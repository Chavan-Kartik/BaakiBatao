import type { Finding, Reconstruction } from '@fc/contracts';
import { PipelineFailure, type ExtractedState } from '@fc/api';
import { converseText } from '../shared/bedrock';
import { optional, required } from '../shared/config';
import { markRedacted, type RedactedText } from '../shared/redacted';
import { putJson, putText } from '../store/documents';
import { emit, loadCase, rethrowCoded, stageDeps, transition } from '../store/io';

/**
 * `WriteProse` (state 11): per-finding explanation and the letter's
 * connective prose, from Bedrock, confined by construction (§15, ADR 003):
 *
 *  - the prompt is built only from `RedactedText` — the redacted line
 *    descriptions and the clause labels; the compile-time gate is the type,
 *    the runtime gate is IAM (this function cannot read the raw bucket);
 *  - the arithmetic is rendered into the letter verbatim from the engine's
 *    own `Arithmetic` objects, and the model is never asked to restate it;
 *  - a reply containing a digit is refused, not trimmed.
 *
 * With no `PROSE_MODEL_ID` the stage records `ProseWritten { skipped }`, the
 * same event the local runner emits, and the UI renders the findings from
 * their clauses and arithmetic alone. Nothing is faked.
 */
export const handler = async (
  event: { caseId: string },
): Promise<{ explanations: number; letterKey: string | null; skipped: boolean }> => {
  const deps = stageDeps();
  try {
    await transition(deps, event.caseId, 'WRITING_PROSE');
    const record = await loadCase(deps, event.caseId);
    const { reconstruction, extracted } = record;
    if (!reconstruction || !extracted) throw new PipelineFailure('PIPELINE_INTERNAL', 'nothing was reconstructed to explain');

    const modelId = optional('PROSE_MODEL_ID');
    if (!modelId) {
      await emit(deps, event.caseId, 'ProseWritten', { skipped: true, reason: 'no prose model configured' });
      return { explanations: 0, letterKey: null, skipped: true };
    }

    const guardrail =
      optional('PROSE_GUARDRAIL_ID') && optional('PROSE_GUARDRAIL_VERSION')
        ? { id: required('PROSE_GUARDRAIL_ID'), version: required('PROSE_GUARDRAIL_VERSION') }
        : undefined;

    const explanations: Record<string, string> = {};
    const disputed = reconstruction.findings.filter((f) => f.bucket !== 'CORRECTLY_APPLIED');
    for (const finding of disputed) {
      const text = await converseText({
        modelId,
        system: SYSTEM,
        prompt: explainPrompt(finding, extracted),
        maxTokens: 160,
        guardrail,
      });
      if (containsDigitClaim(text)) {
        throw new PipelineFailure('MODEL_UNAVAILABLE', 'the model restated a figure; its prose was refused');
      }
      explanations[finding.findingId] = text.trim();
    }

    const artifacts = required('ARTIFACTS_BUCKET');
    await putJson(artifacts, `prose/${event.caseId}.json`, { explanations });
    const letterKey = await putText(
      artifacts,
      `letters/${event.caseId}.html`,
      renderLetter(reconstruction, explanations),
      'text/html; charset=utf-8',
    );

    await emit(deps, event.caseId, 'ProseWritten', {
      skipped: false,
      modelId,
      explanations: Object.keys(explanations).length,
      letterKey,
    });
    return { explanations: Object.keys(explanations).length, letterKey, skipped: false };
  } catch (e) {
    if ((e as { name?: string }).name === 'ThrottlingException') {
      rethrowCoded(new PipelineFailure('BEDROCK_THROTTLED', 'the prose model is throttled; try again shortly'));
    }
    rethrowCoded(e);
  }
};

const SYSTEM = [
  'You explain one line of a health-insurance claim reconciliation to the policyholder, in plain English, in at most two sentences.',
  'Never state, restate or estimate any amount, percentage, date or clause number: the reader already sees the arithmetic beside your sentences.',
  'Never give medical or legal advice. Describe what the clause does and why the line falls under it, nothing more.',
].join(' ');

/** Built from redacted text only: the type is the compile-time half of the gate. */
function explainPrompt(finding: Finding, extracted: ExtractedState): RedactedText {
  const line = finding.lineRef ? extracted.billTable.rows.find((r) => r.lineRef === finding.lineRef) : undefined;
  const parts = [
    `Bucket: ${finding.bucket}.`,
    finding.clauseId ? `Clause: ${finding.clauseId}.` : 'No clause could be cited.',
    finding.unresolvedReason ? `Unresolved because: ${finding.unresolvedReason}.` : '',
    finding.resolvedBy ? `Would be settled by: ${finding.resolvedBy}.` : '',
    line ? `Bill line: ${line.rawDescription}.` : 'Whole-claim finding.',
    'Explain in at most two sentences, with no numbers of any kind.',
  ];
  return markRedacted(parts.filter(Boolean).join('\n'));
}

/** The §15 no-digits assertion: numeric claims in prose are refused, not trimmed. */
export function containsDigitClaim(text: string): boolean {
  return /[0-9०-९]/.test(text);
}

/**
 * The reconsideration letter, holes-only (§15.2): every figure is the
 * engine's, formatted here; the model's sentences sit under each finding.
 */
function renderLetter(r: Reconstruction, explanations: Record<string, string>): string {
  const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const disputed = r.findings.filter((f) => f.bucket === 'INCORRECTLY_APPLIED');
  const rows = disputed
    .map(
      (f) => `<li><strong>${esc(f.clauseId ?? '')}</strong> — ${rupees(Math.abs(f.amount))}<br/>` +
        `<code>${esc(f.arithmetic.expression)}</code>` +
        (explanations[f.findingId] ? `<p>${esc(explanations[f.findingId]!)}</p>` : '') + `</li>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Request for reconsideration — ${esc(r.caseId)}</title>
<body style="font-family:system-ui;max-width:42rem;margin:2rem auto;line-height:1.5">
<h1>Request for reconsideration</h1>
<p>Claim reference: <code>${esc(r.caseId)}</code></p>
<p>The settlement paid ${rupees(r.actualPaid)} against a bill of ${rupees(r.billTotal)}. Applying the policy's own terms line by line, the payable amount reconstructs to ${rupees(r.expectedPayable)}.</p>
<p>The following deductions do not follow from the policy wording as applied to the itemised bill:</p>
<ol>${rows}</ol>
<p>Total under dispute: ${rupees(r.reconciliation.byBucket.INCORRECTLY_APPLIED)}. Each line above cites the clause and shows the arithmetic; the reconstruction certificate (<code>${esc(r.pins.rulepackHash)}</code>) can be replayed against the same inputs.</p>
<p>I request that the claim be reassessed accordingly.</p>
</body></html>`;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
