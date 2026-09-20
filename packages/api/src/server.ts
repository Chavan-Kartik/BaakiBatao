import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { buildLexicon, createNormaliser } from '@fc/normalise';
import { loadRulepackV1 } from '@fc/rulepack';
import { createAuth, migrateAuth, type Auth } from './auth';
import { loadEnv, type Env } from './env';
import { structuredExtractor, textractExtractor } from './pipeline/extract';
import type { PipelineDeps } from './pipeline/run';
import { localRunner, type PipelineRunner } from './pipeline/runner';
import { caseRoutes, type CaseRouteOptions } from './routes/cases';
import { FsCaseStore, FsDocumentStorage } from './store/case-store';

/**
 * The API process: sign-in, cases, uploads, the pipeline, events, certificates.
 *
 * Locally this is one Node process with filesystem storage. On AWS the same
 * routes become API Gateway + Lambda, the store becomes DynamoDB, uploads
 * become presigned S3 POSTs and the pipeline becomes Step Functions — behind
 * the interfaces in `store/` and `pipeline/`, not by rewriting the routes.
 * `createApp` is the part both share; `createServer` is the local wiring.
 */
export interface AppParts {
  readonly env: Env;
  readonly auth: Auth;
  readonly deps: PipelineDeps;
  readonly runner: PipelineRunner;
  /** Whatever the deployment wants `/api/health` to say about itself. */
  readonly health?: Record<string, unknown>;
  readonly routes?: CaseRouteOptions;
}

export function createApp(parts: AppParts): Hono {
  const { env, auth, deps, runner } = parts;
  const app = new Hono();
  app.use('*', logger());
  app.use('/api/*', cors({ origin: [...env.trustedOrigins], credentials: true }));

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      rulepack: { version: deps.rulepack.version, hash: deps.rulepack.hash },
      extractor: deps.extractor.name,
      runner: runner.name,
      // The UI shows a Cognito button only when the server can honour it.
      signIn: { emailAndPassword: true, cognito: env.cognito !== null },
      ...parts.health,
    }),
  );

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.route('/api/cases', caseRoutes(auth, deps, runner, parts.routes));

  return app;
}

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
  const runner = localRunner(deps, env.baseUrl);

  const app = createApp({ env, auth, deps, runner, health: { auth: migrated } });
  return { app, env, deps };
}
