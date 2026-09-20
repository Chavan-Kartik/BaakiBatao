import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { buildLexicon, createNormaliser } from '@fc/normalise';
import { loadRulepackV1 } from '@fc/rulepack';
import { createAuth, migrateAuth } from './auth';
import { loadEnv } from './env';
import { structuredExtractor, textractExtractor } from './pipeline/extract';
import type { PipelineDeps } from './pipeline/run';
import { caseRoutes } from './routes/cases';
import { FsCaseStore, FsDocumentStorage } from './store/case-store';

/**
 * The API process: sign-in, cases, uploads, the pipeline, events, certificates.
 *
 * Locally this is one Node process with filesystem storage. On AWS the same
 * routes become API Gateway + Lambda, the store becomes DynamoDB, uploads
 * become presigned S3 POSTs and the pipeline becomes Step Functions — behind
 * the interfaces in `store/` and `pipeline/`, not by rewriting the routes.
 */
export async function createServer() {
  const env = loadEnv();
  const auth = createAuth(env);
  const migrated = await migrateAuth(auth);

  const rulepack = loadRulepackV1();
  const deps: PipelineDeps = {
    store: new FsCaseStore(env.dataDir),
    documents: new FsDocumentStorage(env.dataDir),
    extractor: env.extractor === 'textract' ? textractExtractor : structuredExtractor,
    rulepack,
    normaliser: createNormaliser(buildLexicon(rulepack)),
    now: () => new Date().toISOString(),
  };

  const app = new Hono();
  app.use('*', logger());
  app.use('/api/*', cors({ origin: [...env.trustedOrigins], credentials: true }));

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      rulepack: { version: rulepack.version, hash: rulepack.hash },
      extractor: deps.extractor.name,
      auth: migrated,
    }),
  );

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.route('/api/cases', caseRoutes(auth, deps, env.baseUrl));

  return { app, env, deps };
}
