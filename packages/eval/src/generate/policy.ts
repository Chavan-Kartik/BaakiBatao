import type { AdmissionFacts, CategoryId, ClauseId, Paise, PolicySchedule } from '@fc/contracts';
import { rupeesToPaise, unsafePaise } from '@fc/contracts';
import type { Archetype } from '../types';
import { chance, int, pick, type Rng } from './rng';

const R = (rupees: number): Paise => rupeesToPaise(rupees);

export function samplePolicy(rng: Rng): PolicySchedule {
  const sumInsured = R(pick(rng, [300_000, 500_000, 750_000, 1_000_000] as const));
  const roomRentCapPerDay = R(pick(rng, [4000, 5000, 6000, 8000] as const));
  const icuCapPerDay = R(pick(rng, [10000, 12000, 15000] as const));
  const copayPercent = pick(rng, [0, 0, 10, 15, 20] as const);
  const deductible = chance(rng, 0.5) ? R(pick(rng, [0, 5000, 10000] as const)) : null;
  const hasRider = chance(rng, 0.3);

  // A per-claim ambulance cap is the commonest sub-limit on a retail policy
  // and the simplest to settle exactly, which makes it the right first
  // exercise of step 4's sub-limit path and a lawful control worth having.
  const ambulanceCap = chance(rng, 0.4) ? R(pick(rng, [1500, 2000, 3000] as const)) : null;

  return {
    insurerWordingId: pick(rng, ['eval-insurer-a', 'eval-insurer-b'] as const),
    policyStartDate: '2025-04-01',
    policyEndDate: '2026-03-31',
    productFiledOn: '2021-06-01',
    lastRenewedOn: '2025-04-01',
    sumInsured,
    sumInsuredRemaining: sumInsured,
    restoreBenefitGranted: false,
    noClaimBonus: null,
    roomRentCapPerDay,
    roomRentCapPercentOfSumInsured: null,
    eligibleRoomCategory: 'SINGLE_PRIVATE',
    icuCapPerDay,
    copayPercent,
    deductible,
    subLimits:
      ambulanceCap === null
        ? []
        : [
            {
              clauseId: 'LIMIT.AMBULANCE' as ClauseId,
              label: 'Ambulance charges',
              appliesToCategories: ['AMBULANCE' as CategoryId],
              capAmount: ambulanceCap,
              capPercentOfSumInsured: null,
              perDay: false,
            },
          ],
    waitingPeriods: [],
    riders: hasRider
      ? [
          {
            riderId: 'CONSUMABLES_RIDER',
            label: 'Consumables cover',
            effectiveFrom: '2025-04-01',
            coversCategories: ['CONSUMABLE' as CategoryId, 'PPE_KIT' as CategoryId],
          },
        ]
      : [],
    hasProportionateDeductionClause: true,
    ameDefinitionCategories: [
      'SURGEON_FEE', 'ANAESTHETIST_FEE', 'ASSISTANT_SURGEON_FEE', 'OT_CHARGE',
      'NURSING_CHARGE', 'DOCTOR_VISIT', 'PROCEDURE_CHARGE', 'DRESSING_CHARGE',
      'PHYSIOTHERAPY', 'OXYGEN', 'DIALYSIS',
      // Named in the policy's own definition and excluded by the circular
      // anyway — the two gates are independent, and a definition that lists
      // them is exactly the wording the circular was written against.
      'PHARMACY', 'CONSUMABLE', 'IMPLANT_DEVICE', 'DIAGNOSTICS', 'IMAGING',
      'CARDIAC_DIAGNOSTICS', 'ICU_CHARGE', 'VENTILATOR',
    ] as CategoryId[],
  };
}

export interface SampledAdmission {
  readonly facts: AdmissionFacts;
  readonly archetype: Archetype;
}

const ARCHETYPE_WEIGHTS: readonly (readonly [Archetype, number])[] = [
  ['MEDICAL', 0.4],
  ['MAJOR_SURGERY', 0.3],
  ['DAYCARE_SURGERY', 0.15],
  ['CRITICAL_CARE', 0.15],
];

function sampleArchetype(rng: Rng): Archetype {
  let roll = rng();
  for (const [archetype, w] of ARCHETYPE_WEIGHTS) {
    if (roll < w) return archetype;
    roll -= w;
  }
  return 'MEDICAL';
}

/**
 * Length of stay and ICU use follow the archetype; the room rate is what
 * creates a proportionate ratio in step 5 at all, so it is sampled at, above
 * or below the eligible rate independently of everything else.
 */
export function sampleAdmission(rng: Rng, policy: PolicySchedule): SampledAdmission {
  const archetype = sampleArchetype(rng);

  const roomDays =
    archetype === 'DAYCARE_SURGERY' ? 1
    : archetype === 'MAJOR_SURGERY' ? int(rng, 3, 8)
    : archetype === 'CRITICAL_CARE' ? int(rng, 2, 5)
    : int(rng, 2, 6);

  const icuDays =
    archetype === 'DAYCARE_SURGERY' ? 0
    : archetype === 'CRITICAL_CARE' ? int(rng, 2, 6)
    : archetype === 'MAJOR_SURGERY' ? (chance(rng, 0.45) ? int(rng, 1, 3) : 0)
    : chance(rng, 0.15) ? int(rng, 1, 2) : 0;

  const cap = policy.roomRentCapPerDay ?? R(5000);
  const roll = rng();
  const actualRoomRentPerDay =
    roll < 0.35
      ? cap
      : roll < 0.85
        ? unsafePaise(Math.round((cap * int(rng, 120, 200)) / 100))
        : unsafePaise(Math.round((cap * int(rng, 60, 99)) / 100));

  const admitted = new Date(Date.UTC(2025, 8, 10));
  const discharged = new Date(admitted);
  discharged.setUTCDate(admitted.getUTCDate() + roomDays + icuDays);

  return {
    archetype,
    facts: {
      admissionDate: isoDate(admitted),
      dischargeDate: isoDate(discharged),
      occupiedRoomCategory: actualRoomRentPerDay > cap ? 'DELUXE' : 'SINGLE_PRIVATE',
      actualRoomRentPerDay,
      roomDays,
      icuDays,
      hospitalUsesDifferentialBilling: true,
    },
  };
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
