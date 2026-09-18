import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { NagSuppressions } from 'cdk-nag';
import { join } from 'node:path';
import type { Construct } from 'constructs';

/**
 * The public URL.
 *
 * This stack is the whole demo, and it has no backend. `packages/engine` is
 * pure, so the same waterfall that runs in Lambda as the authority is compiled
 * into the browser bundle — which means a static distribution is a working
 * product, not a placeholder. It is also the cheapest thing in the account:
 * there is nothing here that costs money while nobody is looking at it.
 *
 * Spec: build spec §10.4, §22
 */
export interface WebStackProps extends StackProps {
  /** Built by `pnpm web:build` before synth. */
  readonly bundlePath?: string;
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

    this.distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(originBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
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
      // The app routes client-side, so a deep link has no object behind it.
      // Both codes are rewritten rather than 404ing, and the 200 matters:
      // returning index.html under a 404 would break the browser history API.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
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

    new CfnOutput(this, 'Url', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'The public URL',
    });

    this.suppressReviewedNagFindings();
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
            "Unfixable while the distribution uses the default *.cloudfront.net certificate, whose security policy AWS fixes at TLSv1 regardless of what the template asks for. Raising it requires a custom domain and an ACM certificate, which this submission does not have. The site serves only public static assets and sets no cookies, so a downgrade reveals nothing that is not already public. Attaching a domain is the fix, and it changes this stack by two properties.",
        },
        {
          id: 'AwsSolutions-CFR2',
          reason:
            'No WAF. The distribution serves immutable static assets from a private bucket with no origin request forwarding, no cookies and no query strings in the cache key, so there is no request-borne attack surface for a WAF to inspect. A WAF web ACL also costs more per month than the rest of this stack combined.',
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

/** `packages/web/dist`, resolved from this file rather than from the cwd. */
function defaultBundlePath(): string {
  return join(import.meta.dirname, '..', '..', 'web', 'dist');
}
