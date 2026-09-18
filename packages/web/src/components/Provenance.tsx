import type { CaseView } from '../lib/case';
import { STEP_LABEL } from '../lib/labels';
import { Eyebrow, Shell } from './ui';

/**
 * What produced the figures above, stated precisely enough to be reproduced.
 *
 * A reconstruction that cannot be replayed is not evidence. The pins below
 * identify the engine, the rulepack and its content hash, so the same inputs
 * can be settled again and checked against this page.
 */
export function Provenance({ view }: { view: CaseView }) {
  const { pins, computedAt } = view.result;

  return (
    <Shell>
      <footer className="py-16 md:py-20">
        <div className="grid gap-12 md:grid-cols-[1.1fr_1fr]">
          <div>
            <Eyebrow>Computed here</Eyebrow>
            <p className="mt-4 max-w-[54ch] text-[0.9375rem] leading-relaxed text-ink-soft">
              Every figure on this page was produced in this browser tab. The page imports{' '}
              <code className="font-mono text-[0.8125rem] text-ink">reconstruct</code> from{' '}
              <code className="font-mono text-[0.8125rem] text-ink">@fc/engine</code> — the same
              module the server-side authority runs — and calls it directly. There is no API request
              behind these numbers, and nothing was baked in at build time. Open the network tab and
              reload: you will see this bundle and its fonts, and no call for a result.
            </p>
            <p className="mt-4 max-w-[54ch] text-[0.9375rem] leading-relaxed text-ink-soft">
              That is only possible because the engine is pure — no AWS SDK, no Node built-ins, no
              I/O. It is enforced by an ESLint rule, a dependency-cruiser rule and a required CI
              check, so it is a build failure rather than a code-review convention.
            </p>
          </div>

          <div className="space-y-8">
            <div>
              <Eyebrow>Pinned versions</Eyebrow>
              <dl className="mt-4 space-y-2 font-mono text-[11.5px]">
                <Pin label="engine" value={pins.engineVersion} />
                <Pin label="rulepack" value={pins.rulepackVersion} />
                <Pin label="rulepack hash" value={pins.rulepackHash.replace('sha256:', '')} truncate />
                <Pin label="lexicon" value={pins.lexiconVersion} />
                <Pin label="settled at" value={computedAt} />
              </dl>
            </div>

            <div>
              <Eyebrow>Step order, as pinned</Eyebrow>
              <ol className="mt-4 space-y-1.5 font-mono text-[11.5px] text-ink-muted">
                {pins.stepOrder.map((id, i) => (
                  <li key={id} className="flex gap-2.5">
                    <span className="text-ink-faint">{String(i + 1).padStart(2, '0')}</span>
                    <span>{STEP_LABEL[id]}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 max-w-[38ch] text-[0.75rem] leading-relaxed text-ink-faint">
                Pinned into the result so a later rulepack cannot rewrite what this settlement was
                judged against.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </Shell>
  );
}

function Pin({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule-soft pb-2">
      <dt className="shrink-0 text-ink-faint">{label}</dt>
      <dd className={truncate ? 'truncate text-ink-soft' : 'text-ink-soft'} title={value}>
        {truncate ? `${value.slice(0, 16)}…` : value}
      </dd>
    </div>
  );
}
