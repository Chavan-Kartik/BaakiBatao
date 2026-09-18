import type { Finding } from '@fc/contracts';
import { lineDescription } from '@fc/fixtures';
import type { CaseView } from '../lib/case';
import { inr, inrAbs } from '../lib/format';
import { STEP_LABEL } from '../lib/labels';
import { Badge, Money, Panel } from './ui';

export function FindingPanel({
  view,
  selectedIndex,
}: {
  view: CaseView;
  selectedIndex: number;
}) {
  const claimLevel = selectedIndex < 0;
  const row = claimLevel ? null : (view.rows[selectedIndex] ?? null);
  const findings = row ? row.findings : view.claimLevel;
  const title = row ? row.desc : 'Claim-level findings';

  return (
    <Panel
      title={
        <div className="min-w-0">
          <div className="truncate">{title}</div>
          {row && (
            <div className="truncate font-mono text-[10px] font-normal text-text-3">
              claimed {inr(row.claimed)} · paid {inr(row.insurerPaid)} · cut {inr(row.insurerCut)}
            </div>
          )}
        </div>
      }
      className="min-h-0"
    >
      {findings.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-text-3">
          No findings on this line — the insurer paid the claimed amount.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {findings.map((finding) => (
            <FindingCard key={finding.findingId} finding={finding} view={view} />
          ))}
        </ul>
      )}

      {claimLevel && (
        <div className="border-t border-border bg-canvas/60 px-4 py-3">
          <div className="text-[11px] font-medium text-text-2">Recoverable math</div>
          <dl className="mt-2 space-y-1.5 text-[12px]">
            <Row label="Disputed (gross)" value={inr(view.disputedGross)} />
            {view.copayPercent !== null && (
              <Row
                label={`Less ${view.copayPercent}% co-pay on restored`}
                value={`− ${inr(view.copayOnRestored)}`}
              />
            )}
            <Row label="Recoverable" value={inr(view.recoverable)} strong />
            <Row label="Unexplained (query only)" value={inr(view.unexplained)} />
          </dl>
        </div>
      )}
    </Panel>
  );
}

function FindingCard({ finding, view }: { finding: Finding; view: CaseView }) {
  const clause = finding.clauseId ? view.rulepack.clauses[finding.clauseId] : null;
  const line = lineDescription(finding.lineRef ?? null);

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge bucket={finding.bucket} />
            <span className="font-mono text-[10px] text-text-3">{STEP_LABEL[finding.stepId]}</span>
          </div>
          {finding.clauseId && (
            <code className="mt-1.5 inline-block rounded-sm border border-border bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-text-2">
              {finding.clauseId}
            </code>
          )}
          {line && finding.lineRef === null && (
            <p className="mt-1 text-[12px] text-text-2">{line}</p>
          )}
        </div>
        <Money
          value={inrAbs(finding.amount)}
          tone={finding.bucket === 'INCORRECTLY_APPLIED' ? 'disputed' : 'default'}
          className="shrink-0 text-[14px]"
        />
      </div>

      {clause?.text && (
        <blockquote className="mt-2 border-l-2 border-border-strong pl-3 text-[12px] leading-relaxed text-text-2">
          {clause.text}
        </blockquote>
      )}

      <p className="mt-2 font-mono text-[11px] text-text-3">{finding.arithmetic.expression}</p>

      {finding.unresolvedReason && (
        <p className="mt-2 text-[12px] text-unresolved">
          {finding.unresolvedReason.replaceAll('_', ' ').toLowerCase()}
          {finding.resolvedBy ? ` — ${finding.resolvedBy}` : ''}
        </p>
      )}

      {clause?.source && (
        <p className="mt-1.5 font-mono text-[10px] text-text-3">
          {clause.source}
          {clause.paragraph ? ` · ${clause.paragraph}` : ''}
        </p>
      )}
    </li>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-medium text-text' : 'text-text-2'}>{label}</dt>
      <dd data-numeric className={strong ? 'font-semibold text-accent' : 'text-text'}>
        {value}
      </dd>
    </div>
  );
}
