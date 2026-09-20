import { useEffect, useState } from 'react';

/**
 * A boolean that follows a media query. Starts from the real answer when a
 * window exists, so the first paint does not flash the wrong layout.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `lg` breakpoint, where the workspace goes side-by-side. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
