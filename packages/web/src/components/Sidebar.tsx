import { BadgeCheck, FlaskConical, GitBranch, LayoutList, Plus, Scale, type LucideIcon } from 'lucide-react';
import { BRAND, TAGLINE } from '../lib/brand';
import { href, useRoute, type Route } from '../lib/router';
import { cn } from '../lib/utils';
import { Square } from './primitives';

interface Item {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly to: Route;
  readonly active: boolean;
}

/**
 * Application navigation. Two groups: the things you can always do, and the
 * things that only exist once a case does. Nothing here is an account menu,
 * because there are no accounts — a claim is opened, worked and closed in one
 * sitting by whoever has the pack.
 */
export function Sidebar({ caseId }: { caseId: string | null }) {
  const route = useRoute();

  const workspace: Item[] = [
    { label: 'Cases', icon: LayoutList, to: { name: 'cases' }, active: route.name === 'cases' },
    { label: 'New case', icon: Plus, to: { name: 'new' }, active: route.name === 'new' },
    { label: 'Worked example', icon: FlaskConical, to: { name: 'demo' }, active: route.name === 'demo' },
  ];

  const current: Item[] = caseId
    ? [
        {
          label: 'Pipeline',
          icon: GitBranch,
          to: { name: 'case', caseId, tab: 'pipeline' },
          active: route.name === 'case' && route.tab === 'pipeline',
        },
        {
          label: 'Review',
          icon: Scale,
          to: { name: 'case', caseId, tab: 'review' },
          active: route.name === 'case' && route.tab === 'review',
        },
        {
          label: 'Certificate',
          icon: BadgeCheck,
          to: { name: 'case', caseId, tab: 'verify' },
          active: route.name === 'case' && route.tab === 'verify',
        },
      ]
    : [];

  return (
    <aside className="hidden w-[228px] shrink-0 flex-col border-r border-border bg-surface md:flex">
      <a
        href={href({ name: 'landing' })}
        className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border px-4 transition-colors hover:bg-hover"
      >
        <Square size={12} className="rounded-[2px]" />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold leading-none tracking-[-0.035em] text-text">
            {BRAND}
          </span>
          <span className="mt-1 block truncate text-[10.5px] leading-none text-text-3">{TAGLINE}</span>
        </span>
      </a>

      <nav className="scroll-quiet flex-1 overflow-auto px-2 py-3">
        <Group label="Workspace" items={workspace} />
        {current.length > 0 && <Group label="This case" items={current} className="mt-5" />}
      </nav>

      <div className="border-t border-border p-3">
        <p className="text-[11px] leading-snug text-text-3">
          Every figure is produced by code over a versioned rulepack. Nothing here is a model's opinion.
        </p>
      </div>
    </aside>
  );
}

function Group({ label, items, className }: { label: string; items: Item[]; className?: string }) {
  return (
    <div className={className}>
      <p className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.label}>
            <a
              href={href(item.to)}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-lg px-2 text-[12.5px] font-medium tracking-[-0.01em] transition-colors',
                item.active ? 'bg-selected text-text' : 'text-text-2 hover:bg-hover hover:text-text',
              )}
            >
              <item.icon
                className={cn('size-4 shrink-0', item.active ? 'text-brand' : 'text-text-3')}
                strokeWidth={1.75}
              />
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The same navigation as a scrollable strip, for a phone. */
export function MobileNav({ caseId }: { caseId: string | null }) {
  const route = useRoute();
  const items: Item[] = [
    { label: 'Cases', icon: LayoutList, to: { name: 'cases' }, active: route.name === 'cases' },
    { label: 'New', icon: Plus, to: { name: 'new' }, active: route.name === 'new' },
    { label: 'Example', icon: FlaskConical, to: { name: 'demo' }, active: route.name === 'demo' },
    ...(caseId
      ? ([
          {
            label: 'Pipeline',
            icon: GitBranch,
            to: { name: 'case', caseId, tab: 'pipeline' },
            active: route.name === 'case' && route.tab === 'pipeline',
          },
          {
            label: 'Review',
            icon: Scale,
            to: { name: 'case', caseId, tab: 'review' },
            active: route.name === 'case' && route.tab === 'review',
          },
          {
            label: 'Certificate',
            icon: BadgeCheck,
            to: { name: 'case', caseId, tab: 'verify' },
            active: route.name === 'case' && route.tab === 'verify',
          },
        ] satisfies Item[])
      : []),
  ];

  return (
    <nav className="scroll-quiet flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 md:hidden">
      <a
        href={href({ name: 'landing' })}
        className="mr-1 shrink-0 text-[13px] font-semibold tracking-[-0.035em] text-text"
      >
        {BRAND}
      </a>
      {items.map((item) => (
        <a
          key={item.label}
          href={href(item.to)}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium',
            item.active ? 'bg-selected text-text' : 'text-text-2',
          )}
        >
          <item.icon className="size-3.5" strokeWidth={1.75} />
          {item.label}
        </a>
      ))}
    </nav>
  );
}
