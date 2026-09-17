/**
 * The engine fails loudly rather than returning a plausible number it cannot
 * defend. These are the only ways it refuses.
 */

export class RulepackError extends Error {
  override readonly name: string = 'RulepackError';
}

/**
 * Thrown when a finding claims CORRECTLY_APPLIED or INCORRECTLY_APPLIED without
 * a clause ID. A finding without a clause ID is not a finding — it is an
 * opinion, and it belongs in the unresolved bucket. See project brief §17.
 */
export class UncitedFindingError extends RulepackError {
  override readonly name = 'UncitedFindingError';
}

/**
 * Thrown only if residual materialisation itself fails to balance the ledger —
 * i.e. a bug in the invariant, not an unexplained rupee. An unexplained rupee is
 * a normal outcome and becomes an UNRESOLVED finding.
 */
export class ReconciliationResidualError extends Error {
  override readonly name: string = 'ReconciliationResidualError';
  constructor(
    message: string,
    readonly residual: number,
  ) {
    super(message);
  }
}

export class UnknownReducerError extends RulepackError {
  override readonly name = 'UnknownReducerError';
}
