import type {
  AdmissionFacts,
  DocId,
  DocumentKind,
  ExtractedRow,
  ExtractedTable,
  FailureCode,
  LineRef,
  PolicySchedule,
} from '@fc/contracts';
import { ZERO } from '@fc/contracts';
import type { StoredDocument } from '../store/case-store';
import { StructuredBill, StructuredSchedule, StructuredSheet, StructuredWording } from './structured';

/** What extraction has to hand the rest of the pipeline. */
export interface ExtractedPack {
  readonly billTable: ExtractedTable;
  readonly deductionTable: ExtractedTable;
  readonly policy: PolicySchedule;
  readonly admission: AdmissionFacts;
  readonly actualPaid: ExtractedTable['printedTotal'];
  readonly wordingText: string;
  /** Per-document notes for the event log — page counts, confidences, which extractor ran. */
  readonly detail: Record<string, unknown>;
}

export class ExtractionError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export interface Extractor {
  readonly name: string;
  extract(docs: readonly { doc: StoredDocument; bytes: Uint8Array }[]): Promise<ExtractedPack>;
}

const provenance = (docId: DocId, i: number): ExtractedRow['provenance'] => ({
  docId,
  bbox: { page: 1, left: 0.05, top: Math.min(0.95, 0.1 + i * 0.02), width: 0.9, height: 0.015 },
  // Structured input has no OCR, so the confidence is the one an exact read gets.
  textractConfidence: 100,
  corrected: false,
});

const decode = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
};

/**
 * Reads the structured pack. This is the extractor a deployment with no
 * Textract runs, and the shape a Textract-backed one has to produce.
 */
export const structuredExtractor: Extractor = {
  name: 'structured',
  async extract(docs) {
    const byKind = new Map<DocumentKind, { doc: StoredDocument; bytes: Uint8Array }>();
    for (const d of docs) byKind.set(d.doc.kind, d);

    const need = (kind: DocumentKind) => {
      const entry = byKind.get(kind);
      if (!entry) throw new ExtractionError('PACK_INCOMPLETE', `the pack has no ${kind}`);
      if (entry.doc.contentType !== 'application/json') {
        throw new ExtractionError(
          'EXTRACTOR_UNAVAILABLE',
          `${kind} was uploaded as ${entry.doc.contentType}; this deployment extracts structured JSON only — Textract is not wired in yet`,
        );
      }
      return entry;
    };

    const billDoc = need('ITEMISED_BILL');
    const sheetDoc = need('DEDUCTION_SHEET');
    const scheduleDoc = need('POLICY_SCHEDULE');
    const wordingDoc = need('POLICY_WORDING');

    const bill = StructuredBill.safeParse(decode(billDoc.bytes));
    if (!bill.success) {
      throw new ExtractionError('TEXTRACT_NO_TABLE_FOUND', `the itemised bill is not a readable table: ${bill.error.issues[0]?.message ?? 'invalid'}`);
    }
    const sheet = StructuredSheet.safeParse(decode(sheetDoc.bytes));
    if (!sheet.success) {
      throw new ExtractionError('TEXTRACT_NO_TABLE_FOUND', `the deduction sheet is not a readable table: ${sheet.error.issues[0]?.message ?? 'invalid'}`);
    }
    const schedule = StructuredSchedule.safeParse(decode(scheduleDoc.bytes));
    if (!schedule.success) {
      throw new ExtractionError('SCHEDULE_UNPARSEABLE', `the policy schedule could not be read: ${schedule.error.issues[0]?.path.join('.') ?? ''} ${schedule.error.issues[0]?.message ?? ''}`.trim());
    }
    const wording = StructuredWording.safeParse(decode(wordingDoc.bytes));

    const billId = `doc-${billDoc.doc.sha256.slice(7, 19)}` as DocId;
    const sheetId = `doc-${sheetDoc.doc.sha256.slice(7, 19)}` as DocId;

    const billTable: ExtractedTable = {
      docId: billId,
      rows: bill.data.rows.map((r, i) => ({
        lineRef: `${billId}:1:${i}` as LineRef,
        rawDescription: r.description,
        quantity: r.quantity ?? null,
        amountClaimed: r.amountClaimed,
        amountPaid: null,
        insurerReasonCode: null,
        provenance: provenance(billId, i),
      })),
      printedTotal: bill.data.printedTotal ?? null,
    };

    const deductionTable: ExtractedTable = {
      docId: sheetId,
      rows: sheet.data.rows.map((r, i) => ({
        lineRef: `${sheetId}:1:${i}` as LineRef,
        rawDescription: r.description,
        quantity: null,
        amountClaimed: r.amountClaimed,
        amountPaid: r.amountPaid ?? ZERO,
        insurerReasonCode: r.reason ?? null,
        provenance: provenance(sheetId, i),
      })),
      printedTotal: sheet.data.actualPaid,
    };

    return {
      billTable,
      deductionTable,
      policy: schedule.data,
      admission: bill.data.admission,
      actualPaid: sheet.data.actualPaid,
      wordingText: wording.success ? wording.data.text : '',
      detail: {
        extractor: 'structured',
        billRows: billTable.rows.length,
        sheetRows: deductionTable.rows.length,
        textractConfidence: 100,
      },
    };
  },
};

/**
 * The Textract path. Declared so the wiring point is visible; it fails with a
 * taxonomy code rather than pretending, until `PipelineStack` and the
 * start-textract / textract-complete handlers exist (IMPLEMENTATION.md §11.3).
 */
export const textractExtractor: Extractor = {
  name: 'textract',
  async extract() {
    throw new ExtractionError(
      'EXTRACTOR_UNAVAILABLE',
      'Textract extraction is not configured in this deployment; deploy the pipeline stack or upload the structured JSON pack',
    );
  },
};
