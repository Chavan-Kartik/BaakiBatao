import type { ExtractedTable } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { PipelineFailure, redactPack, type ExtractedPack, type ExtractedState } from '@fc/api';
import { detectPiiEntities, type PiiEntity } from '../shared/comprehend';
import { required } from '../shared/config';
import { markRedacted, type RedactedText } from '../shared/redacted';
import { getJson, putJson, putText } from '../store/documents';
import { emit, rethrowCoded, stageDeps, transition } from '../store/io';

/**
 * `RedactionGate` (state 4): the hard boundary (§13, ADR 004).
 *
 * Two detectors, both, not either: Comprehend `DetectPiiEntities` for names,
 * addresses and the identifiers a model recognises, then the deterministic
 * format regexes for Aadhaar, PAN, GSTIN, phone and email, where a format
 * beats a model. Every span becomes a typed placeholder — `«NAME»`,
 * `«IN_AADHAAR»` — and amounts, dates of service, line descriptions and
 * clause references stay intact, because they are the data.
 *
 * Fails CLOSED. If Comprehend errors, the execution stops with
 * `REDACTION_FAILED_OPEN` and nothing reaches Bedrock; the `Catch` on the
 * state writes that code, and no retry turns a refused gate into an open one.
 *
 * Only after both passes does the text become `ExtractedState` on the case
 * record, and only from there do the Bedrock-calling stages read. This is the
 * last Lambda in the pipeline with `s3:GetObject` on the raw bucket.
 */
export interface RedactInput {
  readonly caseId: string;
  readonly packKey: string;
}

/** Service dates are data (§13 step 4); everything else Comprehend flags is not. */
const KEEP_ENTITY_TYPES: ReadonlySet<string> = new Set(['DATE_TIME']);
const MIN_ENTITY_SCORE = 0.5;
/** Comprehend takes 100 KB per call; chunk well under it, on line boundaries. */
const CHUNK_CHARS = 60_000;

export const handler = async (
  event: RedactInput,
): Promise<{ countByType: Record<string, number>; detectors: string[] }> => {
  const deps = stageDeps();
  try {
    await transition(deps, event.caseId, 'REDACTING');
    const pack = await getJson<ExtractedPack>(required('RAW_BUCKET'), event.packKey);

    const counts: Record<string, number> = {};
    let billTable: ExtractedTable;
    let deductionTable: ExtractedTable;
    let wordingText: RedactedText;
    try {
      billTable = await redactTable(pack.billTable, counts);
      deductionTable = await redactTable(pack.deductionTable, counts);
      wordingText = await redactText(pack.wordingText, counts);
    } catch (e) {
      throw new PipelineFailure(
        'REDACTION_FAILED_OPEN',
        `redaction could not be confirmed (${e instanceof Error ? e.message : String(e)}), so nothing proceeds`,
      );
    }

    // The deterministic pass, second, over what the model left.
    const formats = redactPack({ billTable, deductionTable, wordingText });
    for (const [type, n] of Object.entries(formats.countByType)) counts[type] = (counts[type] ?? 0) + n;
    if (!formats.confirmed) throw new PipelineFailure('REDACTION_FAILED_OPEN', 'redaction could not be confirmed, so nothing proceeds');

    const extracted: ExtractedState = {
      billTable: formats.billTable,
      deductionTable: formats.deductionTable,
      policy: pack.policy,
      admission: pack.admission,
      actualPaid: pack.actualPaid ?? unsafePaise(0),
      wordingText: formats.wordingText,
    };

    // The audit copy, on the far side of the gate.
    const redacted = required('REDACTED_BUCKET');
    await putText(redacted, `redacted/${event.caseId}/wording.txt`, extracted.wordingText);
    await putJson(redacted, `redacted/${event.caseId}/tables.json`, {
      billTable: extracted.billTable,
      deductionTable: extracted.deductionTable,
    });

    await deps.store.update(event.caseId, (r) => ({ ...r, extracted }));
    const detectors = ['comprehend:DetectPiiEntities', ...formats.detectors];
    await emit(deps, event.caseId, 'Redacted', { countByType: counts, detectors, comprehend: 'confirmed' });
    return { countByType: counts, detectors };
  } catch (e) {
    rethrowCoded(e);
  }
};

async function redactTable(table: ExtractedTable, counts: Record<string, number>): Promise<ExtractedTable> {
  const descriptions = table.rows.map((r) => r.rawDescription);
  const redacted = await redactLines(descriptions, counts);
  return {
    ...table,
    rows: table.rows.map((row, i) => ({ ...row, rawDescription: redacted[i] ?? row.rawDescription })),
  };
}

async function redactText(text: string, counts: Record<string, number>): Promise<RedactedText> {
  const lines = text.split('\n');
  return markRedacted((await redactLines(lines, counts)).join('\n'));
}

/**
 * Lines go to Comprehend joined, so it sees names that span a line, and come
 * back as the same number of lines: a placeholder keeps any newline the span
 * covered, so the row ↔ description pairing survives.
 */
async function redactLines(lines: readonly string[], counts: Record<string, number>): Promise<string[]> {
  if (lines.every((l) => l.trim().length === 0)) return [...lines];
  const out: string[] = [];
  for (const chunk of chunkLines(lines)) {
    const joined = chunk.join('\n');
    const entities = await detectPiiEntities(joined);
    out.push(...applyEntities(joined, entities, counts).split('\n'));
  }
  return out;
}

function* chunkLines(lines: readonly string[]): Generator<string[]> {
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > CHUNK_CHARS && current.length > 0) {
      yield current;
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) yield current;
}

export function applyEntities(text: string, entities: readonly PiiEntity[], counts: Record<string, number>): string {
  const spans = entities
    .filter((e) => e.score >= MIN_ENTITY_SCORE && !KEEP_ENTITY_TYPES.has(e.type) && e.endOffset > e.beginOffset)
    .sort((a, b) => a.beginOffset - b.beginOffset);
  let cursor = 0;
  let out = '';
  for (const span of spans) {
    if (span.beginOffset < cursor) continue; // overlapping span; the first one already covered it
    out += text.slice(cursor, span.beginOffset);
    const covered = text.slice(span.beginOffset, span.endOffset);
    out += `«${span.type}»` + covered.replace(/[^\n]/g, '');
    counts[span.type] = (counts[span.type] ?? 0) + 1;
    cursor = span.endOffset;
  }
  return out + text.slice(cursor);
}
