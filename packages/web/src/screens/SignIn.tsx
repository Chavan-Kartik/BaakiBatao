import { Eye, EyeOff, FileText } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { LoadingButton } from '../components/extras/loading-button';
import { RegulatoryMarquee } from '../components/extras/marquee';
import { authClient } from '../lib/auth-client';
import { href, navigate } from '../lib/router';
import { cn } from '../lib/utils';

/**
 * Sign-in and sign-up on one form, at `#/u`. A policyholder with a rejected
 * claim is not here to study an onboarding flow, so the two modes are one
 * toggle apart and nothing else competes for the screen — the pitch lives on
 * the landing page at `#/`.
 */
export function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === 'up'
        ? await authClient.signUp.email({ name: name.trim() || email, email, password })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? 'That did not work.');
      return;
    }
    navigate({ name: 'cases' });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <a href={href({ name: 'landing' })} className="mb-6 flex items-center gap-2">
            <FileText className="size-5 text-brand" strokeWidth={2} />
            <span className="text-[15px] font-semibold tracking-tight text-text">Settlement Reconstructor</span>
          </a>

          <form onSubmit={submit} className="rounded-md border border-border bg-surface p-5">
            <div className="mb-4 flex rounded-sm border border-border p-0.5">
              {(['in', 'up'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    'h-7 flex-1 rounded-sm text-[12px] font-medium',
                    mode === m ? 'bg-selected text-text' : 'text-text-3 hover:text-text-2',
                  )}
                >
                  {m === 'in' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            {mode === 'up' && (
              <Field label="Name" value={name} onChange={setName} type="text" autoComplete="name" />
            )}
            <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" required />
            <Field
              label="Password"
              value={password}
              onChange={setPassword}
              type="password"
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              required
              minLength={8}
              revealable
            />

            {error && (
              <p className="mb-3 rounded-sm bg-disputed-soft px-2.5 py-2 text-[12px] text-disputed">{error}</p>
            )}

            <LoadingButton
              type="submit"
              loading={busy}
              loadingText={mode === 'in' ? 'Signing in…' : 'Creating account…'}
              className="w-full"
            >
              {mode === 'in' ? 'Sign in' : 'Create account'}
            </LoadingButton>

            <p className="mt-4 text-[11px] leading-relaxed text-text-3">
              Your documents are tied to your account and nobody else's. Raw uploads are kept for the
              session, not indefinitely.
            </p>
          </form>

          <div className="mt-4 flex flex-col items-center gap-1 text-[12px] text-text-3">
            <p>
              Just looking?{' '}
              <a href={href({ name: 'demo' })} className="text-brand hover:underline">
                Open the demo case
              </a>{' '}
              — it settles in your browser.
            </p>
            <a href={href({ name: 'landing' })} className="hover:text-text-2 hover:underline">
              Back to the overview
            </a>
          </div>
        </div>
      </div>

      <RegulatoryMarquee />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  required,
  minLength,
  revealable,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  autoComplete: string;
  required?: boolean;
  minLength?: number;
  revealable?: boolean;
}) {
  const [shown, setShown] = useState(false);

  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[12px] font-medium text-text-2">{label}</span>
      <div className="relative">
        <input
          type={revealable && shown ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          className={cn(
            'h-9 w-full rounded-sm border border-border bg-canvas px-2.5 text-[13px] text-text outline-none focus:border-brand',
            revealable && 'pr-8',
          )}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-2 flex items-center text-text-3 hover:text-text"
          >
            {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
      </div>
    </label>
  );
}
