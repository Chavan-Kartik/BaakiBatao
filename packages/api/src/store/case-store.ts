import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AdmissionFacts,
  CaseEvent,
  CaseStatus,
  Certificate,
  DocumentKind,
  ExtractedTable,
  FailureCode,
  Paise,
  PolicySchedule,
  ReconstructInput,
  Reconstruction,
} from '@fc/contracts';

/** What extraction and redaction produced; the pipeline resumes from here after a correction. */
export interface ExtractedState {
  readonly billTable: ExtractedTable;
  readonly deductionTable: ExtractedTable;
  readonly policy: PolicySchedule;
  readonly admission: AdmissionFacts;
  readonly actualPaid: Paise;
  readonly wordingText: string;
}

/** One uploaded document, as recorded when its bytes arrived. */
export interface StoredDocument {
  readonly kind: DocumentKind;
  readonly filename: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly sha256: string;
  /** Storage key — a path under the case directory locally, an S3 key on AWS. */
  readonly key: string;
}

export interface CaseRecord {
  readonly caseId: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: CaseStatus;
  /** What the client said it would upload; documents arrive against these slots. */
  readonly expected: readonly { kind: DocumentKind; filename: string; contentType: string }[];
  readonly documents: readonly StoredDocument[];
  readonly events: readonly CaseEvent[];
  readonly extracted: ExtractedState | null;
  readonly input: ReconstructInput | null;
  readonly reconstruction: Reconstruction | null;
  readonly certificate: Certificate | null;
  readonly failure: { code: FailureCode; message: string } | null;
  /** Set while status is AWAITING_CORRECTION; the token that resumes the pipeline. */
  readonly correctionTaskToken: string | null;
}

/**
 * Case persistence behind an interface, so the local filesystem and the
 * DynamoDB single table (IMPLEMENTATION.md §17) are two implementations of
 * one contract rather than two code paths. Events are append-only; state is
 * whatever the last write said it was.
 */
export interface CaseStore {
  create(record: CaseRecord): Promise<void>;
  get(caseId: string): Promise<CaseRecord | null>;
  listByOwner(ownerId: string): Promise<CaseRecord[]>;
  /** Read-modify-write under a per-case queue; `mutate` must be pure. */
  update(caseId: string, mutate: (r: CaseRecord) => CaseRecord): Promise<CaseRecord>;
}

/**
 * One JSON file per case. Writes go through a temp file and a rename, so a
 * crash mid-write leaves the previous record intact rather than half a one.
 */
export class FsCaseStore implements CaseStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  private dir(caseId: string): string {
    return join(this.root, 'cases', caseId);
  }

  private file(caseId: string): string {
    return join(this.dir(caseId), 'case.json');
  }

  async create(record: CaseRecord): Promise<void> {
    await mkdir(join(this.dir(record.caseId), 'raw'), { recursive: true });
    await this.write(record);
  }

  async get(caseId: string): Promise<CaseRecord | null> {
    try {
      return JSON.parse(await readFile(this.file(caseId), 'utf8')) as CaseRecord;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async listByOwner(ownerId: string): Promise<CaseRecord[]> {
    let ids: string[];
    try {
      ids = await readdir(join(this.root, 'cases'));
    } catch {
      return [];
    }
    const records = await Promise.all(ids.map((id) => this.get(id)));
    return records
      .filter((r): r is CaseRecord => r !== null && r.ownerId === ownerId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async update(caseId: string, mutate: (r: CaseRecord) => CaseRecord): Promise<CaseRecord> {
    const prev = this.queues.get(caseId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const current = await this.get(caseId);
      if (!current) throw new Error(`case ${caseId} not found`);
      const updated = { ...mutate(current), updatedAt: new Date().toISOString() };
      await this.write(updated);
      return updated;
    });
    this.queues.set(caseId, next.catch(() => undefined));
    return next;
  }

  /**
   * Temp file plus rename, so a crash mid-write leaves the last good record.
   * Windows refuses the rename while another process (an antivirus scan, a
   * sync client) holds the target for a moment, so it is retried briefly; the
   * pipeline writes this file a dozen times per case and one EPERM should not
   * fail a claim.
   */
  private async write(record: CaseRecord): Promise<void> {
    const target = this.file(record.caseId);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, target);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || attempt >= 8) throw e;
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
      }
    }
  }
}

/** Documents' bytes, separately from the record: raw uploads on S3 later, files now. */
export interface DocumentStorage {
  put(caseId: string, key: string, bytes: Uint8Array): Promise<void>;
  get(caseId: string, key: string): Promise<Uint8Array>;
}

export class FsDocumentStorage implements DocumentStorage {
  constructor(private readonly root: string) {}

  private path(caseId: string, key: string): string {
    return join(this.root, 'cases', caseId, key);
  }

  async put(caseId: string, key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(join(this.root, 'cases', caseId, 'raw'), { recursive: true });
    await writeFile(this.path(caseId, key), bytes);
  }

  async get(caseId: string, key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(caseId, key)));
  }
}
