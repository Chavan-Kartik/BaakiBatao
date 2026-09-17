# 004 — The redaction gate is what makes cross-region Bedrock defensible

**Status:** accepted · 17 Sept 2026

## Context

Everything belongs in `ap-south-1` (Mumbai): the documents are Indian medical records.
But the Bedrock model we want may not be available there, and discovering that on Friday
would cost half a day.

The lazy answer is "run Bedrock in `us-east-1`, it's a hackathon." An AWS professional
will ask about data residency, and they will be right to.

## Decision

A redaction gate sits upstream of **every** Bedrock call and is treated as an
architectural boundary rather than a function:

- Comprehend `DetectPiiEntities` for names, addresses, phones, emails;
- deterministic regex for Aadhaar, PAN, GSTIN, policy number, UHID, claim number —
  formats where a regex genuinely beats a model;
- amounts, service dates, line descriptions and clause references are kept **intact**,
  because they are the data.

Enforcement is threefold:

1. **Type system.** `RedactedText` is a branded string that only the gate can mint. The
   Bedrock client wrapper accepts nothing else, so passing raw text is a compile error.
2. **IAM.** Bedrock-calling Lambdas have no `s3:GetObject` on the `raw/` prefix at all. A
   bug cannot read unredacted content.
3. **Lifecycle.** `raw/` expires after 1 day; case items carry a 24-hour TTL.

The gate **fails closed**. If redaction cannot be confirmed, the execution stops with
`REDACTION_FAILED_OPEN` and nothing proceeds.

## Consequences

- Only redacted text ever leaves Mumbai, so a `us-east-1` Bedrock client is a defensible
  choice rather than an admission.
- "Nothing stores real personal data beyond the demo session" becomes a lifecycle policy
  and an IAM boundary — a mechanism, not a promise.
- One extra state in the pipeline and one extra failure mode, both worth it.
