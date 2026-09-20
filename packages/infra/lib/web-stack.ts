import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  HttpVersion,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy,
  type BehaviorOptions,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { OAuthScope, UserPool, UserPoolClient, UserPoolClientIdentityProvider } from 'aws-cdk-lib/aws-cognito';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { join } from 'node:path';
import type { Construct } from 'constructs';
import type { ApiRefs } from './shared';

/**
 * The public URL.
 *
 * One distribution serves the web bundle from a private bucket and proxies
 * `/api/*` to the hosted API — the HTTP API for every route, the streaming
 * Function URL for the events route — so the browser sees one origin, the
 * session cookie is first-party, and nothing here needs CORS. That is the
 * same shape `docker/nginx.conf` gives the container deployment.
 *
 * Without `api`, the stack is the standalone demo it always was: the engine
 * is pure and the bundle settles the reference claim in the browser, so a
 * static distribution is a working product, not a placeholder.
 *
 * This stack deploys last and mints the origin the API needs for cookies and
 * the Cognito callback, so it writes that origin — and the Cognito app
 * client it registers against it — to SSM under `/fc/web`, where the API
 * Lambda reads them at cold start.
 *
 * Spec: build spec §10.2, §10.4, §22
 */
export interface WebStackProps extends StackProps {
  /** Built by `pnpm web:build` before synth. */
  readonly bundlePath?: string;
  /** The hosted API to front. Omit for the static demo alone. */
  readonly api?: ApiRefs;
}

export class WebStack extends Stack {
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props?: WebStackProps) {
    super(scope, id, props);

    // CloudFront standard logging writes with an ACL, so this one bucket has to
    // allow them. Every other bucket in the system keeps ACLs disabled
    // entirely; confining the exception to the log destination is the reason it
    // is a separate bucket rather than a relaxed setting on a shared one.
    const logsBucket = new Bucket(this, 'CloudFrontLogsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ id: 'expire-cf-logs', expiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Private. Reachable only through the distribution, via Origin Access
    // Control — never a public bucket policy and never a website endpoint,
    // which cannot speak TLS.
    const originBucket = new Bucket(this, 'OriginBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      serverAccessLogsBucket: logsBucket,
      serverAccessLogsPrefix: 'origin/',
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // The app routes client-side, so a deep link has no object behind it.
    // Paths without a file extension are rewritten to index.html at the
    // edge, before the origin is asked. This is done as a viewer-request
    // function rather than with custom error responses on purpose: error
    // responses apply to every behaviour on the distribution, and would
    // turn the API's own 404 ("no such case") into a 200 with a web page.
    const spaRewrite = new CloudFrontFunction(this, 'SpaRewrite', {
      code: FunctionCode.fromInline(
        `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('/api/') !== 0 && uri.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}`,
      ),
      comment: 'Rewrites extension-less paths to /index.html for client-side routing',
    });

    this.distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(originBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [{ function: spaRewrite, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: props?.api ? apiBehaviors(props.api) : undefined,
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      // No `minimumProtocolVersion` here on purpose: it has no effect without a
      // custom certificate, and setting it would only look like a control that
      // is not actually in force. See the CFR4 suppression below.
      // Cheapest tier that still serves India from an Indian edge location.
      priceClass: PriceClass.PRICE_CLASS_200,
      enableLogging: true,
      logBucket: logsBucket,
      logFilePrefix: 'cdn/',
    });

    new BucketDeployment(this, 'DeployBundle', {
      sources: [Source.asset(props?.bundlePath ?? defaultBundlePath())],
      destinationBucket: originBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
      // Vite fingerprints the assets, so they are immutable. index.html is not
      // fingerprinted and must never be cached, or a deploy would leave viewers
      // on a stale document pointing at deleted asset hashes.
      cacheControl: [CacheControl.fromString('public, max-age=31536000, immutable')],
    });

    new BucketDeployment(this, 'DeployIndex', {
      sources: [Source.asset(props?.bundlePath ?? defaultBundlePath(), { exclude: ['assets/**'] })],
      destinationBucket: originBucket,
      distribution: this.distribution,
      distributionPaths: ['/index.html'],
      prune: false,
      cacheControl: [CacheControl.fromString('no-cache, must-revalidate')],
    });

    const origin = `https://${this.distribution.distributionDomainName}`;
    new CfnOutput(this, 'Url', { value: origin, description: 'The public URL' });

    if (props?.api) this.registerWithApi(props.api, origin);

    this.suppressReviewedNagFindings();
  }

  /**
   * What the API needs from this stack, written where its Lambda reads it:
   * the public origin, and the Cognito app client whose callback URL is on
   * that origin. Explicit values, not exports — see `shared.ts`.
   */
  private registerWithApi(api: ApiRefs, origin: string): void {
    const userPool = UserPool.fromUserPoolId(this, 'UserPool', api.userPoolId);
    const client = new UserPoolClient(this, 'WebClient', {
      userPool,
      userPoolClientName: 'fc-web',
      // Public client with PKCE: better-auth runs the code exchange in the
      // Lambda with no secret, which is the right shape for a browser flow.
      generateSecret: false,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: [`${origin}/api/auth/callback/cognito`],
        logoutUrls: [`${origin}/`],
      },
      preventUserExistenceErrors: true,
    });

    new StringParameter(this, 'OriginParam', {
      parameterName: '/fc/web/origin',
      stringValue: origin,
      description: 'The public origin; the API uses it for cookies, CORS and the Cognito callback',
    });
    new StringParameter(this, 'CognitoClientParam', {
      parameterName: '/fc/web/cognito-client-id',
      stringValue: client.userPoolClientId,
      description: 'Cognito app client registered against the public origin',
    });
  }

  private suppressReviewedNagFindings(): void {
    NagSuppressions.addResourceSuppressions(this, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'The CloudFront log bucket is the access log destination. Pointing it at itself is circular and S3 rejects it.',
      },
    ]);

    NagSuppressions.addResourceSuppressions(
      this.distribution,
      [
        {
          id: 'AwsSolutions-CFR1',
          reason:
            'Deliberately not geo-restricted. The audience is Indian policyholders, but restricting by viewer country would also block the judges and anyone reviewing the submission from outside India.',
        },
        {
          id: 'AwsSolutions-CFR4',
          reason:
            "Unfixable while the distribution uses the default *.cloudfront.net certificate, whose security policy AWS fixes at TLSv1 regardless of what the template asks for. Raising it requires a custom domain and an ACM certificate, which this submission does not have. Attaching a domain is the fix, and it changes this stack by two properties.",
        },
        {
          id: 'AwsSolutions-CFR2',
          reason:
            'No WAF. The static behaviour serves immutable assets from a private bucket; the API behaviours forward to an application that authenticates every request itself and holds nothing beyond a 24-hour demo case. A WAF web ACL costs more per month than the rest of this stack combined.',
        },
      ],
      true,
    );

    // The BucketDeployment and auto-delete handlers are Lambda-backed custom
    // resources that CDK generates, and their construct IDs embed a hash of the
    // CDK version. Matching on the id prefix rather than the full path means a
    // CDK upgrade does not turn every suppression into a synth error, which is
    // what happens when these are written out by hand.
    const generated = this.node
      .findAll()
      .filter((c) => /^Custom::(CDKBucketDeployment|S3AutoDeleteObjects)/.test(c.node.id));

    for (const construct of generated) {
      NagSuppressions.addResourceSuppressions(
        construct,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason:
              'CDK-generated custom resource role; the managed policy is attached by the framework.',
          },
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'CDK-generated custom resource role. The wildcard is scoped to the bucket and distribution this stack owns.',
          },
          {
            id: 'AwsSolutions-L1',
            reason:
              'The runtime of the bundled BucketDeployment handler is pinned by the CDK version, not by us.',
          },
        ],
        true,
      );
    }
  }
}

/**
 * `/api/*` to the HTTP API, and the events route to the streaming Function
 * URL. Nothing is cached; every viewer header, cookie and query string is
 * forwarded except `Host`, which each origin needs to be its own.
 */
function apiBehaviors(api: ApiRefs): Record<string, BehaviorOptions> {
  const common: Omit<BehaviorOptions, 'origin'> = {
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    compress: false,
  };
  return {
    // Server-sent events stay open; the origin read timeout is the ceiling
    // on a quiet stretch (the route sends a keep-alive well inside it).
    'api/cases/*/events': {
      ...common,
      origin: new HttpOrigin(api.eventsUrlDomain, {
        protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
        readTimeout: Duration.seconds(60),
      }),
    },
    'api/*': {
      ...common,
      origin: new HttpOrigin(api.httpApiDomain, { protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY }),
    },
  };
}

/** `packages/web/dist`, resolved from this file rather than from the cwd. */
function defaultBundlePath(): string {
  return join(import.meta.dirname, '..', '..', 'web', 'dist');
}
