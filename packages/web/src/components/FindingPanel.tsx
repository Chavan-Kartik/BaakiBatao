import type { Finding } from '@fc/contracts';
import { BookOpen, CircleDashed, Scale } from 'lucide-react';
import { type CaseView } from '../lib/case';
import { inr, inrAbs } from '../lib/format';
import { BUCKET_VERDICT, CLAUSE_EFFECT_LABEL, STEP_LABEL, UNRESOLVED_REASON_LABEL } from '../lib/labels';
import { cn } from '../lib/utils';
import { Equation } from './Equation';
import { Badge, BUCKET_META, Chip, Money, Panel } from './primitives';

/**
 * Why. One card per finding: the verdict in a sentence, the working that
 * produced it, and the clause quoted as the policy wrote it. A finding with
 * no clause is never dressed up as one — it goes in the unresolved bucket and
 * says what document would settle it.
 */
export function FindingPanel({ view, selectedIndex }: { view: CaseView; selectedIndex: number }) {
  const claimLevel = selectedIndex < 0;
  const row = claimLevel ? null : (view.rows[selectedIndex] ?? null);
  const findings = row ? row.findings : view.claimLevel;

  return (
    <Panel
      title={row ? row.desc : 'Taken off the whole claim'}
      subtitle={
        row
          ? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'} on this line`
          : 'Deductible, co-pay, and anything left unexplained'
      }
      className="min-h-0"
    >
      {row && (
        <dl className="grid grid-cols-3 gap-px border-b border-border bg-border">
          <LineStat label="Charged" value={inr(row.claimed)} />
          <LineStat label="Paid" value={row.insurerPaid === null ? 'No sheet row' : inr(row.insurerPaid)} />
          <LineStat
            label="Withheld"
            value={row.insurerCut === 0 ? 'Nothing' : inr(row.insurerCut)}
            tone={row.disputed > 0 ? 'disputed' : 'default'}
          />
        </dl>
      )}

      {findings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <CircleDashed className="size-5 text-text-3" strokeWidth={1.5} />
          <p className="text-[12.5px] font-medium text-text-2">Nothing to argue with here.</p>
          <p className="max-w-[34ch] text-[11.5px] leading-snug text-text-3">
            The insurer paid this line in full, so the engine had nothing to place.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {findings.map((finding) => (
            <FindingCard key={finding.findingId} finding={finding} view={view} />
          ))}
        </ul>
      )}

      {claimLevel && <AskCard view={view} />}
    </Panel>
  );
}

function LineStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'disputed';
}) {
  return (
    <div className="bg-surface px-3.5 py-2.5">
      <dt className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-text-3">{label}</dt>
      <dd>
        <Money value={value} tone={tone} className="mt-1 block text-[14px]" />
      </dd>
    </div>
  );
}

function FindingCard({ finding, view }: { finding: Finding; view: CaseView }) {
  const clause = finding.clauseId ? view.rulepack.clauses[finding.clauseId] : null;
  const meta = BUCKET_META[finding.bucket];
  const amount = inrAbs(finding.amount);

  return (
    <li className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge bucket={finding.bucket} />
          <Chip tone="neutral">
            <Scale className="size-3" />
            {STEP_LABEL[finding.stepId]}
          </Chip>
        </div>
        <Money
          value={amount}
          tone={finding.bucket === 'INCORRECTLY_APPLIED' ? 'disputed' : 'default'}
          className="shrink-0 text-[20px] font-semibold leading-none tracking-[-0.035em]"
        />
      </div>

      <p
        className={cn(
          'mt-3 text-[13.5px] font-medium leading-[1.3] tracking-[-0.015em]',
          finding.bucket === 'INCORRECTLY_APPLIED' ? 'text-text' : 'text-text-2',
        )}
      >
        {BUCKET_VERDICT[finding.bucket](amount)}
      </p>

      <Equation
        arithmetic={finding.arithmetic}
        resultLabel={finding.bucket === 'INCORRECTLY_APPLIED' ? 'Lawful to withhold here' : undefined}
        className="mt-3"
      />

      {clause && (
        <figure className="mt-3 rounded-lg border border-border bg-surface px-3.5 py-3">
          <figcaption className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-text-3">
            <BookOpen className="size-3" strokeWidth={2} />
            <span title={finding.clauseId ?? undefined}>
              {CLAUSE_EFFECT_LABEL[clause.effect] ?? 'Clause'}
            </span>
          </figcaption>
          <blockquote className="mt-2 border-l-2 border-brand/50 pl-3 text-[12.5px] leading-[1.45] text-text-2">
            {clause.text}
          </blockquote>
          <p className="mt-2 text-[11px] text-text-3">
            {clause.source === 'POLICY_WORDING' ? 'Your policy wording' : clause.source}
            {clause.paragraph ? ` · ${clause.paragraph}` : ''}
          </p>
        </figure>
      )}

      {finding.unresolvedReason && (
        <p className={cn('mt-3 rounded-lg px-3 py-2 text-[12px] leading-snug', meta.className)}>
          {UNRESOLVED_REASON_LABEL[finding.unresolvedReason] ?? finding.unresolvedReason}
          {finding.resolvedBy && (
            <span className="mt-1 block opacity-75">What would settle it: {finding.resolvedBy}.</span>
          )}
        </p>
      )}
    </li>
  );
}

/** The number that goes in the letter, and how it was arrived at. */
function AskCard({ view }: { view: CaseView }) {
  return (
    <section className="border-t border-border-strong bg-canvas/70 px-4 py-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-text-3">What we will ask for</p>

      <dl className="mt-2.5">
        <AskRow label="Withheld with no clause behind it" value={inr(view.disputedGross)} />
        {view.copayPercent !== null && (
          <AskRow
            label={`Less the ${view.copayPercent}% co-pay that rides on it`}
            value={`− ${inr(view.copayOnRestored)}`}
            muted
          />
        )}
        <AskRow label="Recoverable" value={inr(view.recoverable)} strong />
      </dl>

      {view.unexplained > 0 && (
        <p className="mt-3 rounded-lg bg-unresolved-soft px-3 py-2 text-[11.5px] leading-snug text-unresolved">
          A further {inr(view.unexplained)} was withheld without a reason we can check. We ask about it
          rather than claim it.
        </p>
      )}
    </section>
  );
}

function AskRow({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1.5',
        strong && 'mt-1 border-t-2 border-border-strong pt-2',
      )}
    >
      <dt className={cn('text-[12px]', strong ? 'font-semibold text-text' : muted ? 'text-text-3' : 'text-text-2')}>
        {label}
      </dt>
      <dd>
        <Money
          value={value}
          tone={strong ? 'accent' : muted ? 'muted' : 'default'}
          className={strong ? 'text-[16px] font-semibold tracking-[-0.03em]' : 'text-[12.5px]'}
        />
      </dd>
    </div>
  );
}
