import { Sidebar } from './components/Sidebar';
import { authClient } from './lib/auth-client';
import { useRoute } from './lib/router';
import { CasesList } from './screens/CasesList';
import { NewCase } from './screens/NewCase';
import { Pipeline } from './screens/Pipeline';
import { CaseReview, DemoReview } from './screens/Review';
import { SignIn } from './screens/SignIn';
import { Verify } from './screens/Verify';

/**
 * Product shell. Sign-in → cases → upload → pipeline → review → verify.
 *
 * The demo case is reachable without a session: it settles the reference
 * claim in the browser with the same engine the API runs, and needs no
 * server at all. Everything with a document behind it needs a session.
 */
export function App() {
  const route = useRoute();
  const { data: session, isPending } = authClient.useSession();

  if (route.name === 'demo') {
    return (
      <Shell session={session ?? null} caseId={null}>
        <DemoReview />
      </Shell>
    );
  }

  if (isPending) return <div className="flex h-dvh items-center justify-center bg-canvas text-[13px] text-text-3">…</div>;
  if (!session) return <SignIn />;

  return (
    <Shell session={session} caseId={route.name === 'case' ? route.caseId : null}>
      {route.name === 'cases' && <CasesList />}
      {route.name === 'signin' && <CasesList />}
      {route.name === 'new' && <NewCase />}
      {route.name === 'case' && route.tab === 'pipeline' && <Pipeline caseId={route.caseId} />}
      {route.name === 'case' && route.tab === 'review' && <CaseReview caseId={route.caseId} />}
      {route.name === 'case' && route.tab === 'verify' && <Verify caseId={route.caseId} />}
    </Shell>
  );
}

function Shell({
  session,
  caseId,
  children,
}: {
  session: { user: { email: string; name: string } } | null;
  caseId: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar session={session} caseId={caseId} />
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}
