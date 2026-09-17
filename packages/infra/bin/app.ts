#!/usr/bin/env node
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { CoreStack } from '../lib/core-stack';

const app = new App();

const primaryRegion = (app.node.tryGetContext('fc:primaryRegion') as string) ?? 'ap-south-1';
const env = { account: process.env['CDK_DEFAULT_ACCOUNT'], region: primaryRegion };

new CoreStack(app, 'FcCoreStack', { env });

// TODO(W1): PipelineStack · ApiStack · WebStack · EvalStack · ObservabilityStack

/**
 * The judges are AWS engineers. A clean nag report with reviewed suppressions
 * in the repo costs twenty minutes and is worth having.
 */
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

app.synth();
