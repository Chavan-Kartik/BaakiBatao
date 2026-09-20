# AWS — services, and how to connect

This is the operator's page: which AWS services the system uses, what each one is for,
which of them exist in the account today, and the exact steps to get from a fresh laptop
to `cdk deploy --all`. The architecture rationale lives in `IMPLEMENTATION.md` §3.2 and §10;
this page does not repeat it.

Nothing on this page is needed to run the product locally. The engine is pure, the web UI
settles the reference claim in the browser, and the evaluation harness generates its own
corpus — `pnpm verify`, `pnpm eval:assert` and `pnpm web:dev` all work with no credentials.
AWS is needed for the document pipeline (Textract, Comprehend, Bedrock), the public URL,
and the hosted API.

---

## 1. What exists today, and what is specified

Two CDK stacks are implemented and synthesise clean under `cdk-nag`'s `AwsSolutionsChecks`.
Four more are specified in `IMPLEMENTATION.md` §10.2 and not yet written.

| Stack | State | Contents |
|---|---|---|
| `FcCoreStack` | **implemented** | KMS key, four S3 buckets, DynamoDB single table, two SSM parameters |
| `FcWebStack` | **implemented** | Private origin bucket, CloudFront distribution with OAC, `BucketDeployment` of `packages/web/dist` |
| `PipelineStack` | specified | Step Functions state machine, pipeline Lambdas, Textract SNS topic, DLQs |
| `ApiStack` | specified | HTTP API, Lambda Function URL for SSE, API Lambdas |
| `EvalStack` | specified | Distributed Map sweep over the corpus, Express child workflow |
| `ObservabilityStack` | specified | CloudWatch dashboard, alarms |

The Lambda handlers in `packages/functions` are also not yet written; the package holds the
redaction boundary type (`RedactedText`) and the handler inventory in its `index.ts`.

### What runs locally, and what each piece becomes on AWS

`packages/api` is the product slice without AWS. It is written behind the interfaces the
AWS pieces will implement, so wiring them is a matter of swapping implementations, not
rewriting routes:

| Locally | Interface | On AWS |
|---|---|---|
| `FsCaseStore` — one JSON file per case | `CaseStore` | DynamoDB single table (§17) |
| `FsDocumentStorage` — files under `data/cases/<id>/raw/` | `DocumentStorage` | S3 `raw/` (SSE-KMS, 1-day expiry) |
| `PUT /api/cases/{id}/documents/{kind}` targets | `CreateCaseResponse.uploads` | Presigned S3 POSTs; the client already handles both |
| `structuredExtractor` — reads the JSON pack | `Extractor` | `textractExtractor`: `StartDocumentAnalysis` + SNS task token |
| `redactPack` — format regexes only | the redaction gate | Comprehend `DetectPiiEntities` added; fails closed |
| `runPipeline` — stages in one process | the §11 state machine | Step Functions Standard, one Lambda per stage, same `CaseEvent`s |
| `GET /api/cases/{id}/events` — SSE polling the store | events stream | Lambda Function URL with response streaming |
| `issueCertificate` — `signature: null` | certificate | KMS `ECDSA_SHA_256` signing |
| better-auth on `node:sqlite` | sessions | better-auth on a Kysely dialect over Postgres/DynamoDB, or Cognito behind the same session middleware |

---

## 2. The services, one by one

### Deployed by `FcCoreStack`

| Service | Resource | Purpose | Notes |
|---|---|---|---|
| **KMS** | key `alias/fc/documents`, rotation on | Encrypts uploaded claim packs at rest | Symmetric. The asymmetric `ECC_NIST_P256` certificate-signing key (§16) is not created yet |
| **S3** | `RawBucket` | Presigned uploads land here | SSE-KMS with the key above. **Expires objects after 1 day** — this lifecycle rule is the mechanism behind "nothing stores real personal data beyond the demo session". EventBridge notifications on. CORS currently `*` (TODO: narrow to the CloudFront domain) |
| **S3** | `RedactedBucket` | Everything downstream of the redaction gate reads from here | SSE-S3, 7-day expiry. Bedrock-calling Lambdas will be granted read here and **nowhere on `raw/`** (ADR 004) |
| **S3** | `ArtifactsBucket` | Signed certificates and generated letters | Versioned |
| **S3** | `AccessLogsBucket` | Server access logs for the three above | SSE-S3 on purpose: a CMK on a log-delivery target is the usual reason logging silently stops. 30-day expiry |
| **DynamoDB** | `MainTable` (`pk`/`sk`, `gsi1`) | Single table: case event log, materialised state, rulepack versions, lexicon | On-demand, PITR on, TTL attribute `ttl` (24 h on case items). Access patterns in `IMPLEMENTATION.md` §17 |
| **SSM Parameter Store** | `/fc/rulepack/active` = `v1` | Pointer to the live rulepack version | Bump to correct a rule without a redeploy |
| **SSM Parameter Store** | `/fc/normalisation/tau` = `0.08` | Tier-2 embedding-margin threshold | Placeholder until tier 2 is wired; the tier-1 threshold is calibrated in `docs/evaluation.md` and lives in code until it too is promoted to a parameter |

### Deployed by `FcWebStack`

| Service | Resource | Purpose | Notes |
|---|---|---|---|
| **S3** | `OriginBucket` | The built web bundle | Private; reachable only through CloudFront via Origin Access Control. Never a website endpoint (cannot do TLS) |
| **S3** | `CloudFrontLogsBucket` | CloudFront standard logs | The one bucket in the system with ACLs enabled, because CloudFront log delivery writes with an ACL. Confined to this bucket on purpose |
| **CloudFront** | `Distribution` | The public URL | HTTP/2+3, `PRICE_CLASS_200` (serves India from an Indian edge), 403/404 → `/index.html` with a **200** so client-side routing and the history API keep working. `index.html` is `no-cache`; fingerprinted assets are `immutable` |
| **CloudFormation output** | `Url` | Where to point the browser | `cdk deploy FcWebStack` prints it |

### Specified, not yet deployed

| Service | Planned use | Why this and not the alternative |
|---|---|---|
| **EventBridge** | S3 `ObjectCreated` on `raw/` → rule → `StartExecution` on the state machine | No Lambda glue for a trigger; one fewer cold start |
| **Step Functions (Standard)** | The per-pack pipeline (`IMPLEMENTATION.md` §11): validate → classify → extract (inline `Map`, `MaxConcurrency: 4`) → redact → checksum → optional human correction → normalise → reconstruct → prose → certificate | Standard rather than Express because two states pause on `.waitForTaskToken` (Textract completion, human correction) and the correction pause can last hours |
| **Step Functions (Distributed Map)** | Only the evaluation sweep over 200 corpus packs, Express child per pack, `MaxConcurrency: 40` | The right tool for a 200-item batch and the wrong one for six documents (ADR 006) |
| **Lambda** | Thin handlers over `@fc/engine`; `arm64`, 1024 MB, Powertools logger/tracer/metrics/idempotency/parameters | The engine is pure so each handler is I/O only |
| **Lambda Function URL** | Server-sent events for pipeline progress | Response streaming is only available on Function URLs, not through API Gateway |
| **API Gateway (HTTP API)** | `POST /cases`, `GET /cases/{id}`, corrections, simulate, verify, certificate, letter | Cheaper and lower-latency than REST API; no usage plans needed |
| **Textract** | `StartDocumentAnalysis`: `TABLES`+`LAYOUT` on bill and deduction sheet, `QUERIES` on the policy schedule, `LAYOUT` on the wording | Asynchronous; completion arrives via SNS, so the task token is stored keyed by `JobId` and `SendTaskSuccess` is called from the SNS handler (§11.3) |
| **SNS** | Textract `NotificationChannel` → completion Lambda | There is no `.sync` integration for async Textract |
| **Comprehend** | `DetectPiiEntities` in the redaction gate, alongside deterministic regex for Aadhaar / PAN / UHID / policy number | Both, not either: the model for names and addresses, regex where a format beats a model |
| **Bedrock** | Exactly three calls: document classification, **Titan Text Embeddings V2** for tier-2 normalisation, **Claude** for tier-3 tie-break and prose | Money never passes through it (ADR 003). Only redacted text reaches it (ADR 004) |
| **SQS** | Dead-letter queue per async Lambda | Nothing disappears silently |
| **KMS (asymmetric)** | `ECC_NIST_P256` key, `ECDSA_SHA_256`, for signing reconstruction certificates | Verifiable offline with the public key |
| **CloudWatch + X-Ray** | Structured JSON logs (`caseId` correlation), EMF business metrics (`UnresolvedRatePct`, `ReconciliationResidualPaise`, `NormalisationTierDistribution`, `CostPerCaseInr`), one dashboard, subsegment per waterfall step | §22 |

---

## 3. Regions

- **`ap-south-1` (Mumbai)** for everything that touches documents: S3, KMS, DynamoDB,
  Step Functions, Lambda, Textract, Comprehend, the CloudFront origin. Set by the
  `fc:primaryRegion` context key in `packages/infra/cdk.json`.
- **Bedrock**: `fc:bedrockRegion`, also `ap-south-1` by default. If the model you need is
  not available there, an APAC cross-region inference profile is the first fallback and
  `us-east-1` the second. What makes a different Bedrock region defensible is that only
  redacted text ever reaches it (ADR 004) — check that before changing the key, not after.
- CloudFront is global; the distribution's log bucket and origin bucket are in the
  primary region.

Verify model availability **before** building anything on it:

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
- The CDK CLI is a workspace dev dependency; you do not need a global install.
  `pnpm cdk -- --version` runs it.

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

# Enable Bedrock model access (console only, once per account+region):
#   Bedrock → Model access → request Titan Text Embeddings V2 and the Claude model in use.
# Then confirm with the list-foundation-models command in §3.
```

### 4.4 Permissions the deploying identity needs

For a sandbox, `AdministratorAccess` is the honest answer. For anything shared, the deploy
role needs CloudFormation, IAM (to create the Lambda and custom-resource roles),
S3, KMS, DynamoDB, SSM, CloudFront, Lambda, Logs, and — once the pipeline stack exists —
States, Events, SNS, SQS, Textract, Comprehend and Bedrock. CDK's bootstrap roles carry
most of this; the deploying identity mainly needs `sts:AssumeRole` on
`cdk-hnb659fds-*-role-*` in the account.

### 4.5 Synthesise, diff, deploy

```bash
pnpm web:build                        # WebStack deploys packages/web/dist, so build first
pnpm cdk:synth                        # no credentials needed; runs cdk-nag and fails on findings
pnpm cdk -- diff --all                # what would change
pnpm deploy                           # = cdk deploy --all; prints FcWebStack.Url when done
```

`cdk deploy --all` is the only deploy command anyone runs. Cross-stack references are by
explicit props, not `Fn::ImportValue`, so the stacks can be deployed independently:

```bash
pnpm cdk -- deploy FcWebStack         # the public demo alone; needs no bucket, table or key
```

### 4.6 Tear down

```bash
pnpm cdk -- destroy --all
```

Every bucket has `autoDeleteObjects: true` and every resource `RemovalPolicy.DESTROY`, so
this is a clean removal and not a half-deleted stack. Both of those are deliberate for a
demo account and are the first things to change for anything else.

---

## 5. Runtime configuration

Things that must be changeable without a deploy live in SSM and are read through
Powertools Parameters with a 5-minute cache:

| Parameter | Default | Effect |
|---|---|---|
| `/fc/rulepack/active` | `v1` | Which rulepack version the reconstruct step loads. Correcting a rule during judging is a `PutItem` on the rulepack row plus bumping this pointer |
| `/fc/normalisation/tau` | `0.08` | Tier-2 embedding margin gate. Not yet consumed — tier 2 is not wired |

```bash
aws ssm put-parameter --name /fc/rulepack/active --value v2 --overwrite --region ap-south-1
```

The tier-1 trigram threshold is currently `DEFAULT_TIER1.fuzzyThreshold` in
`packages/normalise` (0.92); `docs/evaluation.md` records the calibrated knee. Promoting it
to `/fc/normalisation/tier1-threshold` is the intended next step once the normalise Lambda
exists.

---

## 6. Data handling, as mechanisms

These are the controls a reviewer will ask about, and where each one actually is:

| Claim | Mechanism | Where |
|---|---|---|
| Raw uploads do not persist | S3 lifecycle: `raw/` expires after **1 day** | `core-stack.ts` `RawBucket.lifecycleRules` |
| Case data does not persist | DynamoDB TTL attribute `ttl`, 24 h on case items | `core-stack.ts` `MainTable.timeToLiveAttribute` |
| Documents encrypted at rest with our key | SSE-KMS on `raw/`, key rotation on | `core-stack.ts` `DocumentKey`, `RawBucket.encryption` |
| Nothing unredacted reaches a model | Branded `RedactedText` type; Bedrock Lambdas get no `s3:GetObject` on `raw/`; gate fails closed | `packages/functions/src/shared/redacted.ts`, ADR 004; the IAM half lands with `PipelineStack` |
| Public URL cannot reach the data | `WebStack` has no reference to `CoreStack` at all | `bin/app.ts` |
| Every S3 access is logged | Server access logging on all data buckets, CloudFront standard logs | both stacks |
| No public buckets, no ACLs | `BLOCK_ALL` + `BUCKET_OWNER_ENFORCED` everywhere except the CloudFront log bucket | both stacks |

Every `cdk-nag` suppression in the stacks names the finding and the reason; none is a
blanket rule disable. `pnpm cdk:synth` fails on an unreviewed finding.

---

## 7. Cost

There is nothing in the two deployed stacks that costs money while nobody is using it:
S3 and DynamoDB on-demand at rest, CloudFront on `PRICE_CLASS_200`, no provisioned
capacity, no NAT, no always-on compute. The cost drivers arrive with the pipeline —
Textract pages (dominant), Bedrock tokens, Step Functions state transitions — and
`docs/cost.md` is to be written from measured demo-corpus figures once they exist
(`IMPLEMENTATION.md` §22.3), not estimated beforehand.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `cdk synth` fails with `AwsSolutions-…` | A nag finding without a reviewed suppression | Fix the resource, or add a suppression *with a reason* next to the existing ones |
| `Need to perform AWS calls for account …, but no credentials found` | No active profile | `export AWS_PROFILE=fc` and `aws sso login --profile fc` |
| `This stack uses assets, so the toolkit stack must be deployed` | Account not bootstrapped in `ap-south-1` | §4.3 |
| `WebStack` deploy fails on `Source.asset` | `packages/web/dist` missing | `pnpm web:build` first |
| Bedrock `AccessDeniedException` / `ValidationException: model not available` | Model access not enabled, or not offered in the region | §3 and §4.3 |
| S3 access logs never appear | Log bucket encrypted with a CMK | Keep the log bucket on SSE-S3 (already the case) |
