import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
  Metric,
  SingleValueWidget,
  TextWidget,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import type { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import type { StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import type { Construct } from 'constructs';

/**
 * One dashboard and four alarms (build spec §22).
 *
 * Not p99 latency. The top row is the business: how much of the money the
 * engine could not place (`UnresolvedRatePct`), whether the ledger balanced
 * (`ReconciliationResidualPaise`, should be 0), how long the money math took
 * (`EngineDurationMs`, ~5 ms — the slow part is never the arithmetic), and
 * which normalisation tier answered. These are EMF metrics the pipeline
 * handlers emit under the `FC` namespace. Below that, the plumbing: state
 * machine outcomes, API errors, dead-letter depth.
 *
 * Alarms: an execution failed, a residual was non-zero, unresolved crossed
 * a quarter of the bill, anything landed in a dead-letter queue.
 */
export interface ObservabilityStackProps extends StackProps {
  readonly stateMachine: StateMachine;
  readonly httpApi: HttpApi;
  readonly apiFunctions: readonly LambdaFunction[];
  readonly deadLetterQueueNames: readonly string[];
}

export const METRICS_NAMESPACE = 'FC';

export class ObservabilityStack extends Stack {
  readonly dashboard: Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const business = (metricName: string, statistic: string, dimensions?: Record<string, string>) =>
      new Metric({ namespace: METRICS_NAMESPACE, metricName, statistic, period: Duration.minutes(5), dimensionsMap: dimensions });

    const unresolved = business('UnresolvedRatePct', 'Average');
    const residual = business('ReconciliationResidualPaise', 'Maximum');
    const engineMs = business('EngineDurationMs', 'Average');
    const tiers = ['LEXICON', 'LEXICON_FUZZY', 'EMBEDDING', 'LLM', 'UNRESOLVED'].map((tier) =>
      business('NormalisationTierDistribution', 'Sum', { tier }).with({ label: tier }),
    );

    const sm = props.stateMachine;
    const failed = sm.metricFailed({ period: Duration.minutes(5), statistic: 'Sum' });
    const dlqDepths = props.deadLetterQueueNames.map((name, i) =>
      Queue.fromQueueAttributes(this, `Dlq${i}`, { queueName: name, queueArn: `arn:${this.partition}:sqs:${this.region}:${this.account}:${name}` })
        .metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: 'Maximum' })
        .with({ label: name }),
    );

    this.dashboard = new Dashboard(this, 'Dashboard', { dashboardName: 'fc-settlement-reconstructor' });
    this.dashboard.addWidgets(
      new TextWidget({
        width: 24,
        height: 1,
        markdown: '## Settlement reconstructor — domain metrics first, plumbing second',
      }),
    );
    this.dashboard.addWidgets(
      new SingleValueWidget({ title: 'Unresolved % of bill (lower is better)', metrics: [unresolved], width: 6, height: 4 }),
      new SingleValueWidget({ title: 'Reconciliation residual, paise (must be 0)', metrics: [residual], width: 6, height: 4 }),
      new SingleValueWidget({ title: 'Engine duration, ms', metrics: [engineMs], width: 6, height: 4 }),
      new SingleValueWidget({ title: 'Cases completed / failed (5 min)', metrics: [sm.metricSucceeded({ statistic: 'Sum' }), failed], width: 6, height: 4 }),
    );
    this.dashboard.addWidgets(
      new GraphWidget({ title: 'Normalisation tier distribution', left: tiers, stacked: true, width: 12, height: 6 }),
      new GraphWidget({ title: 'Unresolved rate over time', left: [unresolved], width: 12, height: 6 }),
    );
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Pipeline executions',
        left: [sm.metricStarted({ statistic: 'Sum' }), sm.metricSucceeded({ statistic: 'Sum' }), failed, sm.metricTimedOut({ statistic: 'Sum' })],
        width: 8,
        height: 6,
      }),
      new GraphWidget({
        title: 'API',
        left: props.apiFunctions.map((fn) => fn.metricErrors({ statistic: 'Sum' }).with({ label: `${fn.node.id} errors` })),
        right: [
          new Metric({ namespace: 'AWS/ApiGateway', metricName: '5xx', dimensionsMap: { ApiId: props.httpApi.apiId }, statistic: 'Sum', period: Duration.minutes(5), label: 'HTTP API 5xx' }),
          new Metric({ namespace: 'AWS/ApiGateway', metricName: 'Latency', dimensionsMap: { ApiId: props.httpApi.apiId }, statistic: 'p90', period: Duration.minutes(5), label: 'p90 latency' }),
        ],
        width: 8,
        height: 6,
      }),
      new GraphWidget({ title: 'Dead-letter queue depth (must be 0)', left: dlqDepths, width: 8, height: 6 }),
    );

    new Alarm(this, 'ExecutionsFailed', {
      alarmName: 'fc-pipeline-executions-failed',
      metric: failed,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription: 'A case pipeline execution failed. The CaseFailed event on the record names the taxonomy code.',
    });
    new Alarm(this, 'ResidualNonZero', {
      alarmName: 'fc-reconciliation-residual',
      metric: residual,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription: 'A reconciliation left a non-zero residual: the invariant needed its escape hatch.',
    });
    new Alarm(this, 'UnresolvedHigh', {
      alarmName: 'fc-unresolved-rate-high',
      metric: unresolved,
      threshold: 25,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription: 'More than a quarter of the bill is landing in UNRESOLVED; extraction or normalisation is degrading.',
    });
    if (dlqDepths.length > 0) {
      new Alarm(this, 'DeadLetters', {
        alarmName: 'fc-dead-letter-depth',
        metric: new MathExpression({
          expression: dlqDepths.map((_, i) => `m${i}`).join(' + '),
          usingMetrics: Object.fromEntries(dlqDepths.map((m, i) => [`m${i}`, m])),
          period: Duration.minutes(1),
          label: 'DLQ depth',
        }),
        threshold: 0,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: TreatMissingData.NOT_BREACHING,
        alarmDescription: 'Something landed in a dead-letter queue. Nothing disappears silently.',
      });
    }

    new CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.dashboard.dashboardName}`,
    });
  }
}
