# Corpus provenance

## How these packs are produced

The packs in this directory are **generated**, by `packages/eval`. Each one is produced
from a single integer seed, recorded in its `truth.json`, so the whole corpus is
regenerable and reproducible in CI.

The generation pipeline is:

1. Sample a plausible `PolicySchedule` — sum insured, room rent cap, ICU cap, co-pay,
   deductible, sub-limits, a rider about 30% of the time, one of two insurer wordings.
2. Sample a plausible itemised bill — 40 to 120 lines across the canonical categories,
   a room category, ICU days with probability 0.35, implants with 0.2.
3. **Settle it correctly**, by running our own engine's waterfall over it. This produces
   a lawful deduction sheet, which means ground truth is exact by construction rather
   than annotated by hand.
4. Apply zero to three fault operators on top of that lawful settlement, so every
   unlawful rupee has a known clause ID and a known amount.
5. Render to HTML/CSS in one of six hospital and two insurer layouts, rasterise, and
   degrade — rotate ±1.2°, gaussian noise, JPEG quality 62, occasional 2px shear.
6. Assemble the degraded pages into PDFs.

## Status

Steps 1–4 above are implemented, in `packages/eval`, and run locally with no AWS
credentials:

| Step | Where | State |
|---|---|---|
| 1 sample policy | `src/generate/policy.ts` | done — sum insured, room/ICU caps, co-pay, deductible, rider ~30% of the time |
| 2 sample bill | `src/generate/bill.ts` | done — canonical categories; the room rate is what creates a proportionate ratio, and ICU is sampled inside its cap so a PD fault on it reaches step 5 rather than step 4 |
| 3 settle it lawfully | `src/generate/settle.ts` | done — steps 3–6 of the waterfall, as data, so ground truth is exact by construction. Two settlements are produced, with and without the differential-billing gate, so a fault that flips an admission fact can still be injected into a sheet that is lawful under the facts the engine will see |
| 4 inject faults | `src/faults/` | done — six unlawful operators with a known clause and amount, plus the zero-fault control set |
| 5 render and degrade | — | **not implemented.** Rendering to HTML/CSS, rasterising, rotating, noising and the PDFs still have to be built, and they are what make the extraction layer real rather than assumed |
| 6 assemble PDFs | — | **not implemented**, for the same reason |

Because steps 5–6 are outstanding, there is no `fixtures/corpus/` content in git yet
and the `.gitignore` rules for it are ahead of the code. Until they land, the
detection numbers in `packages/eval/baseline.json` measure the engine against
**perfectly extracted** rows: they prove the waterfall attributes known unlawful
rupees to the right clauses, and they say nothing yet about OCR confidence,
low-confidence routing or human correction.

## Why the degradation step exists

A clean digital PDF is a cheat. If Textract never struggles, the extraction layer goes
untested, `TEXTRACT_LOW_CONFIDENCE` and the human-correction path become defensive
branches nobody ever exercised, and any accuracy figure we report is measuring the wrong
thing. The degradation is what makes those code paths real.

## What this corpus can and cannot support

**It can support**, and this is the point of it:

- per-clause precision and recall, because every injected fault has a known clause ID
  and amount;
- a **false-positive rate on a control set** of entirely lawful deductions — legitimate
  sub-limit cuts, legitimate co-pay, legitimate Annexure II cuts with no rider. This is
  the harder and more important half. Anyone can build something that flags deductions;
  proving we do *not* flag a lawful cut is what distinguishes a reconstructor from a
  blanket classifier;
- calibration of the normalisation threshold τ against a held-out labelled split;
- paise-level attribution error, and the composition of the unresolved bucket by reason.

**It cannot support** a claim about real-world accuracy. It measures whether the engine
correctly applies the rules as we have encoded them, against documents whose layout
distribution we chose. Two distinct things it does not measure:

- whether our encoding of the IRDAI circular matches how a practitioner would read it;
- how the extraction layer behaves on the full messiness of real Indian hospital billing.

Any figure quoted from this corpus should be described as what it is: a detection rate
against a generated corpus with injected faults.

## Real packs

Real claim packs, if obtained, go in `fixtures/real/` — never here, and never in git.
The standing requirements:

- written permission from the policyholder, kept;
- patient name, policy number, UHID, hospital registration number, phone, address and
  Aadhaar redacted **before** the file enters the repository;
- amounts, dates, line descriptions and clause references left intact — they are the data;
- originals stored outside the repo.

`.gitignore` excludes `fixtures/originals/` and `**/unredacted/` for this reason.
