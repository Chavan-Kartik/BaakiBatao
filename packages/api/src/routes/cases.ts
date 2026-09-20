import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type {
  CaseSummary,
  CreateCaseResponse,
  DocumentKind,
  GetCaseResponse,
  VerifyResult,
} from '@fc/contracts';
import { CreateCaseRequest, DocumentKind as DocumentKindSchema, SubmitCorrectionsRequest } from '@fc/contracts';
import { matchDeductionSheet, normaliseDescription, reconstruct } from '@fc/engine';
import type { Auth, Session } from '../auth';
import { resultHash } from '../pipeline/certificate';
import type { PipelineDeps } from '../pipeline/run';
import type { PipelineRunner } from '../pipeline/runner';
import type { CaseRecord } from '../store/case-store';

type Vars = { Variables: { session: Session } };

export interface CaseRouteOptions {
  /**
   * How long one events stream may stay open before it ends and the browser's
   * EventSource reconnects with `Last-Event-ID`. Unbounded locally; on Lambda
   * it sits under the function timeout.
   */
  readonly eventStreamMaxMs?: number;
}

/**
 * The case API (IMPLEMENTATION.md §18).
 *
 * Cases are *scoped* to an owner, but the API is deliberately **not gated**:
 * a request without a session is served as the shared guest owner below. The
 * better-auth handler is still mounted and still mints real sessions, so
 * turning ownership back into access control is a one-line change here — but
 * nothing in the product asks anyone to sign in to look at their own bill.
 *
 * Uploads: `POST /cases` answers with one upload target per document. On AWS
 * those are presigned S3 POSTs so the bytes never touch our compute; locally
 * they are `PUT` routes on this server. The client does not know which.
 */

/**
 * The owner a request without a session is attributed to. A constant rather
 * than a per-browser id, because the point of the demo is that the next person
 * to open it sees the case the last one ran.
 */
export const GUEST_OWNER_ID = 'guest';

const GUEST_SESSION = {
  user: { id: GUEST_OWNER_ID, email: 'guest@localhost', name: 'Guest' },
} as unknown as Session;

export function caseRoutes(
  auth: Auth,
  deps: PipelineDeps,
  runner: PipelineRunner,
  options: CaseRouteOptions = {},
): Hono<Vars> {
  const app = new Hono<Vars>();

  app.use('*', async (c, next) => {
    // A real session is honoured when the browser happens to carry one; its
    // absence is not an error, it is the ordinary case.
    const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
    c.set('session', session ?? GUEST_SESSION);
    await next();
  });

  const owned = async (c: { get: (k: 'session') => Session }, caseId: string): Promise<CaseRecord | null> => {
    const record = await deps.store.get(caseId);
    if (!record || record.ownerId !== c.get('session').user.id) return null;
    return record;
  };

  app.get('/', async (c) => {
    const records = await deps.store.listByOwner(c.get('session').user.id);
    const out: CaseSummary[] = records.map((r) => ({
      caseId: r.caseId as CaseSummary['caseId'],
      status: r.status,
      createdAt: r.createdAt,
      documents: r.documents.map((d) => d.kind),
    }));
    return c.json(out);
  });

  app.post('/', async (c) => {
    const parsed = CreateCaseRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid request' }, 400);
    if (parsed.data.docs.length === 0) return c.json({ error: 'a pack has at least one document' }, 400);

    const kinds = new Set<DocumentKind>();
    for (const d of parsed.data.docs) {
      if (kinds.has(d.kind)) return c.json({ error: `two documents declared as ${d.kind}` }, 400);
      kinds.add(d.kind);
    }

    const caseId = `case-${randomUUID()}`;
    const now = deps.now();
    await deps.store.create({
      caseId,
      ownerId: c.get('session').user.id,
      createdAt: now,
      updatedAt: now,
      status: 'AWAITING_UPLOAD',
      expected: parsed.data.docs,
      documents: [],
      events: [],
      extracted: null,
      input: null,
      reconstruction: null,
      certificate: null,
      failure: null,
      correctionTaskToken: null,
    });

    const response: CreateCaseResponse = {
      caseId: caseId as CreateCaseResponse['caseId'],
      uploads: await runner.uploadTargets(caseId, parsed.data.docs),
    };
    return c.json(response, 201);
  });

  app.put('/:id/documents/:kind', async (c) => {
    const record = await owned(c, c.req.param('id'));
    if (!record) return c.json({ error: 'no such case' }, 404);
    if (record.status !== 'AWAITING_UPLOAD') return c.json({ error: 'this case is no longer accepting uploads' }, 409);

    const kind = DocumentKindSchema.safeParse(c.req.param('kind'));
    if (!kind.success) return c.json({ error: 'unknown document kind' }, 400);
    const slot = record.expected.find((e) => e.kind === kind.data);
    if (!slot) return c.json({ error: `the case did not declare a ${kind.data}` }, 400);

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) return c.json({ error: 'empty upload' }, 400);
    if (bytes.byteLength > 25 * 1024 * 1024) return c.json({ error: 'document exceeds 25 MB' }, 413);

    const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const key = `raw/${kind.data}`;
    await deps.documents.put(record.caseId, key, bytes);
    await deps.store.update(record.caseId, (r) => ({
      ...r,
      documents: [
        ...r.documents.filter((d) => d.kind !== kind.data),
        {
          kind: kind.data,
          filename: slot.filename,
          contentType: c.req.header('content-type')?.split(';')[0]?.trim() ?? slot.contentType,
          byteLength: bytes.byteLength,
          sha256,
          key,
        },
      ],
    }));
    return c.json({ kind: kind.data, sha256, byteLength: bytes.byteLength });
  });

  /** All declared documents are in; run the pipeline. */
  app.post('/:id/submit', async (c) => {
    const declared = await owned(c, c.req.param('id'));
    if (!declared) return c.json({ error: 'no such case' }, 404);
    if (declared.status !== 'AWAITING_UPLOAD') return c.json({ error: 'already submitted' }, 409);
    // Presigned uploads land in storage without passing through here; the
    // runner records them on the case before the check below.
    const record = await runner.collect(declared);
    const missing = record.expected.filter((e) => !record.documents.some((d) => d.kind === e.kind));
    if (missing.length > 0) {
      return c.json({ error: `still waiting for ${missing.map((m) => m.kind).join(', ')}` }, 409);
    }

    await deps.store.update(record.caseId, (r) => ({
      ...r,
      events: [
        ...r.events,
        {
          seq: r.events.length,
          at: deps.now(),
          kind: 'PackUploaded',
          detail: { documents: r.documents.map((d) => ({ kind: d.kind, sha256: d.sha256, bytes: d.byteLength })) },
        },
      ],
    }));
    await runner.start(record.caseId);
    return c.json({ caseId: record.caseId, status: 'VALIDATING' }, 202);
  });

  app.get('/:id', async (c) => {
    const record = await owned(c, c.req.param('id'));
    if (!record) return c.json({ error: 'no such case' }, 404);
    const response: GetCaseResponse = {
      caseId: record.caseId as GetCaseResponse['caseId'],
      status: record.status,
      extractedBill: record.extracted?.billTable ?? null,
      input: record.input,
      reconstruction: record.reconstruction,
      failure: record.failure,
      correctionTaskToken: record.correctionTaskToken,
    };
    return c.json(response);
  });

  app.get('/:id/events', async (c) => {
    const record = await owned(c, c.req.param('id'));
    if (!record) return c.json({ error: 'no such case' }, 404);
    const caseId = record.caseId;
    const after = Number(c.req.header('last-event-id') ?? -1);

    return streamSSE(c, async (stream) => {
      let sent = Number.isFinite(after) ? after : -1;
      const deadline = options.eventStreamMaxMs ? Date.now() + options.eventStreamMaxMs : Infinity;
      let lastWrite = Date.now();
      for (;;) {
        // A quiet stretch (Textract on a long document) must not look like a
        // dead connection to whatever proxy sits in front: a comment line
        // every 15 s keeps it open and is invisible to EventSource.
        if (Date.now() - lastWrite > 15_000) {
          await stream.write(': keep-alive\n\n');
          lastWrite = Date.now();
        }
        const current = await deps.store.get(caseId);
        if (!current) break;
        for (const ev of current.events) {
          if (ev.seq <= sent) continue;
          await stream.writeSSE({ id: String(ev.seq), event: ev.kind, data: JSON.stringify(ev) });
          sent = ev.seq;
          lastWrite = Date.now();
        }
        const terminal = current.status === 'COMPLETE' || current.status === 'FAILED' || current.status === 'AWAITING_CORRECTION';
        if (terminal) {
          await stream.writeSSE({ event: 'status', data: JSON.stringify({ status: current.status }) });
          break;
        }
        // Not terminal but out of time: end quietly. The browser reconnects
        // with the last seq it saw, and nothing is repeated or lost.
        if (Date.now() >= deadline) break;
        await stream.sleep(300);
      }
    });
  });

  app.post('/:id/corrections', async (c) => {
    const record = await owned(c, c.req.param('id'));
    if (!record) return c.json({ error: 'no such case' }, 404);
    const correctable = record.status === 'AWAITING_CORRECTION' || record.status === 'COMPLETE';
    if (!correctable || !record.extracted || !record.correctionTaskToken) {
      return c.json({ error: 'this case cannot take a correction right now' }, 409);
    }
    const parsed = SubmitCorrectionsRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid request' }, 400);
    if (parsed.data.taskToken !== record.correctionTaskToken) return c.json({ error: 'stale task token' }, 409);

    // The bill and the sheet are joined on description and amount, so an edit
    // to a bill line is applied to the sheet row it was matched to as well —
    // otherwise correcting a misread description would unpair the line from
    // the insurer's cut and move that cut into the residual.
    const extracted = record.extracted;
    const matched = matchDeductionSheet(
      extracted.billTable,
      extracted.deductionTable,
      deps.rulepack.rounding.matchTolerancePaise,
    ).byLine;
    const sheetRenames = new Map<string, { rawDescription?: string; amountClaimed?: number }>();

    const rows = extracted.billTable.rows.map((row) => {
      let out = row;
      for (const edit of parsed.data.rows) {
        if (edit.lineRef !== row.lineRef) continue;
        if (edit.field === 'rawDescription') out = { ...out, rawDescription: edit.value };
        if (edit.field === 'amountClaimed') out = { ...out, amountClaimed: Math.round(Number(edit.value)) as typeof row.amountClaimed };
        out = { ...out, provenance: { ...out.provenance, corrected: true } };
      }
      if (out !== row && matched.has(row.lineRef)) {
        sheetRenames.set(`${normaliseDescription(row.rawDescription)}|${row.amountClaimed}`, {
          rawDescription: out.rawDescription,
          amountClaimed: out.amountClaimed,
        });
      }
      return out;
    });

    const sheetRows = extracted.deductionTable.rows.map((row) => {
      const rename = sheetRenames.get(`${normaliseDescription(row.rawDescription)}|${row.amountClaimed}`);
      if (!rename) return row;
      sheetRenames.delete(`${normaliseDescription(row.rawDescription)}|${row.amountClaimed}`);
      return {
        ...row,
        rawDescription: rename.rawDescription ?? row.rawDescription,
        amountClaimed: (rename.amountClaimed ?? row.amountClaimed) as typeof row.amountClaimed,
        provenance: { ...row.provenance, corrected: true },
      };
    });

    await deps.store.update(record.caseId, (r) => ({
      ...r,
      // The status moves before the resume is launched, so a client that
      // polls straight after the 202 never reads the previous run as current.
      status: 'NORMALISING',
      extracted: {
        ...extracted,
        billTable: { ...extracted.billTable, rows, printedTotal: null },
        deductionTable: { ...extracted.deductionTable, rows: sheetRows },
      },
      correctionTaskToken: null,
      events: [
        ...r.events,
        { seq: r.events.length, at: deps.now(), kind: 'RowsCorrected', detail: { edits: parsed.data.rows.length } },
      ],
    }));
    await runner.resume(record);
    return c.json({ caseId: record.caseId, status: 'NORMALISING' }, 202);
  });

  app.get('/:id/certificate', async (c) => {
    const record = await owned(c, c.req.param('id'));
    if (!record?.certificate) return c.json({ error: 'no certificate yet' }, 404);
    return c.json(record.certificate);
  });

  /**
   * Replay: run the engine again over the pinned input and compare hashes.
   * The rulepack in use must match the pins, or the comparison is between two
   * different rule sets and says nothing about the certificate.
   */
  app.get('/:id/verify', async (c) => {
    const record = await owned(c, c.req.param('id'));
    if (!record?.certificate || !record.input) return c.json({ error: 'nothing to verify yet' }, 404);
    if (record.input.pins.rulepackHash !== deps.rulepack.hash) {
      return c.json({ error: `certificate pins rulepack ${record.input.pins.rulepackHash}; this server runs ${deps.rulepack.hash}` }, 409);
    }
    const started = performance.now();
    const again = reconstruct({ input: record.input, rulepack: deps.rulepack, now: deps.now() });
    const recomputedHash = resultHash(again);
    const result: VerifyResult = {
      match: recomputedHash === record.certificate.resultHash,
      storedHash: record.certificate.resultHash,
      recomputedHash,
      recomputedInMs: Math.round((performance.now() - started) * 100) / 100,
      signatureValid: deps.verifySignature ? await deps.verifySignature(record.certificate) : null,
    };
    return c.json(result);
  });

  return app;
}
