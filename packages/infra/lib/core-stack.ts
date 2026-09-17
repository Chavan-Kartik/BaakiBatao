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
  readonly documentKey: Key;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

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
      lifecycleRules: [{ id: 'expire-raw-uploads', expiration: Duration.days(1) }],
      cors: [
        {
          allowedMethods: [HttpMethods.POST, HttpMethods.PUT],
          allowedOrigins: ['*'], // TODO(W1): narrow to the CloudFront domain
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
  }
}
