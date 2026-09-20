import { FileText, GitBranch, LayoutDashboard, LogOut, Plus, Scale, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AvatarPicker, avatars, type Avatar } from './AvatarPicker';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { authClient } from '../lib/auth-client';
import { href, navigate, useRoute } from '../lib/router';
import { cn } from '../lib/utils';

/**
 * A display preference, not an identity. The chosen avatar is keyed by the
 * signed-in email and kept in local storage, because picking a picture changes
 * nothing about what the account is allowed to do.
 */
function useStoredAvatar(email: string | null) {
  const [id, setId] = useState<number | null>(null);

  useEffect(() => {
    // `|| null` folds the unparseable cases — absent key, empty string, NaN —
    // into "nothing stored yet".
    setId(email ? Number(window.localStorage.getItem(`fc:avatar:${email}`)) || null : null);
  }, [email]);

  const selected = avatars.find((a) => a.id === id) ?? avatars[0];

  function choose(avatar: Avatar) {
    setId(avatar.id);
    if (email) window.localStorage.setItem(`fc:avatar:${email}`, String(avatar.id));
  }

  return { selected, choose };
}

export function Sidebar({
  session,
  sessionPending,
  caseId,
}: {
  session: { user: { email: string; name: string } } | null;
  /** True until the first session read lands, so the card does not flash the signed-out state. */
  sessionPending: boolean;
  caseId: string | null;
}) {
  const route = useRoute();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { selected: avatar, choose: chooseAvatar } = useStoredAvatar(session?.user.email ?? null);

  const items = [
    { id: 'cases', label: 'Cases', icon: LayoutDashboard, to: href({ name: 'cases' }), active: route.name === 'cases', enabled: true },
    { id: 'new', label: 'New case', icon: Plus, to: href({ name: 'new' }), active: route.name === 'new', enabled: true },
    { id: 'pipeline', label: 'Pipeline', icon: GitBranch, to: caseId ? href({ name: 'case', caseId, tab: 'pipeline' }) : '#', active: route.name === 'case' && route.tab === 'pipeline', enabled: caseId !== null },
    { id: 'review', label: 'Review', icon: Scale, to: caseId ? href({ name: 'case', caseId, tab: 'review' }) : href({ name: 'demo' }), active: (route.name === 'case' && route.tab === 'review') || route.name === 'demo', enabled: true },
    { id: 'verify', label: 'Verify', icon: ShieldCheck, to: caseId ? href({ name: 'case', caseId, tab: 'verify' }) : '#', active: route.name === 'case' && route.tab === 'verify', enabled: caseId !== null },
  ];

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface">
      <a href={href({ name: 'landing' })} className="flex h-12 items-center gap-2 border-b border-border px-4 hover:bg-hover">
        <FileText className="size-4 text-brand" strokeWidth={2} />
        <div className="truncate text-[13px] font-semibold tracking-tight text-text">Settlement Reconstructor</div>
      </a>

      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.id}
              href={item.enabled ? item.to : undefined}
              aria-disabled={!item.enabled}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-left text-[13px]',
                item.active ? 'bg-selected font-medium text-text' : item.enabled ? 'text-text-2 hover:bg-hover' : 'cursor-not-allowed text-text-3',
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              {item.label}
              {!item.enabled && item.id !== 'cases' && item.id !== 'new' && (
                <span className="ml-auto font-mono text-[10px] text-text-3">open a case</span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-3">
        {sessionPending ? (
          <div className="flex items-center gap-2">
            <span className="size-7 shrink-0 animate-pulse rounded-full bg-border" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <span className="block h-2.5 w-20 animate-pulse rounded-full bg-border" />
              <span className="block h-2 w-28 animate-pulse rounded-full bg-border/60" />
            </div>
            <span className="sr-only">Checking your session</span>
          </div>
        ) : session ? (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label="Change avatar"
                className="size-7 shrink-0 overflow-hidden rounded-full border border-border bg-canvas transition-colors hover:border-brand [&_svg]:size-full"
              >
                {avatar.svg}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-text">{session.user.name}</p>
                <p className="truncate text-[11px] text-text-3">{session.user.email}</p>
              </div>
              <button
                type="button"
                aria-label="Sign out"
                onClick={() => authClient.signOut().then(() => navigate({ name: 'landing' }))}
                className="shrink-0 rounded-sm p-1.5 text-text-3 hover:bg-hover hover:text-text"
              >
                <LogOut className="size-4" />
              </button>
            </div>

            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
              <DialogContent className="max-w-sm">
                <DialogTitle className="sr-only">Choose your avatar</DialogTitle>
                <AvatarPicker
                  userName={session.user.name}
                  userRole="Policyholder"
                  onSelect={chooseAvatar}
                />
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <a href={href({ name: 'auth' })} className="text-[12px] text-brand hover:underline">
              Sign in
            </a>
            <span className="text-[11px] leading-snug text-text-3">
              Work you do stays attached to your account. The demo case needs none.
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
