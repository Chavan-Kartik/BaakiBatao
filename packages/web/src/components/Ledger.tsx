import type { CaseView } from '../lib/case';
import { inr } from '../lib/format';
import { CATEGORY_LABEL } from '../lib/labels';
import { BucketBadge, Card, SectionHeading, Shell } from './ui';

/**
 * The itemised bill against the insurer's own deduction sheet.
 *
 * The two documents use different line references, so the engine matches them
 * on normalised description before any verdict is reached. What is shown here
 * is the join: what was billed, what they paid, and what our reconstruction
 * says about the difference.
 */
export function Ledger({ view }: { view: CaseView }) {
  return (
    <Shell>
      <section className="border-b border-rule py-16 md:py-20">
        <SectionHeading
          eyebrow="Line by line"
          title="Their deduction sheet, decomposed."
          lede="Ten bill lines. The insurer cut nine of them at a flat 40%, which is what a blanket
            ratio looks like when it is applied without reading the exclusions. Five of those lines
            were exempt."
        />

        <Card className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-[0.875rem]">
            <caption className="sr-only">
              Bill lines with claimed, paid and withheld amounts, and the verdict on each
            </caption>
            <thead>
              <tr className="border-b border-rule text-left">
                <Th className="pl-6">Bill line</Th>
                <Th align="right">Claimed</Th>
                <Th align="right">They paid</Th>
                <Th align="right">Withheld</Th>
                <Th className="pr-6">Verdict</Th>
              </tr>
            </thead>

            <tbody className="divide-y divide-rule-soft">
              {view.rows.map((row) => {
                const buckets = [...new Set(row.findings.map((f) => f.bucket))];
                const clauses = [
                  ...new Set(row.findings.flatMap((f) => (f.clauseId ? [f.clauseId] : []))),
                ];

                return (
                  <tr key={row.index} className={row.disputed > 0 ? 'bg-disputed-soft/35' : ''}>
                    <td className="py-3.5 pl-6 pr-4 align-top">
                      <p className="text-ink">{row.desc}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-faint">
                        {CATEGORY_LABEL[row.category] ?? row.category}
                      </p>
                    </td>
                    <Td align="right">{inr(row.claimed)}</Td>
                    <Td align="right">{inr(row.insurerPaid)}</Td>
                    <Td align="right" className={row.disputed > 0 ? 'text-disputed' : 'text-ink'}>
                      {row.insurerCut === 0 ? '—' : inr(row.insurerCut)}
                    </Td>
                    <td className="py-3.5 pl-4 pr-6 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {buckets.length === 0 ? (
                          <span className="text-[0.8125rem] text-ink-faint">nothing withheld</span>
                        ) : (
                          buckets.map((b) => <BucketBadge key={b} bucket={b} />)
                        )}
                      </div>
                      {clauses.length > 0 && (
                        <p className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-ink-muted">
                          {clauses.join(' · ')}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="border-t border-rule bg-rule-soft/50 font-medium">
                <td className="py-3.5 pl-6 pr-4 text-ink">Bill total</td>
                <Td align="right" className="text-ink">
                  {inr(view.billTotal)}
                </Td>
                <td className="py-3.5 pr-6 text-right font-mono text-[11px] text-ink-muted" colSpan={3}>
                  claim-level deductions follow below
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <p className="mt-4 max-w-[64ch] text-[0.8125rem] leading-relaxed text-ink-muted">
          The consumables line is the one worth pausing on. It is an Annexure II item, so step three
          would have cut it in full — and the only reason it survives to be disputed at step five is
          the consumables rider on this schedule. Exemption from a proportionate deduction does not
          make a line payable, and conflating the two is the mistake the waterfall exists to avoid.
        </p>
      </section>
    </Shell>
  );
}

function Th({
  children,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-faint ${
        align === 'right' ? 'pl-4 text-right' : 'pr-4'
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      data-numeric
      className={`py-3.5 align-top ${align === 'right' ? 'pl-4 text-right' : 'pr-4'} ${className}`}
    >
      {children}
    </td>
  );
}
