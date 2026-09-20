import type { StepId } from '@fc/contracts';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronsUpDown,
  EyeOff,
  FileCheck,
  KeyRound,
  MapPin,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { useState } from 'react';
import { IntroLoader } from '../components/extras/intro-loader';
import { RegulatoryMarquee } from '../components/extras/marquee';
import { BRAND, BRAND_MARK } from '../lib/brand';
import { STEP_LABEL } from '../lib/labels';
import { href } from '../lib/router';

/**
 * The front door.
 *
 * Editorial, not dashboard: black-on-paper type set large, black panels
 * for anything that is evidence, and one accent (the product's own teal)
 * used as a small square rather than a wash. Every figure on the page comes
 * from `docs/evaluation.md`; the worked amounts in the finding carousel are
 * illustrative and say so.
 *
 * Sections, top to bottom: nav, hero, proof cards, showcase, features,
 * findings carousel, pipeline + steps, security, built-on, closing CTA,
 * ticker, footer.
 */

const REPO = 'https://github.com/Chavan-Kartik/settlement-reconstructor';

const INK = 'bg-[#0b0b0b] text-[#fbfbf9]';
const PAPER = 'bg-[#fbfbf9] text-[#0b0b0b]';

const PILL_DARK =
  'inline-flex h-9 items-center rounded-full bg-[#0b0b0b] px-4.5 text-[12.5px] font-medium text-[#fbfbf9] transition-colors hover:bg-[#2a2a2a]';
const PILL_LIGHT =
  'inline-flex h-9 items-center rounded-full bg-[#e7e7e3] px-4.5 text-[12.5px] font-medium text-[#0b0b0b] transition-colors hover:bg-[#dcdcd7]';

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

/**
 * The four proof cards. The first two are the clean-profile row of
 * `docs/evaluation.md`; the last two are IRDAI Annual Report 2024-25,
 * Table I.29 — the regulator's own measure of the deduction phenomenon.
 */
const PROOF = [
  {
    figure: '100%',
    caption: 'Injected faults detected across 200 generated packs',
    art: 'ledger',
  },
  {
    figure: '0 paise',
    caption: 'Mean attribution error on every detected fault',
    art: 'grid',
  },
  {
    figure: '₹18,521 cr',
    caption: 'Disallowed under policy terms in FY2024-25 — 13.98% of everything claimed',
    art: 'boxed',
  },
  {
    figure: '22.7%',
    caption: 'Year-on-year growth in disallowed amounts, against 12.9% growth in amounts paid',
    art: 'bars',
  },
] as const;

const FEATURES = [
  {
    n: '/1',
    title: 'Upload the claim pack.',
    body: 'The bill, the deduction sheet, the schedule and the wording. Each is classified, read and checksummed before anything downstream sees it.',
  },
  {
    n: '/2',
    title: 'Walk the waterfall.',
    body: 'Every rupee is placed by a versioned rulepack in the order the policy sets. A disputed line names the clause it breaks and the amount it recovers.',
  },
  {
    n: '/3',
    title: 'Verify the certificate.',
    body: 'The rulepack, the extraction and the result are pinned by SHA-256 and signed with KMS. Replay it on the server and you get the same paise.',
  },
] as const;

/**
 * Three findings, one per tab, written the way the product writes them: the
 * arithmetic first, then the clause. Amounts are illustrative.
 */
const FINDINGS = [
  {
    tab: 'ROOM RENT',
    clause: 'PD.LIMIT',
    quote:
      '“The schedule caps room rent at ₹5,000 a day. The hospital charged ₹7,800 for three nights, so ₹8,400 of the room charge is lawfully the policyholder’s. The insurer deducted ₹11,400. The difference of ₹3,000 has no clause behind it and is recoverable.”',
    who: 'Caps / sub-limits',
    role: 'Step 4 of 7 · Finding INCORRECTLY_APPLIED',
  },
  {
    tab: 'SURGEON',
    clause: 'PD.DIFFBILL',
    quote:
      '“Because the room exceeded its cap, the insurer cut the surgeon’s fee by the same 36%. IRDAI circular 151/06/2020 restricts proportionate deduction to associated medical expenses. A surgeon’s fee is not one. ₹19,800 is recoverable.”',
    who: 'Proportionate',
    role: 'Step 5 of 7 · Finding INCORRECTLY_APPLIED',
  },
  {
    tab: 'PHARMACY',
    clause: 'AME.EXCL.PHARMA',
    quote:
      '“Pharmacy was billed at ₹14,620 and proportionately reduced alongside the room. The wording excludes pharmacy from associated medical expenses, so no proportion applies to it. The whole ₹5,263 cut is recoverable; the ₹1,180 of non-payable consumables stands.”',
    who: 'Non-payable · Proportionate',
    role: 'Steps 3 and 5 of 7 · Two findings',
  },
  {
    tab: 'UNRESOLVED',
    clause: 'UNRESOLVED',
    quote:
      '“Line 14 reads MISC CHARGES, ₹2,340. The normaliser could not place it above threshold and no sheet row pairs with it. It is not defended and it is not disputed. It is unresolved, and the document that would resolve it is the pharmacy annexure.”',
    who: 'Normalisation',
    role: 'Step 2 of 7 · No clause, so no opinion',
  },
] as const;

const STEP_ORDER = Object.keys(STEP_LABEL) as StepId[];

/** What each step of the waterfall turns on. Read against `STEP_LABEL`. */
const STEP_META: Record<StepId, string> = {
  ADMISSIBILITY: 'In force on admission · Waiting periods · PED clock · Exclusions',
  NORMALISATION_GATE: 'Free text → canonical category · The one step that needs a model',
  NON_PAYABLE: 'Annexure lists · Consumables rider checked before anything is cut',
  CAPS_SUBLIMITS: 'Room rent · ICU · Disease and procedure limits · This schedule, not a template',
  PROPORTIONATE: 'Eligible AME only · Differential billing only · Never ICU',
  COPAY_DEDUCTIBLE: 'In the order this wording specifies · Not the same across insurers',
  SUM_INSURED: 'Expected against paid · Every rupee of difference lands in a bucket',
};

const PIPELINE_STATES = [
  'ValidatePack',
  'ClassifyDocuments',
  'ExtractDocuments',
  'AssembleExtraction',
  'RedactionGate',
  'ChecksumRows',
  'NeedsCorrection?',
  'AwaitHumanCorrection',
  'Normalise',
  'Reconstruct',
  'InvariantHeld?',
  'WriteProse',
  'IssueCertificate',
];

const CONTROLS = [
  { icon: KeyRound, label: 'SSE-KMS at rest' },
  { icon: EyeOff, label: 'Redaction gate' },
  { icon: Timer, label: '24-hour expiry' },
  { icon: MapPin, label: 'ap-south-1 residency' },
  { icon: FileCheck, label: 'ECDSA-signed certificate' },
  { icon: ShieldCheck, label: 'Fails closed' },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Landing() {
  return (
    <div className={`flex min-h-dvh flex-col font-geist ${PAPER} tracking-[-0.01em]`}>
      <IntroLoader />
      <Nav />
      <main className="flex-1">
        <Hero />
        <Proof />
        <Showcase />
        <Features />
        <Findings />
        <Pipeline />
        <Security />
        <BuiltOn />
        <Closing />
      </main>
      <RegulatoryMarquee />
      <Footer />
    </div>
  );
}

/* ---- Nav ---------------------------------------------------------- */

function Nav() {
  return (
    <header className="relative z-10">
      <div className="mx-auto grid h-[68px] w-full max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 lg:px-8">
        <a href={href({ name: 'landing' })} className="text-[19px] font-bold tracking-[-0.05em]">
          {BRAND}
        </a>
        <nav className="hidden items-center gap-4 text-[13px] font-medium md:flex">
          <a href="#product" className="hover:opacity-60">
            Product
          </a>
          <a href="#pipeline" className="hover:opacity-60">
            Pipeline
          </a>
          <a href="#security" className="hover:opacity-60">
            Security
          </a>
        </nav>
        <div className="flex items-center justify-end gap-2">
          <a href={href({ name: 'demo' })} className={`${PILL_LIGHT} max-sm:hidden`}>
            Run the worked example
          </a>
          <a href={href({ name: 'cases' })} className={PILL_DARK}>
            Open the workspace
          </a>
        </div>
      </div>
    </header>
  );
}

/* ---- Hero --------------------------------------------------------- */

function Hero() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 pt-24 sm:px-6 lg:px-8 lg:pt-36">
      <h1 className="max-w-[1180px] text-[clamp(34px,5.6vw,80px)] font-semibold leading-[0.96] tracking-[-0.05em]">
        The insurer paid less than the policy allows. Here is the arithmetic.
      </h1>
      <p className="mt-32 max-w-[440px] text-[16px] font-medium leading-[1.25] tracking-[-0.02em] lg:mt-44">
        {BRAND} walks a hospital bill through the settlement waterfall the policy describes, line by
        line, and separates the deductions that hold up from the ones that do not.
      </p>
      <div className="mt-8 h-px w-full bg-[#0b0b0b]/25" />
    </section>
  );
}

/* ---- Proof cards -------------------------------------------------- */

function Proof() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 pt-10 sm:px-6 lg:px-8">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PROOF.map((p, i) => (
          <li key={p.figure} className={`relative flex aspect-[0.9] flex-col justify-between p-3 ${INK}`}>
            <p className="text-[clamp(32px,3vw,46px)] font-semibold leading-none tracking-[-0.04em]">
              {p.figure}
            </p>
            <div className="flex flex-1 items-center justify-center px-4">
              <ProofArt kind={p.art} />
            </div>
            <p className="max-w-[230px] text-[13px] font-medium leading-[1.2] tracking-[-0.02em]">{p.caption}</p>
            {i === 0 && <Square className="absolute bottom-3 right-3" />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProofArt({ kind }: { kind: (typeof PROOF)[number]['art'] }) {
  const stroke = 'rgba(251,251,249,0.85)';
  if (kind === 'ledger') {
    // A bill, every row with a mark against it.
    return (
      <svg viewBox="0 0 160 120" className="w-full max-w-[200px]" aria-hidden>
        <rect x="8" y="8" width="144" height="104" rx="6" fill="none" stroke={stroke} strokeWidth="1.5" />
        {[28, 44, 60, 76, 92].map((y, i) => (
          <g key={y}>
            <rect x="20" y={y - 3} width={[70, 54, 62, 46, 58][i]} height="6" rx="3" fill={stroke} opacity="0.6" />
            <rect x="104" y={y - 3} width="24" height="6" rx="3" fill={stroke} opacity="0.35" />
            <path d={`M134 ${y} l3 3 l6 -6`} fill="none" stroke="#0f766e" strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === 'grid') {
    // A grid of cells and one balanced circle: the invariant.
    const cells: React.ReactNode[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cx = c - 3.5;
        const cy = r - 3.5;
        const inside = cx * cx + cy * cy < 9;
        cells.push(
          <rect
            key={`${r}-${c}`}
            x={c * 18 + 2}
            y={r * 18 + 2}
            width="14"
            height="14"
            fill={inside ? '#0f766e' : 'none'}
            stroke={stroke}
            strokeWidth="1"
            opacity={inside ? 0.9 : 0.35}
          />,
        );
      }
    }
    return (
      <svg viewBox="0 0 146 146" className="w-full max-w-[150px]" aria-hidden>
        {cells}
      </svg>
    );
  }
  if (kind === 'boxed') {
    return (
      <div className="relative">
        <div className="border-[3px] border-[#fbfbf9] px-4 py-1.5 text-[29px] font-semibold leading-none tracking-[-0.03em]">
          I.29
        </div>
        <Square className="absolute -bottom-2 -right-3" />
      </div>
    );
  }
  // bars: the waterfall as a small chart.
  const bars = [100, 82, 74, 61, 48, 44, 40];
  return (
    <svg viewBox="0 0 160 110" className="w-full max-w-[200px]" aria-hidden>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={8 + i * 21}
          y={105 - h}
          width="15"
          height={h}
          fill={i === bars.length - 1 ? '#0f766e' : stroke}
          opacity={i === bars.length - 1 ? 1 : 0.25 + i * 0.1}
        />
      ))}
      <line x1="4" y1="105" x2="156" y2="105" stroke={stroke} strokeWidth="1" />
    </svg>
  );
}

/* ---- Showcase ----------------------------------------------------- */

function Showcase() {
  return (
    <section id="product" className="mx-auto w-full max-w-[1400px] px-4 pt-36 sm:px-6 lg:px-8 lg:pt-48">
      <h2 className="text-center text-[clamp(28px,3.6vw,50px)] font-semibold leading-[1.02] tracking-[-0.045em]">
        A calculator, not an oracle.
      </h2>
      <p className="mx-auto mt-10 max-w-[640px] text-center text-[clamp(18px,2vw,27px)] font-medium leading-[1.15] tracking-[-0.03em]">
        It reads the pack like a model would. It settles the bill like code does.
      </p>

      <div className="relative mt-20 overflow-hidden bg-[#0b0b0b]">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(60% 50% at 30% 20%, rgba(255,255,255,0.10), transparent 60%), radial-gradient(50% 40% at 80% 90%, rgba(15,118,110,0.35), transparent 60%)',
          }}
        />
        <div className="relative mx-auto my-16 w-[86%] max-w-[1060px] bg-[#fbfbf9] px-4 py-16 text-[#0b0b0b] sm:py-24 lg:my-28 lg:py-36">
          <IntakeMock />
        </div>
      </div>
    </section>
  );
}

function IntakeMock() {
  const files = [
    { name: 'Itemised bill.pdf', kind: 'Required', tone: 'bg-[#b42318]' },
    { name: 'Deduction sheet.pdf', kind: 'Required', tone: 'bg-[#b42318]' },
    { name: 'Policy schedule.pdf', kind: 'Required', tone: 'bg-[#0f766e]' },
    { name: 'Policy wording.pdf', kind: 'Required', tone: 'bg-[#0f766e]' },
    { name: 'Settlement letter.pdf', kind: 'Optional', tone: 'bg-[#374151]' },
  ];
  return (
    <div className="mx-auto max-w-[600px] rounded-[28px] border border-[#0b0b0b]/10 bg-white p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.35)]">
      <div className="flex flex-wrap gap-2.5">
        {files.map((f) => (
          <div
            key={f.name}
            className="relative flex items-center gap-3 rounded-xl border border-[#0b0b0b]/10 px-2 py-2 pr-6"
          >
            <span className={`grid size-10 place-items-center rounded-lg ${f.tone} text-white`}>
              <FileGlyph />
            </span>
            <div className="leading-tight">
              <p className="text-[13px] font-medium">{f.name}</p>
              <p className="text-[12px] text-[#6b7280]">{f.kind}</p>
            </div>
            <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-[#0b0b0b] text-[9px] text-white">
              ×
            </span>
          </div>
        ))}
      </div>
      <div className="mt-10 flex items-center justify-between">
        <span className="text-[22px] leading-none text-[#6b7280]">+</span>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-[14px] text-[#374151]">
            Rulepack v0.1 <ChevronsUpDown className="size-3.5" />
          </span>
          <span className="grid size-10 place-items-center rounded-full bg-[#0b0b0b] text-white">
            <ArrowUp className="size-4" strokeWidth={2.25} />
          </span>
        </div>
      </div>
    </div>
  );
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

/* ---- Features ----------------------------------------------------- */

function Features() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 pt-32 sm:px-6 lg:px-8 lg:pt-44">
      <Eyebrow className="justify-center">Features</Eyebrow>
      <h2 className="mx-auto mt-4 max-w-[680px] text-center text-[clamp(24px,2.7vw,37px)] font-semibold leading-[1.05] tracking-[-0.04em]">
        Upload the claim pack. Walk the waterfall. Verify the certificate.
      </h2>

      <ul className="mt-24 grid gap-2.5 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <li key={f.n} className={`relative flex min-h-[500px] flex-col p-3 ${INK}`}>
            <Square className="absolute right-0 top-0" size={24} />
            <div className="flex items-start justify-between gap-6">
              <h3 className="max-w-[300px] text-[clamp(20px,1.7vw,25px)] font-semibold leading-[1.05] tracking-[-0.035em]">
                {f.title}
              </h3>
              <span className="mt-5 text-[26px] font-semibold leading-none tracking-[-0.04em]">{f.n}</span>
            </div>
            <div className="flex flex-1 items-center justify-center py-10">
              {i === 0 && <UploadMock />}
              {i === 1 && <FindingMock />}
              {i === 2 && <CertificateMock />}
            </div>
            <p className="max-w-[370px] text-[14.5px] font-medium leading-[1.25] tracking-[-0.02em]">{f.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UploadMock() {
  return (
    <div className="w-[82%] max-w-[360px] rounded-[26px] bg-white p-4 text-[#0b0b0b]">
      <div className="grid grid-cols-2 gap-2">
        {['Itemised bill', 'Deduction sheet', 'Schedule', 'Wording'].map((n) => (
          <div key={n} className="flex items-center gap-2 rounded-lg border border-[#0b0b0b]/10 p-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[#0b0b0b] text-white">
              <FileGlyph />
            </span>
            <span className="truncate text-[11px] font-medium">{n}.pdf</span>
          </div>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-between">
        <span className="text-[18px] leading-none text-[#6b7280]">+</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#374151]">5 documents · 3 required</span>
          <span className="grid size-8 place-items-center rounded-full bg-[#0b0b0b] text-white">
            <ArrowUp className="size-3.5" strokeWidth={2.25} />
          </span>
        </div>
      </div>
    </div>
  );
}

function FindingMock() {
  return (
    <div className="relative w-[90%] max-w-[380px] text-[#0b0b0b]">
      <div className="rounded-xl bg-white p-4">
        <p className="text-[12px] font-semibold">4. Room rent cap · PD.LIMIT</p>
        <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-snug text-[#374151]">
          <Check className="mt-0.5 size-3 shrink-0 text-[#0f766e]" strokeWidth={3} />
          <span>
            <b className="font-semibold text-[#0b0b0b]">Finding:</b> the insurer deducted ₹11,400 where the
            schedule allows ₹8,400.
          </span>
        </p>
        <p className="mt-1.5 text-[10.5px] leading-snug text-[#6b7280]">
          Evidence: three nights at ₹7,800 against a ₹5,000 daily cap. The excess is ₹2,800 a night.
        </p>
        <div className="mt-3 space-y-1.5">
          {[0, 1, 2].map((r) => (
            <div key={r} className="grid grid-cols-[1fr_1.4fr_1fr] gap-2 rounded bg-[#f3f4f6] px-2 py-1.5">
              <span className="h-1.5 rounded bg-[#d1d5db]" />
              <span className="h-1.5 rounded bg-[#d1d5db]" />
              <span className="h-1.5 rounded bg-[#d1d5db]" />
            </div>
          ))}
        </div>
      </div>
      <div className="absolute -bottom-10 right-0 w-[66%] rounded-xl border border-[#0b0b0b]/10 bg-white p-3 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.5)]">
        <p className="text-[10.5px] leading-snug text-[#374151]">
          Recoverable on this line: <b className="font-semibold text-[#0b0b0b]">₹3,000.00</b>
        </p>
        <span className="mt-3 inline-flex h-6 items-center rounded-full bg-[#0b0b0b] px-2.5 text-[10px] font-medium text-white">
          Read the clause
        </span>
      </div>
    </div>
  );
}

function CertificateMock() {
  return (
    <div className="w-[92%] max-w-[380px] rounded-xl bg-white p-2 text-[#0b0b0b]">
      <div className="flex items-center gap-1.5 px-1 py-1">
        <span className="size-1.5 rounded-full bg-[#d1d5db]" />
        <span className="size-1.5 rounded-full bg-[#d1d5db]" />
        <span className="size-1.5 rounded-full bg-[#d1d5db]" />
        <span className="mx-auto rounded-full bg-[#f3f4f6] px-3 py-0.5 text-[9px] text-[#6b7280]">
          /cases/…/verify
        </span>
      </div>
      <div className="mt-1 rounded-lg border border-[#0b0b0b]/10 p-3">
        <p className="text-[11px] font-semibold">Certificate</p>
        <dl className="mt-2 space-y-1 text-[10px]">
          <div className="flex justify-between gap-3">
            <dt className="text-[#6b7280]">Rulepack</dt>
            <dd className="font-mono">v0.1 · 9f3c…a41e</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#6b7280]">Result hash</dt>
            <dd className="font-mono">sha256:7b2e…d90c</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#6b7280]">Signature</dt>
            <dd className="font-mono">ECDSA_SHA_256</dd>
          </div>
        </dl>
        <div className="mt-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf8] px-2 py-0.5 text-[9.5px] font-medium text-[#0f766e]">
            <span className="size-1.5 rounded-full bg-[#0f766e]" /> Replayed · signature valid
          </span>
          <span className="text-[9.5px] text-[#6b7280]">same paise</span>
        </div>
      </div>
    </div>
  );
}

/* ---- Findings carousel -------------------------------------------- */

function Findings() {
  const [i, setI] = useState(0);
  const f = FINDINGS[i] ?? FINDINGS[0];
  const prev = () => setI((n) => (n - 1 + FINDINGS.length) % FINDINGS.length);
  const next = () => setI((n) => (n + 1) % FINDINGS.length);

  return (
    <section className={`mt-32 lg:mt-44 ${INK}`}>
      <div className="relative mx-auto w-full max-w-[1440px] px-4 pb-0 pt-8 sm:px-6 lg:px-3">
        <div className="grid gap-10 lg:grid-cols-[220px_1fr_220px]">
          <div>
            <p className="text-[38px] font-semibold leading-none tracking-[-0.04em]">1</p>
            <p className="mt-6 max-w-[130px] text-[17px] font-medium leading-[1.05] tracking-[-0.03em]">
              How a dispute is named
            </p>
          </div>

          <div className="pt-4 lg:pt-32">
            <blockquote
              key={i}
              className="max-w-[800px] text-[clamp(18px,2vw,28px)] font-medium leading-[1.12] tracking-[-0.03em] animate-in fade-in duration-500"
            >
              {f.quote}
            </blockquote>

            <div className="mt-24 flex items-center gap-4">
              <div className="grid size-[100px] shrink-0 place-items-center bg-[#fbfbf9]/10 text-[#fbfbf9]">
                <Check className="size-9" strokeWidth={2} />
              </div>
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.02em]">{f.who}</p>
                <p className="text-[12px] text-[#fbfbf9]/60">{f.role}</p>
              </div>
            </div>

            <div className="mt-10 flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={prev}
                  aria-label="Previous finding"
                  className="grid size-8 place-items-center rounded-full bg-[#fbfbf9] text-[#0b0b0b] hover:bg-white"
                >
                  <ArrowLeft className="size-3.5" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-label="Next finding"
                  className="grid size-8 place-items-center rounded-full bg-[#fbfbf9] text-[#0b0b0b] hover:bg-white"
                >
                  <ArrowRight className="size-3.5" strokeWidth={2.5} />
                </button>
              </div>
              <div className="flex gap-6 text-[14px] font-semibold tracking-[-0.02em]">
                {FINDINGS.map((x, n) => (
                  <button
                    key={x.tab}
                    type="button"
                    onClick={() => setI(n)}
                    className={n === i ? 'text-[#fbfbf9]' : 'text-[#fbfbf9]/35 hover:text-[#fbfbf9]/70'}
                  >
                    {x.tab}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="hidden justify-end lg:flex">
            <div
              className="h-[156px] w-[196px]"
              style={{
                background:
                  'radial-gradient(70% 45% at 55% 60%, rgba(255,255,255,0.9), rgba(15,118,110,0.6) 30%, #0f766e 70%)',
              }}
            />
          </div>
        </div>

        <p className="mt-16 text-[clamp(44px,5.6vw,84px)] font-bold leading-[0.9] tracking-[-0.05em]">{f.clause}</p>
        <p className="mt-3 pb-3 text-[11px] text-[#fbfbf9]/45">
          Amounts in the findings above are illustrative. The unresolved bucket is a feature: a line the
          engine cannot place is named as such, never guessed at.
        </p>
      </div>
    </section>
  );
}

/* ---- Pipeline + steps (the reference's careers block) ------------- */

function Pipeline() {
  return (
    <section id="pipeline" className="mx-auto w-full max-w-[1120px] px-4 pt-32 sm:px-6 lg:px-8 lg:pt-44">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
        <Eyebrow>Pipeline</Eyebrow>
        <h2 className="text-[clamp(24px,2.7vw,37px)] font-semibold leading-[1.05] tracking-[-0.04em]">
          Fourteen functions, one state machine, and nothing adjudicates until the ledger balances.
        </h2>
      </div>

      <div className={`relative mt-12 overflow-hidden ${INK}`}>
        <Square className="absolute right-0 top-0" size={20} />
        <div className="grid gap-x-8 gap-y-2 px-6 py-16 sm:grid-cols-2 lg:grid-cols-3 lg:px-12 lg:py-24">
          {PIPELINE_STATES.map((s, n) => {
            const branch = s.endsWith('?');
            const last = n === PIPELINE_STATES.length - 1;
            return (
              <div key={s} className="flex items-center gap-3 py-2">
                <span className="w-7 shrink-0 font-mono text-[11px] tabular-nums text-[#fbfbf9]/40">
                  {String(n + 1).padStart(2, '0')}
                </span>
                <span
                  className={`text-[clamp(15px,1.5vw,20px)] font-semibold tracking-[-0.03em] ${
                    branch ? 'text-[#fbfbf9]/55' : last ? 'text-[#5eead4]' : ''
                  }`}
                >
                  {s}
                </span>
              </div>
            );
          })}
        </div>
        <div className="border-t border-[#fbfbf9]/15 px-6 py-4 text-[12px] text-[#fbfbf9]/60 lg:px-12">
          A wrong number stated confidently is worse than no number. Every task retries transient errors
          and catches everything else into a named failure: a pack that cannot be settled says why, and is
          never settled approximately.
        </div>
      </div>

      <div className="mt-16">
        <Eyebrow accent>Steps</Eyebrow>
        <ol className="mt-4">
          {STEP_ORDER.map((id) => (
            <li
              key={id}
              className="group flex flex-col gap-1 border-b border-[#0b0b0b]/10 py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <span className="text-[clamp(20px,2vw,27px)] font-medium tracking-[-0.035em] text-[#0b0b0b]/35 transition-colors group-hover:text-[#0b0b0b]">
                {STEP_LABEL[id]}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.02em] text-[#0b0b0b]/40 sm:shrink-0 sm:text-right">
                {STEP_META[id]}
              </span>
            </li>
          ))}
        </ol>
        <a href={href({ name: 'demo' })} className={`${PILL_DARK} mt-6`}>
          Run the worked example
        </a>
      </div>
    </section>
  );
}

/* ---- Security ----------------------------------------------------- */

function Security() {
  return (
    <section id="security" className="mx-auto w-full max-w-[1120px] px-4 pt-32 sm:px-6 lg:px-8 lg:pt-44">
      <Eyebrow accent>Security</Eyebrow>
      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_1fr]">
        <h2 className="max-w-[420px] text-[clamp(27px,3vw,40px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          Nothing personal reaches a model.
        </h2>
        <div className="space-y-6 text-[14.5px] font-medium leading-[1.25] tracking-[-0.02em] lg:pt-2">
          <p>
            Built for the most personal documents a household owns, against a rule that has been public
            since June 2020 and that almost nobody has read.
          </p>
          <p>
            Uploads land in a KMS-encrypted bucket that expires them after a day. Before any text crosses to
            a model it passes a redaction gate — Comprehend and format rules for Aadhaar, PAN, GSTIN, phone
            and email, both, not either — and the gate fails closed. The functions that write prose hold
            no grant on the raw bucket at all.
          </p>
          <p>
            Money never passes through a model: the waterfall is code over a versioned rulepack, and the
            certificate is signed with an asymmetric KMS key you can verify offline.
          </p>
        </div>
      </div>

      <ul className="mt-24 grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-6">
        {CONTROLS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex flex-col items-center gap-5 text-center">
            <Icon className="size-14" strokeWidth={1.25} />
            <span className="text-[12px] font-medium tracking-[-0.01em]">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- Built on ----------------------------------------------------- */

function BuiltOn() {
  return (
    <section className={`mt-40 lg:mt-52 ${INK}`}>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col px-3 pb-6 pt-3">
        <div className="flex flex-col items-start gap-1 lg:flex-row lg:gap-8">
          <p className="pt-2 text-[14.5px] font-medium">Built on</p>
          <p className="text-[clamp(36px,7vw,104px)] font-bold uppercase leading-[0.86] tracking-[-0.05em]">
            AWS Step Functions
            <br />
            Amazon Textract
          </p>
        </div>

        <div className="my-24 flex justify-center lg:my-40">
          <Square size={20} />
        </div>

        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <p className="max-w-[520px] text-[14.5px] font-semibold leading-[1.2] tracking-[-0.02em]">
            We do not tell you your insurer cheated you. We tell you, line by line, which part of your
            deduction we can defend, which part we can challenge, and which part we honestly cannot
            judge.
          </p>
          <div className="text-left lg:text-right">
            <p className="text-[14.5px] font-medium">with</p>
            <p className="text-[clamp(30px,4.7vw,67px)] font-bold uppercase leading-[0.9] tracking-[-0.05em]">
              Comprehend
              <br />
              Bedrock
              <br />
              KMS
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- Closing CTA -------------------------------------------------- */

function Closing() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 py-40 text-center sm:px-6 lg:px-8 lg:py-56">
      <h2 className="mx-auto max-w-[760px] text-[clamp(33px,4.7vw,65px)] font-semibold leading-[0.98] tracking-[-0.05em]">
        The arithmetic, not the adjective.
      </h2>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <a href={href({ name: 'cases' })} className={PILL_DARK}>
          Open the workspace
        </a>
        <a href={href({ name: 'demo' })} className={PILL_LIGHT}>
          Run the worked example
        </a>
      </div>
      <p className="mt-4 text-[12px] text-[#0b0b0b]/50">
        The worked example settles a full case in your browser — no account, no upload, no server.
      </p>
    </section>
  );
}

/* ---- Footer ------------------------------------------------------- */

function Footer() {
  const cols: { title: string; links: { label: string; to: string; external?: boolean }[] }[] = [
    {
      title: 'Product',
      links: [
        { label: 'Home', to: href({ name: 'landing' }) },
        { label: 'Workspace', to: href({ name: 'cases' }) },
        { label: 'Demo case', to: href({ name: 'demo' }) },
      ],
    },
    {
      title: 'Work with it',
      links: [
        { label: 'Upload a claim pack', to: href({ name: 'new' }) },
        { label: 'Open the workspace', to: href({ name: 'cases' }) },
      ],
    },
    {
      title: 'Source',
      links: [
        { label: 'GitHub', to: REPO, external: true },
        { label: 'Evaluation', to: `${REPO}/blob/main/docs/evaluation.md`, external: true },
      ],
    },
    {
      title: 'Reference',
      links: [
        { label: 'Architecture', to: `${REPO}/blob/main/docs/aws.md`, external: true },
        { label: 'Decisions', to: `${REPO}/tree/main/docs/decisions`, external: true },
      ],
    },
  ];

  return (
    <footer className={INK}>
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-6 pt-16 sm:px-6">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:max-w-[880px]">
          {cols.map((c) => (
            <div key={c.title}>
              <p className="text-[17px] font-semibold tracking-[-0.03em]">{c.title}</p>
              <ul className="mt-1.5 space-y-0.5 text-[13.5px] font-medium">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.to}
                      target={l.external ? '_blank' : undefined}
                      rel={l.external ? 'noreferrer' : undefined}
                      className="hover:opacity-60"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap gap-5 text-[12px] font-medium">
          <a href={`${REPO}/blob/main/docs/learning.md`} target="_blank" rel="noreferrer" className="hover:opacity-60">
            Method
          </a>
          <a href={`${REPO}/blob/main/docs/evaluation.md`} target="_blank" rel="noreferrer" className="hover:opacity-60">
            Evaluation report
          </a>
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="hover:opacity-60">
            Support
          </a>
        </div>

        <svg viewBox="0 0 1000 112" className="mt-10 w-full" aria-label={BRAND} role="img">
          <text
            x="0"
            y="104"
            textLength="1000"
            lengthAdjust="spacingAndGlyphs"
            fontSize="134"
            fontWeight="700"
            letterSpacing="-5"
            fill="#fbfbf9"
            fontFamily="inherit"
          >
            {BRAND_MARK}
          </text>
        </svg>

        <p className="mt-6 text-[12px] font-medium">© {new Date().getFullYear()} {BRAND}. A settlement reconstructor.</p>
      </div>
    </footer>
  );
}

/* ---- Bits --------------------------------------------------------- */

function Eyebrow({
  children,
  accent = false,
  className = '',
}: {
  children: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <p className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.04em] ${className}`}>
      <span className={`size-2 rounded-full ${accent ? 'bg-[#0f766e]' : 'bg-current'}`} />
      {children}
    </p>
  );
}

function Square({ className = '', size = 14 }: { className?: string; size?: number }) {
  return <span aria-hidden className={`block bg-[#0f766e] ${className}`} style={{ width: size, height: size }} />;
}
