import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Key, KeySpec, KeyUsage } from 'aws-cdk-lib/aws-kms';
import type { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { LambdaSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';
import { deadLetterQueue, nodeFn, type CoreRefs, type PipelineRefs } from './shared';

/**
 * The per-pack pipeline: one Step Functions Standard state machine, one
 * Lambda per state of the build spec §11, the Textract completion topic,
 * the certificate signing key, and a dead-letter queue on the one function
 * that is invoked asynchronously.
 *
 * Standard rather than Express because two states pause on a task token —
 * Textract completion and human correction — and the correction pause can
 * last hours (ADR 006 is about the *other* Map; this is the inline one).
 *
 * Least privilege is per function. The stages after `RedactionGate` have no
 * `s3:GetObject` on the raw bucket at all, and `WriteProse` — the only
 * function allowed to call Bedrock — is one of them. That is the runtime half
 * of ADR 004; the compile-time half is the `RedactedText` type in
 * `packages/functions`.
 *
 * Spec: build spec §10.2, §11, §13, §16, §23
 */
export interface PipelineStackProps extends StackProps {
  readonly core: CoreRefs;
  /** Where Bedrock is called; may differ from the stack's region (§10.1). */
  readonly bedrockRegion: string;
  /**
   * The prose model, as a model id or a cross-region inference profile id.
   * Empty means `WriteProse` records `ProseWritten { skipped }` and gets no
   * Bedrock permission at all.
   */
  readonly proseModelId: string;
}

export class PipelineStack extends Stack {
  readonly stateMachine: sfn.StateMachine;
  readonly signingKey: Key;
  readonly textractTopic: Topic;
  readonly refs: PipelineRefs;
  /** For the observability stack's DLQ alarm. */
  readonly deadLetterQueueNames: string[] = [];

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const { table, rawBucket, redactedBucket, artifactsBucket, documentKey } = props.core;

    // The certificate key (§16). Asymmetric, so anyone with the public key
    // can verify a certificate offline; ECDSA P-256 because that is what
    // `ECDSA_SHA_256` is. Asymmetric keys cannot rotate automatically.
    this.signingKey = new Key(this, 'CertificateSigningKey', {
      alias: 'fc/certificates',
      keySpec: KeySpec.ECC_NIST_P256,
      keyUsage: KeyUsage.SIGN_VERIFY,
      description: 'Signs reconstruction certificates (ECDSA_SHA_256 over the result hash)',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Textract's completion channel (§11.3). There is no `.sync` integration
    // for async Textract, so the job publishes here and a Lambda redeems the
    // parked task token.
    this.textractTopic = new Topic(this, 'TextractCompleteTopic', {
      displayName: 'Textract completion notifications',
      enforceSSL: true,
    });
    const textractRole = new iam.Role(this, 'TextractPublishRole', {
      assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
      description: 'Lets Textract publish job completion to the SNS topic',
    });
    this.textractTopic.grantPublish(textractRole);

    const env = {
      TABLE_NAME: table.tableName,
      RAW_BUCKET: rawBucket.bucketName,
      REDACTED_BUCKET: redactedBucket.bucketName,
      ARTIFACTS_BUCKET: artifactsBucket.bucketName,
    };
    const stage = (id: string, entry: string, extra: Record<string, string> = {}, timeout = Duration.seconds(60)) =>
      nodeFn(this, `${id}Fn`, { entry: `pipeline/${entry}`, environment: { ...env, ...extra }, timeout });

    /* ------------------------------------------------------ the functions */

    const validatePack = stage('ValidatePack', 'validate-pack');
    const classifyDocs = stage('ClassifyDocuments', 'classify-docs');
    const startTextract = stage('StartTextract', 'start-textract', {
      TEXTRACT_TOPIC_ARN: this.textractTopic.topicArn,
      TEXTRACT_ROLE_ARN: textractRole.roleArn,
    });
    const completeDlq = deadLetterQueue(this, 'TextractCompleteDlq');
    this.deadLetterQueueNames.push(completeDlq.queueName);
    const textractComplete = nodeFn(this, 'TextractCompleteFn', {
      entry: 'pipeline/textract-complete',
      environment: env,
      timeout: Duration.minutes(5),
      deadLetterQueue: completeDlq,
      description: 'SNS-invoked: pages GetDocumentAnalysis and redeems the parked task token',
    });
    const parseBlocks = stage('ParseBlocks', 'parse-tables', {}, Duration.minutes(2));
    const extract = stage('AssembleExtraction', 'extract', {}, Duration.minutes(2));
    const redact = stage('RedactionGate', 'redact', {}, Duration.minutes(5));
    const checksum = stage('ChecksumRows', 'checksum-rows');
    const awaitCorrection = stage('AwaitHumanCorrection', 'await-correction');
    const normalise = stage('Normalise', 'normalise');
    const reconstruct = stage('Reconstruct', 'reconstruct');
    const writeProse = stage(
      'WriteProse',
      'write-prose',
      { BEDROCK_REGION: props.bedrockRegion, PROSE_MODEL_ID: props.proseModelId },
      Duration.minutes(5),
    );
    const issueCertificate = stage('IssueCertificate', 'issue-certificate', { SIGNING_KEY_ID: this.signingKey.keyId });
    const failWithReason = stage('FailWithReason', 'fail-with-reason');

    /* --------------------------------------------------------- the grants */

    // Every stage reads and writes the case record.
    for (const fn of [
      validatePack, classifyDocs, startTextract, textractComplete, extract, redact, checksum,
      awaitCorrection, normalise, reconstruct, writeProse, issueCertificate, failWithReason,
    ]) {
      table.grantReadWriteData(fn);
    }

    // The raw side of the gate: everything up to and including redaction.
    rawBucket.grantRead(startTextract); // Textract reads the object with the caller's permissions
    rawBucket.grantWrite(textractComplete); // textract/<caseId>/<kind>.json
    rawBucket.grantReadWrite(parseBlocks); // parsed/<caseId>/<kind>.json
    rawBucket.grantReadWrite(extract); // extracted/<caseId>.json
    rawBucket.grantRead(redact);
    redactedBucket.grantWrite(redact);
    documentKey.grantEncryptDecrypt(startTextract);
    documentKey.grantEncryptDecrypt(textractComplete);
    documentKey.grantEncryptDecrypt(parseBlocks);
    documentKey.grantEncryptDecrypt(extract);
    documentKey.grantDecrypt(redact);

    // The far side: no raw bucket, no document key. Enforced by absence.
    artifactsBucket.grantWrite(writeProse);
    artifactsBucket.grantWrite(issueCertificate);
    this.signingKey.grant(issueCertificate, 'kms:Sign');

    startTextract.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['textract:StartDocumentAnalysis'], resources: ['*'] }),
    );
    textractRole.grantPassRole(startTextract.role!);
    textractComplete.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentAnalysis', 'states:SendTaskSuccess', 'states:SendTaskFailure'],
        resources: ['*'],
      }),
    );
    redact.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['comprehend:DetectPiiEntities'], resources: ['*'] }),
    );
    if (props.proseModelId) {
      writeProse.addToRolePolicy(
        new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: bedrockModelArns(this, props.bedrockRegion, props.proseModelId) }),
      );
    }

    this.textractTopic.addSubscription(new LambdaSubscription(textractComplete, { deadLetterQueue: completeDlq }));

    /* -------------------------------------------------- the state machine */

    const failed = this.failureChain(failWithReason);
    // Inside the Map iterator a task only retries: a catch there would pull the
    // outer failure chain into the iterator's graph. The Map state's own catch
    // routes anything that escapes the iterator to FailWithReason.
    const guard = <T extends sfn.TaskStateBase>(task: T, inMap = false): T => {
      task.addRetry({
        errors: [
          'Lambda.ServiceException',
          'Lambda.AWSLambdaException',
          'Lambda.SdkClientException',
          'Lambda.TooManyRequestsException',
          'BEDROCK_THROTTLED',
        ],
        interval: Duration.seconds(2),
        backoffRate: 2,
        maxAttempts: 3,
      });
      if (!inMap) task.addCatch(failed, { errors: ['States.ALL'], resultPath: '$.error' });
      return task;
    };
    const invoke = (id: string, fn: LambdaFunction, payload: Record<string, unknown>, resultPath: string, inMap = false) =>
      guard(
        new tasks.LambdaInvoke(this, id, {
          lambdaFunction: fn,
          payload: sfn.TaskInput.fromObject(payload),
          payloadResponseOnly: true,
          resultPath,
          retryOnServiceExceptions: false,
        }),
        inMap,
      );
    const caseId = { caseId: sfn.JsonPath.stringAt('$.caseId') };

    const sValidate = invoke('ValidatePack', validatePack, caseId, '$.validated');
    const sClassify = invoke('ClassifyDocuments', classifyDocs, caseId, '$.classified');

    // 3a/3b, per document. Structured JSON skips Textract; a scan parks on a
    // task token until the completion topic wakes it, then is parsed.
    const sStartTextract = guard(
      new tasks.LambdaInvoke(this, 'StartTextract', {
        lambdaFunction: startTextract,
        integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        payload: sfn.TaskInput.fromObject({
          ...caseId,
          doc: sfn.JsonPath.objectAt('$.doc'),
          taskToken: sfn.JsonPath.taskToken,
        }),
        resultPath: '$.textract',
        taskTimeout: sfn.Timeout.duration(Duration.minutes(30)),
        retryOnServiceExceptions: false,
      }),
      true,
    );
    const sParse = invoke(
      'ParseBlocks',
      parseBlocks,
      { ...caseId, doc: sfn.JsonPath.objectAt('$.doc'), blocksKey: sfn.JsonPath.stringAt('$.textract.blocksKey') },
      '$.parsed',
      true,
    );
    const scanned = new sfn.Pass(this, 'ScannedDocument', {
      parameters: {
        'kind.$': '$.doc.kind',
        source: 'textract',
        'parsedKey.$': '$.parsed.parsedKey',
      },
    });
    const structured = new sfn.Pass(this, 'StructuredDocument', {
      parameters: { 'kind.$': '$.doc.kind', source: 'structured', parsedKey: null },
    });
    const perDocument = new sfn.Choice(this, 'NeedsOcr?')
      .when(sfn.Condition.stringEquals('$.doc.contentType', 'application/json'), structured)
      .otherwise(sStartTextract.next(sParse).next(scanned));
    const sExtractDocuments = new sfn.Map(this, 'ExtractDocuments', {
      itemsPath: '$.validated.documents',
      maxConcurrency: 4,
      itemSelector: { ...caseId, doc: sfn.JsonPath.objectAt('$$.Map.Item.Value') },
      resultPath: '$.extracted',
    }).itemProcessor(perDocument);
    sExtractDocuments.addCatch(failed, { errors: ['States.ALL'], resultPath: '$.error' });

    const sAssemble = invoke('AssembleExtraction', extract, { ...caseId, documents: sfn.JsonPath.listAt('$.extracted') }, '$.pack');
    const sRedact = invoke('RedactionGate', redact, { ...caseId, packKey: sfn.JsonPath.stringAt('$.pack.packKey') }, '$.redaction');
    const sChecksum = invoke('ChecksumRows', checksum, caseId, '$.checksum');

    const sAwait = guard(
      new tasks.LambdaInvoke(this, 'AwaitHumanCorrection', {
        lambdaFunction: awaitCorrection,
        integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        payload: sfn.TaskInput.fromObject({ ...caseId, taskToken: sfn.JsonPath.taskToken }),
        resultPath: '$.correction',
        taskTimeout: sfn.Timeout.duration(Duration.hours(24)),
        retryOnServiceExceptions: false,
      }),
    );

    const sNormalise = invoke('Normalise', normalise, caseId, '$.normalised');
    const sReconstruct = invoke('Reconstruct', reconstruct, { ...caseId, lines: sfn.JsonPath.listAt('$.normalised.lines') }, '$.reconstructed');
    const sProse = invoke('WriteProse', writeProse, caseId, '$.prose');
    const sCertificate = invoke('IssueCertificate', issueCertificate, caseId, '$.certificate');
    const succeeded = new sfn.Succeed(this, 'Succeeded');

    // Belt and braces: the engine already materialises the residual, and
    // `Reconstruct` throws on an unbalanced ledger. This choice re-reads the
    // flag the engine set and refuses to write prose about a ledger that
    // does not add up.
    const invariantViolated = new sfn.Pass(this, 'InvariantViolated', {
      result: sfn.Result.fromObject({ Error: 'INVARIANT_VIOLATED', Cause: 'the ledger did not balance' }),
      resultPath: '$.error',
    }).next(failed);
    const sInvariantHeld = new sfn.Choice(this, 'InvariantHeld?')
      .when(sfn.Condition.booleanEquals('$.reconstructed.invariantHeld', false), invariantViolated)
      .otherwise(sProse.next(sCertificate).next(succeeded));

    const fromNormalise = sNormalise.next(sReconstruct).next(sInvariantHeld);
    const sNeedsCorrection = new sfn.Choice(this, 'NeedsCorrection?')
      .when(sfn.Condition.booleanEquals('$.checksum.ok', false), sAwait.next(fromNormalise))
      .otherwise(fromNormalise);

    const fromTop = sValidate
      .next(sClassify)
      .next(sExtractDocuments)
      .next(sAssemble)
      .next(sRedact)
      .next(sChecksum)
      .next(sNeedsCorrection);

    // A completed case being corrected again enters here (§11.7): there is no
    // parked execution to wake, so a fresh one starts at Normalise.
    const entry = new sfn.Choice(this, 'Entry')
      .when(
        sfn.Condition.and(
          sfn.Condition.isPresent('$.resumeFrom'),
          sfn.Condition.isNotNull('$.resumeFrom'),
          sfn.Condition.stringEquals('$.resumeFrom', 'Normalise'),
        ),
        fromNormalise,
      )
      .otherwise(fromTop);

    this.stateMachine = new sfn.StateMachine(this, 'CasePipeline', {
      stateMachineName: 'fc-case-pipeline',
      definitionBody: sfn.DefinitionBody.fromChainable(entry),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: Duration.hours(25),
      tracingEnabled: true,
      logs: {
        destination: new LogGroup(this, 'CasePipelineLogs', {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    this.refs = { stateMachineArn: this.stateMachine.stateMachineArn, signingKey: this.signingKey };
    this.suppressReviewedNagFindings();
  }

  /** `FailWithReason` then a terminal `Fail` carrying the taxonomy code (§11.2). */
  private failureChain(failWithReason: LambdaFunction): sfn.Chain {
    const record = new tasks.LambdaInvoke(this, 'FailWithReason', {
      lambdaFunction: failWithReason,
      payload: sfn.TaskInput.fromObject({
        caseId: sfn.JsonPath.stringAt('$.caseId'),
        error: sfn.JsonPath.objectAt('$.error'),
      }),
      payloadResponseOnly: true,
      resultPath: '$.failure',
      retryOnServiceExceptions: true,
    });
    const fail = new sfn.Fail(this, 'Failed', {
      errorPath: sfn.JsonPath.stringAt('$.failure.code'),
      causePath: sfn.JsonPath.stringAt('$.failure.message'),
    });
    return record.next(fail);
  }

  private suppressReviewedNagFindings(): void {
    NagSuppressions.addResourceSuppressions(this.signingKey, [
      {
        id: 'AwsSolutions-KMS5',
        reason: 'Asymmetric signing keys cannot be rotated automatically by KMS; rotating would also invalidate every certificate already issued against the public key.',
      },
    ]);
    NagSuppressions.addResourceSuppressions(this.textractTopic, [
      {
        id: 'AwsSolutions-SNS2',
        reason: 'The topic carries Textract job ids and a status word, never document content; a CMK here would need a key policy for the Textract service principal for no confidentiality gain.',
      },
    ]);
    // Function roles: bucket grants are `bucket/*`, table grants include
    // `table/index/*`, and Textract, Comprehend and SendTaskSuccess have no
    // resource-level permissions at all.
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'S3 object grants are per bucket; DynamoDB grants include the GSI; textract:*, comprehend:DetectPiiEntities and states:SendTask* accept no resource ARN. Each function holds only the buckets and actions its stage needs, and the Bedrock-calling function has no raw-bucket grant at all.',
        appliesTo: [
          { regex: '/^Resource::<.*Bucket.*Arn>\\/\\*$/g' },
          { regex: '/^Resource::<.*Table.*Arn>\\/index\\/\\*$/g' },
          { regex: '/^Resource::arn:<AWS::Partition>:bedrock:.*$/g' },
          'Resource::*',
          'Action::s3:GetObject*',
          'Action::s3:GetBucket*',
          'Action::s3:List*',
          'Action::s3:DeleteObject*',
          'Action::s3:Abort*',
          'Action::kms:ReEncrypt*',
          'Action::kms:GenerateDataKey*',
        ],
      },
    ]);
    // The state machine's role invokes each function by unqualified ARN,
    // which CDK grants as `function:*` so aliases and versions resolve.
    NagSuppressions.addResourceSuppressions(
      this.stateMachine,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'lambda:InvokeFunction on <function>:* is how CDK lets the state machine invoke any version or alias of exactly the functions in this stack.',
          appliesTo: [{ regex: '/^Resource::<.*Arn>:\\*$/g' }],
        },
      ],
      true,
    );
  }
}

/**
 * The ARNs `bedrock:InvokeModel` needs for a model id or an inference
 * profile id. A profile (`apac.anthropic…`, `us.anthropic…`) resolves to
 * foundation models in several regions, so the grant names the profile in
 * the calling region and the bare model in every region.
 */
function bedrockModelArns(stack: Stack, bedrockRegion: string, modelId: string): string[] {
  const profile = /^(apac|us|eu|global)\./.exec(modelId);
  const bare = profile ? modelId.slice(profile[0].length) : modelId;
  const arns = [`arn:${stack.partition}:bedrock:*::foundation-model/${bare}`];
  if (profile) arns.push(`arn:${stack.partition}:bedrock:${bedrockRegion}:${stack.account}:inference-profile/${modelId}`);
  return arns;
}
