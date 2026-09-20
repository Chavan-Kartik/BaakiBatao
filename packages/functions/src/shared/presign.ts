import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Presigned POST and GET URLs for claim documents. Bytes never touch Lambda:
 * the browser uploads straight to `raw/` and reads letters straight from
 * `artifacts/`.
 *
 * Expiry is five minutes for an upload. That is not a policy carried by the
 * URL — it is the interval during which a leaked URL stays useful, and there
 * is no reason to grant more. The content-length range and the content-type
 * equality are the other two conditions (build spec §23): the API never sees
 * the bytes, so the policy is where the 25 MB limit lives on AWS.
 */
const s3 = new S3Client({});

export interface PresignUploadConfig {
  readonly bucket: string;
  readonly key: string;
  readonly contentType: string;
  readonly maxBytes: number;
  readonly expiresSeconds?: number;
}

export async function presignUpload(config: PresignUploadConfig): Promise<{ url: string; fields: Record<string, string> }> {
  const post = await createPresignedPost(s3, {
    Bucket: config.bucket,
    Key: config.key,
    Expires: config.expiresSeconds ?? 5 * 60,
    // The field is what the browser sends; the condition is what S3 checks
    // it against. Both, or the upload is rejected with a policy error.
    Fields: { 'Content-Type': config.contentType },
    Conditions: [
      ['content-length-range', 1, config.maxBytes],
      ['eq', '$Content-Type', config.contentType],
    ],
  });
  return { url: post.url, fields: post.fields };
}

export async function presignGet(bucket: string, key: string, expiresSeconds = 15 * 60): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresSeconds });
}
