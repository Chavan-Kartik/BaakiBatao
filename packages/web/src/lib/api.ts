import type {
  CaseEvent,
  CaseSummary,
  Certificate,
  CreateCaseRequest,
  CreateCaseResponse,
  DocumentKind,
  GetCaseResponse,
  SubmitCorrectionsRequest,
  VerifyResult,
} from '@fc/contracts';

/**
 * The case API client. Thin on purpose: the contracts package owns every
 * request and response shape, and the server validates them with the same
 * zod schemas, so a drift is a type error on one side and a 400 on the other.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { accept: 'application/json', ...(init.body && !(init.body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...init.headers },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  listCases: () => call<CaseSummary[]>('/cases'),

  getCase: (caseId: string) => call<GetCaseResponse>(`/cases/${caseId}`),

  createCase: (body: CreateCaseRequest) =>
    call<CreateCaseResponse>('/cases', { method: 'POST', body: JSON.stringify(body) }),

  /** Works for a presigned S3 POST target or a local PUT target alike. */
  async upload(target: CreateCaseResponse['uploads'][number], file: Blob): Promise<void> {
    // A local target is one of this API's own routes. It is fetched by path,
    // same-origin, so the session cookie travels with it whatever host the API
    // process printed into the URL; a presigned S3 target is used verbatim.
    const isLocal = target.url.includes('/api/cases/');
    const res = isLocal
      ? await fetch(new URL(target.url).pathname, { method: 'PUT', credentials: 'include', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file })
      : await fetch(target.url, { method: 'POST', body: presignedForm(target.fields, file) });
    if (!res.ok) throw new ApiError(res.status, `upload of ${target.kind} failed`);
  },

  submit: (caseId: string) => call<{ status: string }>(`/cases/${caseId}/submit`, { method: 'POST' }),

  corrections: (caseId: string, body: SubmitCorrectionsRequest) =>
    call<{ status: string }>(`/cases/${caseId}/corrections`, { method: 'POST', body: JSON.stringify(body) }),

  certificate: (caseId: string) => call<Certificate>(`/cases/${caseId}/certificate`),

  verify: (caseId: string) => call<VerifyResult>(`/cases/${caseId}/verify`),

  /** Server-sent events until the case reaches a terminal status. */
  events(caseId: string, onEvent: (e: CaseEvent) => void, onStatus: (status: string) => void): () => void {
    const source = new EventSource(`/api/cases/${caseId}/events`, { withCredentials: true });
    const handler = (e: MessageEvent<string>) => onEvent(JSON.parse(e.data) as CaseEvent);
    for (const kind of EVENT_KINDS) source.addEventListener(kind, handler as EventListener);
    source.addEventListener('status', ((e: MessageEvent<string>) => {
      onStatus((JSON.parse(e.data) as { status: string }).status);
      source.close();
    }) as EventListener);
    source.onerror = () => source.close();
    return () => source.close();
  },
};

const EVENT_KINDS: readonly CaseEvent['kind'][] = [
  'PackUploaded', 'PackValidated', 'DocumentClassified', 'PageExtracted', 'Redacted',
  'ChecksumFailed', 'RowsCorrected', 'Normalised', 'Reconstructed', 'ProseWritten',
  'CertificateIssued', 'CaseFailed',
];

function presignedForm(fields: Record<string, string>, file: Blob): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  return form;
}

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  ITEMISED_BILL: 'Itemised hospital bill',
  DEDUCTION_SHEET: 'Deduction sheet',
  SETTLEMENT_LETTER: 'Settlement letter',
  POLICY_SCHEDULE: 'Policy schedule',
  POLICY_WORDING: 'Policy wording',
  ENDORSEMENT: 'Endorsement / rider',
};
