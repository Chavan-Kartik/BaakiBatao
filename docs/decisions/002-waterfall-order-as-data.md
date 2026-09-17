# 002 — The waterfall order lives in the rulepack, not in code

**Status:** accepted · 17 Sept 2026

## Context

Order matters more than any individual rule. The same set of deductions applied in a
different sequence produces a different payable — most visibly, co-pay before the
deductible is not the same as after, and insurers differ on which.

If the order is expressed as a sequence of function calls, then supporting a second
insurer's wording means a code branch, and "we support two insurers" becomes "we have two
code paths that drift."

## Decision

`packages/rulepack/data/v1/steps.json` is an ordered list of step IDs with parameters.
The interpreter walks it, resolves each `reducer` name to a registered pure function, and
threads the state through:

```ts
for (const def of rulepack.steps) {
  const [next, produced] = resolveReducer(def.reducer)(state, ctx);
  ...
}
```

Insurer wording differences are a rulepack version. Rulepacks are immutable, versioned,
stored in DynamoDB behind an SSM pointer, and their hash is pinned into every
certificate.

## Consequences

- A rule can be corrected during judging with a `PutItem` and a pointer bump — no
  redeploy. The demo value is real but secondary.
- The primary value: an old certificate still verifies against its own pinned rulepack
  hash, so correcting a rule does not retroactively rewrite history.
- An unknown reducer name fails loudly at load time rather than silently skipping a step.
- There is a property test asserting that permuting the co-pay/deductible order *changes*
  the result for some input — which proves the order is live rather than decorative.
