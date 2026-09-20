import { FileText } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { authClient } from '../lib/auth-client';
import { navigate } from '../lib/router';
import { cn } from '../lib/utils';

/**
 * Email and password, through better-auth. Sign-up and sign-in are one form
 * with a toggle, because a policyholder with a rejected claim is not here to
 * study an onboarding flow.
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
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <FileText className="size-5 text-brand" strokeWidth={2} />
          <span className="text-[15px] font-semibold tracking-tight text-text">Settlement Reconstructor</span>
        </div>

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
          />

          {error && (
            <p className="mb-3 rounded-sm bg-disputed-soft px-2.5 py-2 text-[12px] text-disputed">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 w-full items-center justify-center rounded-sm bg-brand text-[13px] font-medium text-white hover:bg-brand/90 disabled:opacity-60"
          >
            {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>

          <p className="mt-4 text-[11px] leading-relaxed text-text-3">
            Your documents are tied to your account and nobody else's. Raw uploads are kept for the
            session, not indefinitely.
          </p>
        </form>

        <p className="mt-4 text-center text-[12px] text-text-3">
          Just looking?{' '}
          <a href="#/demo" className="text-brand hover:underline">
            Open the demo case
          </a>{' '}
          — it settles in your browser, no account needed.
        </p>
      </div>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  autoComplete: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[12px] font-medium text-text-2">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        className="h-9 w-full rounded-sm border border-border bg-canvas px-2.5 text-[13px] text-text outline-none focus:border-brand"
      />
    </label>
  );
}
