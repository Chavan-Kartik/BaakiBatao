import { KMSClient, SignCommand, VerifyCommand } from '@aws-sdk/client-kms';
import type { Certificate, Sha256, Signature } from '@fc/contracts';

/**
 * `ECDSA_SHA_256` over the certificate's result hash (§16). The hash is the
 * substance — replay proves it reproduces — and the signature is what lets a
 * sceptic check provenance without trusting the signer. The message is the
 * `sha256:…` string itself, so anyone holding the public key can verify a
 * certificate offline from the JSON alone.
 *
 * Fails closed: a certificate that cannot be signed is not issued.
 */
const kms = new KMSClient({});

export async function signResultHash(keyId: string, resultHash: Sha256): Promise<Signature> {
  const out = await kms.send(
    new SignCommand({
      KeyId: keyId,
      Message: Buffer.from(resultHash, 'utf8'),
      MessageType: 'RAW',
      SigningAlgorithm: 'ECDSA_SHA_256',
    }),
  );
  if (!out.Signature || !out.KeyId) throw new Error('KMS signing returned no signature');
  return { alg: 'ECDSA_SHA_256', keyId: out.KeyId, value: Buffer.from(out.Signature).toString('base64') };
}

/** `null` when the certificate is unsigned; otherwise KMS's own verdict. */
export async function verifyCertificateSignature(certificate: Certificate): Promise<boolean | null> {
  if (!certificate.signature) return null;
  try {
    const out = await kms.send(
      new VerifyCommand({
        KeyId: certificate.signature.keyId,
        Message: Buffer.from(certificate.resultHash, 'utf8'),
        MessageType: 'RAW',
        Signature: Buffer.from(certificate.signature.value, 'base64'),
        SigningAlgorithm: 'ECDSA_SHA_256',
      }),
    );
    return out.SignatureValid ?? false;
  } catch (e) {
    // KMS answers an invalid signature with an exception, not `false`.
    if ((e as { name?: string }).name === 'KMSInvalidSignatureException') return false;
    throw e;
  }
}
