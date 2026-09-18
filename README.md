# Settlement reconstructor

**Your insurer sent you a deduction sheet. This tells you which parts of it are legal.**

Upload your claim pack — itemised hospital bill, deduction sheet, settlement letter, policy
schedule and wording. The system independently reconstructs what the settlement *should*
have been as an ordered seven-step waterfall, then reconciles its own figure against what
the insurer actually paid. Every rupee of difference lands in one of three buckets:
**correctly applied**, **incorrectly applied** (with the clause it contradicts), or
**unresolved** (with the reason we cannot decide).

> We do not tell you your insurer cheated you. We tell you, line by line, which part of
> your deduction we can defend, which part we can challenge, and which part we honestly
> cannot judge.

**Built for:** Bharat Builds Tour — First Commit, 17–20 Sept 2026 · **Track:** Ship It

---

## Why this exists

In FY2024-25, Indian health insurers disallowed **₹18,521 crore** under policy terms —
**13.98%** of everything claimed ([IRDAI Annual Report 2024-25, Table I.29](https://intranet.irdai.gov.in/en/web/guest/annual-reports)).

Some of that is entirely lawful. Insurers are entitled to most of what they disallow.
But a policyholder holding a deduction sheet has no way to tell the lawful part from the
unlawful part, because doing so requires reading a 40-page policy wording against an IRDAI
circular and then redoing the arithmetic in the right order. Almost nobody does this. The
deduction sheet is, in practice, unfalsifiable.

IRDAI circular `151/06/2020` is what makes this tractable. It draws four **bright lines** —
rules with no discretion in them, which means a machine can check them deterministically
and cite chapter and verse when they are crossed.

---

## What it actually produces

A worked example, end to end. Every figure below is a **passing assertion**, not
illustration: [`worked-example.test.ts`](packages/eval/src/worked-example.test.ts) runs this
claim through the real engine and checks each rupee, so a change to a step, a clause, or
the step order that would alter these numbers fails the build rather than quietly making
this page wrong.

**Policy:** sum insured ₹5,00,000 · room rent limit ₹6,000/day · ICU limit ₹15,000/day ·
deductible ₹10,000 · co-pay 10% · consumables rider in force
**Admission:** 7 days — 2 in ICU, 5 in a Deluxe room billed at ₹10,000/day

| Bill line | Amount |
|---|---|
| Room rent — Deluxe, 5 days @ ₹10,000 | ₹50,000 |
| ICU — 2 days @ ₹12,000 | ₹24,000 |
| Surgeon's fee | ₹35,000 |
| Anaesthetist's fee | ₹12,000 |
| Operation theatre charges | ₹13,000 |
| Pharmacy & consumables | ₹98,000 |
| Implants — drug-eluting stent | ₹1,20,000 |
| Diagnostics — labs, imaging | ₹56,000 |
| Medical records & administrative charges | ₹7,000 |
| **Bill total** | **₹4,15,000** |

The patient took a room at ₹10,000 against a ₹6,000 eligibility, so the insurer applied a
**40% proportionate deduction**. It applied it to the whole bill.

**The insurer paid ₹2,08,320. The reconstruction says ₹3,18,600.**

Reconciling the ₹2,06,680 that was deducted:

| Bucket | Amount | Why |
|---|---|---|
| ✅ **Correctly applied** | **₹84,480** | ₹7,000 administrative charges, non-payable under Annexure II with no rider covering them · ₹20,000 room rent above the per-day cap · ₹24,000 proportionate deduction on the surgeon, anaesthetist and OT fees, which genuinely *are* associated medical expenses · ₹10,000 deductible · ₹23,480 co-pay |
| ❌ **Incorrectly applied** | **₹1,19,200** | The 40% was also applied to pharmacy (₹39,200 · `AME.EXCL.PHARMA`), implants (₹48,000 · `AME.EXCL.IMPLANT`), diagnostics (₹22,400 · `AME.EXCL.DIAG`) and ICU charges (₹9,600 · `PD.ICU`). The circular says it may not be. |
| ⚠️ **Unresolved** | **₹3,000** | An "OTHER DEDUCTIONS" line on the sheet with no stated basis. We do not guess. The letter asks the insurer to explain it. |

`84,480 + 1,19,200 + 3,000 = 2,06,680.` It balances exactly, and it is not allowed not to —
see [the invariant](#1-the-arithmetic-cannot-be-fudged) below.

**The shortfall is ₹1,10,280, and it splits into two different kinds of ask.**

**₹1,07,280 we argue with a citation** — not the gross ₹1,19,200. This difference is the
reason the system reconstructs an entire settlement instead of auditing lines in
isolation: once the unlawful ₹1,19,200 is added back to the payable base, the policy's 10%
co-pay lawfully applies to it too, which is ₹11,920 of it. Demanding the gross figure
would be wrong, and an insurer would be right to refuse it.

**₹3,000 we can only query.** No clause was cited for it and our reconstruction does not
cut it, so the letter asks the insurer to explain that line rather than asserting a rule
about it. Merging it into the headline number would be the easy thing to do and would make
the whole document less defensible.

The output is a certificate and a drafted reconsideration request that quotes each clause
verbatim against the specific line it contradicts.

---

## Run it

Requires **Node 22+** and **pnpm 9+**. No AWS account needed for the engine or the UI —
the deterministic core runs entirely in your browser.

```bash
pnpm install
pnpm verify          # typecheck · lint · dep:cruise · test
pnpm web:dev         # http://localhost:5173
```

Individual checks:

```bash
pnpm typecheck
pnpm lint
pnpm dep:cruise      # enforces engine purity — see claim 3 below
pnpm test
```

After editing anything under `packages/rulepack/data/`:

```bash
pnpm --filter @fc/rulepack lock    # regenerate the rulepack hash
```

---

## Three claims you can verify yourself

Most projects ask you to trust the demo. These three are checkable in under a minute each.

### 1. The arithmetic cannot be fudged

The engine **refuses to emit** a result whose findings do not sum to the observed
difference between the bill total and the amount paid. Any remainder it cannot attribute
to a clause is materialised as an explicit `UNRESOLVED` finding with reason
`RESIDUAL_UNATTRIBUTED`. Every paise is either attributed to a clause ID or explicitly
marked unattributed — **there is no third state**, and no silent rounding drift.

Money is a branded integer `Paise` type, never a float. A raw `number` cannot be passed
where an amount is expected.

```bash
pnpm test --filter @fc/engine     # fast-check asserts the invariant over 500 generated ledgers
```

→ [`packages/engine/src/reconcile/invariant.ts`](packages/engine/src/reconcile/invariant.ts) · [ADR 001](docs/decisions/001-money-as-integer-paise.md)

### 2. The waterfall order is data, not code

Order matters more than any individual rule, because each step consumes the output of the
last. [`steps.json`](packages/rulepack/data/v1/steps.json) is an ordered list of step IDs,
each resolving to a registered pure reducer:

| # | Step | What it does |
|---|---|---|
| 1 | `ADMISSIBILITY` | Policy in force, waiting periods. Halts the waterfall on failure. |
| 2 | `NORMALISATION_GATE` | Free-text bill lines → canonical categories, or `UNRESOLVED`. |
| 3 | `NON_PAYABLE` | Annexure II list, checking riders and endorsements first. |
| 4 | `CAPS_SUBLIMITS` | Room rent and ICU per-day limits. |
| 5 | `PROPORTIONATE` | The circular's bright lines. **Step five of seven, not the thesis.** |
| 6 | `COPAY_DEDUCTIBLE` | Deductible then co-pay — the order is a parameter. |
| 7 | `SUM_INSURED` | Aggregate liability ceiling. |

Whether co-pay applies before or after the deductible is a **rulepack version, not a
branch**. Modelling a second insurer's wording is a config change. Rules live in DynamoDB,
so a wrong rule can be corrected without a redeploy — and an older certificate still
verifies against its own pinned rulepack hash.

→ [`packages/rulepack/data/v1/`](packages/rulepack/data/v1/) · [ADR 002](docs/decisions/002-waterfall-order-as-data.md)

### 3. The model cannot compute money

Claude on Amazon Bedrock does exactly two jobs: it maps free-text bill descriptions to
canonical categories, and it writes English. **It never computes an amount, and it never
receives unredacted text.**

Normalisation is a three-tier cascade in which the model is the last resort, and **its
self-reported confidence is never used** — routing is gated on the cosine margin between
the top two candidates and on three-sample agreement:

| Tier | Method | Accepted when |
|---|---|---|
| 1 | DynamoDB lexicon, exact then trigram | exact hit, or similarity ≥ 0.92 with a single candidate |
| 2 | Titan Text Embeddings V2, cosine kNN over ~60 category centroids | `cos(top1) − cos(top2) ≥ τ` |
| 3 | Claude on Bedrock, tool-use with a JSON schema, choices restricted to the top-5 embedding candidates, `n = 3` | all three samples agree |

Below τ, or on a split vote, the line becomes `UNRESOLVED` and its rupees go to the
unresolved bucket. That is the honest answer, and the invariant forces us to give it.

`packages/engine` **must not import the AWS SDK or any Node built-in.** That is enforced in
three independent places so it cannot rot — ESLint `no-restricted-imports`, a
`dependency-cruiser` rule, and a required CI check. It is a build failure, not a
code-review convention.

```bash
pnpm dep:cruise      # 0 errors across 55 modules and 145 dependencies
```

Verified the hard way rather than assumed: a probe file importing `@aws-sdk/client-s3` and
`node:fs` into the engine was rejected by both rules. `dependency-cruiser` also caught a
type-only cycle between the step registry and the steps on its first run — TypeScript was
perfectly happy with it.

→ [ADR 003](docs/decisions/003-model-never-computes-money.md) · [ADR 005](docs/decisions/005-confidence-from-margin-not-self-report.md) · [ADR 007](docs/decisions/007-engine-purity-enforced-mechanically.md)

---

## Architecture

```
  upload ──▶ S3 raw/ ──▶ EventBridge ──▶ Step Functions
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
             Textract                  Comprehend                 Bedrock
       TABLES · QUERIES · LAYOUT    DetectPiiEntities      Titan embeds · Claude
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
              zero-sum reconciliation + signed certificate
                               │
                               ▼
                   CloudFront ──▶ the same @fc/engine,
                                  in your browser, for what-if
```

The engine is compiled once and runs in **two** places: in Lambda as the authority, and in
the browser for instant what-if simulation with no network round-trip. Change the room-rent
limit in the UI and the whole waterfall re-runs locally. That is only possible because of
the purity rule in claim 3.

Why each service is there, one line each:

| Service | Job |
|---|---|
| **S3** | Claim pack storage. Presigned uploads keep documents off our compute; `ObjectCreated` is the pipeline trigger. |
| **EventBridge** | S3 to Step Functions with no Lambda glue in between. |
| **Step Functions** | Sequences a multi-document pipeline with per-step visibility. Three document types with different failure modes — a single Lambda would hide where it broke. |
| **Textract** | `TABLES` on the deduction sheet, `QUERIES` on the policy schedule, `LAYOUT` on the wording. These are scanned tables; generic OCR loses the column structure, which is the only thing that matters. |
| **Comprehend** | PII detection in the redaction gate, alongside deterministic regex for Aadhaar, PAN and GSTIN — formats where a regex genuinely beats a model. |
| **Bedrock** | Two jobs only: line normalisation, and prose. Money is never computed by a model. |
| **Lambda** | Thin handlers over the engine. Scales to zero between demos. |
| **DynamoDB** | Case event log, and rules as data. A rule can be corrected without a redeploy. |
| **KMS** | Document encryption, and signing the reconstruction certificate. |
| **CloudFront** | The public URL, and the engine bundle. |

The **redaction gate** is the structural reason this is deployable at all: because no raw
document text crosses it, the model-facing half of the pipeline can run in a region where
the model is available, while documents stay encrypted in-region.
→ [ADR 004](docs/decisions/004-redaction-gate-enables-cross-region-bedrock.md)

---

## Where to start reading

If you have ten minutes and want to judge whether this is real, read these four files in
this order:

1. **[`packages/contracts/src/finding.ts`](packages/contracts/src/finding.ts)** — the
   central data structure. A `Finding` may omit its clause ID **only** when its bucket is
   `UNRESOLVED`; the engine asserts `findingIsWellFormed` at construction and throws
   otherwise. So a verdict of "correctly applied" or "incorrectly applied" cannot exist
   without a citation. That is what makes "we never assert without a clause" structural
   rather than aspirational — and note the seven `UnresolvedReason` values, each of which
   also names the document that would settle it.
2. **[`packages/engine/src/reconcile/invariant.ts`](packages/engine/src/reconcile/invariant.ts)** —
   the load-bearing claim, about 60 lines.
3. **[`packages/rulepack/data/v1/clauses.json`](packages/rulepack/data/v1/clauses.json)** —
   every rule the system can cite, as data, with commencement dates and source URLs.
4. **[`docs/decisions/`](docs/decisions/)** — seven ADRs. Each states the decision, the
   alternative rejected, and the cost of being wrong.

Full layout:

```
packages/
  contracts/   shared types + zod schemas — the frozen seam every package builds against
  engine/      the pure waterfall: interpreter, 7 steps, the invariant
  rulepack/    rules as data: clauses, categories, step order, rounding policy
  eval/        corpus generation, fault injection, detection-rate harness
  functions/   thin Lambda handlers — all logic lives in engine/
  infra/       AWS CDK
  web/         the reconciliation UI
docs/
  decisions/   ADRs
  learning.md  what we touched for the first time
fixtures/
  corpus/      generated claim packs + ground truth
  golden/      byte-compared reconstruction snapshots
```

---

## The statutory basis

IRDAI circular `IRDAI/HLT/REG/CIR/151/06/2020` (11 June 2020) gives four bright-line tests
against which a real deduction sheet can be checked deterministically. Where a policy
proportionately deducts "associated medical expenses" because the patient took a higher
room category:

- pharmacy and consumables, implants and medical devices, and diagnostics **may not** be
  part of that definition;
- insurers **shall not** recover any expenses towards proportionate deductions other than
  the defined associated medical expenses;
- proportionate deduction **cannot** be applied to ICU charges, because ICUs have no room
  categories;
- proportionate deduction **cannot** be applied to hospitals that do not follow
  differential billing by room category.

All six clauses are encoded in
[`clauses.json`](packages/rulepack/data/v1/clauses.json) with their **commencement dates** —
the circular binds products filed from 1 Oct 2020, and existing products on renewal from
1 Apr 2021. The engine checks that before applying it, so the circular is never applied to
a policy that predates it.

### What we are not claiming

Being exempt from proportionate deduction does **not** make a line payable. Sub-limits,
co-pay, the deductible, waiting periods and the non-payable list all still apply
independently, in their own order. Insurers are entitled to most of what they disallow.
That is precisely why proportionate deduction is **step five of seven** and not the whole
product.

### Not legal advice

The output is document assembly with citations. It drafts a reconsideration request quoting
a clause against a line; it does not advise you on your rights.

---

## Status

| Package | State |
|---|---|
| `@fc/contracts` | **Complete.** The frozen seam. Changes need a version bump. |
| `@fc/engine` | **All seven step reducers implemented**, plus the interpreter, `Paise` arithmetic and the reconciliation invariant. |
| `@fc/rulepack` | All six IRDAI bright-line clauses encoded as data, validated, hashed. 20 of ~60 line categories. |
| `@fc/infra` | `CoreStack` — KMS, four buckets, single-table DynamoDB, SSM config. Clean `cdk-nag` report. Remaining stacks to come. |
| `@fc/eval` | The end-to-end golden test above. Corpus generator and fault injection to come. |
| `@fc/functions` | The redaction boundary type. Handlers to come. |
| `@fc/web` | Scaffold that proves the engine runs in the browser. |

`pnpm verify` is green: 7 packages typecheck, lint clean, 0 dependency errors, 29 tests
passing. `pnpm cdk:synth` is green with no `cdk-nag` findings.

---

## Sources

- IRDAI circular 151/06/2020 — https://irdai.gov.in/en/document-detail?documentId=394680
- Health Insurance Master Circular, 29 May 2024 — https://caalley.com/irda24/Master_Circular_on_Health_Insurance_Business_29052024.pdf
- IRDAI Annual Report 2024-25, Table I.29 — https://intranet.irdai.gov.in/en/web/guest/annual-reports
