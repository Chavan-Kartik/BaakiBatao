import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType, Billing, TableEncryptionV2, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Key } from 'aws-cdk-lib/aws-kms';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';

/**
 * Buckets, table, keys and config. Deployed once and then left alone.
 *
 * Spec: build spec §10.2, §17, §23
 */
export class CoreStack extends Stack {
  readonly table: TableV2;
  readonly rawBucket: Bucket;
  readonly redactedBucket: Bucket;
  readonly artifactsBucket: Bucket;
  readonly logsBucket: Bucket;
  readonly documentKey: Key;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3 server access logs for the three data buckets. Deliberately SSE-S3 and
    // not the customer-managed key: S3 log delivery writes here directly, and a
    // CMK on the target bucket is the usual reason logging silently stops.
    this.logsBucket = new Bucket(this, 'AccessLogsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [{ id: 'expire-access-logs', expiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Customer-managed key for claim documents, which are the only genuinely
    // sensitive thing in the system.
    this.documentKey = new Key(this, 'DocumentKey', {
      alias: 'fc/documents',
      enableKeyRotation: true,
      description: 'Encrypts uploaded claim packs at rest',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Raw uploads. KMS-encrypted, and expired after a day — this lifecycle rule
    // is the actual mechanism behind "nothing stores real personal data beyond
    // the demo session" (the project brief §6). A policy, not a promise.
    this.rawBucket = new Bucket(this, 'RawBucket', {
      encryption: BucketEncryption.KMS,
      encryptionKey: this.documentKey,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      eventBridgeEnabled: true,
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 'raw/',
      lifecycleRules: [{ id: 'expire-raw-uploads', expiration: Duration.days(1) }],
      cors: [
        {
          allowedMethods: [HttpMethods.POST, HttpMethods.PUT],
          // The distribution's domain is minted two stacks later, and an S3
          // CORS origin allows exactly one wildcard — so this is the tightest
          // rule that can be written before the public URL exists.
          allowedOrigins: ['https://*.cloudfront.net', 'http://localhost:5173'],
          allowedHeaders: ['*'],
          maxAge: 300,
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Everything downstream of the redaction gate reads from here instead.
    this.redactedBucket = new Bucket(this, 'RedactedBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 'redacted/',
      lifecycleRules: [{ id: 'expire-redacted', expiration: Duration.days(7) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Certificates and generated letters.
    this.artifactsBucket = new Bucket(this, 'ArtifactsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 'artifacts/',
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Single table. Access patterns in the build spec §17.
    this.table = new TableV2(this, 'MainTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      encryption: TableEncryptionV2.awsManagedKey(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // 24h TTL on case items, so demo data disposes of itself.
      timeToLiveAttribute: 'ttl',
      globalSecondaryIndexes: [
        {
          // Every case citing a given clause — powers the "which clauses fire
          // most across the corpus" panel.
          indexName: 'gsi1',
          partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
          sortKey: { name: 'gsi1sk', type: AttributeType.STRING },
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Runtime config that must be changeable without a deploy: the active
    // rulepack version, model IDs, and the normalisation threshold τ.
    new StringParameter(this, 'ActiveRulepackParam', {
      parameterName: '/fc/rulepack/active',
      stringValue: 'v1',
      description: 'Pointer to the live rulepack version. Bump to correct a rule with no redeploy.',
    });

    new StringParameter(this, 'NormalisationTauParam', {
      parameterName: '/fc/normalisation/tau',
      stringValue: '0.08',
      description:
        'Minimum cosine margin between the top two category candidates. Calibrated, not guessed.',
    });

    this.suppressReviewedNagFindings();
  }

  /**
   * Every suppression here is a finding we looked at and decided against, with
   * the reason recorded. None of them are blanket rule disables.
   *
   * Spec: build spec §23
   */
  private suppressReviewedNagFindings(): void {
    NagSuppressions.addResourceSuppressions(this.logsBucket, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'This is the server access log destination. Pointing it at itself is circular and S3 rejects it; the recursion is the reason the rule cannot apply to a log bucket.',
      },
    ]);

    // CDK synthesises these two Lambda-backed custom resources itself, for
    // S3 EventBridge notifications and for autoDeleteObjects. Their roles are
    // framework-owned, so we cannot swap the managed policy or narrow the
    // wildcard without forking the construct.
    for (const path of [
      '/FcCoreStack/BucketNotificationsHandler050a0587b7544547bf325f094a3db834/Role/Resource',
      '/FcCoreStack/Custom::S3AutoDeleteObjectsCustomResourceProvider/Role',
    ]) {
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        path,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason:
              'CDK-generated custom resource role. AWSLambdaBasicExecutionRole is attached by the framework and is not ours to replace.',
          },
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'CDK-generated custom resource role. The wildcard is scoped to the buckets this stack owns and is emitted by the framework.',
          },
        ],
        true,
      );
    }
  }
}
