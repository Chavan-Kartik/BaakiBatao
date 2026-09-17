import type { Finding } from '@fc/contracts';
import type { ReducerContext, WaterfallState } from './state';

/**
 * Every step is a pure function of the same shape:
 *   (state, rules, policy) → state' plus a list of findings.
 * See project brief §5.
 *
 * This type lives here rather than in registry.ts so the steps can depend on
 * the contract without depending on the registry that collects them — the
 * registry imports the steps, so the reverse would be a cycle.
 */
export type Reducer = (
  state: WaterfallState,
  ctx: ReducerContext,
) => readonly [WaterfallState, readonly Finding[]];
