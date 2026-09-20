  - Deterministic engine: ~90%
  - Rulepack/domain coverage: ~70%
  - Evaluation: ~65%
  - Desktop UI: ~35%
  - Mobile UI: ~5%
  - AWS end-to-end product path: ~10%
  - Security/observability/deployment completion: ~15%

  ## What is already done

  - Monorepo, contracts, TypeScript setup, CI workflow, ADRs, project narrative.
  - Branded integer-paise money model.
  - Seven-step deterministic settlement engine, with the rulepack's rounding mode threaded
    through every place a fraction touches money.
  - Insurer deduction matching and three-bucket reconciliation.
  - Residual invariant: unexplained money becomes an explicit unresolved finding.
  - Rulepack loader, hashing, version pins, clauses, step ordering; 73 categories covering
    the payable classes plus the IRDAI non-payable and subsumed lists, with the
    category ↔ clause contract asserted at load time.
  - Tier 1 of the normalisation cascade (`@fc/normalise`): lexicon from the rulepack
    aliases, exact and trigram-fuzzy, pure, with an escalation hook for tiers 2–3.
  - Direct tests for every reducer, and the ten §21.2 property tests.
  - Worked example and local synthetic evaluation harness: four admission archetypes with
    correlated bills, six fault operators with a computed over-recovery bound, derived
    lawful controls, exact fault↔dispute assignment, a data-level degradation profile
    routed through the real normaliser, miss attribution (gated / unmatched / engine), the
    tier-1 threshold calibration sweep, two-profile regression gate, `docs/evaluation.md`.
  - Static React case-review UI using the real engine in-browser.
  - Basic CDK foundation: raw/redacted/artifact storage, KMS, DynamoDB, SSM configuration, CloudFront static hosting.
  - Local verification: typecheck, lint, dependency-cruiser, tests, both eval gates, web build,
    CDK synth with cdk-nag — all green on Node 24 / pnpm 11.

  ## What is partly done

  - Evaluation: generation, lawful controls, faults, degradation and scoring exist; PDF
    rendering and a Textract pass do not. The degraded profile reproduces the row-level
    consequences of OCR error; layout failures need the render path.
  - Calibration: the tier-1 fuzzy threshold is swept and the knee recorded (0.52 vs the §14
    default 0.92); the tier-2 embedding-margin τ waits on Titan.
  - AWS infrastructure has the foundation, but not the actual application pipeline.
  - UI visually represents the planned product, but only the reference claim works today.

  ## What remains, in the exact implementation path

  ### 1. Core follow-ups

  - Decide whether to adopt the calibrated tier-1 threshold (rulepack decision; the curve is
    in docs/evaluation.md).
  - The sheet matcher is exact on description + amount; under independent OCR noise on two
    documents 27% of lines lose their row. A tolerant matcher that falls back to UNRESOLVED
    rather than to a wrong pairing is the next engine-side gain.
  - Sub-limit semantics in step 4 are per line; disease-wise limits are per claim.

  ### 2. Build the real AWS vertical slice

  This is the biggest missing block.

  - POST /cases with presigned uploads.
  - Case state in DynamoDB.
  - S3 upload trigger through EventBridge.
  - Standard Step Functions workflow.
  - Lambda handlers for document classification, extraction, parsing, redaction, normalisation, reconstruction, letter/certificate generation.
  - GET /cases/{id}, events stream, correction submission, simulation, verification, certificate, and letter endpoints.

  ### 3. Implement document intelligence

  - Textract strategy per document type.
  - Parse tables, policy schedule queries, wording layout, and capture bounding boxes.
  - Low-confidence detection and human-correction callback flow.
  - Comprehend + deterministic PII redaction.
  - DynamoDB lexicon seeded from `@fc/normalise`'s `buildLexicon`, with tier-3 write-back.
  - Titan embedding similarity/margin gate (tier 2), plugged into the `Escalation` hook.
  - Claude tie-breaker with three-sample agreement (tier 3).
  - Bedrock prose generation for explanations and reconsideration letters.

  ### 4. Complete the security architecture

  - Per-function IAM roles and narrow bucket-prefix access.
  - Raw/redacted separation in actual runtime code.
  - Bedrock functions unable to read raw documents.
  - KMS asymmetric signing key for certificates.
  - TTL/lifecycle enforcement through the case model.
  - Narrow raw-upload CORS from '*' to the deployed frontend origin.
  - CloudTrail, DLQs, and failure handling.

  ### 5. Complete the product UI

  Implement the components named in IMPLEMENTATION.md:

  - Upload and case creation.
  - Pipeline progress screen.
  - Human correction grid.
  - Waterfall bridge chart.
  - Three equal-weight bucket views.
  - Provenance crop viewer.
  - What-if controls.
  - Browser-versus-Lambda verification.
  - Certificate verification.
  - Letter download/share flow.
  - Rulepack/clauses screen.

  ### 6. Complete evaluation and operations
  - Render generated hospital documents into varied PDFs (6 hospital + 2 insurer layouts).
  - Degrade the rendered pages and pass them through Textract; replace the data-level
    noise model's assumed rates with measured ones.
  - Tier-2 τ calibration once Titan is wired in (same held-out split, same sweep).
  - Add docs/cost.md from measured demo-corpus figures.
  - Build CloudWatch dashboard, business metrics, alarms, tracing, and cost-per-case reporting.
  - Add the deployment workflow and deploy the final public URL.

  ## Mobile: yes, make it responsive—but not as a separate app

  A responsive web app is the right direction. Use one React app, with:

  - Desktop as the deep investigation workspace.
  - Mobile as the policyholder action flow.

  The current UI is desktop-first. On a phone it will not be good enough because:

  - The sidebar always consumes 220px.
  - The app locks itself to a desktop-style h-dvh workspace.
  - The bill table has five columns.
  - Header metrics and action button compete for narrow space.
  - The two-column review layout stacks only at lg, but the fixed sidebar remains.

  For mobile, do not try to shrink the current table-and-inspector screen. Use a different responsive composition:

  1. Upload documents / choose demo case
  2. Processing timeline
  3. Result summary: paid, expected, recoverable, unresolved
  4. Findings as cards, grouped by Disputed / Lawful / Unexplained
  5. Tap a finding for clause, arithmetic, and document crop
  6. Draft/download reconsideration letter
  7. Certificate verification

  Keep the desktop UI for detailed tables, correction grids, provenance inspection, and reviewer workflows. A mobile-first summary plus desktop analysis
  workspace will make the project much stronger for both real users and the Best UI track.
