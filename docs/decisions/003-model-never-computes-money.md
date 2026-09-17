# 003 — The model never computes money

**Status:** accepted · 17 Sept 2026

## Context

The obvious version of this product hands the bill and the policy to an LLM and asks
"what should have been paid?" It demos well and it is indefensible. A wrong number stated
confidently is worse than no number, and in front of a judge who knows the domain it is
the fastest way to lose.

## Decision

Bedrock does exactly two jobs:

1. **Line normalisation** — map a free-text bill description to one of ~60 canonical
   categories. It selects from a candidate list; it never invents a category.
2. **Prose** — the per-finding explanation and the connective sentences in the
   reconsideration letter.

Every rupee is decided by the deterministic engine. The letter is a template with holes,
and there is no hole a number could go in:

- amounts, clause IDs, line references and arithmetic are interpolated from the engine
  result;
- clause text is quoted verbatim from the rulepack;
- the model supplies only `opening`, `closing` and one `rationale` sentence per finding.

A post-generation assertion scans every model-authored block for digit sequences
resembling currency and rejects the generation if it finds any.

## Consequences

- We can state "money is never computed by a model" as a fact about the architecture
  rather than a claim about prompt discipline.
- The engine is testable without any model in the loop, which is why the test suite runs
  in under a second.
- The model's genuine value — reading six hospitals' wording for the same line item — is
  still captured, but bounded to a classification decision with a confidence gate.
