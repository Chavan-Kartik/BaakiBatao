# Settlement reconstructor

A policy-aware settlement reconstructor for Indian health insurance claims.

You upload your claim pack — the itemised hospital bill, the deduction sheet, the
settlement letter, and your own policy schedule and wording. The system independently
reconstructs what the settlement *should* have been, as an ordered seven-step waterfall,
then reconciles its own figure against what the insurer actually paid. Every rupee of
difference is placed in one of three buckets: **correctly applied**, **incorrectly
applied** (with the clause it contradicts), or **unresolved** (with the reason we cannot
decide).

> We do not tell you your insurer cheated you. We tell you, line by line, which part of
> your deduction we can defend, which part we can challenge, and which part we honestly
> cannot judge.

**Built for:** Bharat Builds Tour — First Commit, 17–20 Sept 2026
**Track:** Ship It

---

## The three things worth looking at

**1. A hard arithmetic invariant.** The engine refuses to emit a result whose findings do
not sum to the observed difference between the bill total and the amount paid. Any
unexplained remainder is materialised as an explicit `UNRESOLVED` finding with reason
`RESIDUAL_UNATTRIBUTED`. Every paise is either attributed to a clause ID or explicitly
marked unattributed — there is no third state.

See [`packages/engine/src/reconcile/invariant.ts`](packages/engine/src/reconcile/invariant.ts)
and its property test.

**2. The waterfall order is data, not code.** [`steps.json`](packages/rulepack/data/v1/steps.json)
is an ordered list of step IDs; each resolves to a registered pure reducer. Whether
co-pay applies before or after the deductible is a rulepack version, not a branch. Rules
live in DynamoDB, so a rule can be corrected without a redeploy — and an older
certificate still verifies against its own pinned rulepack hash.

**3. The model cannot compute money.** Bedrock does exactly two jobs: it maps free-text
bill descriptions to canonical categories, and it writes English. It never computes an
amount and never receives unredacted text. Normalisation is a three-tier cascade where
the LLM is the last resort, and **its self-reported confidence is never used** — routing
is gated on the cosine margin between the top two candidates and on three-sample
agreement.

---

## Status

Day 1 scaffold. What runs today:

| Package | State |
|---|---|
| `@fc/contracts` | Complete. The frozen seam both engineers build against. |
| `@fc/engine` | Interpreter, `Paise` arithmetic and the reconciliation invariant implemented and tested. Seven step reducers are typed stubs. |
| `@fc/rulepack` | All six IRDAI bright-line clauses encoded as data, validated, hashed. 20 of ~60 line categories. |
| `@fc/eval` | Scaffold. Corpus generator and fault injection to come. |
| `@fc/functions` | The redaction boundary type. Handlers to come. |
| `@fc/infra` | `CoreStack` — KMS, three buckets, single-table DynamoDB, SSM config. Remaining stacks to come. |
| `@fc/web` | Scaffold that proves the engine runs in the browser. |

---

## Running it

Requires Node 22+ and pnpm 9+.

```bash
pnpm install
pnpm verify          # typecheck · lint · dep:cruise · test
pnpm web:dev         # http://localhost:5173
```

Individual checks:

```bash
pnpm typecheck
pnpm lint
pnpm dep:cruise      # enforces engine purity — see below
pnpm test
```

After editing anything in `packages/rulepack/data/`:

```bash
pnpm --filter @fc/rulepack lock    # regenerate the rulepack hash
```

---

## Architecture

```
  upload ──▶ S3 raw/ ──▶ EventBridge ──▶ Step Functions
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
             Textract                  Comprehend               Bedrock
       TABLES · QUERIES · LAYOUT    DetectPiiEntities     Titan embeds · Claude
                    │                        │                        │
                    └──────────┬─────────────┘                        │
                               ▼                                      │
                    ◆ REDACTION GATE ─────── no raw text past here ───┘
                               │
                               ▼
                   @fc/engine — 7 deterministic steps
                   integer paise, no model, no I/O
                               │
                               ▼
              zero-sum reconciliation + certificate
                               │
                               ▼
                   CloudFront ──▶ the same @fc/engine,
                                  in your browser, for what-if
```

Why each service is there, in one line each:

| Service | Job |
|---|---|
| **S3** | Claim pack storage. Presigned uploads keep documents off our compute; ObjectCreated is the pipeline trigger. |
| **EventBridge** | S3 to Step Functions with no Lambda glue in between. |
| **Step Functions** | Sequences a multi-document pipeline with per-step visibility. Three document types with different failure modes — a single Lambda would hide where it broke. |
| **Textract** | `TABLES` on the deduction sheet, `QUERIES` on the policy schedule, `LAYOUT` on the wording. These are scanned tables; generic OCR loses the column structure, which is the only thing that matters. |
| **Comprehend** | PII detection in the redaction gate, alongside deterministic regex for Aadhaar, PAN and GSTIN — formats where a regex genuinely beats a model. |
| **Lambda** | Thin handlers over the engine. Scales to zero between demos. |
| **DynamoDB** | Case event log, and rules as data. A rule can be corrected without a redeploy. |
| **Bedrock** | Two jobs only: line normalisation, and prose. Money is never computed by a model. |
| **KMS** | Document encryption, and signing the reconstruction certificate. |
| **CloudFront** | The public URL. |

Design decisions and their reasoning are in [`docs/decisions/`](docs/decisions/).

### The structural rule

`packages/engine` must not import the AWS SDK or any Node built-in. It is the
deterministic core, and it runs **both** in Lambda (as the authority) and in the browser
(for instant what-if simulation with no network call).

This is enforced in three places so it cannot rot: ESLint `no-restricted-imports`, a
`dependency-cruiser` rule, and a required CI check. It is a build failure, not a
code-review convention.

---

## Repository layout

```
packages/
  contracts/   shared types + zod schemas — the seam between both engineers
  engine/      the pure waterfall: interpreter, 7 steps, the invariant
  rulepack/    rules as data: clauses, categories, step order, rounding policy
  eval/        corpus generation, fault injection, detection-rate harness
  functions/   thin Lambda handlers — all logic lives in engine/
  infra/       AWS CDK
  web/         the reconciliation UI
docs/
  decisions/   ADRs
  learning.md  what each of us touched for the first time
fixtures/
  corpus/      generated claim packs + ground truth
  golden/      byte-compared reconstruction snapshots
```

---

## The statutory basis

IRDAI circular `IRDAI/HLT/REG/CIR/151/06/2020` (11 June 2020) gives four bright-line
tests against which a real deduction sheet can be checked deterministically. Where a
policy proportionately deducts "associated medical expenses" because the patient took a
higher room category:

- pharmacy and consumables, implants and medical devices, and diagnostics **may not** be
  part of that definition;
- insurers **shall not** recover any expenses towards proportionate deductions other
  than the defined associate medical expenses;
- proportionate deduction **cannot** be applied to ICU charges, because ICUs have no room
  categories;
- proportionate deduction **cannot** be applied to hospitals that do not follow
  differential billing by room category.

All six clauses are encoded in
[`packages/rulepack/data/v1/clauses.json`](packages/rulepack/data/v1/clauses.json), with
their commencement dates — the circular binds products filed from 1 Oct 2020 and existing
products on renewal from 1 Apr 2021, and the engine checks that before applying it.

### What we are not claiming

Insurers are entitled to most of what they disallow. Being exempt from proportionate
deduction does **not** make a line payable — sub-limits, co-pay, the deductible, waiting
periods and the non-payable list all still apply independently, in their own order. That
is precisely why this reconstructs the whole settlement instead of auditing lines in
isolation, and why proportionate deduction is step **five of seven**.

### Sources

- IRDAI circular 151/06/2020 — https://irdai.gov.in/en/document-detail?documentId=394680
- Health Insurance Master Circular, 29 May 2024 — https://caalley.com/irda24/Master_Circular_on_Health_Insurance_Business_29052024.pdf
- IRDAI Annual Report 2024-25, Table I.29 (the ₹18,521 crore disallowed under policy
  terms in FY2024-25, 13.98% of everything claimed) —
  https://intranet.irdai.gov.in/en/web/guest/annual-reports

### Not legal advice

The output is document assembly with citations. It drafts a reconsideration request
quoting a clause against a line; it does not advise you on your rights.
