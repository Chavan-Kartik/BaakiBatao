import { z } from 'zod';
import { CategoryId, ClauseId } from './ids';
import { Paise } from './money';

/**
 * Read from *this* schedule, never a generic template.
 *
 * Every field is nullable on purpose: a value we could not extract must stay
 * null so step 4 can emit UNRESOLVED / MISSING_POLICY_SCHEDULE rather than
 * assume the limit does not exist.
 */
export const RoomCategory = z.enum([
  'GENERAL_WARD',
  'SHARED_TWIN',
  'SINGLE_PRIVATE',
  'DELUXE',
  'SUITE',
  'ICU',
]);
export type RoomCategory = z.infer<typeof RoomCategory>;

export const SubLimit = z.object({
  clauseId: ClauseId,
  label: z.string(),
  appliesToCategories: z.array(CategoryId),
  capAmount: Paise.nullable(),
  capPercentOfSumInsured: z.number().min(0).max(100).nullable(),
  perDay: z.boolean(),
});
export type SubLimit = z.infer<typeof SubLimit>;

export const WaitingPeriod = z.object({
  clauseId: ClauseId,
  label: z.string(),
  months: z.number().int().nonnegative(),
  appliesToConditions: z.array(z.string()),
});
export type WaitingPeriod = z.infer<typeof WaitingPeriod>;

export const Rider = z.object({
  riderId: z.string(),
  label: z.string(),
  effectiveFrom: z.string().date(),
  /** Categories this rider rescues from the non-payable list in step 3. */
  coversCategories: z.array(CategoryId),
});
export type Rider = z.infer<typeof Rider>;

export const PolicySchedule = z.object({
  insurerWordingId: z.string(),
  policyStartDate: z.string().date().nullable(),
  policyEndDate: z.string().date().nullable(),
  /**
   * Load-bearing for the 2020 circular: it binds products filed from
   * 2020-10-01 and existing products on renewal from 2021-04-01. Applying it to
   * a policy predating that would be exactly the confident-wrong answer we
   * claim not to produce. See build spec §9.1.
   */
  productFiledOn: z.string().date().nullable(),
  lastRenewedOn: z.string().date().nullable(),

  sumInsured: Paise.nullable(),
  sumInsuredRemaining: Paise.nullable(),
  restoreBenefitGranted: z.boolean(),
  noClaimBonus: Paise.nullable(),

  roomRentCapPerDay: Paise.nullable(),
  roomRentCapPercentOfSumInsured: z.number().min(0).max(100).nullable(),
  eligibleRoomCategory: RoomCategory.nullable(),
  icuCapPerDay: Paise.nullable(),

  copayPercent: z.number().min(0).max(100).nullable(),
  deductible: Paise.nullable(),

  subLimits: z.array(SubLimit),
  waitingPeriods: z.array(WaitingPeriod),
  riders: z.array(Rider),

  /**
   * Whether the wording contains a proportionate-deduction clause at all, and
   * which categories its own definition of "associate medical expenses" covers.
   * Gate A and gate C of step 5. See build spec §7.6.
   */
  hasProportionateDeductionClause: z.boolean().nullable(),
  ameDefinitionCategories: z.array(CategoryId),
});
export type PolicySchedule = z.infer<typeof PolicySchedule>;

/** Facts about the admission itself, read off the bill and settlement letter. */
export const AdmissionFacts = z.object({
  admissionDate: z.string().date().nullable(),
  dischargeDate: z.string().date().nullable(),
  occupiedRoomCategory: RoomCategory.nullable(),
  actualRoomRentPerDay: Paise.nullable(),
  roomDays: z.number().int().nonnegative().nullable(),
  icuDays: z.number().int().nonnegative().nullable(),
  /**
   * Gate B of step 5. `null` means unknown, which routes to
   * UNRESOLVED / HOSPITAL_BILLING_MODE_UNKNOWN — never assumed either way.
   */
  hospitalUsesDifferentialBilling: z.boolean().nullable(),
});
export type AdmissionFacts = z.infer<typeof AdmissionFacts>;
