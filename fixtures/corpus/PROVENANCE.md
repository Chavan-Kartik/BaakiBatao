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
