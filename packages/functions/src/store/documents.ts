import { createHash } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DocumentStorage } from '@fc/api';

/**
 * Documents on S3, behind the redaction boundary (build spec §13).
 *
 * `raw/` is one bucket and `redacted/` another, on purpose: the split is
 * enforced by IAM per Lambda, not by a prefix condition, so a handler that is
 * allowed to call Bedrock has no `s3:GetObject` on the raw bucket at all.
 * This module is the compile-time half of the same split — callers pick
 * which bucket they touch by which function they call.
 *
 * Object keys are `raw/<caseId>/<kind>` and `redacted/<caseId>/<name>`, and
 * the key stored on the case record is the S3 key verbatim.
 */
const s3 = new S3Client({});

export const rawKey = (caseId: string, kind: string): string => `raw/${caseId}/${kind}`;

/** `DocumentStorage` over the raw bucket, for the API's own `PUT` fallback and the pipeline's reads. */
export class S3DocumentStorage implements DocumentStorage {
  constructor(private readonly rawBucket: string) {}

  async put(_caseId: string, key: string, bytes: Uint8Array): Promise<void> {
    await s3.send(new PutObjectCommand({ Bucket: this.rawBucket, Key: key, Body: bytes }));
  }

  async get(_caseId: string, key: string): Promise<Uint8Array> {
    const out = await s3.send(new GetObjectCommand({ Bucket: this.rawBucket, Key: key }));
    if (!out.Body) throw new Error(`empty object ${key}`);
    return out.Body.transformToByteArray();
  }
}

export interface RawObjectFacts {
  readonly byteLength: number;
  readonly contentType: string;
  readonly sha256: string;
}

/**
 * What arrived at a presigned target. `null` when nothing did. The hash is
 * computed here because S3 does not store SHA-256 for a POST upload and the
 * case record needs it — it is what the `PackUploaded` event and the
 * certificate's extraction hash chain back to.
 */
export async function describeRawObject(rawBucket: string, key: string): Promise<RawObjectFacts | null> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: rawBucket, Key: key }));
  } catch (e) {
    if ((e as { name?: string }).name === 'NotFound' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw e;
  }
  const out = await s3.send(new GetObjectCommand({ Bucket: rawBucket, Key: key }));
  const bytes = await out.Body!.transformToByteArray();
  return {
    byteLength: bytes.byteLength,
    contentType: out.ContentType?.split(';')[0]?.trim() ?? 'application/octet-stream',
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

export async function putJson(bucket: string, key: string, value: unknown): Promise<string> {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json' }),
  );
  return key;
}

export async function getJson<T>(bucket: string, key: string): Promise<T> {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) throw new Error(`empty object ${key}`);
  return JSON.parse(await out.Body.transformToString()) as T;
}

export async function putText(bucket: string, key: string, text: string, contentType = 'text/plain'): Promise<string> {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: text, ContentType: contentType }));
  return key;
}
