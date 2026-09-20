import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import type { Env } from './env';

/**
 * Sign-in, via better-auth.
 *
 * Email and password, sessions in a cookie, users and sessions in SQLite
 * through Node's built-in driver — no native module to build, which keeps the
 * Docker image and the CI runner boring. On AWS the same configuration points
 * at a different `database` (better-auth ships adapters for DynamoDB via
 * Kysely dialects and for Postgres); nothing in the routes changes.
 *
 * Every case is owned by the user who created it, and every case route checks
 * the session first. There is no anonymous path to a document.
 */
// `node:sqlite` is a prefix-only builtin, which Vite's resolver does not
// recognise, so it is required rather than imported: same module, and the
// tests run under vitest without a shim.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export function createAuth(env: Env) {
  const database = new DatabaseSync(join(env.dataDir, 'auth.sqlite'));

  return betterAuth({
    database,
    baseURL: env.baseUrl,
    secret: env.authSecret,
    trustedOrigins: [...env.trustedOrigins],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // No mail transport exists yet, so verification would lock everyone out.
      requireEmailVerification: false,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      // The dev server proxies /api to this process, so the cookie is set on
      // the UI's origin. Secure cookies only once we are actually behind TLS.
      useSecureCookies: env.nodeEnv === 'production',
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth['$Infer']['Session'];

/**
 * Creates the user/session/account/verification tables on first start.
 * `getMigrations` is the CLI's own migration path, called in-process so a
 * fresh checkout needs no separate step.
 */
export async function migrateAuth(auth: Auth): Promise<{ created: string[]; added: string[] }> {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length > 0 || toBeAdded.length > 0) await runMigrations();
  return {
    created: toBeCreated.map((t) => t.table),
    added: toBeAdded.map((t) => t.table),
  };
}
