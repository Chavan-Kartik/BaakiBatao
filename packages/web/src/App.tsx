import { useMemo } from 'react';
import { balanceLedger } from '@fc/engine';
import { loadRulepackV1 } from '@fc/rulepack';
import { formatInr, unsafePaise, type Finding } from '@fc/contracts';

/**
 * Day-one scaffold. It exists to prove the architectural claim early: the SAME
 * engine module that runs in Lambda also runs here, in the browser, with no
 * network call — which is what the what-if panel will be built on.
 *
 * TODO(W4): replace with the real routes — Upload · Pipeline · Case · Verify.
 */
export function App() {
  const rulepack = useMemo(() => loadRulepackV1(), []);

  // A deliberately under-explained settlement: bill ₹1,00,000, paid ₹75,000,
  // but we can only account for ₹20,000 of the ₹25,000 cut.
  const demo = useMemo(() => {
    const findings: Finding[] = [
      {
        findingId: 'demo-room-cap',
        lineRef: null,
        stepId: 'CAPS_SUBLIMITS',
        clauseId: 'LIMIT.ROOM' as Finding['clauseId'],
        bucket: 'CORRECTLY_APPLIED',
        amount: unsafePaise(-2_000_000),
        arithmetic: {
          expression: 'room rent 6,500/day vs cap 4,000/day × 5 days',
          inputs: { actual: 650000, cap: 400000, days: 5 },
          result: -2_000_000,
        },
        unresolvedReason: null,
        resolvedBy: null,
        confidence: 1,
      },
    ];
    return balanceLedger(unsafePaise(10_000_000), unsafePaise(7_500_000), findings);
  }, []);

  const residual = demo.findings.find((f) => f.findingId === 'RESIDUAL');

  return (
    <main
      style={{
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        maxWidth: 760,
        margin: '4rem auto',
        padding: '0 1.5rem',
        lineHeight: 1.6,
        color: '#1a1a1a',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Settlement reconstructor</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Scaffold running. Rulepack <code>{rulepack.version}</code> loaded, {rulepack.steps.length}{' '}
        steps, {Object.keys(rulepack.clauses).length} citable clauses.
      </p>

      <h2 style={{ fontSize: '1rem', marginTop: '2.5rem' }}>The waterfall, in order</h2>
      <ol style={{ paddingLeft: '1.25rem' }}>
        {rulepack.steps.map((s) => (
          <li key={s.id}>
            <code>{s.id}</code>
            {s.id === 'PROPORTIONATE' && (
              <span style={{ color: '#666' }}> — step 5 of 7, not the thesis</span>
            )}
          </li>
        ))}
      </ol>

      <h2 style={{ fontSize: '1rem', marginTop: '2.5rem' }}>
        The invariant, computed in your browser
      </h2>
      <p>
        Bill {formatInr(unsafePaise(10_000_000))}, insurer paid{' '}
        {formatInr(unsafePaise(7_500_000))}. We can account for{' '}
        {formatInr(unsafePaise(2_000_000))} of the gap against a clause.
      </p>
      {residual && (
        <p
          style={{
            background: '#eef2f7',
            borderLeft: '3px solid #64748b',
            padding: '0.75rem 1rem',
          }}
        >
          <strong>Unresolved: {formatInr(residual.amount)}</strong>
          <br />
          <span style={{ color: '#475569' }}>
            {residual.unresolvedReason} — {residual.resolvedBy}
          </span>
        </p>
      )}
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Residual after materialisation: {demo.reconciliation.residual}. Every paise is either
        attributed to a clause or explicitly marked unattributed — there is no third state.
      </p>
    </main>
  );
}
