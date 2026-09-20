import { useEffect, useState } from 'react';
import { BRAND_MARK } from '../../lib/brand';

/**
 * The landing page's entrance.
 *
 * Two beats. First the wordmark is scanned in: a solid block sweeps across
 * the letters and each one lights as it passes. Then a band of three accent
 * stripes leads the black panel off to the right and the page is underneath.
 * About two seconds, all of it in CSS (`intro-*` keyframes in index.css);
 * React only decides whether to mount it and when to unmount it.
 *
 * Plays once per full page load. Hash navigation back to `#/` remounts the
 * landing but not the intro — the module-level flag survives that, and only
 * a reload resets it. Reduced-motion users never see it.
 */

const LETTERS = BRAND_MARK.split('');

/** Per-letter beat. Letters × 70ms is the sweep; the wipe follows it. */
const STEP_MS = 70;
const SCAN_MS = LETTERS.length * STEP_MS;
const WIPE_DELAY_MS = SCAN_MS + 320;
const WIPE_MS = 820;
const TOTAL_MS = WIPE_DELAY_MS + WIPE_MS;

let played = false;

function shouldPlay(): boolean {
  if (played) return false;
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {
    /* matchMedia unavailable: play. */
  }
  return true;
}

export function IntroLoader() {
  const [active, setActive] = useState(shouldPlay);

  useEffect(() => {
    if (!active) return;
    played = true;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    const t = window.setTimeout(() => setActive(false), TOTAL_MS);
    return () => {
      window.clearTimeout(t);
      root.style.overflow = prev;
    };
  }, [active]);

  if (!active) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[100] overflow-hidden"
      style={
        {
          '--intro-scan': `${SCAN_MS}ms`,
          '--intro-wipe-delay': `${WIPE_DELAY_MS}ms`,
          '--intro-wipe': `${WIPE_MS}ms`,
        } as React.CSSProperties
      }
    >
      {/* The panel and its leading stripes leave together. */}
      <div className="intro-panel absolute inset-0 bg-[#0b0b0b]">
        <div className="absolute inset-y-0 right-full flex w-[34vw]">
          <div className="flex-1 bg-[#5eead4]" />
          <div className="flex-1 bg-[#14b8a6]" />
          <div className="flex-1 bg-[#0f766e]" />
        </div>

        <div className="flex h-full items-center justify-center">
          <span className="relative inline-block font-geist text-[clamp(28px,3.4vw,44px)] font-bold leading-none tracking-[-0.05em] text-[#fbfbf9]">
            {LETTERS.map((ch, i) => (
              <span
                key={i}
                className="intro-letter inline-block opacity-25"
                style={{ animationDelay: `${i * STEP_MS}ms` }}
              >
                {ch}
              </span>
            ))}
            <span
              className="intro-cursor absolute top-[-0.06em] bottom-[-0.06em] left-0 w-[0.72em] bg-[#0f766e]"
              style={{ animationTimingFunction: `steps(${LETTERS.length}, end)` }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
