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
- **pnpm 11 runs a dependency check before every script**, and a workspace with an
  unapproved build script (`esbuild` again) makes *every* `pnpm typecheck` fail with a stack
  trace from `runDepsStatusCheck` rather than from the script you asked for. The fix is the
  same `onlyBuiltDependencies` entry, but the symptom points somewhere else entirely.
- **`-0` is a rupee figure JavaScript will happily produce.** `negPaise(ZERO)` gave `-0`, which
  is `===` to `0` but not `Object.is` to it, so `toMatchObject({ amount: 0 })` failed on a
  finding whose amount was genuinely zero. Fixed at the source rather than in the tests: a
  zero cut negates to zero.
- **A trigram threshold tuned for single words is wrong for billing lines.** The §14 default
  of 0.92 comes from the pg_trgm world; on multi-token descriptions ("pharmacy - day 2")
  the union of trigrams grows with every token, and 0.92 escalates half the corpus while
  0.52 is still 99.98% accurate. The number is only defensible once it is on a curve.
- **Fault matching has to be an assignment, not a greedy pass.** With two faults under one
  clause, the first fault can take the dispute the second needed and the harness scores a
  miss the engine never made. Three faults per pack keeps the exact search trivial.
- **`node:sqlite` is invisible to Vite.** It is a prefix-only builtin, absent from
  `builtinModules`, so vitest tried to resolve a package called `sqlite`. `createRequire`
  loads it without a shim and the runtime is unchanged.
- **An absolute upload URL is a cross-origin request.** The API printed
  `http://localhost:3000/...` into the upload target; the browser at `127.0.0.1:5173` sent no
  cookie and got a 401. Local targets are fetched by path through the proxy; presigned S3
  targets are used verbatim — the client handles both.
- **Correcting a bill description unpairs it from the deduction sheet.** The two documents
  are joined on description and amount, so a fix to one side has to be applied to the row
  it was matched to on the other, or the insurer's cut lands in the residual.
- **`rename()` over an open file is EPERM on Windows**, especially in a OneDrive folder. The
  atomic-write pattern needs a short retry loop there; the first pipeline run through the UI
  died on the eleventh write.

