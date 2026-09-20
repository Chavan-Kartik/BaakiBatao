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
credentials. Steps 5–6 have a data-level stand-in; the render path itself does not exist.

| Step | Where | State |
|---|---|---|
| 1 sample policy | `src/generate/policy.ts` | done — sum insured, room/ICU caps, co-pay, deductible, an ambulance sub-limit ~40% of the time, a rider ~30% of the time |
| 2 sample bill | `src/generate/bill.ts` | done — four admission archetypes (medical, day-care surgery, major surgery, critical care) with correlated line structure: no implant without a surgeon and a theatre, no ventilator outside intensive care, per-day pharmacy and visits scaling with the stay. Descriptions are mostly lexicon aliases, sometimes an alias with a day or count appended, sometimes free text no lexicon will match. ICU and ambulance are billed above their caps some of the time on purpose, as lawful controls |
| 3 settle it lawfully | `src/generate/settle.ts` | done — steps 3–6 of the waterfall, using the engine's own `survivingShare`/`applyRatio` with the rulepack's rounding mode, so the lawful proportionate figure per line is the engine's figure, not an approximation of it. Two settlements are produced, with and without the differential-billing gate |
| 4 inject faults | `src/faults/` | done — six unlawful operators with a known clause and amount. Over-recovery injects beyond a *computed* bound and refuses to run if the lawful sheet disagrees with it; operators skip lines that already carry a cut of another kind; controls are derived from what each zero-fault pack actually contains |
| 5 render and degrade | `src/generate/degrade.ts` | **data-level stand-in.** The `degraded` profile misreads descriptions and digits with OCR-typical confusions, drops sheet rows, and assigns categories through the real tier-1 normaliser (`@fc/normalise`) — so the normalisation gate, the sheet matcher and low-confidence routing are inside the measured loop. What it cannot produce is a layout failure (a merged cell, a page break through a table); only rendering can |
| 6 assemble PDFs | — | **not implemented.** HTML/CSS layouts, rasterising, rotation and noise, and the PDFs are what turn the stand-in into a measurement of Textract |

Because step 6 is outstanding, there is no `fixtures/corpus/` content in git yet and the
`.gitignore` rules for it are ahead of the code. The numbers in `packages/eval/baseline.json`
measure the engine against **perfectly extracted** rows; the numbers in
`packages/eval/baseline.degraded.json` measure the engine, the tier-1 normaliser and the sheet
matcher together against rows degraded by our own noise model. Both, with the calibration
curve for the normaliser's threshold, are written out to `docs/evaluation.md`.

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
- calibration of the tier-1 fuzzy threshold against a held-out labelled split (done — the
  embedding-margin τ of tier 2 waits on Titan);
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
