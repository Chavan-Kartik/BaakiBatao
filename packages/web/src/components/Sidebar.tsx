import {
  FileText,
  GitBranch,
  LayoutDashboard,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '../lib/utils';

const NAV = [
  { id: 'cases', label: 'Cases', icon: LayoutDashboard, active: true },
  { id: 'pipeline', label: 'Pipeline', icon: GitBranch, active: false },
  { id: 'rulepack', label: 'Rulepack', icon: Scale, active: false },
  { id: 'verify', label: 'Verify', icon: ShieldCheck, active: false },
] as const;

export function Sidebar() {
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-12 items-center gap-2 border-b border-border px-4">
        <FileText className="size-4 text-accent" strokeWidth={2} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold tracking-tight text-text">
            Settlement Reconstructor
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!item.active}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-left text-[13px]',
                item.active
                  ? 'bg-selected text-text font-medium'
                  : 'text-text-3 cursor-not-allowed',
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              {item.label}
              {!item.active && (
                <span className="ml-auto font-mono text-[10px] text-text-3">soon</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">Demo case</p>
        <p className="mt-1 truncate text-[12px] text-text-2">readme-worked-example</p>
      </div>
    </aside>
  );
}
