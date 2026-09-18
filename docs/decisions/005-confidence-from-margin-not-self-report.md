# 005 — Confidence comes from margin and agreement, never from the model

**Status:** accepted · 17 Sept 2026

## Context

The unresolved bucket only means something if the routing decision into it is sound. Ask
an LLM for its confidence and it will answer 0.95 with total composure whether it is
right or wrong. Self-reported confidence is not calibrated, and using it as a routing
signal is the most common unforced error in LLM pipelines.

## Decision

Normalisation is a three-tier cascade, and the model is the last resort:

| Tier | Mechanism | Accepted when |
|---|---|---|
| 1 | DynamoDB lexicon, exact then trigram | exact hit, or similarity ≥ 0.92 with a single candidate |
| 2 | Titan Text Embeddings V2, cosine kNN over ~60 category centroids | `cos(top1) − cos(top2) ≥ τ` |
| 3 | Claude on Amazon Bedrock, tool-use with a JSON schema, choices restricted to the top-5 embedding candidates, `n = 3` at temperature 0.3 | all three samples agree |

Neither accepted signal is the model's opinion of itself:

- **embedding margin** — the distance between best and second-best. A narrow margin means
  the categories are genuinely close for this text.
- **sample agreement** — three independent samples agreeing is evidence; one sample
  asserting confidence is not.

A tier-2 margin below τ escalates. A tier-3 split vote becomes
`UNRESOLVED / AMBIGUOUS_DESCRIPTION`, and the UI shows the split.

τ is **calibrated**, not guessed: `pnpm eval:calibrate` sweeps it over a held-out
labelled split and plots accuracy-among-accepted against escalation rate. We pick the
knee and publish the curve in `docs/evaluation.md`.

## Consequences

- Accepted tier-3 answers are written back to the lexicon with provenance, so the next
  claim with that description resolves at tier 1 for free. The system gets cheaper and
  more deterministic with every claim it sees.
- Most lines never reach the model at all, which is the point.
- We need a labelled split to calibrate against, which is one more reason the evaluation
  corpus is load-bearing rather than decorative.
