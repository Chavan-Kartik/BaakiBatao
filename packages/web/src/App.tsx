import { Sidebar } from './components/Sidebar';
import { authClient } from './lib/auth-client';
import { useRoute } from './lib/router';
import { CasesList } from './screens/CasesList';
import { Landing } from './screens/Landing';
import { NewCase } from './screens/NewCase';
import { Pipeline } from './screens/Pipeline';
import { CaseReview, DemoReview } from './screens/Review';
import { SignIn } from './screens/SignIn';
import { Verify } from './screens/Verify';

/**
 * Product shell.
 *
 * `#/` is the landing page and `#/u` is sign-in; both stand on their own with
 * no sidebar. Everything else renders inside the workspace.
 *
 * Auth is deliberately **not** enforced here yet. The session is read for the
 * sidebar card and for the requests that need it, and no route waits on it —
 * so a page is never traded for a spinner, and the demo case stays reachable
 * without an account. When gating arrives it belongs in one place: the branch
 * below that currently renders every route unconditionally.
 */
export function App() {
  const route = useRoute();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  if (route.name === 'landing') return <Landing />;
  if (route.name === 'auth') return <SignIn />;

  return (
    <Shell
      session={session ?? null}
      sessionPending={sessionPending}
      caseId={route.name === 'case' ? route.caseId : null}
    >
      {route.name === 'cases' && <CasesList />}
      {route.name === 'new' && <NewCase />}
      {route.name === 'demo' && <DemoReview />}
      {route.name === 'case' && route.tab === 'pipeline' && <Pipeline caseId={route.caseId} />}
      {route.name === 'case' && route.tab === 'review' && <CaseReview caseId={route.caseId} />}
      {route.name === 'case' && route.tab === 'verify' && <Verify caseId={route.caseId} />}
    </Shell>
  );
}

function Shell({
  session,
  sessionPending,
  caseId,
  children,
}: {
  session: { user: { email: string; name: string } } | null;
  sessionPending: boolean;
  caseId: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar session={session} sessionPending={sessionPending} caseId={caseId} />
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}
