import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';
import { nodeFn, type CoreRefs } from './shared';

/**
 * The evaluation sweep (§20.4, ADR 006): a Distributed Map over a manifest
 * of 200 seeds in S3, an Express child per pack at `MaxConcurrency: 40`,
 * and a summary written beside the results. This is the correct use of
 * Distributed Map — a high-fan-out batch over an S3 manifest — and the six
 * documents inside one claim pack use the inline `Map` in the pipeline
 * stack; ADR 006 is about keeping those two apart.
 *
 * Start it with `{ "count": 200, "profile": "degraded" }` (both optional)
 * and read `eval-runs/<runId>/report.txt` from the artifacts bucket: the
 * same text `pnpm eval:run` prints, from the same seeds.
 */
export interface EvalStackProps extends StackProps {
  readonly core: CoreRefs;
}

export class EvalStack extends Stack {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: EvalStackProps) {
    super(scope, id, props);
    const { artifactsBucket } = props.core;
    const env = { ARTIFACTS_BUCKET: artifactsBucket.bucketName };

    const plan = nodeFn(this, 'PlanSweepFn', { entry: 'eval/sweep', handler: 'plan', environment: env });
    const settle = nodeFn(this, 'SettlePackFn', { entry: 'eval/sweep', handler: 'settle', environment: env, timeout: Duration.seconds(30) });
    const summarise = nodeFn(this, 'SummariseSweepFn', {
      entry: 'eval/sweep',
      handler: 'summarise',
      environment: env,
      timeout: Duration.minutes(5),
      memorySize: 2048,
    });
    artifactsBucket.grantWrite(plan);
    artifactsBucket.grantWrite(settle);
    artifactsBucket.grantRead(summarise);
    artifactsBucket.grantWrite(summarise);

    const sPlan = new tasks.LambdaInvoke(this, 'Plan', {
      lambdaFunction: plan,
      payloadResponseOnly: true,
      resultPath: '$.plan',
    });

    const sSettle = new tasks.LambdaInvoke(this, 'Settle', {
      lambdaFunction: settle,
      payloadResponseOnly: true,
    });
    sSettle.addRetry({ errors: ['Lambda.TooManyRequestsException', 'Lambda.ServiceException'], interval: Duration.seconds(1), backoffRate: 2, maxAttempts: 4 });

    const sweep = new sfn.DistributedMap(this, 'Sweep', {
      maxConcurrency: 40,
      mapExecutionType: sfn.StateMachineType.EXPRESS,
      itemReader: new sfn.S3JsonItemReader({
        bucket: artifactsBucket,
        key: sfn.JsonPath.stringAt('$.plan.manifestKey'),
      }),
      resultWriterV2: new sfn.ResultWriterV2({
        bucket: artifactsBucket,
        prefix: 'eval-runs/map-output/',
      }),
      resultPath: '$.sweep',
      toleratedFailurePercentage: 0,
    }).itemProcessor(sSettle);

    const sSummarise = new tasks.LambdaInvoke(this, 'Summarise', {
      lambdaFunction: summarise,
      payload: sfn.TaskInput.fromObject({
        runId: sfn.JsonPath.stringAt('$.plan.runId'),
        profile: sfn.JsonPath.stringAt('$.plan.profile'),
        count: sfn.JsonPath.numberAt('$.plan.count'),
      }),
      payloadResponseOnly: true,
      resultPath: '$.summary',
    });

    this.stateMachine = new sfn.StateMachine(this, 'EvalSweep', {
      stateMachineName: 'fc-eval-sweep',
      definitionBody: sfn.DefinitionBody.fromChainable(sPlan.next(sweep).next(sSummarise)),
      timeout: Duration.hours(1),
      tracingEnabled: true,
      logs: {
        destination: new LogGroup(this, 'EvalSweepLogs', { retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
        level: sfn.LogLevel.ALL,
      },
    });

    new CfnOutput(this, 'EvalStateMachineArn', { value: this.stateMachine.stateMachineArn });

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'S3 object grants are per bucket, the Distributed Map reads its manifest and writes its results by prefix, and the map runs child executions of exactly this state machine.',
        appliesTo: [
          { regex: '/^Resource::<.*Bucket.*Arn>\\/\\*$/g' },
          // The Distributed Map's S3 grants are built from the bucket name, not its ARN token.
          { regex: '/^Resource::arn:<AWS::Partition>:s3:::<.*Bucket.*>\\/\\*$/g' },
          { regex: '/^Resource::<.*Arn>:\\*$/g' },
          { regex: '/^Resource::arn:<AWS::Partition>:states:.*$/g' },
          'Resource::*',
          'Action::s3:GetObject*',
          'Action::s3:GetBucket*',
          'Action::s3:List*',
          'Action::s3:DeleteObject*',
          'Action::s3:Abort*',
        ],
      },
    ]);
  }
}
