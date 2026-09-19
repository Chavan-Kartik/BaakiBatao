import seedrandom from 'seedrandom';

/**
 * Seeded RNG — the whole corpus is regenerable from an integer seed
 * (fixtures/corpus/PROVENANCE.md). One rng per pack; threads never share it.
 */
export type Rng = () => number;

export function rngFromSeed(seed: number): Rng {
  return seedrandom(`fc-eval-${seed}`, { global: false });
}

export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, xs: readonly T[]): T {
  const v = xs[Math.floor(rng() * xs.length)];
  if (v === undefined) throw new Error('pick: empty array');
  return v;
}

/** Probability-p event. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Shuffle a copy (Fisher–Yates). */
export function shuffled<T>(rng: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
