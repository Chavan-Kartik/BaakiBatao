import { FileText, GitBranch, LayoutDashboard, LogOut, Plus, Scale, ShieldCheck } from 'lucide-react';
import { authClient } from '../lib/auth-client';
import { href, navigate, useRoute } from '../lib/router';
import { cn } from '../lib/utils';

export function Sidebar({
  session,
  caseId,
}: {
  session: { user: { email: string; name: string } } | null;
  caseId: string | null;
}) {
  const route = useRoute();

  const items = [
    { id: 'cases', label: 'Cases', icon: LayoutDashboard, to: href({ name: 'cases' }), active: route.name === 'cases' || route.name === 'signin', enabled: session !== null },
    { id: 'new', label: 'New case', icon: Plus, to: href({ name: 'new' }), active: route.name === 'new', enabled: session !== null },
    { id: 'pipeline', label: 'Pipeline', icon: GitBranch, to: caseId ? href({ name: 'case', caseId, tab: 'pipeline' }) : '#', active: route.name === 'case' && route.tab === 'pipeline', enabled: caseId !== null },
    { id: 'review', label: 'Review', icon: Scale, to: caseId ? href({ name: 'case', caseId, tab: 'review' }) : href({ name: 'demo' }), active: (route.name === 'case' && route.tab === 'review') || route.name === 'demo', enabled: true },
    { id: 'verify', label: 'Verify', icon: ShieldCheck, to: caseId ? href({ name: 'case', caseId, tab: 'verify' }) : '#', active: route.name === 'case' && route.tab === 'verify', enabled: caseId !== null },
  ];

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-12 items-center gap-2 border-b border-border px-4">
        <FileText className="size-4 text-brand" strokeWidth={2} />
        <div className="truncate text-[13px] font-semibold tracking-tight text-text">Settlement Reconstructor</div>
      </div>

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
        {session ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-text">{session.user.name}</p>
              <p className="truncate text-[11px] text-text-3">{session.user.email}</p>
            </div>
            <button
              type="button"
              aria-label="Sign out"
              onClick={() => authClient.signOut().then(() => navigate({ name: 'signin' }))}
              className="shrink-0 rounded-sm p-1.5 text-text-3 hover:bg-hover hover:text-text"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <a href={href({ name: 'signin' })} className="text-[12px] text-brand hover:underline">
            Sign in to upload a claim
          </a>
        )}
      </div>
    </aside>
  );
}
