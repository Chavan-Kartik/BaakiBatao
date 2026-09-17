# 007 — Engine purity is a build failure, not a convention

**Status:** accepted · 17 Sept 2026

## Context

`packages/engine` is the deterministic core. Keeping it free of AWS SDK calls buys three
specific things:

1. The test suite runs in under a second with no mocks and no network.
2. The Build It fallback (SAM CLI + LocalStack, Textract stubbed from cached fixtures)
   costs an hour rather than a day.
3. **The identical module runs in the browser**, which is what the what-if panel is built
   on: drag the room category down a tier and the full seven-step waterfall recomputes
   synchronously, with no round trip.

A rule this load-bearing cannot rely on remembering it at 2 a.m. on day three.

## Decision

Three enforcement points:

1. **ESLint** — `no-restricted-imports` on `packages/engine/src/**` blocking `@aws-sdk/*`,
   `aws-sdk`, `node:*` and the bare Node built-ins, with a message explaining why.
2. **dependency-cruiser** — `engine-is-pure`, `engine-no-node-builtins` and
   `engine-depends-only-on-contracts` as `error`-severity rules. This catches what ESLint
   misses, including type-only cycles.
3. **CI** — `pnpm dep:cruise` is a required check.

Verified by writing a probe file that imports `@aws-sdk/client-s3` and `node:fs` into the
engine and confirming the rule fires, rather than assuming it does.

## Consequences

- Any I/O the engine appears to need is a signal that the boundary is wrong: the caller
  should fetch and pass it in. In practice this pushed the clock out of the engine too —
  `reconstruct()` takes `now` as a parameter, which is also what makes two runs over
  identical input produce an identical result hash.
- `dependency-cruiser` caught a real cycle on day one: the step registry imports all
  seven steps, and the steps were importing the `Reducer` type back from the registry.
  Type-only, so TypeScript was happy. Moving the type to `types.ts` fixed it.
