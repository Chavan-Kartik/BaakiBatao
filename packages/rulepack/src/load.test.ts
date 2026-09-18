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
    expect(pack.categories['PHARMACY']?.ameEligible).toBe(false);
    expect(pack.categories['PHARMACY']?.ameExclusionClause).toBe('AME.EXCL.PHARMA');
    expect(pack.categories['IMPLANT_DEVICE']?.ameExclusionClause).toBe('AME.EXCL.IMPLANT');
    expect(pack.categories['DIAGNOSTICS']?.ameExclusionClause).toBe('AME.EXCL.DIAG');
  });

  /**
   * The circular excludes "pharmacy and consumables" from AME as a single
   * phrase, so both halves carry the same clause. Payability is a separate
   * question the circular says nothing about, and the two halves answer it
   * differently.
   */
  it('excludes both halves of "pharmacy and consumables" from AME under one clause', () => {
    expect(pack.categories['PHARMACY']?.ameExclusionClause).toBe('AME.EXCL.PHARMA');
    expect(pack.categories['CONSUMABLE']?.ameExclusionClause).toBe('AME.EXCL.PHARMA');
  });

  /**
   * The §3 trap, encoded in the data: consumables are exempt from proportionate
   * deduction AND still on the non-payable list. Exemption from PD does not
   * mean payable — that is why it needs both properties.
   */
  it('keeps consumables both PD-exempt and Annexure II, because those are independent', () => {
    const consumable = pack.categories['CONSUMABLE'];
    expect(consumable?.ameExclusionClause).toBe('AME.EXCL.PHARMA');
    expect(consumable?.annexure).toBe('II');
    expect(consumable?.riderCanCover).toContain('CONSUMABLES_RIDER');
  });

  /**
   * Prescribed drugs are payable. A single pharmacy-and-consumables category
   * would have had to call them non-payable, which would tell every
   * policyholder their medicines were lawfully disallowed.
   */
  it('keeps pharmacy payable while still exempting it from proportionate deduction', () => {
    expect(pack.categories['PHARMACY']?.annexure).toBe('I');
    expect(pack.categories['PHARMACY']?.riderCanCover).toEqual([]);
  });

  /**
   * A bill line lumped as "pharmacy & consumables" spans a payable and a
   * non-payable category, so it must reach the unresolved bucket rather than be
   * resolved by whichever category we happened to give the alias to.
   */
  it('claims no alias for the ambiguous combined pharmacy-and-consumables line', () => {
    const aliases = Object.values(pack.categories).flatMap((c) => c.aliases);
    for (const ambiguous of aliases.filter((a) => /pharmac|drug/.test(a))) {
      expect(ambiguous, `"${ambiguous}" resolves an ambiguous line by fiat`).not.toMatch(
        /consumable/,
      );
    }
  });

  it('gives every category a distinct set of aliases', () => {
    const seen = new Map<string, string>();
    for (const cat of Object.values(pack.categories)) {
      for (const alias of cat.aliases) {
        expect(seen.get(alias), `alias "${alias}" is claimed twice`).toBeUndefined();
        seen.set(alias, cat.categoryId);
      }
    }
  });

  it('has no dangling clause references', () => {
    for (const cat of Object.values(pack.categories)) {
      if (cat.ameExclusionClause) {
        expect(pack.clauses[cat.ameExclusionClause]).toBeDefined();
      }
    }
  });
});
