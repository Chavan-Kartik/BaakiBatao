import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import type { Key } from 'aws-cdk-lib/aws-kms';
import { Architecture, Runtime, Tracing, type Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { NagSuppressions } from 'cdk-nag';
import { join } from 'node:path';
import type { Construct } from 'constructs';

/**
 * What crosses a stack boundary, as explicit props — never `Fn::ImportValue`
 * by name (build spec §10.2). A stack that holds data takes `CoreRefs`; a
 * stack that starts work takes `PipelineRefs`; the web tier takes `ApiRefs`.
 * Nothing else is shared, and the DAG is Core → Pipeline → Api → Web, with
 * Eval and Observability hanging off Core and Pipeline.
 */
export interface CoreRefs {
  /** `MainTable` (`pk`/`sk`, `gsi1`): case records, auth rows, lexicon, task tokens. */
  readonly table: TableV2;
  /** Presigned uploads land here. SSE-KMS. 1-day expiry. */
  readonly rawBucket: Bucket;
  /** Everything downstream of the redaction gate reads from here. SSE-S3. 7-day expiry. */
  readonly redactedBucket: Bucket;
  /** Certificates, letters, prose and evaluation runs. Versioned. */
  readonly artifactsBucket: Bucket;
  /** Customer-managed key for claim documents. */
  readonly documentKey: Key;
}

export interface PipelineRefs {
  /** The per-pack state machine; the API starts and resumes executions on it. */
  readonly stateMachineArn: string;
  /** The asymmetric key certificates are signed with; the API verifies against it. */
  readonly signingKey: Key;
}

export interface ApiRefs {
  /** `https://{id}.execute-api.{region}.amazonaws.com` — every route but the events stream. */
  readonly httpApiDomain: string;
  /** The Function URL's host, for the streaming events route. */
  readonly eventsUrlDomain: string;
  /** The Cognito user pool the web tier registers its app client with. */
  readonly userPoolId: string;
  readonly userPoolArn: string;
}

/** `packages/functions`, resolved from this file rather than from the cwd. */
export const FUNCTIONS_DIR = join(import.meta.dirname, '..', '..', 'functions');

export interface NodeFnProps {
  /** Path under `packages/functions/src`, without extension. */
  readonly entry: string;
  readonly handler?: string;
  readonly environment?: Record<string, string>;
  readonly timeout?: Duration;
  readonly memorySize?: number;
  readonly description?: string;
  /** For a function invoked asynchronously: where an invocation that exhausts its retries lands. */
  readonly deadLetterQueue?: Queue;
}

/**
 * Every handler the same way: Node 24 on arm64, 1 GB, X-Ray on, ESM bundle
 * from the workspace source with the AWS SDK left to the runtime, a log
 * group we own with a retention. The engine is pure, so the handlers are
 * I/O and a bundle of `@fc/*` source; nothing is compiled ahead of synth.
 */
export function nodeFn(scope: Construct, id: string, props: NodeFnProps): NodejsFunction {
  const fn = new NodejsFunction(scope, id, {
    entry: join(FUNCTIONS_DIR, 'src', `${props.entry}.ts`),
    handler: props.handler ?? 'handler',
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    memorySize: props.memorySize ?? 1024,
    timeout: props.timeout ?? Duration.seconds(60),
    tracing: Tracing.ACTIVE,
    description: props.description,
    deadLetterQueue: props.deadLetterQueue,
    environment: {
      NODE_OPTIONS: '--enable-source-maps',
      POWERTOOLS_SERVICE_NAME: 'fc',
      ...props.environment,
    },
    logGroup: new LogGroup(scope, `${id}Logs`, {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    }),
    bundling: {
      format: OutputFormat.ESM,
      target: 'node22',
      mainFields: ['module', 'main'],
      sourceMap: true,
      minify: false,
      externalModules: ['@aws-sdk/*'],
      // ESM bundles have no `require`; a few transitive dependencies still
      // call it, and `createRequire` is the standard shim.
      banner: "import { createRequire as __fcRequire } from 'node:module'; const require = __fcRequire(import.meta.url);",
    },
    // The workspace lockfile is the one pnpm uses; without this, bundling
    // looks for a package-lock next to the entry and finds none.
    depsLockFilePath: join(FUNCTIONS_DIR, '..', '..', 'pnpm-lock.yaml'),
    projectRoot: join(FUNCTIONS_DIR, '..', '..'),
  });
  suppressLambdaNag(fn);
  return fn;
}

/**
 * The findings every NodejsFunction raises, reviewed once here rather than
 * once per handler: the basic execution managed policy CDK attaches, and the
 * wildcard X-Ray actions `tracing: ACTIVE` needs.
 */
export function suppressLambdaNag(fn: LambdaFunction): void {
  NagSuppressions.addResourceSuppressions(
    fn,
    [
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'AWSLambdaBasicExecutionRole is the log-writing policy CDK attaches to every function role; it grants CloudWatch Logs only.',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'xray:PutTraceSegments and PutTelemetryRecords take no resource ARN; the wildcard is the only form the API accepts.',
        appliesTo: ['Resource::*'],
      },
    ],
    true,
  );
}

/** A dead-letter queue for an asynchronously invoked function. Nothing disappears silently. */
export function deadLetterQueue(scope: Construct, id: string): Queue {
  const dlq = new Queue(scope, id, {
    encryption: QueueEncryption.SQS_MANAGED,
    enforceSSL: true,
    retentionPeriod: Duration.days(14),
    removalPolicy: RemovalPolicy.DESTROY,
  });
  NagSuppressions.addResourceSuppressions(dlq, [
    {
      id: 'AwsSolutions-SQS3',
      reason: 'This queue is itself the dead-letter destination; a dead-letter queue for the dead-letter queue is recursion, not resilience.',
    },
  ]);
  return dlq;
}

/** Fail fast: a stack composed in `bin/app.ts` passes concrete resources, not looked-up names. */
export function requireProps<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Missing required stack input: ${name}`);
  return value;
}

export const regionOf = (scope: Construct): string => Stack.of(scope).region;
