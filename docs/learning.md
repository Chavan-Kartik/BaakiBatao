# What we touched for the first time

Maintained daily, named per person. Most teams leave this blank; the judging criteria
asks for it explicitly.

Be specific. "Learned AWS" is worth nothing. "Learned that there is no `.sync` service
integration for async Textract, so you have to park the task token keyed by JobId and
call `SendTaskSuccess` from the SNS handler" is worth something.

---

## Kartik

### Thursday 17 Sept

- **Branded types for money.** Had not used the `unique symbol` brand trick before.
  `type Paise = number & { readonly [brand]: 'Paise' }` means a raw `number` cannot be
  passed where an amount is expected, which is exactly the guard you want in code that
  drafts letters about rupee figures.
- **`dependency-cruiser` as an architectural test.** Knew about ESLint import rules;
  did not know you could assert "this package may not depend on that one" as a build
  step. Wrote a probe file importing `@aws-sdk/client-s3` into the engine to confirm the
  rule actually fires rather than assuming it did — it does, on both the AWS SDK and
  `node:fs`.
- **zod `.brand()` and `z.record` with enum keys.** `z.record(SomeEnum, X)` infers a
  *partial* record, so `byBucket.CORRECTLY_APPLIED` was `Paise | undefined`. Spelling
  the three buckets out as a `z.object` made them statically exhaustive.

---

## Eshan

### Thursday 17 Sept

- _(add yours here — one line is fine, specifics beat volume)_

---

## Things that fought back

A running list, for the Builder Center post.

- **pnpm 10 blocks postinstall scripts by default.** `esbuild` needs one, so it has to be
  named in `onlyBuiltDependencies` in `pnpm-workspace.yaml` or the install silently
  produces a broken binary.
- **Circular dependency between the step registry and the steps.** The registry imports
  all seven steps; the steps imported the `Reducer` type back from the registry. Type-only,
  so TypeScript was perfectly happy — `dependency-cruiser` caught it. Fixed by moving the
  type to its own module.
