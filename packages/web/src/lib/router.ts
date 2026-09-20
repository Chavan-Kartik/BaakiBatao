import { useEffect, useState } from 'react';

/**
 * Hash routing, so the static bundle works from any path with no rewrite
 * rules and CloudFront's 403/404 → index.html mapping is never load-bearing
 * for a deep link. Four screens do not need a router library.
 */
export type Route =
  | { name: 'signin' }
  | { name: 'cases' }
  | { name: 'new' }
  | { name: 'demo' }
  | { name: 'case'; caseId: string; tab: 'pipeline' | 'review' | 'verify' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'signin') return { name: 'signin' };
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'demo') return { name: 'demo' };
  if (parts[0] === 'cases' && parts[1]) {
    const tab = parts[2] === 'review' || parts[2] === 'verify' ? parts[2] : 'pipeline';
    return { name: 'case', caseId: parts[1], tab };
  }
  return { name: 'cases' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'signin': return '#/signin';
    case 'new': return '#/new';
    case 'demo': return '#/demo';
    case 'cases': return '#/cases';
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
