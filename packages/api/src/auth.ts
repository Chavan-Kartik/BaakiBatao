import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import type { CognitoConfig, Env } from './env';

/**
 * Sign-in, via better-auth.
 *
 * Email and password, sessions in a cookie, users and sessions in SQLite
 * through Node's built-in driver — no native module to build, which keeps the
 * Docker image and the CI runner boring. On AWS the same configuration points
 * at a different `database` (a DynamoDB adapter in `@fc/functions`); nothing
 * in the routes changes.
 *
 * Amazon Cognito is an optional second way in, through better-auth's Cognito
 * social provider: the Hosted UI authenticates, better-auth still mints the
 * session. It is on whenever `env.cognito` is set, locally or on AWS.
 *
 * Every case is owned by the user who created it, and every case route checks
 * the session first. There is no anonymous path to a document.
 */
export interface AuthOverrides {
  /** Where users and sessions live. Default: SQLite under `env.dataDir`. */
  readonly database?: BetterAuthOptions['database'];
  /** The public origin, when it is not `env.baseUrl`. */
  readonly baseURL?: string;
  readonly trustedOrigins?: readonly string[];
  readonly cognito?: CognitoConfig | null;
}

export function createAuth(env: Env, overrides: AuthOverrides = {}) {
  const database = overrides.database ?? openSqlite(join(env.dataDir, 'auth.sqlite'));
  const cognito = overrides.cognito === undefined ? env.cognito : overrides.cognito;

  return betterAuth({
    database,
    baseURL: overrides.baseURL ?? env.baseUrl,
    secret: env.authSecret,
    trustedOrigins: [...(overrides.trustedOrigins ?? env.trustedOrigins)],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // No mail transport exists yet, so verification would lock everyone out.
      requireEmailVerification: false,
      autoSignIn: true,
    },
    socialProviders: cognito
      ? {
          cognito: {
            clientId: cognito.clientId,
            domain: cognito.domain,
            region: cognito.region,
            userPoolId: cognito.userPoolId,
            // Public app client with PKCE. A confidential client would need
            // the secret in the Lambda, for no gain on a browser flow.
            requireClientSecret: false,
          },
        }
      : {},
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

/**
 * `node:sqlite` is a prefix-only builtin, which Vite's resolver does not
 * recognise, so it is required rather than imported: same module, and the
 * tests run under vitest without a shim. Required lazily so a deployment on
 * another database never loads it at all.
 */
function openSqlite(file: string): DatabaseSyncType {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: typeof DatabaseSyncType;
  };
  return new DatabaseSync(file);
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth['$Infer']['Session'];

/**
 * Creates the user/session/account/verification tables on first start.
 * `getMigrations` is the CLI's own migration path, called in-process so a
 * fresh checkout needs no separate step. Only SQL databases have anything to
 * migrate; a custom adapter reports nothing to do.
 */
export async function migrateAuth(auth: Auth): Promise<{ created: string[]; added: string[] }> {
  if (typeof auth.options.database === 'function') return { created: [], added: [] };
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length > 0 || toBeAdded.length > 0) await runMigrations();
  return {
    created: toBeCreated.map((t) => t.table),
    added: toBeAdded.map((t) => t.table),
  };
}
