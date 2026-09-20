#!/usr/bin/env node
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ApiStack } from '../lib/api-stack';
import { CoreStack } from '../lib/core-stack';
import { EvalStack } from '../lib/eval-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { WebStack } from '../lib/web-stack';

const app = new App();

const context = (key: string, fallback: string): string => (app.node.tryGetContext(key) as string | undefined) ?? fallback;
const primaryRegion = context('fc:primaryRegion', 'ap-south-1');
const bedrockRegion = context('fc:bedrockRegion', primaryRegion);
// Empty by default: prose is skipped, honestly, until model access is
// confirmed in the account (docs/aws.md §3). Set `-c fc:proseModelId=…`.
const proseModelId = context('fc:proseModelId', '');
const env = { account: process.env['CDK_DEFAULT_ACCOUNT'], region: primaryRegion };

// Core → Pipeline → Api → Web, by explicit props. Eval and Observability
// hang off the side. `cdk deploy --all` orders them from these references.
const core = new CoreStack(app, 'FcCoreStack', { env });
const pipeline = new PipelineStack(app, 'FcPipelineStack', { env, core, bedrockRegion, proseModelId });
const api = new ApiStack(app, 'FcApiStack', { env, core, pipeline: pipeline.refs });

// The web tier fronts the API under one origin. It still holds no reference
// to CoreStack: what it knows about the backend is two hostnames and a user
// pool id, and the data stays behind the API's own session checks.
new WebStack(app, 'FcWebStack', { env, api: api.refs });

new EvalStack(app, 'FcEvalStack', { env, core });
new ObservabilityStack(app, 'FcObservabilityStack', {
  env,
  stateMachine: pipeline.stateMachine,
  httpApi: api.httpApi,
  apiFunctions: api.functions,
  deadLetterQueueNames: pipeline.deadLetterQueueNames,
});

/**
 * The judges are AWS engineers. A clean nag report with reviewed suppressions
 * in the repo costs twenty minutes and is worth having.
 */
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

app.synth();
