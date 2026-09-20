import type { AdmissionFacts, Paise, PolicySchedule } from '@fc/contracts';
import { rupeesToPaise, unsafePaise } from '@fc/contracts';
import { loadRulepackV1 } from '@fc/rulepack';
import type { Archetype } from '../types';
import { chance, int, pick, type Rng } from './rng';

const R = (rupees: number): Paise => rupeesToPaise(rupees);
const rulepack = loadRulepackV1();

export interface SampledBillLine {
  readonly desc: string;
  readonly category: string;
  readonly claimed: Paise;
}

/** One category's presence in a bill: how likely, how many lines, what size. */
interface Draw {
  readonly category: string;
  readonly p: number;
  readonly lines: readonly [number, number];
  readonly rupees: readonly [number, number];
}

const d = (
  category: string,
  p: number,
  rupees: readonly [number, number],
  lines: readonly [number, number] = [1, 1],
): Draw => ({ category, p, lines, rupees });

/**
 * What every admission can carry, regardless of kind: the incidental and
 * non-payable lines a hospital prints on the way out. Low prevalences, because
 * a bill with all of them would be a parody.
 */
const INCIDENTALS: readonly Draw[] = [
  d('REGISTRATION_FEE', 0.6, [500, 2000]),
  d('ADMIN_CHARGE', 0.5, [1000, 9000]),
  d('FOOD_BEVERAGE', 0.25, [300, 3000]),
  d('PATIENT_DIET', 0.3, [500, 4000]),
  d('PPE_KIT', 0.4, [500, 4000]),
  d('TOILETRIES', 0.15, [200, 1500]),
  d('LINEN_BEDDING', 0.1, [200, 1200]),
  d('ADMISSION_KIT', 0.15, [300, 1500]),
  d('ATTENDANT_CHARGE', 0.1, [500, 3000]),
  d('LAUNDRY', 0.08, [200, 1500]),
  d('TELEPHONE_INTERNET', 0.05, [100, 800]),
  d('INJECTION_CHARGE', 0.15, [300, 3000]),
  d('PULSE_OXIMETER', 0.1, [300, 2500]),
  d('DAILY_CHART', 0.05, [100, 600]),
  d('HOUSEKEEPING_HVAC', 0.1, [500, 4000]),
  d('CERTIFICATE_CHARGE', 0.1, [200, 1000]),
  d('MINERAL_WATER', 0.1, [100, 600]),
  d('DISCHARGE_PROCESSING', 0.05, [300, 1500]),
  d('SURCHARGE', 0.05, [500, 3000]),
];

/** The surgical bundle. Its members are correlated: no implant without a surgeon and a theatre. */
interface Surgical {
  readonly p: number;
  readonly surgeon: readonly [number, number];
  readonly theatre: readonly [number, number];
  readonly anaesthetist: number;
  readonly assistant: number;
  readonly implant: number;
  readonly implantRupees: readonly [number, number];
}

interface Plan {
  readonly surgical: Surgical | null;
  readonly clinical: readonly Draw[];
  readonly ambulance: number;
}

/**
 * Bill composition by admission archetype. Per-day lines (pharmacy, doctor
 * visits, nursing) scale with the length of stay, and each archetype has the
 * treatment lines it would actually have: theatre and implants only with
 * surgery, ventilator and dialysis only in critical care.
 */
function planFor(archetype: Archetype, days: number): Plan {
  const perDay = (max: number): readonly [number, number] => [1, Math.max(1, Math.min(days, max))];

  switch (archetype) {
    case 'MEDICAL':
      return {
        surgical: null,
        ambulance: 0.2,
        clinical: [
          d('PHARMACY', 0.98, [2000, 30000], perDay(5)),
          d('DOCTOR_VISIT', 0.9, [800, 4000], perDay(3)),
          d('NURSING_CHARGE', 0.8, [500 * days, 3000 * days]),
          d('DIAGNOSTICS', 0.9, [1500, 20000], [1, 3]),
          d('IMAGING', 0.5, [2000, 15000], [1, 2]),
          d('CARDIAC_DIAGNOSTICS', 0.3, [800, 6000]),
          d('CONSUMABLE', 0.5, [1000, 15000], [1, 2]),
          d('OXYGEN', 0.2, [1000, 8000]),
          d('EQUIPMENT_CHARGE', 0.2, [1000, 8000]),
          d('DRESSING_CHARGE', 0.1, [500, 3000]),
          d('PROCEDURE_CHARGE', 0.2, [1500, 12000]),
          d('PHYSIOTHERAPY', 0.15, [1000, 6000]),
          d('BLOOD_PRODUCT', 0.05, [3000, 15000]),
        ],
      };
    case 'DAYCARE_SURGERY':
      return {
        surgical: {
          p: 1,
          surgeon: [15000, 60000],
          theatre: [8000, 25000],
          anaesthetist: 0.9,
          assistant: 0.25,
          implant: 0.45,
          implantRupees: [8000, 40000],
        },
        ambulance: 0.05,
        clinical: [
          d('PHARMACY', 0.9, [1500, 12000]),
          d('CONSUMABLE', 0.9, [1500, 12000], [1, 2]),
          d('DOCTOR_VISIT', 0.5, [800, 3000]),
          d('NURSING_CHARGE', 0.5, [500, 2500]),
          d('DIAGNOSTICS', 0.6, [1000, 8000], [1, 2]),
          d('CARDIAC_DIAGNOSTICS', 0.4, [800, 3000]),
          d('DRESSING_CHARGE', 0.3, [500, 2500]),
        ],
      };
    case 'MAJOR_SURGERY':
      return {
        surgical: {
          p: 1,
          surgeon: [40000, 150000],
          theatre: [15000, 60000],
          anaesthetist: 0.95,
          assistant: 0.4,
          implant: 0.55,
          implantRupees: [30000, 150000],
        },
        ambulance: 0.2,
        clinical: [
          d('PHARMACY', 0.98, [5000, 50000], perDay(5)),
          d('CONSUMABLE', 0.95, [3000, 30000], [1, 3]),
          d('DOCTOR_VISIT', 0.9, [1000, 5000], perDay(3)),
          d('NURSING_CHARGE', 0.85, [800 * days, 3500 * days]),
          d('DIAGNOSTICS', 0.9, [2000, 25000], [1, 3]),
          d('IMAGING', 0.6, [3000, 20000], [1, 2]),
          d('CARDIAC_DIAGNOSTICS', 0.4, [800, 6000]),
          d('BLOOD_PRODUCT', 0.25, [4000, 25000]),
          d('PHYSIOTHERAPY', 0.35, [1500, 9000]),
          d('DRESSING_CHARGE', 0.4, [800, 5000]),
          d('OXYGEN', 0.3, [1500, 10000]),
          d('EQUIPMENT_CHARGE', 0.3, [2000, 12000]),
          d('THEATRE_BOOKING', 0.1, [1000, 5000]),
          d('EQUIPMENT_COVER', 0.1, [500, 3000]),
          d('MEDIA_FILM', 0.1, [300, 2000]),
        ],
      };
    case 'CRITICAL_CARE':
      return {
        surgical: {
          p: 0.25,
          surgeon: [30000, 120000],
          theatre: [12000, 50000],
          anaesthetist: 0.95,
          assistant: 0.3,
          implant: 0.2,
          implantRupees: [30000, 150000],
        },
        ambulance: 0.5,
        clinical: [
          d('PHARMACY', 1, [10000, 80000], [1, 4]),
          d('DOCTOR_VISIT', 0.95, [1500, 6000], [2, 3]),
          d('NURSING_CHARGE', 0.9, [1000 * days, 4000 * days]),
          d('DIAGNOSTICS', 1, [3000, 30000], [2, 4]),
          d('IMAGING', 0.7, [3000, 25000], [1, 2]),
          d('CARDIAC_DIAGNOSTICS', 0.5, [1000, 8000]),
          d('VENTILATOR', 0.5, [5000, 40000]),
          d('DIALYSIS', 0.2, [8000, 40000]),
          d('BLOOD_PRODUCT', 0.3, [5000, 30000]),
          d('CONSUMABLE', 0.9, [3000, 30000], [1, 3]),
          d('OXYGEN', 0.5, [2000, 15000]),
          d('EQUIPMENT_CHARGE', 0.5, [3000, 20000]),
          d('PROCEDURE_CHARGE', 0.4, [2000, 15000]),
          d('DRESSING_CHARGE', 0.2, [800, 4000]),
        ],
      };
  }
}

/**
 * A sampled bill, priced so that the lawful reading of it is boring.
 *
 * Room rent is billed at, above or below the eligible rate. Above is what
 * creates a proportionate ratio in step 5 at all.
 *
 * ICU and ambulance are billed above their caps some of the time on purpose:
 * those lawful cuts are the `lawful-icu-cap` and `lawful-sublimit` controls.
 * The fault operators skip any line that already carries a cut of another
 * kind — the engine's step 4 owns the excess on a line it capped and would
 * cite the cap clause, which is true of the rupees but not the clause under
 * test — so a capped ICU line is a control, never a fault site.
 */
export function sampleBillLines(
  rng: Rng,
  policy: PolicySchedule,
  admission: AdmissionFacts,
  archetype: Archetype,
): SampledBillLine[] {
  const lines: SampledBillLine[] = [];
  const icuDays = admission.icuDays ?? 0;
  const roomDays = admission.roomDays ?? 1;
  const icuCapPerDay = policy.icuCapPerDay ?? R(15_000);
  const plan = planFor(archetype, roomDays);
  const describe = describer(rng);

  const push = (category: string, claimed: Paise, day: number | null = null): void => {
    lines.push({ desc: describe(category, day), category, claimed });
  };

  push('ROOM_RENT', unsafePaise((admission.actualRoomRentPerDay ?? R(5000)) * roomDays));

  if (icuDays > 0) {
    const perDay = unsafePaise(Math.round((icuCapPerDay * int(rng, 60, chance(rng, 0.3) ? 150 : 100)) / 100));
    push('ICU_CHARGE', unsafePaise(perDay * icuDays));
  }

  if (plan.surgical && chance(rng, plan.surgical.p)) {
    const s = plan.surgical;
    push('SURGEON_FEE', R(int(rng, ...s.surgeon)));
    push('OT_CHARGE', R(int(rng, ...s.theatre)));
    if (chance(rng, s.anaesthetist)) {
      push('ANAESTHETIST_FEE', R(Math.round(int(rng, ...s.surgeon) * 0.3)));
    }
    if (chance(rng, s.assistant)) {
      push('ASSISTANT_SURGEON_FEE', R(Math.round(int(rng, ...s.surgeon) * 0.2)));
    }
    if (chance(rng, s.implant)) push('IMPLANT_DEVICE', R(int(rng, ...s.implantRupees)));
  }

  for (const draw of plan.clinical) {
    if (!chance(rng, draw.p)) continue;
    const n = int(rng, draw.lines[0], draw.lines[1]);
    for (let i = 0; i < n; i++) {
      push(draw.category, R(int(rng, draw.rupees[0], draw.rupees[1])), n > 1 ? i + 1 : null);
    }
  }

  if (chance(rng, plan.ambulance)) {
    const cap = policy.subLimits.find((s) => s.appliesToCategories.includes('AMBULANCE' as never));
    const capRupees = cap?.capAmount != null ? cap.capAmount / 100 : null;
    const rupees =
      capRupees !== null && chance(rng, 0.5)
        ? int(rng, capRupees + 500, capRupees + 4000)
        : int(rng, 800, capRupees ?? 4000);
    push('AMBULANCE', R(rupees));
  }

  for (const draw of INCIDENTALS) {
    if (chance(rng, draw.p)) push(draw.category, R(int(rng, draw.rupees[0], draw.rupees[1])));
  }

  return lines;
}

/* ------------------------------------------------------------ descriptions */

/**
 * Free text no lexicon alias will ever match: the drug, the test, the item.
 * Real bills are full of it, and in the degraded profile these are the lines
 * that must escalate rather than be guessed.
 */
const FREE_TEXT: Readonly<Record<string, readonly string[]>> = {
  PHARMACY: [
    'Inj Pantoprazole 40mg', 'Tab Augmentin 625', 'Inj Ceftriaxone 1g', 'IV Paracetamol 1g',
    'Cap Omeprazole 20mg', 'Inj Ondansetron 4mg', 'Tab Metformin 500', 'Inj Enoxaparin 40mg',
  ],
  DIAGNOSTICS: [
    'CBC with ESR', 'Serum Creatinine', 'Blood Sugar Fasting', 'Urine Routine',
    'Serum Electrolytes', 'CRP Quantitative', 'Prothrombin Time',
  ],
  IMAGING: ['CT Brain Plain', 'USG Abdomen and Pelvis', 'Chest PA View', 'MRI Lumbar Spine'],
  CONSUMABLE: ['Foley Catheter 16F', 'Suction Catheter', 'Betadine Solution 500ml', 'Sterile Gloves 7.5'],
  IMPLANT_DEVICE: ['Xience Sierra 3.0x18', 'Acrysof IQ IOL', 'Titanium Plate 6 Hole'],
  CARDIAC_DIAGNOSTICS: ['12 Lead Tracing', 'Colour Doppler Study'],
};

const styles = ['ALIAS', 'ALIAS', 'ALIAS', 'ALIAS', 'ALIAS', 'ALIAS', 'SUFFIX', 'SUFFIX', 'FREE'] as const;

/**
 * How a hospital would print the line. Mostly a lexicon alias in some casing;
 * sometimes an alias with the day or the count tacked on; sometimes free text.
 * Aliases within a category are drawn without replacement, so two pharmacy
 * lines never share a description and an amount — the sheet matcher pairs
 * rows on exactly those two things.
 */
function describer(rng: Rng): (category: string, day: number | null) => string {
  const used = new Map<string, Set<string>>();

  return (category, day) => {
    const aliases = rulepack.categories[category]?.aliases ?? [category.toLowerCase()];
    const taken = used.get(category) ?? new Set<string>();
    used.set(category, taken);

    const fresh = aliases.filter((a) => !taken.has(a));
    const alias = pick(rng, fresh.length > 0 ? fresh : aliases);
    taken.add(alias);

    let style = pick(rng, styles);
    if (style === 'FREE' && !FREE_TEXT[category]) style = 'SUFFIX';

    const cased = casing(rng, alias);
    switch (style) {
      case 'FREE':
        return pick(rng, FREE_TEXT[category] ?? [alias]);
      case 'SUFFIX': {
        const n = day ?? int(rng, 1, 5);
        return pick(rng, [`${cased} - Day ${n}`, `${cased} (${n})`, `${cased} x ${n}`, `${cased} : Dt ${n}`]);
      }
      default:
        return day !== null && chance(rng, 0.5) ? `${cased} ${day}` : cased;
    }
  };
}

function casing(rng: Rng, s: string): string {
  const roll = rng();
  if (roll < 0.4) return s.replace(/\b\w/g, (c) => c.toUpperCase());
  if (roll < 0.6) return s.toUpperCase();
  return s;
}
