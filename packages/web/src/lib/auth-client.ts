import { createAuthClient } from 'better-auth/react';

/**
 * Same origin: the dev server proxies /api to the API process, and in
 * production the UI and API sit behind one domain. The session cookie is
 * therefore first-party and nothing here needs to know where the API lives.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
});

export type Session = typeof authClient.$Infer.Session;
