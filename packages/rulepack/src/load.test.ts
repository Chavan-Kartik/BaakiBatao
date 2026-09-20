import { describe, expect, it } from 'vitest';
import { loadRulepackV1, normaliseAlias } from './load';

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

  /**
   * The implementation target is roughly sixty categories: enough that a real
   * itemised bill resolves at tier 1 most of the time, rather than escalating
   * every second line to a model.
   */
  it('carries roughly sixty categories, every one with aliases', () => {
    const cats = Object.values(pack.categories);
    expect(cats.length).toBeGreaterThanOrEqual(60);
    for (const cat of cats) {
      expect(cat.aliases.length, `${cat.categoryId} has no aliases`).toBeGreaterThan(0);
    }
  });

  /**
   * The clause a category cites must say what the finding will use it to say.
   * An exclusion from the AME base has to be grounded in a clause whose effect
   * is EXCLUDE_FROM_AME; an immune category in one whose effect is
   * IMMUNE_TO_PROPORTIONATE. Anything else is a citation that reads wrong.
   */
  it('grounds every AME exclusion in a clause with the matching effect', () => {
    for (const cat of Object.values(pack.categories)) {
      if (!cat.ameExclusionClause) continue;
      const clause = pack.clauses[cat.ameExclusionClause];
      expect(clause?.effect).toBe(
        cat.proportionateImmune ? 'IMMUNE_TO_PROPORTIONATE' : 'EXCLUDE_FROM_AME',
      );
      expect(cat.ameEligible, `${cat.categoryId} is both eligible and excluded`).toBe(false);
    }
  });

  it('only lets a rider buy back items that are actually on the non-payable list', () => {
    for (const cat of Object.values(pack.categories)) {
      if (cat.riderCanCover.length > 0) expect(cat.annexure).toBe('II');
    }
  });

  /**
   * AME eligibility is the set of things a room-category ratio can lawfully
   * touch. It is professional fees, theatre, nursing and treatment procedures
   * — never a non-payable item, and never something the circular excludes.
   */
  it('keeps AME eligibility to payable treatment charges', () => {
    for (const cat of Object.values(pack.categories)) {
      if (!cat.ameEligible) continue;
      expect(cat.annexure, `${cat.categoryId} is AME-eligible but non-payable`).toBe('I');
      expect(cat.ameExclusionClause).toBeNull();
      expect(cat.proportionateImmune).toBe(false);
    }
  });

  /**
   * Alias uniqueness has to hold on the lookup key the lexicon actually uses,
   * not on the spelling: "X-ray" and "x ray" normalise to the same key.
   */
  it('gives every category a distinct set of aliases after normalisation', () => {
    const seen = new Map<string, string>();
    for (const cat of Object.values(pack.categories)) {
      for (const alias of cat.aliases) {
        const key = normaliseAlias(alias);
        expect(seen.get(key), `alias "${alias}" collides after normalisation`).toBeUndefined();
        seen.set(key, cat.categoryId);
      }
    }
  });

  it('carries the three diagnostic sub-categories under the one diagnostics clause', () => {
    for (const id of ['DIAGNOSTICS', 'IMAGING', 'CARDIAC_DIAGNOSTICS', 'ENDOSCOPY']) {
      expect(pack.categories[id]?.ameExclusionClause, id).toBe('AME.EXCL.DIAG');
    }
  });

  it('names every clause a sub-limit in the generated corpus can cite', () => {
    for (const id of ['LIMIT.ROOM', 'LIMIT.ICU', 'LIMIT.AMBULANCE']) {
      expect(pack.clauses[id]?.effect, id).toBe('CAP');
    }
  });
});
