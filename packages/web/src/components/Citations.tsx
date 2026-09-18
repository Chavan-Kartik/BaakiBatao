import type { ClauseId, Finding } from '@fc/contracts';
import { lineDescription } from '@fc/fixtures';
import type { CaseView } from '../lib/case';
import { inrAbs } from '../lib/format';
import { Card, ClauseChip, Eyebrow, SectionHeading, Shell } from './ui';

/**
 * The disputes, each with the clause quoted verbatim.
 *
 * Nothing here is paraphrased and nothing here is generated. The clause text
 * comes from the rulepack as data, the arithmetic comes from the finding that
 * the engine constructed, and a finding cannot exist without a clause to cite —
 * the engine throws rather than emit an uncited verdict.
 */
export function Citations({ view }: { view: CaseView }) {
  const disputed = view.result.findings.filter((f) => f.bucket === 'INCORRECTLY_APPLIED');

  const byClause = new Map<ClauseId, Finding[]>();
  for (const finding of disputed) {
    if (!finding.clauseId) continue;
    const group = byClause.get(finding.clauseId) ?? [];
    group.push(finding);
    byClause.set(finding.clauseId, group);
  }

  const groups = [...byClause.entries()].sort(
    (a, b) => total(b[1]) - total(a[1]),
  );

  const unresolved = view.result.findings.filter((f) => f.bucket === 'UNRESOLVED');

  return (
    <Shell>
      <section className="border-b border-rule py-16 md:py-20">
        <SectionHeading
          eyebrow="The citations"
          title="Four bright lines, quoted rather than paraphrased."
          lede="These are the passages that go into the reconsideration request word for word. The
            engine cannot record a verdict without one — a finding with no clause is not a finding,
            it is an opinion, and construction fails."
        />

        <div className="space-y-4">
          {groups.map(([clauseId, findings]) => {
            const clause = view.rulepack.clauses[clauseId];

            return (
              <Card key={clauseId} className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule px-6 py-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ClauseChip id={clauseId} />
                      {clause?.effect && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                          {clause.effect.replaceAll('_', ' ').toLowerCase()}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-ink-muted">
                      {clause?.source}
                      {clause?.paragraph ? ` · ${clause.paragraph}` : ''}
                      {clause?.sourceDate ? ` · ${clause.sourceDate}` : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <Eyebrow>Disputed</Eyebrow>
                    <p
                      data-numeric
                      className="mt-1 font-serif text-[1.5rem] leading-none text-disputed"
                    >
                      {inrAbs(total(findings))}
                    </p>
                  </div>
                </div>

                {clause?.text && (
                  <blockquote className="border-l-2 border-ink/15 px-6 py-5">
                    <p className="max-w-[68ch] font-serif text-[1.0625rem] leading-relaxed text-ink-soft">
                      &ldquo;{clause.text}&rdquo;
                    </p>
                  </blockquote>
                )}

                <dl className="divide-y divide-rule-soft border-t border-rule-soft">
                  {findings.map((finding) => (
                    <div
                      key={finding.findingId}
                      className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 px-6 py-3.5"
                    >
                      <div className="min-w-0">
                        <dt className="text-[0.875rem] text-ink">
                          {lineDescription(finding.lineRef ?? null) ?? 'Whole claim'}
                        </dt>
                        {/* The expression, never restated in prose by a model. */}
                        <p
                          data-numeric
                          className="mt-1 font-mono text-[11px] leading-relaxed text-ink-muted"
                        >
                          {finding.arithmetic.expression}
                        </p>
                      </div>
                      <dd
                        data-numeric
                        className="shrink-0 font-serif text-[1.0625rem] text-disputed"
                      >
                        {inrAbs(finding.amount)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            );
          })}
        </div>

        {unresolved.length > 0 && (
          <Card className="mt-4 overflow-hidden border-unresolved/25">
            <div className="border-b border-unresolved/15 bg-unresolved-soft px-6 py-5">
              <Eyebrow className="text-unresolved/70">Named, not absorbed</Eyebrow>
              <p className="mt-2 max-w-[64ch] text-[0.875rem] leading-relaxed text-ink-soft">
                The unresolved bucket is a feature. Every entry says why we could not decide and what
                document would settle it, which is the difference between a tool that is honest about
                its limits and one that guesses confidently.
              </p>
            </div>

            <dl className="divide-y divide-rule-soft">
              {unresolved.map((finding) => (
                <div key={finding.findingId} className="px-6 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-unresolved">
                      {finding.unresolvedReason?.replaceAll('_', ' ').toLowerCase()}
                    </dt>
                    <dd
                      data-numeric
                      className="font-serif text-[1.0625rem] text-unresolved"
                    >
                      {inrAbs(finding.amount)}
                    </dd>
                  </div>
                  {finding.resolvedBy && (
                    <p className="mt-1.5 max-w-[64ch] text-[0.8125rem] leading-relaxed text-ink-muted">
                      {finding.resolvedBy}
                    </p>
                  )}
                </div>
              ))}
            </dl>
          </Card>
        )}
      </section>
    </Shell>
  );
}

function total(findings: readonly Finding[]): number {
  return findings.reduce((sum, f) => sum + f.amount, 0);
}
