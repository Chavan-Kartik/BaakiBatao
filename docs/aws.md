# AWS — services, and how to connect

This is the operator's page: which AWS services the system uses, what each one is for,
which of them exist in the account today, and the exact steps to get from a fresh laptop
to `cdk deploy --all`. The architecture rationale lives in `IMPLEMENTATION.md` §3.2 and §10;
this page does not repeat it. §0 is the deploy runbook.

The same product also runs without AWS, as two containers — that path is §9. The API's own
endpoints, environment variables and deliberate stubs are §10, sign-in (including Amazon
Cognito) is §11, and what CI enforces is §12.

Nothing on this page is needed to run the product locally. The engine is pure, the web UI
settles the reference claim in the browser, and the evaluation harness generates its own
corpus — `pnpm verify`, `pnpm eval:assert` and `pnpm web:dev` all work with no credentials.
AWS is needed for the document pipeline (Textract, Comprehend, Bedrock), the public URL,
and the hosted API.

---

## 0. Deploy, start to finish

The whole path from a fresh account to a working public URL. Every step is explained in
§3–§4; this is the order to run them in. Budget about 25 minutes, most of it CloudFront.

```bash
# 1. Toolchain (once). Node ≥ 22, pnpm 11, AWS CLI v2.
corepack enable && corepack prepare pnpm@11 --activate
pnpm install --frozen-lockfile

# 2. Credentials (every shell). A named profile; SSO preferred, access key for a sandbox.
aws configure sso --profile fc          # or: aws configure --profile fc
export AWS_PROFILE=fc                   # PowerShell: $env:AWS_PROFILE = 'fc'
aws sts get-caller-identity             # confirm the account you are about to deploy into

# 3. Bootstrap (once per account + region).
pnpm cdk -- bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-south-1

# 4. Build the UI and check the stacks synthesise clean. No credentials needed for synth.
pnpm web:build
pnpm cdk:synth

# 5. Deploy everything. Order is Core → Pipeline → Api → Web → Eval → Observability.
pnpm deploy                             # = cdk deploy --all; approve the IAM prompts, or add --require-approval never
#    FcWebStack.Url is the public URL. FcObservabilityStack.DashboardUrl is the dashboard.

# 6. Smoke test.
curl -s https://<FcWebStack.Url>/api/health   # ok:true, runner:"step-functions", signIn.cognito:true
#    Then in the browser: sign up, "load demo pack", submit, watch the pipeline, verify.
```

Three things to know before pressing enter:

- **`pnpm deploy` is the whole system** — no manual steps between stacks. The API learns
  its public origin from the web stack through SSM, so for the few minutes between
  `FcApiStack` and `FcWebStack` finishing, sign-in answers `Invalid origin`. Wait it out.
- **Prose is off by default.** The pipeline completes without Bedrock (`ProseWritten`
  says `skipped`). To turn it on: enable model access in the Bedrock console, confirm with
  the command in §3, then `pnpm cdk -- deploy --all -c fc:proseModelId=<model or profile id>`.
- **Cognito is on by default** and needs nothing from you: the pool, Hosted UI domain and
  app client are all created by the stacks. Email/password sign-in works regardless.

Afterwards:

```bash
pnpm cdk -- diff --all                  # before any redeploy: what will change
pnpm deploy                             # redeploy; handlers rebundle from source at synth
pnpm cdk -- destroy --all               # clean teardown (buckets auto-empty, nothing retained)
```

---

## 1. What exists today

All six CDK stacks are implemented, and the app synthesizes clean under `cdk-nag`'s
`AwsSolutionsChecks` — no unresolved errors, every suppression reviewed and carrying its
reason in the stack source. Measured on the current tree:

| Stack | Contents | cdk-nag |
|---|---|---|
| `FcCoreStack` | KMS document key, four S3 buckets, DynamoDB single table, two SSM parameters | 23 compliant · 1 suppressed |
| `FcPipelineStack` | Step Functions Standard state machine, 14 pipeline Lambdas, Textract SNS topic, KMS signing key, DLQ | 39 compliant · 96 suppressed |
| `FcApiStack` | HTTP API, streaming Function URL, 2 API Lambdas, better-auth secret, Cognito user pool + Hosted UI domain | 6 compliant · 18 suppressed |
| `FcWebStack` | Private origin bucket, CloudFront with OAC and the `/api/*` behaviours, `BucketDeployment`, Cognito app client, `/fc/web/*` parameters | 14 compliant · 13 suppressed |
| `FcEvalStack` | Distributed Map sweep, Express child workflow, 3 Lambdas | 10 compliant · 25 suppressed |
| `FcObservabilityStack` | CloudWatch dashboard, four alarms | — |

The suppressed count on the pipeline stack is fourteen function roles each raising the same
three reviewed findings (the CDK-attached logging policy, X-Ray's wildcard, and per-bucket
object grants); `pipeline-stack.ts` names each one.

The Lambda handlers live in `packages/functions` — one per state of the `IMPLEMENTATION.md`
§11 state machine, the two API entry points, and the three evaluation handlers. They are
bundled from workspace source by `NodejsFunction` at synth time, so there is no build step
between editing a handler and deploying it.

### What runs locally, and what each piece is on AWS

`packages/api` is the product slice without AWS. It is written behind interfaces, and the
AWS deployment runs **the same Hono app** with different implementations plugged in —
`createApp` in `packages/api/src/server.ts` is shared, `packages/functions/src/api/app.ts`
is the AWS wiring. No route knows which it got.

| Locally | Interface | On AWS |
|---|---|---|
| `FsCaseStore` — one JSON file per case | `CaseStore` | `DynamoCaseStore` — one item per case, optimistic concurrency, 24 h TTL |
| `FsDocumentStorage` — files under `data/cases/<id>/raw/` | `DocumentStorage` | `S3DocumentStorage` over the raw bucket (SSE-KMS, 1-day expiry) |
| `PUT /api/cases/{id}/documents/{kind}` targets | `PipelineRunner.uploadTargets` | Presigned S3 POSTs (5 min, 25 MB, content-type pinned); the client already handles both |
| `runPipeline` — stages in one process | `PipelineRunner.start` / `resume` | `StartExecution` on the state machine; `SendTaskSuccess` to resume a parked correction |
| `structuredExtractor` — reads the JSON pack | the `ExtractDocuments` Map | Textract per scanned document, the structured reader per JSON one, mixed packs allowed |
| `redactPack` — format regexes only | the redaction gate | Comprehend `DetectPiiEntities` **and** the regexes; fails closed |
| `GET /api/cases/{id}/events` — SSE polling the store | the same route | The same route, on a Lambda Function URL with response streaming |
| `issueCertificate` — `signature: null` | the same function | The same function, then KMS `ECDSA_SHA_256`; `verify` reports `signatureValid` from KMS `Verify` |
| better-auth on `node:sqlite` | `AuthOverrides.database` | better-auth on the DynamoDB adapter in `packages/functions/src/store/auth-adapter.ts`; Cognito as a social provider (§11) |

---

## 2. The services, one by one

### Deployed by `FcCoreStack`

| Service | Resource | Purpose | Notes |
|---|---|---|---|
| **KMS** | key `alias/fc/documents`, rotation on | Encrypts uploaded claim packs at rest | Symmetric. The certificate-signing key is in the pipeline stack |
| **S3** | `RawBucket` | Presigned uploads land here; Textract output and the pre-redaction pack too | SSE-KMS with the key above. **Expires objects after 1 day** — the mechanism behind "nothing stores real personal data beyond the demo session". CORS allows `https://*.cloudfront.net` (an S3 CORS origin takes one wildcard, and the distribution's domain is minted two stacks later) |
| **S3** | `RedactedBucket` | The audit copy of what crossed the redaction gate | SSE-S3, 7-day expiry. No Bedrock-calling Lambda has any grant on the raw bucket (ADR 004) |
| **S3** | `ArtifactsBucket` | Signed certificates, generated letters and prose, evaluation runs | Versioned |
| **S3** | `AccessLogsBucket` | Server access logs for the three above | SSE-S3 on purpose: a CMK on a log-delivery target is the usual reason logging silently stops. 30-day expiry |
| **DynamoDB** | `MainTable` (`pk`/`sk`, `gsi1`) | Single table: case records, better-auth users and sessions, the lexicon, Textract task tokens | On-demand, PITR on, TTL attribute `ttl` (24 h on cases, 6 h on task tokens, expiry + 1 day on sessions). GSI1 is `OWNER#<id>` → cases newest first |
| **SSM Parameter Store** | `/fc/rulepack/active` = `v1` | Pointer to the live rulepack version | Not yet consumed: the handlers bundle rulepack v1. Reading this is the next step |
| **SSM Parameter Store** | `/fc/normalisation/tau` = `0.08` | Tier-2 embedding-margin threshold | Placeholder until tier 2 is wired |

### Deployed by `FcPipelineStack`

| Service | Resource | Purpose | Notes |
|---|---|---|---|
| **Step Functions (Standard)** | `fc-case-pipeline` | The per-pack pipeline, state for state from `IMPLEMENTATION.md` §11 | `Entry` → `ValidatePack` → `ClassifyDocuments` → `ExtractDocuments` (inline `Map`, `MaxConcurrency: 4`) → `AssembleExtraction` → `RedactionGate` → `ChecksumRows` → `NeedsCorrection?` → `AwaitHumanCorrection` → `Normalise` → `Reconstruct` → `InvariantHeld?` → `WriteProse` → `IssueCertificate`. Every task retries transient Lambda errors (2 s, ×2, 3 attempts) and catches everything else into `FailWithReason`, which writes the taxonomy code and ends in a `Fail` carrying it. Logging `ALL`, X-Ray on, 25 h timeout |
| **Lambda** × 14 | one per state, plus `TextractComplete` | Thin handlers over `@fc/engine` and `@fc/api`; `arm64`, 1024 MB, Node 24, ESM bundles | Each holds only the grants its stage needs. Stages after the gate — `Normalise`, `Reconstruct`, `WriteProse`, `IssueCertificate` — have no grant on the raw bucket or the document key |
| **Textract** | `StartDocumentAnalysis` | `TABLES`+`LAYOUT`+`QUERIES` on the bill and deduction sheet, `QUERIES`+`LAYOUT` on the schedule and letter, `LAYOUT` on the wording | Asynchronous. The task token is parked in DynamoDB keyed by `JobId` (`TOKEN#<jobId>`, 6 h TTL); the state times out at 30 min |
| **SNS** | `TextractCompleteTopic` | Textract's `NotificationChannel` → `TextractComplete` Lambda, which pages `GetDocumentAnalysis`, writes the blocks to `raw/textract/…` and calls `SendTaskSuccess` | SSL enforced; not CMK-encrypted (the message is a job id and a status word) |
| **SQS** | `TextractCompleteDlq` | Dead-letter queue for the SNS-invoked Lambda | Alarmed on depth > 0 |
| **Comprehend** | `DetectPiiEntities` in `RedactionGate` | Alongside the format regexes for Aadhaar / PAN / GSTIN / phone / email | Both, not either. `DATE_TIME` entities are kept — service dates are data. A Comprehend error is `REDACTION_FAILED_OPEN`, and nothing downstream runs |
| **Bedrock** | `WriteProse` only, via the `RedactedText`-typed wrapper | Per-finding explanation and the letter's connective prose | **Off unless `fc:proseModelId` is set** — then, and only then, does the function get `bedrock:InvokeModel` on that model. Money never passes through it (ADR 003); a reply containing a digit is refused |
| **KMS (asymmetric)** | `alias/fc/certificates`, `ECC_NIST_P256` | `ECDSA_SHA_256` over the certificate's result hash | Verifiable offline from the public key; the API verifies with `kms:Verify` |

### Deployed by `FcApiStack`

| Service | Resource | Purpose | Notes |
|---|---|---|---|
| **Lambda** | `Api` | Every route of `packages/api`, buffered | 29 s timeout to match the gateway. Presigns uploads into `raw/`, records what landed, starts and resumes executions, verifies signatures |
| **Lambda** + **Function URL** | `Events` | `GET /api/cases/{id}/events` as server-sent events, `RESPONSE_STREAM` | Response streaming exists only on Function URLs. The route ends a stream after 9 min and sends a keep-alive comment every 15 s; the browser's `EventSource` reconnects with `Last-Event-ID` |
| **API Gateway (HTTP API)** | `fc-api` | Fronts the `Api` Lambda | Access logs to CloudWatch. No gateway authorizer: the application session is the authorization (reviewed suppression `APIG4`) |
| **Secrets Manager** | `AuthSecret` | `BETTER_AUTH_SECRET`, generated by CloudFormation, read at cold start | Never in an environment variable |
| **Cognito** | user pool `fc-users`, Hosted UI domain `fc-<suffix>` | The optional second sign-in (§11) | Email sign-in, self sign-up, no MFA, Essentials plan. The app client lives in the web stack |

### Deployed by `FcWebStack`

| Service | Resource | Purpose | Notes |
|---|---|---|---|
| **S3** | `OriginBucket` | The built web bundle | Private; reachable only through CloudFront via Origin Access Control |
| **S3** | `CloudFrontLogsBucket` | CloudFront standard logs | The one bucket in the system with ACLs enabled, because CloudFront log delivery writes with an ACL |
| **CloudFront** | `Distribution` | The public URL — the bundle **and** the API under one origin | Default behaviour → the bucket; `api/cases/*/events` → the Function URL (60 s origin read timeout); `api/*` → the HTTP API. API behaviours forward everything except `Host`, cache nothing. A viewer-request CloudFront Function rewrites extension-less paths to `/index.html`, so client-side routing works without custom error responses — which would have turned the API's own 404s into web pages |
| **Cognito** | app client `fc-web` | Registered against the distribution's origin, callback `/api/auth/callback/cognito` | Public client, PKCE, no secret |
| **SSM Parameter Store** | `/fc/web/origin`, `/fc/web/cognito-client-id` | How the API learns the public origin, which only exists once this stack has deployed | Read by the API Lambdas at cold start, cached 5 min (30 s while missing) |
| **CloudFormation output** | `Url` | Where to point the browser | `cdk deploy FcWebStack` prints it |

### Deployed by `FcEvalStack`

| Service | Resource | Purpose | Notes |
|---|---|---|---|
| **Step Functions** | `fc-eval-sweep` | `Plan` → **Distributed Map** over `eval-runs/<runId>/manifest.json`, Express child per pack, `MaxConcurrency: 40` → `Summarise` | Start it with `{ "count": 200, "profile": "degraded" }` (both optional). The same seeds and the same scoring as `pnpm eval:run`; `report.txt` lands next to the results in the artifacts bucket |

### Deployed by `FcObservabilityStack`

| Service | Resource | Purpose | Notes |
|---|---|---|---|
| **CloudWatch** | dashboard `fc-settlement-reconstructor` | Domain metrics first: `UnresolvedRatePct`, `ReconciliationResidualPaise`, `EngineDurationMs`, `NormalisationTierDistribution`, `FindingsByClause` — EMF from the `Reconstruct` and `Normalise` handlers under the `FC` namespace. Then executions, API errors and latency, DLQ depth | §22.2 |
| **CloudWatch** | alarms | `ExecutionsFailed > 0`, `ReconciliationResidualPaise > 0`, `UnresolvedRatePct > 25`, DLQ depth > 0 | No action attached; wire an SNS topic when there is someone to page |
| **X-Ray** | on every function and both state machines | Trace map across API → Step Functions → Lambda | |

### Where the implementation deviates from `IMPLEMENTATION.md`, and why

| Specified | Built | Why |
|---|---|---|
| EventBridge on S3 `ObjectCreated` starts the execution | `POST /cases/{id}/submit` starts it, after recording what landed under `raw/<caseId>/` | One object event per document would start six executions per pack, or need a Lambda to count them. The client already calls `submit` once every upload is done; the API checks storage, not the client's word |
| Bedrock confirms each document's kind from its layout | `DocumentClassified … by: 'declared'` | The layout text does not exist until Textract has run in the next state, and reading a raw document into a model is on the wrong side of the gate. Confirmation belongs after the `Map`, as a check that fails the pack on a contradiction |
| `AwaitHumanCorrection` heartbeats hourly | 24 h `TimeoutSeconds`, no heartbeat | The Lambda returns at once and holds nothing open; a heartbeat would need a process that has nothing to report |
| Tiers 2–3 of normalisation (Titan, Claude) | Tier 1 only; `null` → UNRESOLVED | The `Escalation` hook is the seam; τ is calibrated once Titan is wired |
| Bedrock Guardrails on prose | The no-digits assertion and a system prompt; `PROSE_GUARDRAIL_ID`/`VERSION` are read if set | No guardrail resource is created by the stacks yet |
| `/fc/rulepack/active` selects the rulepack | Handlers bundle v1 | Reading the parameter is a small change to `stageDeps()` once a second version exists |
| `GET /rulepacks/{v}/clauses/{id}` | Not built | The UI reads clause text from the bundled rulepack |

---

## 3. Regions and models

- **`ap-south-1` (Mumbai)** for everything that touches documents: S3, KMS, DynamoDB,
  Step Functions, Lambda, Textract, Comprehend, Cognito, the CloudFront origin. Set by the
  `fc:primaryRegion` context key in `packages/infra/cdk.json`.
- **Bedrock**: `fc:bedrockRegion`, also `ap-south-1` by default. If the model you need is
  not available there, an APAC cross-region inference profile (`apac.anthropic.…`) is the
  first fallback and `us-east-1` the second. What makes a different Bedrock region
  defensible is that only redacted text ever reaches it (ADR 004).
- **`fc:proseModelId`** — empty by default, which means `WriteProse` records
  `ProseWritten { skipped }` and holds no Bedrock permission at all. Set it to a model id
  or an inference profile id once model access is confirmed; the grant is scoped to exactly
  that model (and, for a profile, the underlying model in every region it routes to).
- CloudFront is global; the distribution's log bucket and origin bucket are in the
  primary region.

Verify model availability **before** setting `fc:proseModelId`:

```bash
aws bedrock list-foundation-models --region ap-south-1 \
  --query "modelSummaries[?contains(modelId, 'titan-embed') || contains(modelId, 'claude')].[modelId,inferenceTypesSupported]" \
  --output table
```

---

## 4. Connecting from a laptop

### 4.1 Prerequisites

- Node ≥ 22 and pnpm 11 (`corepack enable && corepack prepare pnpm@11 --activate`, or
  install pnpm directly).
- AWS CLI v2: `aws --version` should print `aws-cli/2.x`.
- The CDK CLI and esbuild are workspace dev dependencies; you do not need a global install
  of either. `pnpm cdk -- --version` runs the CLI. Synth bundles every handler with esbuild
  from the workspace root, which is why esbuild is a root dev dependency.

### 4.2 Credentials

Use a named profile and never paste keys into a shell history. Two supported routes:

**IAM Identity Center (SSO) — preferred**

```bash
aws configure sso --profile fc
#   SSO session name: fc
#   SSO start URL:    https://<your-org>.awsapps.com/start
#   SSO region:       ap-south-1   (the region Identity Center is enabled in — may differ)
#   Account / role:   pick the sandbox account and a role with the permissions in §4.4
#   CLI default region: ap-south-1
aws sso login --profile fc
```

**Long-lived access key — only for a personal sandbox account**

```bash
aws configure --profile fc
#   AWS Access Key ID / Secret Access Key: from IAM → Users → Security credentials
#   Default region name: ap-south-1
#   Default output format: json
```

Then, in every shell that will run CDK:

```bash
export AWS_PROFILE=fc          # PowerShell: $env:AWS_PROFILE = 'fc'
aws sts get-caller-identity    # confirms the account and role you are about to deploy into
```

`CDK_DEFAULT_ACCOUNT` is read by `packages/infra/bin/app.ts`; the CDK CLI sets it from the
active profile, so you do not export it yourself.

### 4.3 One-time account setup

```bash
# Bootstrap the account+region for CDK (creates the staging bucket and roles).
pnpm cdk -- bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-south-1

# Optional — only if you will set fc:proseModelId. Bedrock model access is enabled in
# the console, once per account+region: Bedrock → Model access → request the model.
# Then confirm with the list-foundation-models command in §3.
```

### 4.4 Permissions the deploying identity needs

For a sandbox, `AdministratorAccess` is the honest answer. For anything shared, the deploy
role needs CloudFormation, IAM (to create the function roles), S3, KMS, DynamoDB, SSM,
Secrets Manager, CloudFront, Lambda, Logs, States, SNS, SQS, Cognito, API Gateway,
CloudWatch and — for the pipeline's own roles to be granted them — Textract, Comprehend and
Bedrock. CDK's bootstrap roles carry most of this; the deploying identity mainly needs
`sts:AssumeRole` on `cdk-hnb659fds-*-role-*` in the account.

### 4.5 Synthesise, diff, deploy

```bash
pnpm web:build                        # FcWebStack deploys packages/web/dist, so build first
pnpm cdk:synth                        # no credentials needed; bundles the handlers, runs cdk-nag, fails on findings
pnpm cdk -- diff --all                # what would change
pnpm deploy                           # = cdk deploy --all; prints FcWebStack.Url when done
```

`cdk deploy --all` is the only deploy command anyone runs. The order is Core → Pipeline →
Api → Web (then Eval and Observability), from the explicit props in `bin/app.ts`, not from
`Fn::ImportValue`. Two things about a first deploy worth knowing:

- **The API learns its public origin from the web stack.** `FcWebStack` writes
  `/fc/web/origin` and `/fc/web/cognito-client-id` to SSM after it mints the distribution;
  the API Lambdas read them at cold start and re-check every 30 s while they are missing.
  So between `FcApiStack` finishing and `FcWebStack` finishing — a few minutes — sign-in
  answers `Invalid origin`. That is the stacks staying a DAG, not a fault.
- **To add prose**, deploy with the model: `pnpm cdk -- deploy --all -c fc:proseModelId=…`.
  Without it the pipeline still completes; `ProseWritten` says `skipped`.

The static demo alone still needs nothing else:

```bash
pnpm cdk -- deploy FcWebStack         # the public UI; the demo case settles in the browser
```

(With `FcApiStack` absent the web stack's API behaviours are simply not created — see
`WebStackProps.api`.)

### 4.6 Run the evaluation sweep

```bash
aws stepfunctions start-execution --region ap-south-1 \
  --state-machine-arn $(aws cloudformation describe-stacks --stack-name FcEvalStack \
      --query "Stacks[0].Outputs[?OutputKey=='EvalStateMachineArn'].OutputValue" --output text) \
  --input '{"count":200,"profile":"degraded"}'
# … about three minutes later:
aws s3 ls s3://<ArtifactsBucket>/eval-runs/ --recursive | grep report.txt
```

### 4.7 Tear down

```bash
pnpm cdk -- destroy --all
```

Every bucket has `autoDeleteObjects: true` and every resource `RemovalPolicy.DESTROY`, so
this is a clean removal and not a half-deleted stack. Both of those are deliberate for a
demo account and are the first things to change for anything else.

---

## 5. Runtime configuration

Things that must be changeable without a deploy live in SSM:

| Parameter | Written by | Read by | Effect |
|---|---|---|---|
| `/fc/web/origin` | `FcWebStack` | the API Lambdas, at cold start | The public origin: better-auth's `baseURL`, the trusted origin for CORS and CSRF, the Cognito callback |
| `/fc/web/cognito-client-id` | `FcWebStack` | the API Lambdas | Enables the Cognito button (§11). Absent → email and password only |
| `/fc/rulepack/active` | `FcCoreStack` (`v1`) | nobody yet | Pointer to the live rulepack version. The handlers bundle v1 until this is consumed |
| `/fc/normalisation/tau` | `FcCoreStack` (`0.08`) | nobody yet | Tier-2 embedding margin gate; tier 2 is not wired |

Deploy-time configuration is CDK context: `fc:primaryRegion`, `fc:bedrockRegion`,
`fc:proseModelId` (§3). The prose Lambda also reads `PROSE_GUARDRAIL_ID` and
`PROSE_GUARDRAIL_VERSION` if you attach a Bedrock Guardrail by hand to its environment.

The tier-1 trigram threshold is `DEFAULT_TIER1.fuzzyThreshold` in `packages/normalise`
(0.92); `docs/evaluation.md` records the calibrated knee. Promoting it to
`/fc/normalisation/tier1-threshold` is the intended next step.

---

## 6. Data handling, as mechanisms

These are the controls a reviewer will ask about, and where each one actually is:

| Claim | Mechanism | Where |
|---|---|---|
| Raw uploads do not persist | S3 lifecycle: the raw bucket expires objects after **1 day** (uploads, Textract blocks, the pre-redaction pack alike) | `core-stack.ts` `RawBucket.lifecycleRules` |
| Case data does not persist | DynamoDB TTL attribute `ttl`, 24 h on case items, refreshed on write | `dynamo-store.ts` `CASE_TTL_HOURS` |
| Documents encrypted at rest with our key | SSE-KMS on the raw bucket, key rotation on | `core-stack.ts` `DocumentKey`, `RawBucket.encryption` |
| Nothing unredacted reaches a model | Branded `RedactedText` type (compile time); `Normalise`, `Reconstruct`, `WriteProse`, `IssueCertificate` have no grant on the raw bucket or the document key (runtime); Comprehend error fails closed | `packages/functions/src/shared/redacted.ts`, `pipeline-stack.ts` "the far side", `redact.ts` |
| Bedrock is opt-in and scoped | No `bedrock:InvokeModel` unless `fc:proseModelId` is set; then on that model's ARN only | `pipeline-stack.ts` `bedrockModelArns` |
| Uploads never touch our compute | Presigned POST, 5-minute expiry, 1–25 MB, content-type pinned by policy condition | `shared/presign.ts` |
| The public URL cannot reach the data except through a session | `FcWebStack` holds no reference to `FcCoreStack`: it knows two hostnames and a user pool id. Every `/api/cases` route checks the better-auth cookie and scopes the case to its owner | `bin/app.ts`, `routes/cases.ts` |
| Certificates are signed, and verifiable | KMS asymmetric key, `ECDSA_SHA_256` over the result hash; `verify` returns KMS's verdict | `kms-sign.ts`, `issue-certificate.ts` |
| Every S3 access is logged | Server access logging on all data buckets, CloudFront standard logs, HTTP API access logs | all stacks |
| No public buckets, no ACLs | `BLOCK_ALL` + `BUCKET_OWNER_ENFORCED` everywhere except the CloudFront log bucket | both storage stacks |
| Secrets are not environment variables | `BETTER_AUTH_SECRET` is a generated Secrets Manager secret read at cold start; the Cognito client is public (PKCE) and has none | `api-stack.ts` |

Every `cdk-nag` suppression in the stacks names the finding and the reason; none is a
blanket rule disable. `pnpm cdk:synth` fails on an unreviewed finding.

---

## 7. Cost

Nothing in the six stacks costs money while nobody is using it: S3 and DynamoDB on-demand at
rest, CloudFront on `PRICE_CLASS_200`, Lambda and Step Functions per use, a Cognito pool on
the Essentials plan with no users, no provisioned capacity, no NAT, no always-on compute. The
one fixed line is Secrets Manager's single secret (cents per month). The cost drivers arrive
with use — Textract pages (dominant), Comprehend units, Bedrock tokens if prose is on, Step
Functions state transitions (about 22 per pack) — and `docs/cost.md` is to be written from
measured demo-corpus figures once they exist (`IMPLEMENTATION.md` §22.3), not estimated.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `cdk synth` fails with `AwsSolutions-…` | A nag finding without a reviewed suppression | Fix the resource, or add a suppression *with a reason* next to the existing ones |
| `cdk synth` fails with `'esbuild' is not recognized` | esbuild missing from the workspace root | `pnpm install` — it is a root dev dependency |
| `Need to perform AWS calls for account …, but no credentials found` | No active profile | `export AWS_PROFILE=fc` and `aws sso login --profile fc` |
| `This stack uses assets, so the toolkit stack must be deployed` | Account not bootstrapped in `ap-south-1` | §4.3 |
| `FcWebStack` deploy fails on `Source.asset` | `packages/web/dist` missing | `pnpm web:build` first |
| Sign-in on the public URL answers `Invalid origin` right after a deploy | `FcApiStack` is up but `FcWebStack` has not yet written `/fc/web/origin` | Wait for `FcWebStack`; the API re-checks the parameter every 30 s |
| The Cognito button is missing on the public URL | `/fc/web/cognito-client-id` is absent, or `/api/health` reports `signIn.cognito: false` | Deploy `FcWebStack`; check the parameter exists |
| Cognito Hosted UI says `redirect_mismatch` | The app client's callback URL is not `<origin>/api/auth/callback/cognito` | It is set from the distribution domain in `web-stack.ts`; a custom domain needs adding there |
| Bedrock `AccessDeniedException` / `ValidationException: model not available` | Model access not enabled, or not offered in the region, or `fc:proseModelId` names a model the grant does not cover | §3 and §4.3 |
| Case fails with `TEXTRACT_NO_TABLE_FOUND` on a scan that has a table | The parser found no column that reads as money, or Textract's job failed | Read `raw/textract/<caseId>/<kind>.json` (it expires in a day); `parse-tables.ts` documents the column heuristics |
| Case stays in `EXTRACTING` for 30 minutes then fails | The Textract completion notice never arrived | Check `TextractCompleteDlq` and the topic's delivery logs; the state's timeout is the safety net |
| Case fails with `REDACTION_FAILED_OPEN` | Comprehend errored (throttled, region, permission) | The gate fails closed by design; retry the case once the cause is fixed |
| S3 access logs never appear | Log bucket encrypted with a CMK | Keep the log bucket on SSE-S3 (already the case) |
| Locally: `Invalid origin` on sign-in | The browser's origin is not in `FC_TRUSTED_ORIGINS`, which trusts only `:5173` by default | Add the origin, or free `:5173`. `localhost` and `127.0.0.1` are *different origins* |
| API exits at once with `BETTER_AUTH_SECRET must be set in production` | `NODE_ENV=production` with no secret | Set `BETTER_AUTH_SECRET` (on AWS it comes from Secrets Manager) |
| Upload rejected at 413 by nginx, though the API allows 25 MB | `client_max_body_size` in front of the API | Already `30m` in `docker/nginx.conf`; raise both limits together |
| Pipeline progress never moves in the browser | A proxy is buffering the SSE response | `proxy_buffering off` in `docker/nginx.conf`; on AWS the events route is on its own streaming origin |

---

## 9. Deploying without AWS: the container path

The web bundle and the API also run as two containers. This is how the product is demonstrated
when a Textract-backed deployment is not available, and how a reviewer sees the whole thing run
from a checkout with nothing but Docker installed. `README.md` gives the three commands; this
is the detail behind them.

### One Dockerfile, several targets

`Dockerfile` is a single multi-stage build:

| Target | What it is |
|---|---|
| `deps` | The workspace with dependencies installed from the lockfile alone. `pnpm fetch` runs *before* the source is copied, so that layer caches until `pnpm-lock.yaml` changes |
| `verify` | The whole gate — `typecheck · lint · dep:cruise · test · eval:assert`. `docker build --target verify .` is CI in a box |
| `api` | The case API on Node. `NODE_ENV=production`, `FC_DATA_DIR=/data`, volume `/data`, `EXPOSE 3000`, runs as `node`, health check on `/api/health` |
| `eval` | The evaluation CLI: `docker run … run --count 200 --profile degraded` |
| `web-build` | `pnpm web:build` |
| `web` | nginx 1.27 serving `packages/web/dist` |

### What `docker-compose.yml` brings up

| Command | Services | Ports |
|---|---|---|
| `docker compose up` | `api` + `web-dev` (Vite with HMR, against bind-mounted source) | 3000, 5173 |
| `docker compose --profile prod up` | `api` + `web` (nginx serving the built bundle) | 3000, 8080 |
| `docker compose run --rm verify` | The CI gate, once | — |
| `docker compose run --rm eval run --count 200 --profile degraded` | The eval sweep | — |

`web-dev` shadows each package's `node_modules` with an anonymous volume, because pnpm's layout
is symlinked per package and a host mount over the top of it produces a tree that resolves on
the host and not in the container.

### State, and how to throw it away

The API keeps its SQLite auth database (`auth.sqlite`) and one directory per case under
`FC_DATA_DIR`, which compose mounts as the `fc-data` volume. Accounts and cases therefore
survive a rebuild and are removed by `docker compose down -v`.

### Same-origin is load-bearing, not incidental

`docker/nginx.conf` proxies `/api/` to the `api` service, so the session cookie is first-party
and no CORS is involved — the same shape `FcWebStack` gives CloudFront. The same file does
three things that are easy to get wrong:

- `proxy_buffering off` and `proxy_read_timeout 1h`, because `/api/cases/{id}/events` is a
  long-lived SSE stream and a buffering proxy makes it look like the pipeline has hung.
- `client_max_body_size 30m`, above the API's own 25 MB per-document limit, so the error a user
  sees is the API's named one rather than nginx's bare 413.
- `index.html` `no-cache`, `/assets/` immutable — the same split `FcWebStack` gives CloudFront,
  because a cached document pointing at deleted asset hashes is a blank page.

### The one secret

`BETTER_AUTH_SECRET` must be set wherever `NODE_ENV=production`; `loadEnv` throws rather than
falling back to the development default. `FC_API_BASE_URL` and `FC_TRUSTED_ORIGINS` must name
the origin the browser actually uses — including whether it is `localhost` or `127.0.0.1`, which
are different origins to a cookie jar.

### What is *not* in the container

The containers are the product slice, not the pipeline. No Textract, no Bedrock, no Step
Functions: `FC_EXTRACTOR=structured` reads the JSON pack, and the certificate is issued unsigned
(`signature: null`). A container deployment proves the arithmetic, the reconciliation and the
replay end to end; the AWS deployment is what adds reading real scanned documents. §10 lists
what differs.

---

## 10. The API: endpoints, configuration, and what differs by deployment

`packages/api` is one Hono app. Locally it runs on Node with filesystem storage and
better-auth on `node:sqlite`; on AWS the identical app runs on Lambda with the
implementations in §1's second table. `packages/functions/src/api/app.ts` is the whole
difference.

### Endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | ok · rulepack version and hash · which extractor and runner loaded · which sign-in methods the server offers. This is the container health check |
| `/api/auth/*` (GET, POST) | The better-auth handler: sign up, sign in, sign out, session, and the Cognito callback |
| `GET /api/cases` | The caller's cases |
| `POST /api/cases` | Create a case. `201` with one upload target per declared document |
| `PUT /api/cases/{id}/documents/{kind}` | The local upload target. Presigned S3 POSTs replace these on AWS; the client handles both |
| `POST /api/cases/{id}/submit` | Every declared document is in → run the pipeline. `202`. On AWS this first records what actually landed under `raw/<caseId>/` |
| `GET /api/cases/{id}` | Status, extracted bill, pinned input, reconstruction, failure |
| `GET /api/cases/{id}/events` | SSE progress stream |
| `POST /api/cases/{id}/corrections` | Human correction, then resume. `202` |
| `GET /api/cases/{id}/certificate` | The issued certificate |
| `GET /api/cases/{id}/verify` | Replay: re-run the engine over the pinned input and compare hashes; on AWS, also KMS `Verify` on the signature |

Everything under `/api/cases` is behind a session, and every case is scoped to its owner. A case
ID is content-addressed and guessable, so **ownership, not obscurity, is the access control** —
someone else's case answers `404`, not `403`.

### Configuration

All read in `packages/api/src/env.ts`, from the environment with development defaults. On AWS
`app.ts` fills them from the stack's environment, Secrets Manager and SSM (§5).

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `FC_DATA_DIR` | `packages/api/data` | Case files, uploads, `auth.sqlite`. `/tmp/fc` on Lambda, unused there |
| `NODE_ENV` | `development` | `production` makes the secret mandatory and turns on secure cookies |
| `BETTER_AUTH_SECRET` | a development placeholder | **Throws in production if unset** |
| `FC_API_BASE_URL` | `http://localhost:$PORT` | Also trusted as an origin. `/fc/web/origin` on AWS |
| `FC_TRUSTED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated. Any other origin is refused with `Invalid origin` |
| `FC_EXTRACTOR` | `structured` | `textract` selects the Textract extractor (which locally fails with `EXTRACTOR_UNAVAILABLE`) |
| `FC_COGNITO_CLIENT_ID`, `FC_COGNITO_DOMAIN`, `FC_COGNITO_REGION`, `FC_COGNITO_USER_POOL_ID` | unset | All four set → Cognito sign-in is offered (§11). Works locally too, against a pool whose app client allows `http://localhost:3000/api/auth/callback/cognito` |

### What differs by deployment

| Concern | Locally / containers | On AWS |
|---|---|---|
| Certificate signature | `signature: null`; `verify` reports `signatureValid: null`. The hash still reproduces | `ECDSA_SHA_256` from the KMS key; `signatureValid` is KMS's verdict |
| Non-JSON documents | `EXTRACTOR_UNAVAILABLE` | Textract, with bounding-box provenance per row |
| Redaction | Format regexes only | Comprehend + regexes; fails closed |
| Event delivery | The API polls its own store and streams over SSE | The same, on a streaming Function URL behind CloudFront |
| Prose | `ProseWritten { skipped }` | The same unless `fc:proseModelId` is set |
| Email verification | Off — no mail transport | Off. Cognito sends its own verification mail for the accounts it holds |
| Tier-2 normalisation | Not wired | Not wired |

Two limits to know before a demo: a document over **25 MB** is refused (`413` locally, a
policy error from S3 on AWS), and sign-in from an untrusted origin is refused outright.

---

## 11. Sign-in, and Amazon Cognito

better-auth is the session layer everywhere: it mints the cookie, owns the `user` and
`session` rows, and every `/api/cases` route asks it who the caller is. What changes by
deployment is only where those rows live — SQLite locally, the DynamoDB adapter on AWS.

Amazon Cognito comes in through **better-auth's Cognito social provider**
(`socialProviders.cognito` in `packages/api/src/auth.ts`). That is the shape better-auth
supports, and it means:

- Cognito's Hosted UI does the authentication; better-auth still creates the session. There
  is no separate "Cognito mode" in the routes, and no JWT authorizer at the gateway.
- Both sign-in methods coexist. Email and password stay on, because a policyholder trying
  the demo should not have to leave the page.
- The app client is public with PKCE — no client secret in the Lambda, none to rotate.
- better-auth's own database is still required, which is why the DynamoDB adapter exists.

How the pieces are placed:

| Piece | Stack | Why there |
|---|---|---|
| User pool `fc-users`, Hosted UI domain | `FcApiStack` | Origin-independent; the Lambda gets the pool id, region and domain as environment |
| App client `fc-web` | `FcWebStack` | Its callback URL is on the distribution's origin, which only exists here |
| `/fc/web/cognito-client-id` | written by `FcWebStack`, read by the API | The last piece the Lambda needs, delivered without an `Fn::ImportValue` cycle |
| The button | `packages/web/src/screens/SignIn.tsx` | Rendered only when `GET /api/health` says `signIn.cognito: true` |

The flow: the button calls `authClient.signIn.social({ provider: 'cognito' })` → better-auth
redirects to `https://fc-<suffix>.auth.ap-south-1.amazoncognito.com/oauth2/authorize` → the
Hosted UI signs the user up or in → Cognito redirects to
`<origin>/api/auth/callback/cognito` → better-auth exchanges the code, stores the account row,
sets the session cookie, and sends the browser to `/#/cases`.

If you would rather not have Cognito at all, delete the user pool and domain from
`api-stack.ts`, the client and parameter from `web-stack.ts`, and the `COGNITO_*`
environment; the app reads `env.cognito === null` and offers email and password only.

---

## 12. CI

`.github/workflows/ci.yml` runs on every push and pull request and enforces the same gate as
`docker build --target verify`:

| Step | Fails when |
|---|---|
| `pnpm typecheck` | Any package does not typecheck |
| `pnpm lint` | Any lint error |
| `pnpm dep:cruise` | `packages/engine` imports the AWS SDK or a Node built-in. This is the purity rule, and a required check — see ADR 007 |
| `pnpm test` | Any test fails — including `packages/functions`'s tests of the Textract parser, the redaction spans and the failure decoder |
| Rulepack lock check | `packages/rulepack/data/v1.lock.json` is stale — a rule changed without regenerating it |
| `pnpm web:build` | The UI does not build |
| `pnpm cdk:synth --quiet` | A handler fails to bundle, or a `cdk-nag` `AwsSolutions` finding lacks a reviewed suppression. Synthesis needs no credentials |
| `pnpm eval:assert` | Detection precision or recall regresses against the committed baselines, a lawful deduction starts being disputed, or a lawful control drops out of the measured set |

None of it needs AWS credentials, which is why it can run on every push. `pnpm verify` runs the
first four locally, and `docker compose run --rm verify` runs the same set without a local
toolchain.
