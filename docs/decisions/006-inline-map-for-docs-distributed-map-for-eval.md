# 006 — Inline Map for documents, Distributed Map for the evaluation sweep

**Status:** accepted · 17 Sept 2026

## Context

Step Functions Distributed Map is the more impressive-sounding construct, and it would be
easy to reach for it to fan out across the documents in a claim pack.

A claim pack has about six documents.

## Decision

- **Inline `Map`, `MaxConcurrency: 4`** for the documents within a pack. Six items, each
  needing a Textract call. Inline Map's 40-item limit and shared execution history are
  not constraints at this size, and keeping the child states in the same execution
  history is worth a lot when debugging a failed pack.

- **Distributed Map** for the evaluation sweep over 200 corpus packs, with an Express
  child workflow per pack and `MaxConcurrency: 40`, reading an S3 manifest and writing
  results to `s3://…/eval-runs/<runId>/`.

## Consequences

Using Distributed Map for six items would be the tell of someone pattern-matching a blog
post. Using it for a 200-item batch sweep and inline Map for a six-item fan-out is the
tell of someone who read the limits. Right-sizing is the signal; this ADR exists so the
choice is visibly deliberate rather than accidental.
