import { useMemo } from 'react';
import { Citations } from './components/Citations';
import { Hero } from './components/Hero';
import { Invariant } from './components/Invariant';
import { Ledger } from './components/Ledger';
import { Masthead } from './components/Masthead';
import { Provenance } from './components/Provenance';
import { Verdict } from './components/Verdict';
import { Waterfall } from './components/Waterfall';
import { buildCaseView } from './lib/case';

/**
 * One page, read top to bottom, in the order the argument has to be made:
 * what the claim was, what the verdict is, how the waterfall reached it, the
 * evidence line by line, the clauses quoted, and finally the proof that the
 * arithmetic closes.
 *
 * The settlement is computed once on mount. It is pure and deterministic, so
 * there is nothing to refetch and nothing to invalidate.
 */
export function App() {
  const view = useMemo(() => buildCaseView(), []);

  return (
    <div className="min-h-dvh bg-paper">
      <Masthead view={view} />
      <main>
        <Hero view={view} />
        <Verdict view={view} />
        <Waterfall view={view} />
        <Ledger view={view} />
        <Citations view={view} />
        <Invariant view={view} />
        <Provenance view={view} />
      </main>
    </div>
  );
}
