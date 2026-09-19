import type { AdmissionFacts, CategoryId, Paise, PolicySchedule } from '@fc/contracts';
import { rupeesToPaise, unsafePaise } from '@fc/contracts';
import { chance, int, pick, type Rng } from './rng';

const R = (rupees: number): Paise => rupeesToPaise(rupees);

export function samplePolicy(rng: Rng): PolicySchedule {
  const sumInsured = R(pick(rng, [300_000, 500_000, 750_000, 1_000_000] as const));
  const roomRentCapPerDay = R(pick(rng, [4000, 5000, 6000, 8000] as const));
  const icuCapPerDay = R(pick(rng, [10000, 12000, 15000] as const));
  const copayPercent = pick(rng, [0, 0, 10, 15, 20] as const);
  const deductible = chance(rng, 0.5) ? R(pick(rng, [0, 5000, 10000] as const)) : null;
  const hasRider = chance(rng, 0.3);

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
    subLimits: [],
    waitingPeriods: [],
    riders: hasRider
      ? [
          {
            riderId: 'CONSUMABLES_RIDER',
            label: 'Consumables cover',
            effectiveFrom: '2025-04-01',
            coversCategories: ['CONSUMABLE' as CategoryId],
          },
        ]
      : [],
    hasProportionateDeductionClause: true,
    ameDefinitionCategories: [
      'SURGEON_FEE', 'ANAESTHETIST_FEE', 'OT_CHARGE', 'NURSING_CHARGE',
      'DOCTOR_VISIT', 'PHARMACY', 'CONSUMABLE', 'IMPLANT_DEVICE',
      'DIAGNOSTICS', 'ICU_CHARGE',
    ] as CategoryId[],
  };
}

export function sampleAdmission(rng: Rng, policy: PolicySchedule): AdmissionFacts {
  const icuDays = chance(rng, 0.35) ? int(rng, 1, 3) : 0;
  const roomDays = int(rng, 2, 7);
  const cap = policy.roomRentCapPerDay ?? R(5000);
  const roll = rng();
  const actualRoomRentPerDay =
    roll < 0.35
      ? cap
      : roll < 0.85
        ? unsafePaise(Math.round((cap * int(rng, 120, 200)) / 100))
        : unsafePaise(Math.round((cap * int(rng, 60, 99)) / 100));

  return {
    admissionDate: '2025-09-10',
    dischargeDate: '2025-09-17',
    occupiedRoomCategory: actualRoomRentPerDay > cap ? 'DELUXE' : 'SINGLE_PRIVATE',
    actualRoomRentPerDay,
    roomDays,
    icuDays,
    hospitalUsesDifferentialBilling: true,
  };
}
