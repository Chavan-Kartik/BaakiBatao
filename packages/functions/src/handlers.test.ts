import type { Block } from '@aws-sdk/client-textract';
import type { DocId } from '@fc/contracts';
import { describe, expect, it } from 'vitest';
import { dateOf, roomCategoryOf } from './pipeline/extract';
import { decode } from './pipeline/fail-with-reason';
import { money, moneyLike, parseBlocks } from './pipeline/parse-tables';
import { applyEntities } from './pipeline/redact';
import { containsDigitClaim } from './pipeline/write-prose';

/**
 * The pure halves of the handlers: what Textract blocks become, what the
 * redaction gate does with Comprehend's spans, what a Step Functions error
 * decodes to. No AWS here; the I/O halves are exercised by deploying.
 */

describe('money', () => {
  it('reads Indian grouping, symbols and parentheses', () => {
    expect(money('1,23,456.50')).toBe(12345650);
    expect(money('₹ 5,000')).toBe(500000);
    expect(money('Rs. 750.00')).toBe(75000);
    expect(money('(1,200.00)')).toBe(-120000);
    expect(money('-300')).toBe(-30000);
  });
  it('refuses text that is not an amount', () => {
    expect(money('Room rent')).toBeNull();
    expect(money('12/03/2025')).toBeNull();
    expect(moneyLike('3 days')).toBe(false);
  });
});

/* A two-row table with a header, a total, one query and one LINE, as Textract emits them. */
function table(): Block[] {
  const cell = (id: string, row: number, col: number, text: string, conf = 98): Block[] => [
    {
      Id: id,
      BlockType: 'CELL',
      RowIndex: row,
      ColumnIndex: col,
      Confidence: conf,
      Page: 1,
      Geometry: { BoundingBox: { Left: 0.1 * col, Top: 0.05 * row, Width: 0.2, Height: 0.02 } },
      Relationships: [{ Type: 'CHILD', Ids: [`${id}w`] }],
    },
    { Id: `${id}w`, BlockType: 'WORD', Text: text, Confidence: conf, Page: 1 },
  ];
  const cells = [
    ...cell('h1', 1, 1, 'Particulars'),
    ...cell('h2', 1, 2, 'Qty'),
    ...cell('h3', 1, 3, 'Amount'),
    ...cell('r1a', 2, 1, 'Room rent'),
    ...cell('r1b', 2, 2, '3'),
    ...cell('r1c', 2, 3, '12,000.00'),
    ...cell('r2a', 3, 1, 'Surgeon fee'),
    ...cell('r2b', 3, 2, '1'),
    ...cell('r2c', 3, 3, '45,000.00'),
    ...cell('t1', 4, 1, 'Total'),
    ...cell('t3', 4, 3, '57,000.00'),
  ];
  return [
    { Id: 'line1', BlockType: 'LINE', Text: 'ABC Hospital', Page: 1 },
    {
      Id: 'tbl',
      BlockType: 'TABLE',
      Page: 1,
      Relationships: [{ Type: 'CHILD', Ids: cells.filter((c) => c.BlockType === 'CELL').map((c) => c.Id!) }],
    },
    ...cells,
    {
      Id: 'q1',
      BlockType: 'QUERY',
      Query: { Alias: 'BILL_TOTAL', Text: 'What is the total bill amount?' },
      Relationships: [{ Type: 'ANSWER', Ids: ['a1'] }],
    },
    { Id: 'a1', BlockType: 'QUERY_RESULT', Text: '57,000.00', Confidence: 91, Page: 1 },
  ];
}

describe('parseBlocks', () => {
  it('turns a bill table into rows with provenance, and the total into printedTotal', () => {
    const parsed = parseBlocks(table(), 'ITEMISED_BILL', 'doc-x' as DocId);
    expect(parsed.table?.rows.map((r) => [r.rawDescription, r.quantity, r.amountClaimed])).toEqual([
      ['Room rent', 3, 1_200_000],
      ['Surgeon fee', 1, 4_500_000],
    ]);
    expect(parsed.table?.printedTotal).toBe(5_700_000);
    expect(parsed.table?.rows[0]?.lineRef).toBe('doc-x:1:2');
    expect(parsed.table?.rows[0]?.provenance.bbox.left).toBeCloseTo(0.3);
    expect(parsed.table?.rows[0]?.provenance.textractConfidence).toBe(98);
    expect(parsed.answers['BILL_TOTAL']?.text).toBe('57,000.00');
    expect(parsed.text).toBe('ABC Hospital');
  });

  it('fails with the taxonomy code when a bill has no amount column', () => {
    const noTable = table().filter((b) => b.BlockType !== 'TABLE');
    expect(() => parseBlocks(noTable, 'ITEMISED_BILL', 'doc-x' as DocId)).toThrow(
      expect.objectContaining({ code: 'TEXTRACT_NO_TABLE_FOUND' }),
    );
  });

  it('does not need a table for a wording document', () => {
    const parsed = parseBlocks(table().filter((b) => b.BlockType === 'LINE'), 'POLICY_WORDING', 'doc-w' as DocId);
    expect(parsed.table).toBeNull();
    expect(parsed.text).toBe('ABC Hospital');
  });
});

describe('answers → facts', () => {
  const answer = (text: string, confidence = 90) => ({ alias: 'x', text, confidence, bbox: null });
  it('reads the date formats Indian documents use', () => {
    expect(dateOf(answer('12/03/2025'))).toBe('2025-03-12');
    expect(dateOf(answer('12-03-2025'))).toBe('2025-03-12');
    expect(dateOf(answer('12 Mar 2025'))).toBe('2025-03-12');
    expect(dateOf(answer('March 12, 2025'))).toBe('2025-03-12');
    expect(dateOf(answer('soon'))).toBeNull();
    expect(dateOf(answer('12/03/2025', 20))).toBeNull(); // below the confidence floor
  });
  it('maps room descriptions onto the enum, and nothing else', () => {
    expect(roomCategoryOf(answer('Single Private AC'))).toBe('SINGLE_PRIVATE');
    expect(roomCategoryOf(answer('Twin sharing'))).toBe('SHARED_TWIN');
    expect(roomCategoryOf(answer('ICU'))).toBe('ICU');
    expect(roomCategoryOf(answer('Ward 4B'))).toBe('GENERAL_WARD');
    expect(roomCategoryOf(answer('n/a'))).toBeNull();
  });
});

describe('applyEntities', () => {
  it('replaces spans with typed placeholders, keeps newlines and dates, and counts by type', () => {
    const text = 'Patient: Asha Rao\nAdmitted 12/03/2025\nPhone 9876543210';
    const counts: Record<string, number> = {};
    const out = applyEntities(
      text,
      [
        { type: 'NAME', score: 0.99, beginOffset: 9, endOffset: 17 },
        { type: 'DATE_TIME', score: 0.99, beginOffset: 27, endOffset: 37 },
        { type: 'PHONE', score: 0.97, beginOffset: 44, endOffset: 54 },
        { type: 'ADDRESS', score: 0.2, beginOffset: 0, endOffset: 7 }, // below the score floor
      ],
      counts,
    );
    expect(out).toBe('Patient: «NAME»\nAdmitted 12/03/2025\nPhone «PHONE»');
    expect(counts).toEqual({ NAME: 1, PHONE: 1 });
  });
  it('keeps the line count when a span crosses a newline', () => {
    const out = applyEntities('12 MG Road\nBengaluru 560001', [{ type: 'ADDRESS', score: 0.9, beginOffset: 0, endOffset: 27 }], {});
    expect(out.split('\n')).toHaveLength(2);
  });
});

describe('decode', () => {
  it('keeps a taxonomy code and unwraps the Lambda error message', () => {
    expect(decode({ Error: 'PACK_INCOMPLETE', Cause: JSON.stringify({ errorMessage: 'the pack is missing POLICY_WORDING' }) })).toEqual({
      code: 'PACK_INCOMPLETE',
      message: 'the pack is missing POLICY_WORDING',
    });
  });
  it('maps anything outside the taxonomy to PIPELINE_INTERNAL', () => {
    expect(decode({ Error: 'Lambda.Unknown', Cause: 'boom' })).toEqual({ code: 'PIPELINE_INTERNAL', message: 'boom' });
    expect(decode({ Error: 'States.Timeout' }).message).toBe('the step timed out');
    expect(decode(undefined).code).toBe('PIPELINE_INTERNAL');
  });
});

describe('containsDigitClaim', () => {
  it('refuses any digit, Devanagari included', () => {
    expect(containsDigitClaim('The clause caps room rent at one percent.')).toBe(false);
    expect(containsDigitClaim('The clause caps room rent at 1%.')).toBe(true);
    expect(containsDigitClaim('कमरा किराया १%')).toBe(true);
  });
});
