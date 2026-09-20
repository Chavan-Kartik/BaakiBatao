import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createApp, createAuth, loadEnv, structuredExtractor, type Env } from '@fc/api';
import { buildLexicon, createNormaliser } from '@fc/normalise';
import { loadRulepackV1 } from '@fc/rulepack';
import type { Hono } from 'hono';
import { optional, parametersUnder, required } from '../shared/config';
import { verifyCertificateSignature } from '../shared/kms-sign';
import { dynamoAuthAdapter } from '../store/auth-adapter';
import { S3DocumentStorage } from '../store/documents';
import { DynamoCaseStore } from '../store/dynamo-store';
import { MAX_UPLOAD_BYTES, sfnRunner } from './runner';

/**
 * The case API on Lambda: the same Hono app `packages/api` serves locally,
 * with DynamoDB behind `CaseStore`, S3 behind `DocumentStorage`, Step
 * Functions behind `PipelineRunner`, KMS behind `verifySignature`, and
 * better-auth on the DynamoDB adapter. Nothing in the routes knows.
 *
 * Built once per container. The public origin (for cookies, CORS and the
 * Cognito callback) is minted by `FcWebStack`, which deploys *after* this
 * function, so it is read from SSM under `/fc/web` rather than baked in as an
 * environment variable — and rebuilt if it changes.
 */
let built: { origin: string | null; app: Promise<Hono> } | null = null;

export async function app(): Promise<Hono> {
  const web = await parametersUnder(optional('WEB_PARAMS_PATH') ?? '/fc/web');
  const origin = web['origin'] ?? null;
  if (!built || built.origin !== origin) {
    built = { origin, app: build(origin, web) };
  }
  return built.app;
}

async function build(origin: string | null, web: Record<string, string>): Promise<Hono> {
  const secret = await authSecret();
  const env: Env = {
    ...loadEnv({
      ...process.env,
      NODE_ENV: 'production',
      FC_DATA_DIR: process.env['FC_DATA_DIR'] ?? '/tmp/fc',
      BETTER_AUTH_SECRET: secret,
      FC_API_BASE_URL: origin ?? 'http://localhost',
      FC_TRUSTED_ORIGINS: origin ?? '',
      FC_EXTRACTOR: 'textract',
      // The app client is registered by the web stack (it needs the origin
      // for the callback URL); the pool and its domain are this stack's.
      FC_COGNITO_CLIENT_ID: web['cognito-client-id'],
      FC_COGNITO_DOMAIN: optional('COGNITO_DOMAIN'),
      FC_COGNITO_REGION: optional('COGNITO_REGION'),
      FC_COGNITO_USER_POOL_ID: optional('COGNITO_USER_POOL_ID'),
    }),
  };

  const tableName = required('TABLE_NAME');
  const rawBucket = required('RAW_BUCKET');
  const rulepack = loadRulepackV1();
  const store = new DynamoCaseStore(tableName);

  const auth = createAuth(env, { database: dynamoAuthAdapter({ tableName }) });

  return createApp({
    env,
    auth,
    deps: {
      store,
      documents: new S3DocumentStorage(rawBucket),
      // The API never extracts anything itself on AWS — the state machine
      // does — but the deps carry an extractor so `/api/health` can say which
      // path the deployment is on.
      extractor: { ...structuredExtractor, name: 'textract (Step Functions)' },
      rulepack,
      normaliser: createNormaliser(buildLexicon(rulepack)),
      now: () => new Date().toISOString(),
      verifySignature: verifyCertificateSignature,
    },
    runner: sfnRunner({
      store,
      rawBucket,
      stateMachineArn: required('STATE_MACHINE_ARN'),
      maxUploadBytes: MAX_UPLOAD_BYTES,
    }),
    health: { origin, region: process.env['AWS_REGION'] ?? null },
    routes: { eventStreamMaxMs: Number(optional('FC_EVENTS_MAX_MS') ?? 9 * 60 * 1000) },
  });
}

async function authSecret(): Promise<string> {
  const arn = required('AUTH_SECRET_ARN');
  const out = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }));
  if (!out.SecretString) throw new Error('the auth secret is empty');
  return out.SecretString;
}
