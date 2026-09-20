import type { Block } from '@aws-sdk/client-textract';
import type { BBox, DocId, DocumentKind, ExtractedRow, ExtractedTable, LineRef, Paise, QueryAnswer } from '@fc/contracts';
import { PipelineFailure } from '@fc/api';
import { required } from '../shared/config';
import { getJson, putJson } from '../store/documents';
import { rethrowCoded } from '../store/io';

/**
 * `ParseBlocks` (state 3b): Textract Blocks → one `ParsedDocument`, with the
 * bounding box of every cell and answer preserved (§12.2). Geometry is
 * captured here or lost forever: the provenance crop in the UI reads these
 * boxes, and nothing downstream can reconstruct them.
 *
 * The parse is deliberately conservative. A cell that does not read as money
 * is not a row; a query with no answer is `null`; a table with no money
 * column is `TEXTRACT_NO_TABLE_FOUND`. The engine turns every null into an
 * UNRESOLVED finding that names the missing document — which is the honest
 * outcome for a bad scan, and the opposite of guessing.
 *
 * The output stays in the raw bucket: it is text read off the document and
 * has not yet crossed the redaction gate.
 */
export interface ParsedDocument {
  readonly kind: DocumentKind;
  readonly docId: DocId;
  /** Present for the bill and the deduction sheet. */
  readonly table: ExtractedTable | null;
  readonly answers: Readonly<Record<string, QueryAnswer>>;
  /** Every LINE block's text, in reading order — the wording, and the redaction gate's input. */
  readonly text: string;
  readonly pages: number;
  /** Mean OCR confidence over the cells that became rows, 0–100. */
  readonly meanConfidence: number;
}

interface ParseInput {
  readonly caseId: string;
  readonly doc: { readonly kind: DocumentKind; readonly key: string; readonly contentType: string };
  readonly blocksKey: string;
}

export const handler = async (event: ParseInput): Promise<{ parsedKey: string }> => {
  try {
    const raw = required('RAW_BUCKET');
    const { blocks } = await getJson<{ blocks: Block[] }>(raw, event.blocksKey);
    const docId = `doc-${event.caseId.slice(-12)}-${event.doc.kind.toLowerCase()}` as DocId;
    const parsed = parseBlocks(blocks, event.doc.kind, docId);
    const parsedKey = await putJson(raw, `parsed/${event.caseId}/${event.doc.kind}.json`, parsed);
    return { parsedKey };
  } catch (e) {
    rethrowCoded(e);
  }
};

/* --------------------------------------------------------------- the parse */

const TABLE_KINDS: ReadonlySet<DocumentKind> = new Set(['ITEMISED_BILL', 'DEDUCTION_SHEET']);

export function parseBlocks(blocks: readonly Block[], kind: DocumentKind, docId: DocId): ParsedDocument {
  const byId = new Map<string, Block>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);

  const lines = blocks.filter((b) => b.BlockType === 'LINE' && (b.Text ?? '').trim().length > 0);
  const text = lines.map((b) => b.Text!.trim()).join('\n');
  const pages = Math.max(1, ...blocks.map((b) => b.Page ?? 1));
  const answers = parseQueries(blocks, byId);

  let table: ExtractedTable | null = null;
  let meanConfidence = 0;
  if (TABLE_KINDS.has(kind)) {
    const parsed = parseTables(blocks, byId, kind, docId);
    if (!parsed) {
      throw new PipelineFailure(
        'TEXTRACT_NO_TABLE_FOUND',
        `no table with an amount column was found in the ${kind.toLowerCase().replace('_', ' ')}`,
      );
    }
    table = parsed.table;
    meanConfidence = parsed.meanConfidence;
  } else if (kind === 'POLICY_SCHEDULE' && Object.keys(answers).length === 0 && text.length === 0) {
    throw new PipelineFailure('SCHEDULE_UNPARSEABLE', 'the policy schedule produced no readable text');
  }

  return { kind, docId, table, answers, text, pages, meanConfidence };
}

function bbox(block: Block): BBox {
  const g = block.Geometry?.BoundingBox;
  return {
    page: block.Page ?? 1,
    left: clamp(g?.Left ?? 0),
    top: clamp(g?.Top ?? 0),
    width: clamp(g?.Width ?? 0),
    height: clamp(g?.Height ?? 0),
  };
}

const clamp = (n: number): number => Math.min(1, Math.max(0, n));

function children(block: Block, byId: Map<string, Block>, type: 'CHILD' | 'ANSWER' = 'CHILD'): Block[] {
  const out: Block[] = [];
  for (const rel of block.Relationships ?? []) {
    if (rel.Type !== type) continue;
    for (const id of rel.Ids ?? []) {
      const child = byId.get(id);
      if (child) out.push(child);
    }
  }
  return out;
}

function cellText(cell: Block, byId: Map<string, Block>): string {
  return children(cell, byId)
    .filter((w) => w.BlockType === 'WORD' || w.BlockType === 'SELECTION_ELEMENT')
    .map((w) => (w.BlockType === 'SELECTION_ELEMENT' ? (w.SelectionStatus === 'SELECTED' ? '[x]' : '[ ]') : (w.Text ?? '')))
    .join(' ')
    .trim();
}

function parseQueries(blocks: readonly Block[], byId: Map<string, Block>): Record<string, QueryAnswer> {
  const out: Record<string, QueryAnswer> = {};
  for (const q of blocks) {
    if (q.BlockType !== 'QUERY' || !q.Query?.Alias) continue;
    const results = children(q, byId, 'ANSWER').filter((r) => r.BlockType === 'QUERY_RESULT');
    const best = results.sort((a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0))[0];
    out[q.Query.Alias] = best
      ? { alias: q.Query.Alias, text: best.Text ?? null, confidence: best.Confidence ?? 0, bbox: bbox(best) }
      : { alias: q.Query.Alias, text: null, confidence: 0, bbox: null };
  }
  return out;
}

interface Cell {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: BBox;
}

/**
 * Rows of every TABLE on the document, concatenated in page order. Column
 * roles are inferred per table from what the cells contain rather than from
 * headers, because a hospital's header row says "Particulars", "Description",
 * "Item" or nothing at all.
 */
function parseTables(
  blocks: readonly Block[],
  byId: Map<string, Block>,
  kind: DocumentKind,
  docId: DocId,
): { table: ExtractedTable; meanConfidence: number } | null {
  const rows: ExtractedRow[] = [];
  const confidences: number[] = [];
  let printedTotal: Paise | null = null;
  let found = false;

  for (const t of blocks) {
    if (t.BlockType !== 'TABLE') continue;
    const grid = new Map<number, Map<number, Cell>>();
    for (const cell of children(t, byId)) {
      if (cell.BlockType !== 'CELL' || !cell.RowIndex || !cell.ColumnIndex) continue;
      const row = grid.get(cell.RowIndex) ?? new Map<number, Cell>();
      row.set(cell.ColumnIndex, { text: cellText(cell, byId), confidence: cell.Confidence ?? 0, bbox: bbox(cell) });
      grid.set(cell.RowIndex, row);
    }
    if (grid.size === 0) continue;

    const columns = columnRoles(grid);
    if (columns.amount === null || columns.description === null) continue;
    found = true;
    const page = t.Page ?? 1;

    for (const [rowIndex, cells] of [...grid.entries()].sort((a, b) => a[0] - b[0])) {
      const description = cells.get(columns.description)?.text ?? '';
      const amountCell = cells.get(columns.amount);
      const amount = amountCell ? money(amountCell.text) : null;
      if (amount === null) continue; // a header, a blank, a sub-heading
      if (/\b(grand\s+)?total\b|net\s+(amount|payable)|amount\s+payable/i.test(description) || description.length === 0) {
        if (/total|net|payable/i.test(description)) printedTotal = amount;
        continue;
      }
      const paidCell = columns.paid !== null ? cells.get(columns.paid) : undefined;
      const paid = paidCell ? money(paidCell.text) : null;
      const qtyCell = columns.quantity !== null ? cells.get(columns.quantity) : undefined;
      const qty = qtyCell ? integer(qtyCell.text) : null;
      const reasonCell = columns.reason !== null ? cells.get(columns.reason) : undefined;

      confidences.push(amountCell!.confidence);
      rows.push({
        lineRef: `${docId}:${page}:${rowIndex}` as LineRef,
        rawDescription: description,
        quantity: qty,
        amountClaimed: amount,
        amountPaid: kind === 'DEDUCTION_SHEET' ? paid : null,
        insurerReasonCode: reasonCell?.text || null,
        provenance: {
          docId,
          bbox: amountCell!.bbox,
          textractConfidence: Math.min(100, Math.max(0, amountCell!.confidence)),
          corrected: false,
        },
      });
    }
  }

  if (!found) return null;
  const meanConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  return { table: { docId, rows, printedTotal }, meanConfidence };
}

interface ColumnRoles {
  description: number | null;
  amount: number | null;
  paid: number | null;
  quantity: number | null;
  reason: number | null;
}

const HEADER_ROLES: ReadonlyArray<[keyof ColumnRoles, RegExp]> = [
  ['paid', /\b(paid|approved|allowed|allowable|payable|settled|admissible)\b/i],
  ['amount', /\b(claimed|claim|billed|bill|charges?|charged|amount|amt|rate|total|rs|inr)\b|₹/i],
  ['quantity', /^(qty|quantity|nos?\.?|units?|days?)$/i],
  ['reason', /\b(reason|remarks?|code|deduction|deducted)\b/i],
  ['description', /\b(particulars?|description|items?|services?|head|details?)\b/i],
];

/**
 * Which column is which. The header row decides when there is one — a
 * hospital's header says "Particulars", "Qty", "Amount (Rs.)" — and what the
 * cells contain decides otherwise: the amount is a money column (the paid
 * figure on a deduction sheet is the rightmost, with the claimed one to its
 * left), the description the widest text column, the quantity a column of
 * small integers.
 */
function columnRoles(grid: Map<number, Map<number, Cell>>): ColumnRoles {
  const columnIds = new Set<number>();
  for (const row of grid.values()) for (const c of row.keys()) columnIds.add(c);
  const stats = [...columnIds].sort((a, b) => a - b).map((col) => {
    let money = 0;
    let ints = 0;
    let texts = 0;
    let textLength = 0;
    for (const row of grid.values()) {
      const cell = row.get(col);
      if (!cell || cell.text.length === 0) continue;
      if (/^\d{1,2}$/.test(cell.text)) ints++;
      else if (moneyLike(cell.text)) money++;
      else {
        texts++;
        textLength += cell.text.length;
      }
    }
    return { col, money, ints, texts, textLength };
  });

  const roles: ColumnRoles = { description: null, amount: null, paid: null, quantity: null, reason: null };

  // The header row: the first row with no money in it.
  const header = [...grid.entries()]
    .sort((a, b) => a[0] - b[0])
    .find(([, cells]) => ![...cells.values()].some((c) => moneyLike(c.text) && !/^\d{1,2}$/.test(c.text)));
  if (header) {
    const amountCols: number[] = [];
    for (const [col, cell] of header[1]) {
      for (const [role, pattern] of HEADER_ROLES) {
        if (!pattern.test(cell.text)) continue;
        if (role === 'amount') amountCols.push(col);
        else if (roles[role] === null) roles[role] = col;
        break;
      }
    }
    // Several amount-ish headers ("Claimed", "Deducted"): the leftmost is the claim.
    if (amountCols.length > 0) roles.amount = amountCols[0]!;
  }

  const taken = new Set(Object.values(roles).filter((c): c is number => c !== null));
  const moneyCols = stats.filter((s) => s.money >= 2 && s.money >= s.texts && !taken.has(s.col)).map((s) => s.col);
  const textCols = stats.filter((s) => s.texts >= 2 && s.money < s.texts && !taken.has(s.col));

  if (roles.description === null) roles.description = textCols.sort((a, b) => b.textLength - a.textLength)[0]?.col ?? null;
  if (roles.amount === null && roles.paid === null) {
    roles.amount = moneyCols[0] ?? null;
    roles.paid = moneyCols.length >= 2 ? moneyCols[moneyCols.length - 1]! : null;
  } else if (roles.amount === null) {
    roles.amount = moneyCols.find((c) => c !== roles.paid) ?? roles.paid;
  } else if (roles.paid === null) {
    roles.paid = moneyCols.find((c) => c > roles.amount!) ?? null;
  }
  if (roles.quantity === null) {
    roles.quantity =
      stats.find((s) => s.ints >= 2 && s.money === 0 && ![roles.description, roles.amount, roles.paid].includes(s.col))?.col ?? null;
  }
  if (roles.reason === null && roles.description !== null) {
    roles.reason = textCols.find((s) => s.col > roles.description!)?.col ?? null;
  }
  return roles;
}

const MONEY = /^\(?[-−]?\s*(?:₹|rs\.?|inr)?\s*\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\s*\)?$|^\(?[-−]?\s*(?:₹|rs\.?|inr)?\s*\d+(?:\.\d{1,2})?\s*\)?$/i;

export function moneyLike(text: string): boolean {
  return MONEY.test(text.trim());
}

/** "1,23,456.50" → 12345650 paise. Parentheses and a leading minus read as negative. */
export function money(text: string): Paise | null {
  const t = text.trim();
  if (!moneyLike(t)) return null;
  const negative = /^\(.*\)$/.test(t) || /^[-−]/.test(t);
  // Drop the currency prefix first, or the dot in "Rs." survives into the number.
  const digits = t.replace(/^\(?[-−]?\s*(?:₹|rs\.?|inr)?/i, '').replace(/[^\d.]/g, '');
  if (digits.length === 0) return null;
  const value = Math.round(Number(digits) * 100);
  if (!Number.isFinite(value)) return null;
  return (negative ? -value : value) as Paise;
}

function integer(text: string): number | null {
  return /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null;
}
