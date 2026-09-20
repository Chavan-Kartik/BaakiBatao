import type { StepId } from '@fc/contracts';
import { FileText, Lock, Scale, ShieldCheck } from 'lucide-react';
import { RegulatoryMarquee } from '../components/extras/marquee';
import { STEP_LABEL } from '../lib/labels';
import { href } from '../lib/router';

/**
 * What the product actually promises, stated as properties rather than as
 * adjectives. The landing page is where these belong; the sign-in form is
 * where you act on them.
 */
const ASSURANCES = [
  {
    icon: Lock,
    title: 'Zero discretion',
    body: 'Every rupee is placed by a versioned rulepack, not by a model. The model drafts prose; it never computes an amount.',
  },
  {
    icon: Scale,
    title: 'Statutory rulepack',
    body: 'Each deduction is checked against the wording it cites, so a disputed line names the rule it breaks.',
  },
  {
    icon: ShieldCheck,
    title: 'Replayable certificate',
    body: 'The rulepack, the extraction and the outcome are pinned by SHA-256. Replay it on the server and you get the same paise.',
  },
];

const STEP_ORDER = Object.keys(STEP_LABEL) as StepId[];

export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-brand" strokeWidth={2} />
            <span className="text-[14px] font-semibold tracking-tight text-text">Settlement Reconstructor</span>
          </div>
          <nav className="flex items-center gap-1">
            <a
              href={href({ name: 'cases' })}
              className="rounded-sm px-2.5 py-1.5 text-[13px] text-text-2 hover:bg-hover hover:text-text"
            >
              Workspace
            </a>
            <a
              href={href({ name: 'demo' })}
              className="rounded-sm px-2.5 py-1.5 text-[13px] text-text-2 hover:bg-hover hover:text-text"
            >
              Demo case
            </a>
            <a
              href={href({ name: 'auth' })}
              className="ml-1 inline-flex h-8 items-center rounded-sm bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand/90"
            >
              Sign in
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        <section className="grid gap-10 py-14 lg:grid-cols-[1.15fr_1fr] lg:items-start">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand">
              Health claim reconstruction
            </p>
            <h1 className="mt-3 text-[34px] font-semibold leading-[1.15] tracking-tight text-text">
              The insurer paid less than the policy allows. Here is the arithmetic.
            </h1>
            <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-text-2">
              Upload the claim pack and the engine walks the bill through the same waterfall the wording
              describes, line by line, and separates the deductions that hold up from the ones that do not.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href={href({ name: 'cases' })}
                className="inline-flex h-10 items-center rounded-sm bg-brand px-5 text-[13px] font-medium text-white hover:bg-brand/90"
              >
                Open the workspace
              </a>
              <a
                href={href({ name: 'demo' })}
                className="inline-flex h-10 items-center rounded-sm border border-border bg-surface px-5 text-[13px] font-medium text-text-2 hover:bg-hover hover:text-text"
              >
                Run the worked example
              </a>
            </div>
            <p className="mt-3 text-[11px] text-text-3">
              The worked example settles a full case in your browser — no account, no upload, no server.
            </p>
          </div>

          <ul className="space-y-5 lg:pt-14">
            {ASSURANCES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
                <div>
                  <p className="text-[13px] font-medium text-text">{title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-text-3">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="border-t border-border py-12">
          <h2 className="text-[15px] font-semibold tracking-tight text-text">
            Seven steps, in the order the policy sets them
          </h2>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-2">
            The waterfall is data, not code. It comes from a versioned rulepack, so the same bill
            settles the same way every time it is replayed.
          </p>
          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEP_ORDER.map((id, index) => (
              <li key={id} className="rounded-md border border-border bg-surface p-3.5">
                <span className="font-mono text-[10px] tabular-nums text-text-3">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="mt-1 text-[13px] font-medium text-text">{STEP_LABEL[id]}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-6 border-t border-border py-12 lg:grid-cols-2">
          <div className="rounded-md border border-border bg-surface p-5">
            <h2 className="text-[14px] font-semibold text-text">What a case gives you</h2>
            <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-text-2">
              <li>Every bill line placed in one of three buckets: lawfully deducted, unlawfully deducted, or unexplained.</li>
              <li>The rupee amount recoverable on each disputed line, with the clause it breaks.</li>
              <li>A reconciliation that balances to the paisa, or a failure that names the invariant it broke.</li>
              <li>A certificate you can hand to an insurer's grievance cell and have replayed against it.</li>
            </ul>
          </div>
          <div className="rounded-md border border-border bg-surface p-5">
            <h2 className="text-[14px] font-semibold text-text">What it will not do</h2>
            <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-text-2">
              <li>It will not guess a number. An unreadable line, or an incomplete pack, is named as such and stops there.</li>
              <li>It is not legal advice, and it does not replace the insurer's own grievance route.</li>
              <li>This deployment reads structured JSON packs. Scanned PDFs upload and are stored, but extraction fails with a named reason until Textract is wired in.</li>
            </ul>
          </div>
        </section>
      </main>

      <RegulatoryMarquee />
    </div>
  );
}
