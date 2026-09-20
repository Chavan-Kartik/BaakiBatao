import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, type CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  AccountRecovery,
  FeaturePlan,
  Mfa,
  UserPool,
  UserPoolDomain,
} from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType, InvokeMode, type Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';
import { nodeFn, type ApiRefs, type CoreRefs, type PipelineRefs } from './shared';

/**
 * The hosted API: the same Hono app `packages/api` serves locally, on two
 * Lambdas from one bundle — an HTTP API for every route, and a Function URL
 * with response streaming for the events stream, which API Gateway cannot
 * carry. Both sit behind the web distribution under `/api/*`, so the session
 * cookie is first-party and there is no CORS.
 *
 * Sign-in stays better-auth (sessions in the single table, through the
 * DynamoDB adapter in `packages/functions`). Amazon Cognito is the optional
 * second way in: a user pool here, and the app client — which must know the
 * public origin — in the web stack, through better-auth's Cognito social
 * provider. Nothing about the routes changes either way.
 *
 * The public origin is minted by the web stack, which deploys after this
 * one, so the Lambda reads it from SSM under `/fc/web` at cold start rather
 * than from an environment variable. That keeps the stacks a DAG.
 *
 * Spec: build spec §10.2, §18, §23
 */
export interface ApiStackProps extends StackProps {
  readonly core: CoreRefs;
  readonly pipeline: PipelineRefs;
}

export const WEB_PARAMS_PATH = '/fc/web';

export class ApiStack extends Stack {
  readonly httpApi: HttpApi;
  readonly userPool: UserPool;
  readonly refs: ApiRefs;
  /** For the observability stack. */
  readonly functions: LambdaFunction[];
  private readonly authSecret: Secret;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { table, rawBucket, artifactsBucket, documentKey } = props.core;

    // better-auth's signing secret, generated once and never written down.
    this.authSecret = new Secret(this, 'AuthSecret', {
      description: 'BETTER_AUTH_SECRET for the hosted API',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Cognito, as an identity provider better-auth federates to. Self
    // sign-up with email, password rules that satisfy the nag rule, no MFA
    // (a demo for policyholders, not a bank), Essentials tier.
    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: 'fc-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: Mfa.OFF,
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      featurePlan: FeaturePlan.ESSENTIALS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // Hosted UI domain. The prefix must be unique in the region, so it takes
    // the stack id's suffix rather than a name someone else may hold.
    const domain = new UserPoolDomain(this, 'UserPoolDomain', {
      userPool: this.userPool,
      cognitoDomain: { domainPrefix: `fc-${uniqueSuffix(this)}` },
    });
    const cognitoDomain = `${domain.domainName}.auth.${this.region}.amazoncognito.com`;

    const environment = {
      TABLE_NAME: table.tableName,
      RAW_BUCKET: rawBucket.bucketName,
      ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      STATE_MACHINE_ARN: props.pipeline.stateMachineArn,
      AUTH_SECRET_ARN: this.authSecret.secretArn,
      WEB_PARAMS_PATH,
      COGNITO_USER_POOL_ID: this.userPool.userPoolId,
      COGNITO_REGION: this.region,
      COGNITO_DOMAIN: cognitoDomain,
      FC_EVENTS_MAX_MS: String(9 * 60 * 1000),
    };

    const api = nodeFn(this, 'Api', {
      entry: 'api/http',
      environment,
      timeout: Duration.seconds(29),
      description: 'The case API (every route but the events stream), behind the HTTP API',
    });
    const events = nodeFn(this, 'Events', {
      entry: 'api/events',
      environment,
      timeout: Duration.minutes(10),
      description: 'GET /api/cases/{id}/events — server-sent events over a streaming Function URL',
    });

    this.functions = [api, events];
    for (const fn of this.functions) {
      table.grantReadWriteData(fn);
      this.authSecret.grantRead(fn);
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ssm:GetParametersByPath'],
          resources: [`arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${WEB_PARAMS_PATH}`],
        }),
      );
    }
    // The API presigns uploads into raw/, records what landed there, and can
    // still take a direct PUT; it never reads a document for a model.
    rawBucket.grantReadWrite(api);
    documentKey.grantEncryptDecrypt(api);
    props.pipeline.signingKey.grant(api, 'kms:Verify');
    api.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['states:StartExecution'], resources: [props.pipeline.stateMachineArn] }),
    );
    api.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'], resources: ['*'] }),
    );

    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: 'fc-api',
      description: 'Settlement reconstructor case API',
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', api),
      createDefaultStage: true,
    });
    const accessLogs = new LogGroup(this, 'HttpApiAccessLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const stage = this.httpApi.defaultStage!.node.defaultChild as CfnStage;
    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        ip: '$context.identity.sourceIp',
        requestTime: '$context.requestTime',
        method: '$context.httpMethod',
        path: '$context.path',
        status: '$context.status',
        latencyMs: '$context.responseLatency',
        integrationError: '$context.integrationErrorMessage',
      }),
    };

    const eventsUrl = events.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });

    this.refs = {
      httpApiDomain: `${this.httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
      eventsUrlDomain: Fn.select(2, Fn.split('/', eventsUrl.url)),
      userPoolId: this.userPool.userPoolId,
      userPoolArn: this.userPool.userPoolArn,
    };

    new CfnOutput(this, 'HttpApiUrl', { value: this.httpApi.apiEndpoint, description: 'Direct HTTP API endpoint (the web URL fronts it)' });
    new CfnOutput(this, 'EventsUrl', { value: eventsUrl.url, description: 'Streaming Function URL for the events route' });
    new CfnOutput(this, 'CognitoHostedUi', { value: `https://${cognitoDomain}`, description: 'Cognito Hosted UI domain' });

    this.suppressReviewedNagFindings();
  }

  private suppressReviewedNagFindings(): void {
    NagSuppressions.addResourceSuppressions(this.authSecret, [
      {
        id: 'AwsSolutions-SMG4',
        reason: 'This is the session-signing secret for better-auth, not a database credential: rotating it invalidates every live session, and there is no consumer for Secrets Manager to rotate it against. It is generated once by CloudFormation and read only by the API functions.',
      },
    ]);
    NagSuppressions.addResourceSuppressions(this.userPool, [
      {
        id: 'AwsSolutions-COG8',
        reason: 'The Plus feature plan is billed per monthly active user and exists for threat protection on production identity; this pool federates a demo whose cases expire in 24 hours. Essentials is the deliberate choice, and COG3 below is the same decision seen from the other side.',
      },
      {
        id: 'AwsSolutions-COG2',
        reason: 'MFA is off on purpose: the audience is policyholders reviewing a demo, sign-in gates ownership of a case that expires in 24 hours, and forcing an authenticator onto them would cost more sign-ups than it protects.',
      },
      {
        id: 'AwsSolutions-COG3',
        reason: 'Advanced security (threat protection) requires the Plus feature plan, which is billed per monthly active user; for a demo pool on the Essentials plan the control is not available rather than declined.',
      },
    ]);
    NagSuppressions.addResourceSuppressions(this.httpApi, [
      {
        id: 'AwsSolutions-APIG4',
        reason: 'Authorization is the application session: every /api/cases route checks the better-auth cookie and scopes the case to its owner, and /api/auth/* must be reachable unauthenticated by definition. A gateway authorizer would need the same session logic duplicated at the edge.',
      },
    ], true);
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'S3 object grants are per bucket; the DynamoDB grant includes the GSI; states:SendTaskSuccess accepts no resource ARN. The API holds the raw bucket because it presigns uploads into it; it never calls a model.',
        appliesTo: [
          { regex: '/^Resource::<.*Bucket.*Arn>\\/\\*$/g' },
          { regex: '/^Resource::<.*Table.*Arn>\\/index\\/\\*$/g' },
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
  }
}

/** The last segment of the stack id, unique per deployed stack — the CloudFormation idiom for names that must not collide. */
function uniqueSuffix(stack: Stack): string {
  return Fn.select(4, Fn.split('-', Fn.select(2, Fn.split('/', stack.stackId))));
}
