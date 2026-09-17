import type { Reducer } from './types';
import { UnknownReducerError } from './errors';

import { admissibility } from './steps/01-admissibility';
import { normalisationGate } from './steps/02-normalisation-gate';
import { nonPayable } from './steps/03-non-payable';
import { capsSublimits } from './steps/04-caps-sublimits';
import { proportionate } from './steps/05-proportionate';
import { copayDeductible } from './steps/06-copay-deductible';
import { sumInsured } from './steps/07-sum-insured';

/**
 * Maps the `reducer` field in the rulepack's steps.json to an implementation.
 *
 * The rulepack names a reducer; this file is the only place that resolves a
 * name to code. An unknown name fails loudly at load time rather than silently
 * skipping a step in the waterfall.
 */
const REGISTRY: Readonly<Record<string, Reducer>> = {
  '01-admissibility': admissibility,
  '02-normalisation-gate': normalisationGate,
  '03-non-payable': nonPayable,
  '04-caps-sublimits': capsSublimits,
  '05-proportionate': proportionate,
  '06-copay-deductible': copayDeductible,
  '07-sum-insured': sumInsured,
};

export const resolveReducer = (name: string): Reducer => {
  const r = REGISTRY[name];
  if (!r) {
    throw new UnknownReducerError(
      `rulepack references reducer "${name}", which is not registered`,
    );
  }
  return r;
};
