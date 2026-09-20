import { useEffect, useState } from 'react';

/**
 * Hash routing, so the static bundle works from any path with no rewrite
 * rules and CloudFront's 403/404 → index.html mapping is never load-bearing
 * for a deep link. A handful of screens do not need a router library.
 *
 * Route table:
 *   #/                      landing (marketing, no session needed)
 *   #/u                     sign in / create account
 *   #/cases                 the case list
 *   #/cases/<id>/<tab>      one case: pipeline | review | verify
 *   #/new                   claim pack intake
 *   #/demo                  the worked example, settled in the browser
 *
 * Auth does not gate any of these yet — the session is read for the sidebar
 * and for the API calls that need it, and everything else renders regardless.
 */
export type Route =
  | { name: 'landing' }
  | { name: 'auth' }
  | { name: 'cases' }
  | { name: 'new' }
  | { name: 'demo' }
  | { name: 'case'; caseId: string; tab: 'pipeline' | 'review' | 'verify' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'u') return { name: 'auth' };
  if (parts[0] === 'cases' && parts[1]) {
    const tab = parts[2] === 'review' || parts[2] === 'verify' ? parts[2] : 'pipeline';
    return { name: 'case', caseId: parts[1], tab };
  }
  if (parts[0] === 'cases') return { name: 'cases' };
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'demo') return { name: 'demo' };
  // Root, and anything unrecognised, is the front door.
  return { name: 'landing' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'landing': return '#/';
    case 'auth': return '#/u';
    case 'cases': return '#/cases';
    case 'new': return '#/new';
    case 'demo': return '#/demo';
    case 'case': return `#/cases/${route.caseId}/${route.tab}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
