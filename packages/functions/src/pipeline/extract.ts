import type { AdmissionFacts, DocumentKind, ExtractedTable, Paise, PolicySchedule, QueryAnswer, RoomCategory } from '@fc/contracts';
import { ZERO } from '@fc/contracts';
import { ExtractionError, structuredExtractor, type ExtractedPack, type StoredDocument } from '@fc/api';
import { required } from '../shared/config';
import { getJson, putJson, S3DocumentStorage } from '../store/documents';
import { emit, loadCase, rethrowCoded, stageDeps } from '../store/io';
import { money } from './parse-tables';
import type { ParsedDocument } from './parse-tables';

/**
 * `AssembleExtraction` (after the `Map`): the per-document results become
 * the one `ExtractedPack` the rest of the pipeline consumes — the same shape
 * the local structured extractor produces, so everything downstream of here
 * is the same code either way.
 *
 * A document that was uploaded as structured JSON never went to Textract and
 * is read by the structured extractor; a scanned one comes back as a
 * `ParsedDocument`. A pack may mix the two. Schedule fields that Textract
 * could not answer stay `null` — the engine's UNRESOLVED path is the honest
 * outcome, and a defaulted room-rent cap would be the exact confident-wrong
 * answer this system exists not to give.
 *
 * The pack is written to the raw bucket: it still carries unredacted text.
 */
export interface ExtractInput {
  readonly caseId: string;
  readonly documents: ReadonlyArray<{ kind: DocumentKind; source: 'structured' | 'textract'; parsedKey: string | null }>;
}

export const EXTRACTED_KEY = (caseId: string): string => `extracted/${caseId}.json`;

export const handler = async (event: ExtractInput): Promise<{ packKey: string }> => {
  const deps = stageDeps();
  try {
    const raw = required('RAW_BUCKET');
    const record = await loadCase(deps, event.caseId);
    const storage = new S3DocumentStorage(raw);

    const parsed = new Map<DocumentKind, ParsedDocument>();
    const structured: { doc: StoredDocument; bytes: Uint8Array }[] = [];
    for (const d of event.documents) {
      const stored = record.documents.find((s) => s.kind === d.kind);
      if (!stored) continue;
      if (d.source === 'textract' && d.parsedKey) parsed.set(d.kind, await getJson<ParsedDocument>(raw, d.parsedKey));
      else structured.push({ doc: stored, bytes: await storage.get(record.caseId, stored.key) });
    }

    const pack = parsed.size === 0 ? await structuredExtractor.extract(structured) : await assemble(parsed, structured);
    const packKey = await putJson(raw, EXTRACTED_KEY(event.caseId), pack);
    await emit(deps, event.caseId, 'PageExtracted', pack.detail);
    return { packKey };
  } catch (e) {
    rethrowCoded(e);
  }
};

/** A mixed pack: Textract for the scanned documents, the structured reader for the rest. */
async function assemble(
  parsed: Map<DocumentKind, ParsedDocument>,
  structured: { doc: StoredDocument; bytes: Uint8Array }[],
): Promise<ExtractedPack> {
  // Whatever arrived as JSON is read the structured way — with placeholders
  // for the scanned kinds so the structured reader's own validation runs on
  // the JSON it was given, and nothing else.
  const structuredPack = structured.length > 0 ? await structuredSubset(structured) : null;

  const bill = parsed.get('ITEMISED_BILL');
  const sheet = parsed.get('DEDUCTION_SHEET');
  const schedule = parsed.get('POLICY_SCHEDULE');
  const wording = parsed.get('POLICY_WORDING');
  const letter = parsed.get('SETTLEMENT_LETTER');

  const billTable = bill?.table ?? structuredPack?.billTable;
  const deductionTable = sheet?.table ?? structuredPack?.deductionTable;
  if (!billTable) throw new ExtractionError('TEXTRACT_NO_TABLE_FOUND', 'the itemised bill produced no readable table');
  if (!deductionTable) throw new ExtractionError('TEXTRACT_NO_TABLE_FOUND', 'the deduction sheet produced no readable table');

  const policy = schedule ? scheduleFromAnswers(schedule.answers) : structuredPack?.policy;
  if (!policy) throw new ExtractionError('SCHEDULE_UNPARSEABLE', 'the policy schedule could not be read');

  const admission = bill ? admissionFromAnswers(bill.answers) : (structuredPack?.admission ?? EMPTY_ADMISSION);
  const actualPaid =
    amountOf(sheet?.answers['AMOUNT_PAID']) ??
    amountOf(letter?.answers['AMOUNT_PAID']) ??
    (sheet ? sumPaid(deductionTable) : null) ??
    structuredPack?.actualPaid ??
    null;

  const confidences = [bill, sheet].filter((d): d is ParsedDocument => d !== undefined).map((d) => d.meanConfidence);
  return {
    billTable,
    deductionTable,
    policy,
    admission,
    actualPaid,
    wordingText: wording?.text ?? structuredPack?.wordingText ?? '',
    detail: {
      extractor: 'textract',
      scanned: [...parsed.keys()],
      structured: structured.map((s) => s.doc.kind),
      pages: Object.fromEntries([...parsed.values()].map((d) => [d.kind, d.pages])),
      billRows: billTable.rows.length,
      sheetRows: deductionTable.rows.length,
      textractConfidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 100,
      unanswered: [...parsed.values()].flatMap((d) =>
        Object.values(d.answers).filter((a) => a.text === null).map((a) => `${d.kind}.${a.alias}`),
      ),
    },
  };
}

/**
 * The structured reader wants all four required kinds. For the kinds that
 * were scanned instead, it is given an empty placeholder of the right shape,
 * so it validates the JSON documents it *was* given and nothing more; the
 * placeholder values are discarded by `assemble`.
 */
async function structuredSubset(structured: { doc: StoredDocument; bytes: Uint8Array }[]): Promise<ExtractedPack> {
  const have = new Set(structured.map((s) => s.doc.kind));
  const placeholders: Record<string, unknown> = {
    ITEMISED_BILL: { admission: EMPTY_ADMISSION, rows: [], printedTotal: null },
    DEDUCTION_SHEET: { rows: [], actualPaid: 0 },
    POLICY_SCHEDULE: scheduleFromAnswers({}),
    POLICY_WORDING: { text: '' },
  };
  const docs = [...structured];
  for (const [kind, value] of Object.entries(placeholders)) {
    if (have.has(kind as DocumentKind)) continue;
    docs.push({
      doc: { kind: kind as DocumentKind, filename: 'placeholder.json', contentType: 'application/json', byteLength: 0, sha256: 'sha256:' + '0'.repeat(64), key: '' },
      bytes: new TextEncoder().encode(JSON.stringify(value)),
    });
  }
  return structuredExtractor.extract(docs);
}

/* -------------------------------------------------------- answers → facts */

const EMPTY_ADMISSION: AdmissionFacts = {
  admissionDate: null,
  dischargeDate: null,
  occupiedRoomCategory: null,
  actualRoomRentPerDay: null,
  roomDays: null,
  icuDays: null,
  hospitalUsesDifferentialBilling: null,
};

/** Below this, an answer is treated as absent. Textract's own confidence, 0–100. */
const MIN_ANSWER_CONFIDENCE = 50;

function textOf(answer: QueryAnswer | undefined): string | null {
  if (!answer || answer.text === null || answer.confidence < MIN_ANSWER_CONFIDENCE) return null;
  return answer.text.trim() || null;
}

function amountOf(answer: QueryAnswer | undefined): Paise | null {
  const text = textOf(answer);
  if (!text) return null;
  // "Rs. 5,00,000/-" and "₹5 lakh" both appear on real schedules.
  const lakh = /^(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(lakh|lac|lakhs|lacs)\b/i.exec(text);
  if (lakh) return Math.round(Number(lakh[1]) * 100_000 * 100) as Paise;
  const crore = /^(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(crore|cr)\b/i.exec(text);
  if (crore) return Math.round(Number(crore[1]) * 10_000_000 * 100) as Paise;
  return money(text.replace(/\/-\s*$/, '').replace(/\bper\s+day\b.*$/i, ''));
}

function percentOf(answer: QueryAnswer | undefined): number | null {
  const text = textOf(answer);
  if (!text) return null;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  if (!m) return null;
  const pct = Number(m[1]);
  return pct >= 0 && pct <= 100 ? pct : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, "12 Jan 2025", "Jan 12, 2025" → ISO date, or null. */
export function dateOf(answer: QueryAnswer | undefined): string | null {
  const text = textOf(answer);
  if (!text) return null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  const dMonY = /(\d{1,2})\s+([A-Za-z]{3,9})[,.]?\s+(\d{4})/.exec(text);
  if (dMonY) {
    const m = MONTHS[dMonY[2]!.slice(0, 3).toLowerCase()];
    if (m) return `${dMonY[3]}-${String(m).padStart(2, '0')}-${dMonY[1]!.padStart(2, '0')}`;
  }
  const monDY = /([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (monDY) {
    const m = MONTHS[monDY[1]!.slice(0, 3).toLowerCase()];
    if (m) return `${monDY[3]}-${String(m).padStart(2, '0')}-${monDY[2]!.padStart(2, '0')}`;
  }
  return null;
}

export function roomCategoryOf(answer: QueryAnswer | undefined): RoomCategory | null {
  const text = textOf(answer)?.toLowerCase();
  if (!text) return null;
  if (/\bicu\b|intensive/.test(text)) return 'ICU';
  if (/suite/.test(text)) return 'SUITE';
  if (/deluxe/.test(text)) return 'DELUXE';
  if (/single|private/.test(text)) return 'SINGLE_PRIVATE';
  if (/twin|shared|semi|double/.test(text)) return 'SHARED_TWIN';
  if (/general|ward|economy/.test(text)) return 'GENERAL_WARD';
  return null;
}

function scheduleFromAnswers(a: Readonly<Record<string, QueryAnswer>>): PolicySchedule {
  return {
    insurerWordingId: textOf(a['INSURER']) ?? 'unknown',
    policyStartDate: dateOf(a['POLICY_START']),
    policyEndDate: dateOf(a['POLICY_END']),
    productFiledOn: null,
    lastRenewedOn: null,
    sumInsured: amountOf(a['SUM_INSURED']),
    sumInsuredRemaining: null,
    restoreBenefitGranted: false,
    noClaimBonus: null,
    roomRentCapPerDay: amountOf(a['ROOM_RENT_CAP_PER_DAY']),
    roomRentCapPercentOfSumInsured: percentOf(a['ROOM_RENT_CAP_PERCENT']) ?? percentOf(a['ROOM_RENT_CAP_PER_DAY']),
    eligibleRoomCategory: roomCategoryOf(a['ELIGIBLE_ROOM']),
    icuCapPerDay: amountOf(a['ICU_CAP_PER_DAY']),
    copayPercent: percentOf(a['COPAY_PERCENT']),
    deductible: amountOf(a['DEDUCTIBLE']),
    subLimits: [],
    waitingPeriods: [],
    riders: [],
    hasProportionateDeductionClause: null,
    ameDefinitionCategories: [],
  };
}

function admissionFromAnswers(a: Readonly<Record<string, QueryAnswer>>): AdmissionFacts {
  const admissionDate = dateOf(a['ADMISSION_DATE']);
  const dischargeDate = dateOf(a['DISCHARGE_DATE']);
  const roomDays =
    admissionDate && dischargeDate
      ? Math.max(1, Math.round((Date.parse(dischargeDate) - Date.parse(admissionDate)) / 86_400_000))
      : null;
  return {
    admissionDate,
    dischargeDate,
    occupiedRoomCategory: roomCategoryOf(a['ROOM_TYPE']),
    actualRoomRentPerDay: amountOf(a['ROOM_RENT_PER_DAY']),
    roomDays,
    icuDays: null,
    hospitalUsesDifferentialBilling: null,
  };
}

function sumPaid(table: ExtractedTable): Paise | null {
  const paid = table.rows.map((r) => r.amountPaid).filter((p): p is Paise => p !== null);
  if (paid.length === 0) return null;
  return paid.reduce((s, p) => (s + p) as Paise, ZERO);
}
