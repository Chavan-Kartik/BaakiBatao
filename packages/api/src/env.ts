import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime configuration for the API, from the environment with local-dev
 * defaults. Every default is one a developer can run with immediately; every
 * production value has to be set explicitly, and the one secret refuses to
 * default outside development.
 */
export interface Env {
  readonly port: number;
  /** Where case records, uploads and the auth database live locally. */
  readonly dataDir: string;
  readonly baseUrl: string;
  readonly trustedOrigins: readonly string[];
  readonly authSecret: string;
  /** Which extractor turns uploaded documents into tables. */
  readonly extractor: 'structured' | 'textract';
  readonly nodeEnv: 'development' | 'production' | 'test';
  /**
   * Amazon Cognito as a sign-in option, through better-auth's Cognito social
   * provider: the Hosted UI does the login, better-auth owns the session. Null
   * when the four variables are not all set, in which case only email and
   * password are offered. The app client is public (PKCE), so no secret.
   */
  readonly cognito: CognitoConfig | null;
}

export interface CognitoConfig {
  readonly clientId: string;
  /** The Hosted UI domain, e.g. `fc-demo.auth.ap-south-1.amazoncognito.com`. */
  readonly domain: string;
  readonly region: string;
  readonly userPoolId: string;
}

const here = dirname(fileURLToPath(import.meta.url));

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = (source['NODE_ENV'] as Env['nodeEnv'] | undefined) ?? 'development';
  const dataDir = resolve(source['FC_DATA_DIR'] ?? join(here, '..', 'data'));
  mkdirSync(dataDir, { recursive: true });

  const secret = source['BETTER_AUTH_SECRET'];
  if (!secret && nodeEnv === 'production') {
    throw new Error('BETTER_AUTH_SECRET must be set in production');
  }

  const port = Number(source['PORT'] ?? 3000);
  const baseUrl = source['FC_API_BASE_URL'] ?? `http://localhost:${port}`;
  const origins = (source['FC_TRUSTED_ORIGINS'] ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port,
    dataDir,
    baseUrl,
    trustedOrigins: [baseUrl, ...origins],
    authSecret: secret ?? 'fc-development-secret-do-not-use-in-production',
    extractor: source['FC_EXTRACTOR'] === 'textract' ? 'textract' : 'structured',
    nodeEnv,
    cognito: readCognito(source),
  };
}

export function readCognito(source: NodeJS.ProcessEnv): CognitoConfig | null {
  const clientId = source['FC_COGNITO_CLIENT_ID'];
  const domain = source['FC_COGNITO_DOMAIN'];
  const region = source['FC_COGNITO_REGION'];
  const userPoolId = source['FC_COGNITO_USER_POOL_ID'];
  if (!clientId || !domain || !region || !userPoolId) return null;
  return { clientId, domain, region, userPoolId };
}
