/**
 * @fc/engine — the deterministic core.
 *
 * PURE. No AWS SDK, no Node built-ins, no I/O. Enforced by eslint,
 * dependency-cruiser and a required CI check (the build spec §4.2).
 *
 * That purity is not hygiene for its own sake. It is what lets this exact
 * module run in Lambda as the authority and in the browser for instant what-if
 * simulation, and what keeps the Build It fallback an hour's work.
 */
export { reconstruct, initialState } from './interpreter';
export type { ReconstructOptions } from './interpreter';
export { balanceLedger, sumByBucket } from './reconcile/invariant';
export { applyRatio, survivingShare, percentOf } from './money';
export { resolveReducer } from './registry';
export { matchDeductionSheet, normaliseDescription, classifyReasonCode } from './insurer';
export type { InsurerView, InsurerByLine, InsurerLineOutcome, ClaimLevelCut } from './insurer';
export type { Reducer } from './types';
export type { LineState, WaterfallState, ReducerContext } from './state';
export { sumAllowed, sumClaimed, reduceLine, emptyState } from './state';
export { ENGINE_VERSION } from './version';
export {
  RulepackError,
  UncitedFindingError,
  ReconciliationResidualError,
  UnknownReducerError,
} from './errors';
