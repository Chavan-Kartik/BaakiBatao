import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDemoPack } from '@fc/fixtures';
import { buildLexicon, createNormaliser } from '@fc/normalise';
import { loadRulepackV1 } from '@fc/rulepack';
import { createServer } from './server';
import { resultHash } from './pipeline/certificate';

/**
 * The slice, end to end, through the HTTP surface: sign up, create a case,
 * upload the demo pack, submit, follow the events to completion, read the
 * reconstruction and certificate, verify, correct, re-run. Filesystem store
 * in a temp dir, better-auth on its own SQLite file, no network.
 */
let dir: string;
let app: Awaited<ReturnType<typeof createServer>>['app'];
let cookie = '';

const json = (_body: unknown) => ({ 'content-type': 'application/json', origin: 'http://localhost:5173' });

async function req(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  let body = init.body;
  if (init.json !== undefined) {
    for (const [k, v] of Object.entries(json(init.json))) headers.set(k, v);
    body = JSON.stringify(init.json);
  }
  return app.request(`http://localhost:3000${path}`, { ...init, headers, body });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fc-api-'));
  process.env['FC_DATA_DIR'] = dir;
  process.env['NODE_ENV'] = 'test';
  app = (await createServer()).app;

  const res = await req('/api/auth/sign-up/email', {
    method: 'POST',
    json: { name: 'Test', email: 'test@example.com', password: 'correct-horse-battery' },
  });
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});

afterAll(() => {
  // better-auth holds the SQLite file open; Windows refuses the delete until
  // the process exits, and a leftover temp dir is not a failed test.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function waitForTerminal(caseId: string) {
  for (let i = 0; i < 100; i++) {
    const got = (await (await req(`/api/cases/${caseId}`)).json()) as { status: string };
    if (['COMPLETE', 'FAILED', 'AWAITING_CORRECTION'].includes(got.status)) return got;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('pipeline did not finish');
}

describe('the case API', () => {
  it('serves a request without a session as the guest owner rather than refusing it', async () => {
    const saved = cookie;
    cookie = '';
    expect((await req('/api/cases')).status).toBe(200);
    // Still validated, just not gated: an empty pack is a 400, not a 401.
    expect((await req('/api/cases', { method: 'POST', json: { docs: [] } })).status).toBe(400);
    cookie = saved;
  });

  it('runs the demo pack through the pipeline and issues a verifiable certificate', async () => {
    const pack = buildDemoPack();
    const created = (await (
      await req('/api/cases', {
        method: 'POST',
        json: { docs: pack.map((p) => ({ kind: p.kind, filename: p.filename, contentType: p.contentType })) },
      })
    ).json()) as { caseId: string; uploads: { kind: string; url: string }[] };
    expect(created.uploads).toHaveLength(4);

    for (const u of created.uploads) {
      const file = pack.find((p) => p.kind === u.kind);
      const res = await req(new URL(u.url).pathname, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: file?.body,
      });
      expect(res.status).toBe(200);
    }

    // Submitting before every declared document is in is refused; here they all are.
    expect((await req(`/api/cases/${created.caseId}/submit`, { method: 'POST' })).status).toBe(202);
    const done = (await waitForTerminal(created.caseId)) as {
      status: string;
      reconstruction: { expectedPayable: number; reconciliation: { invariantHeld: boolean } } | null;
      input: { normalisedLines: { categoryId: string | null }[] } | null;
      correctionTaskToken: string | null;
    };
    expect(done.status).toBe('COMPLETE');
    expect(done.reconstruction?.reconciliation.invariantHeld).toBe(true);

    // The real normaliser ran: the fixture's lumped descriptions are gated,
    // not guessed, so the figure differs from the by-construction demo.
    const unresolved = done.input?.normalisedLines.filter((l) => l.categoryId === null) ?? [];
    expect(unresolved.length).toBeGreaterThan(0);

    const cert = (await (await req(`/api/cases/${created.caseId}/certificate`)).json()) as { resultHash: string; signature: null };
    expect(cert.signature).toBeNull();
    expect(cert.resultHash).toBe(resultHash(done.reconstruction as never));

    const verify = (await (await req(`/api/cases/${created.caseId}/verify`)).json()) as { match: boolean };
    expect(verify.match).toBe(true);

    // Correct the gated lines; the case re-runs and lands on the worked example.
    const gated = (await (await req(`/api/cases/${created.caseId}`)).json()) as {
      extractedBill: { rows: { lineRef: string; rawDescription: string }[] };
      correctionTaskToken: string;
    };
    const fix: Record<string, string> = {
      'Room Rent - Deluxe (5 days)': 'Room rent',
      'ICU Charges (2 days)': 'ICU charges',
      'Laboratory and Imaging': 'Laboratory',
      'Medical Records and Administrative Charges': 'Administrative charges',
    };
    const rows = gated.extractedBill.rows
      .filter((r) => fix[r.rawDescription])
      .map((r) => ({ lineRef: r.lineRef, field: 'rawDescription' as const, value: fix[r.rawDescription] as string }));
    const corrected = await req(`/api/cases/${created.caseId}/corrections`, {
      method: 'POST',
      json: { taskToken: gated.correctionTaskToken, rows },
    });
    expect(corrected.status).toBe(202);

    const again = (await waitForTerminal(created.caseId)) as { status: string; reconstruction: { expectedPayable: number; actualPaid: number } };
    expect(again.status).toBe('COMPLETE');
    expect(again.reconstruction.expectedPayable).toBe(318_600_00);
    expect(again.reconstruction.actualPaid).toBe(208_320_00);

    const events = await (await req(`/api/cases/${created.caseId}/events`)).text();
    expect(events).toContain('event: RowsCorrected');
    expect(events).toContain('event: CertificateIssued');
  });

  it('fails a scanned upload with a named reason rather than guessing', async () => {
    const pack = buildDemoPack();
    const created = (await (
      await req('/api/cases', {
        method: 'POST',
        json: {
          docs: pack.map((p) => ({ kind: p.kind, filename: p.filename, contentType: p.kind === 'ITEMISED_BILL' ? 'application/pdf' : p.contentType })),
        },
      })
    ).json()) as { caseId: string; uploads: { kind: string; url: string }[] };
    for (const u of created.uploads) {
      const file = pack.find((p) => p.kind === u.kind);
      const pdf = u.kind === 'ITEMISED_BILL';
      await req(new URL(u.url).pathname, {
        method: 'PUT',
        headers: { 'content-type': pdf ? 'application/pdf' : 'application/json' },
        body: pdf ? '%PDF-1.4 not really' : file?.body,
      });
    }
    await req(`/api/cases/${created.caseId}/submit`, { method: 'POST' });
    const done = (await waitForTerminal(created.caseId)) as { status: string; failure: { code: string } | null };
    expect(done.status).toBe('FAILED');
    expect(done.failure?.code).toBe('EXTRACTOR_UNAVAILABLE');
  });

  it('refuses a pack with a required document missing', async () => {
    const pack = buildDemoPack().filter((p) => p.kind !== 'POLICY_WORDING');
    const created = (await (
      await req('/api/cases', {
        method: 'POST',
        json: { docs: pack.map((p) => ({ kind: p.kind, filename: p.filename, contentType: p.contentType })) },
      })
    ).json()) as { caseId: string; uploads: { kind: string; url: string }[] };
    for (const u of created.uploads) {
      await req(new URL(u.url).pathname, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: pack.find((p) => p.kind === u.kind)?.body,
      });
    }
    await req(`/api/cases/${created.caseId}/submit`, { method: 'POST' });
    const done = (await waitForTerminal(created.caseId)) as { status: string; failure: { code: string } | null };
    expect(done.failure?.code).toBe('PACK_INCOMPLETE');
  });

  it('keeps one user out of another user’s case', async () => {
    const mine = (await (await req('/api/cases')).json()) as { caseId: string }[];
    expect(mine.length).toBeGreaterThan(0);
    const saved = cookie;
    const other = await req('/api/auth/sign-up/email', {
      method: 'POST',
      json: { name: 'Other', email: 'other@example.com', password: 'correct-horse-battery' },
    });
    cookie = other.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    expect((await req(`/api/cases/${mine[0]?.caseId}`)).status).toBe(404);
    expect(((await (await req('/api/cases')).json()) as unknown[]).length).toBe(0);
    cookie = saved;
  });
});

describe('the normaliser the pipeline runs', () => {
  it('is the same tier-1 lexicon the harness calibrates', () => {
    const n = createNormaliser(buildLexicon(loadRulepackV1()));
    expect(n.normalise('x' as never, 'Room rent').categoryId).toBe('ROOM_RENT');
    expect(n.normalise('x' as never, 'Laboratory and Imaging').categoryId).toBeNull();
  });
});
