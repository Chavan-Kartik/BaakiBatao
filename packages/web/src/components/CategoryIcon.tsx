import {
  Ambulance,
  BedDouble,
  Bolt,
  CircleDashed,
  ClipboardList,
  FlaskConical,
  HeartPulse,
  Microscope,
  Package,
  Pill,
  Scan,
  Scissors,
  Stethoscope,
  Syringe,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * A glyph per billing category. Not decoration: a bill is scanned, not read,
 * and the icon is what lets a reader find the room-rent line without parsing
 * fourteen descriptions. An uncategorised line gets a dashed circle, because
 * the product's whole claim is that it says so when it does not know.
 */
const ICON: Record<string, LucideIcon> = {
  ROOM_RENT: BedDouble,
  ICU_CHARGE: HeartPulse,
  SURGEON_FEE: Scissors,
  ANAESTHETIST_FEE: Syringe,
  OT_CHARGE: Stethoscope,
  PHARMACY: Pill,
  CONSUMABLE: Package,
  IMPLANT_DEVICE: Bolt,
  DIAGNOSTICS: Microscope,
  IMAGING: Scan,
  CARDIAC_DIAGNOSTICS: HeartPulse,
  ADMIN_CHARGE: ClipboardList,
  NURSING_CHARGE: Stethoscope,
  DOCTOR_VISIT: Stethoscope,
  AMBULANCE: Ambulance,
  VENTILATOR: Wind,
  LABORATORY: FlaskConical,
};

export function CategoryIcon({
  category,
  className,
  tone = 'default',
}: {
  category: string | null;
  className?: string;
  tone?: 'default' | 'disputed' | 'unresolved';
}) {
  const Icon = (category && ICON[category]) || CircleDashed;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-lg border',
        tone === 'disputed'
          ? 'border-disputed/25 bg-disputed-soft text-disputed'
          : tone === 'unresolved'
            ? 'border-unresolved/25 bg-unresolved-soft text-unresolved'
            : 'border-border bg-canvas text-text-2',
        className,
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </span>
  );
}
