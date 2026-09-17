import { describe, expect, it } from 'vitest';
import { loadRulepackV1 } from './load';

describe('rulepack v1', () => {
  const pack = loadRulepackV1();

  it('validates and loads', () => {
    expect(pack.version).toBe('v1');
    expect(pack.steps).toHaveLength(7);
  });

  it('puts proportionate deduction at step 5 of 7 — it is not the thesis', () => {
    expect(pack.steps[4]?.id).toBe('PROPORTIONATE');
  });

  it('checks riders before cutting anything in step 3', () => {
    const nonPayable = pack.steps.find((s) => s.id === 'NON_PAYABLE');
    expect(nonPayable?.params['checkRidersFirst']).toBe(true);
  });

  it('encodes all four bright-line tests from the 2020 circular', () => {
    for (const id of [
      'AME.EXCL.PHARMA',
      'AME.EXCL.IMPLANT',
      'AME.EXCL.DIAG',
      'PD.LIMIT',
      'PD.ICU',
      'PD.DIFFBILL',
    ]) {
      expect(pack.clauses[id], `missing clause ${id}`).toBeDefined();
      expect(pack.clauses[id]?.source).toBe('IRDAI/HLT/REG/CIR/151/06/2020');
    }
  });

  it('dates the circular so it is never applied to an older policy', () => {
    expect(pack.clauses['AME.EXCL.PHARMA']?.appliesFrom).toBe('2020-10-01');
    expect(pack.clauses['AME.EXCL.PHARMA']?.appliesToExistingOnRenewalFrom).toBe('2021-04-01');
  });

  it('marks ICU immune to proportionate deduction', () => {
    expect(pack.categories['ICU_CHARGE']?.proportionateImmune).toBe(true);
  });

  it('excludes pharmacy, implants and diagnostics from AME with a citable clause each', () => {
    expect(pack.categories['PHARMACY_CONSUMABLE']?.ameEligible).toBe(false);
    expect(pack.categories['PHARMACY_CONSUMABLE']?.ameExclusionClause).toBe('AME.EXCL.PHARMA');
    expect(pack.categories['IMPLANT_DEVICE']?.ameExclusionClause).toBe('AME.EXCL.IMPLANT');
    expect(pack.categories['DIAGNOSTICS']?.ameExclusionClause).toBe('AME.EXCL.DIAG');
  });

  /**
   * The §3 trap, encoded in the data: pharmacy is exempt from proportionate
   * deduction AND still on the non-payable list. Exemption from PD does not
   * mean payable — that is why it needs both properties.
   */
  it('keeps pharmacy both PD-exempt and Annexure II, because those are independent', () => {
    const pharma = pack.categories['PHARMACY_CONSUMABLE'];
    expect(pharma?.ameExclusionClause).toBe('AME.EXCL.PHARMA');
    expect(pharma?.annexure).toBe('II');
    expect(pharma?.riderCanCover).toContain('CONSUMABLES_RIDER');
  });

  it('has no dangling clause references', () => {
    for (const cat of Object.values(pack.categories)) {
      if (cat.ameExclusionClause) {
        expect(pack.clauses[cat.ameExclusionClause]).toBeDefined();
      }
    }
  });
});
