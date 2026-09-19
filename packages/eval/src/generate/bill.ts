import type { AdmissionFacts, Paise, PolicySchedule } from '@fc/contracts';
import { rupeesToPaise, unsafePaise } from '@fc/contracts';
import { chance, int, pick, type Rng } from './rng';

const R = (rupees: number): Paise => rupeesToPaise(rupees);

export interface SampledBillLine {
  readonly desc: string;
  readonly category: string;
  readonly claimed: Paise;
}

interface LineSpec {
  readonly category: string;
  readonly descs: readonly string[];
  readonly min: number;
  readonly max: number;
  readonly prevalence: number;
  readonly maxLines: number;
}

const SPECS: readonly LineSpec[] = [
  { category: 'ROOM_RENT', descs: ['Room rent', 'Bed charges'], min: 3000, max: 12000, prevalence: 1, maxLines: 1 },
  { category: 'ICU_CHARGE', descs: ['ICU charges', 'Intensive care'], min: 8000, max: 20000, prevalence: 0.35, maxLines: 1 },
  { category: 'SURGEON_FEE', descs: ['Surgeon fee', 'Surgery charges'], min: 15000, max: 60000, prevalence: 0.6, maxLines: 1 },
  { category: 'PHARMACY', descs: ['Pharmacy', 'Medicines', 'Drugs'], min: 8000, max: 90000, prevalence: 0.95, maxLines: 3 },
  { category: 'CONSUMABLE', descs: ['Surgical consumables', 'Disposables'], min: 3000, max: 30000, prevalence: 0.7, maxLines: 2 },
  { category: 'IMPLANT_DEVICE', descs: ['Stent', 'Implant', 'Lens'], min: 30000, max: 150000, prevalence: 0.2, maxLines: 1 },
  { category: 'DIAGNOSTICS', descs: ['Laboratory', 'Pathology', 'CT scan'], min: 4000, max: 60000, prevalence: 0.9, maxLines: 3 },
  { category: 'ANAESTHETIST_FEE', descs: ['Anaesthetist', 'Anesthesia charges'], min: 5000, max: 20000, prevalence: 0.5, maxLines: 1 },
  { category: 'OT_CHARGE', descs: ['OT charges', 'Operation theatre'], min: 8000, max: 25000, prevalence: 0.55, maxLines: 1 },
  { category: 'NURSING_CHARGE', descs: ['Nursing charges'], min: 2000, max: 15000, prevalence: 0.6, maxLines: 1 },
  { category: 'DOCTOR_VISIT', descs: ['Consultation', 'Doctor visit'], min: 1000, max: 12000, prevalence: 0.7, maxLines: 2 },
  { category: 'ADMIN_CHARGE', descs: ['Administrative charges', 'Medical records charges'], min: 1000, max: 9000, prevalence: 0.5, maxLines: 1 },
];

/**
 * A sampled bill, priced so that the lawful reading of it is boring.
 *
 * Two deliberate constraints come from the engine's step order:
 *
 *   Room rent is billed at, above or below the eligible rate. Above is what
 *   creates a proportionate ratio in step 5 at all.
 *
 *   An ICU line is billed within the per-day ICU cap. Billing it above would
 *   give step 4 a lawful cut to claim, so an injected proportionate cut on that
 *   line would be attributed to LIMIT.ICU and never reach PD.ICU — the harness
 *   would score its own sampling as a miss.
 */
export function sampleBillLines(
  rng: Rng,
  policy: PolicySchedule,
  admission: AdmissionFacts,
): SampledBillLine[] {
  const lines: SampledBillLine[] = [];
  const icuDays = admission.icuDays ?? 0;
  const icuCapPerDay = policy.icuCapPerDay ?? R(15_000);

  for (const spec of SPECS) {
    if (spec.category === 'ICU_CHARGE' && icuDays === 0) continue;
    if (!chance(rng, spec.prevalence)) continue;
    const n = int(rng, 1, spec.maxLines);
    for (let i = 0; i < n; i++) {
      let claimed = R(int(rng, spec.min, spec.max));
      if (spec.category === 'ROOM_RENT') {
        claimed = unsafePaise((admission.actualRoomRentPerDay ?? R(5000)) * (admission.roomDays ?? 3));
      }
      if (spec.category === 'ICU_CHARGE') {
        // Within the cap, by construction.
        const perDay = unsafePaise(Math.round((icuCapPerDay * int(rng, 60, 100)) / 100));
        claimed = unsafePaise(perDay * icuDays);
      }
      lines.push({ desc: pick(rng, spec.descs), category: spec.category, claimed });
    }
  }
  if (lines.length === 0) lines.push({ desc: 'Pharmacy', category: 'PHARMACY', claimed: R(12_000) });
  return lines;
}
