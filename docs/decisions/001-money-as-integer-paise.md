# 001 — Money is an integer number of paise

**Status:** accepted · 17 Sept 2026

## Context

The system computes rupee figures that go into a letter sent to an insurer. A rounding
error is not a cosmetic bug here; it is a wrong claim made in writing.

## Decision

Every amount is `Paise`, a branded integer. There is no `number` holding money anywhere
in the system. The brand means a raw `number` cannot be passed where an amount is
expected.

Rounding is declared in the rulepack (`rounding.json`), not left to whatever the
floating-point unit did. The proportionate-deduction ratio in step 5 is the only place a
fraction enters the arithmetic, and it goes through `applyRatio()`, which is
integer-only:

```ts
Math.floor((amount * numerator + denominator / 2) / denominator)   // half-up
```

Rounding drift is **not** absorbed. It surfaces in the reconciliation residual, and if it
exceeds `matchTolerancePaise` (default ₹1) it becomes a visible finding.

## Consequences

- Arithmetic on branded numbers needs helpers (`addPaise`, `subPaise`) because `a + b`
  on two branded values widens back to `number`. Mild friction, accepted.
- Display formatting has to be explicit (`formatInr`), which is no loss since Indian
  digit grouping is not the default anyway.
- `0.1 + 0.2 !== 0.3` cannot reach a generated letter.
