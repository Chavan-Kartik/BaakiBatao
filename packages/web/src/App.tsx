import { MobileNav, Sidebar } from './components/Sidebar';
import { useRoute } from './lib/router';
import { CasesList } from './screens/CasesList';
import { Landing } from './screens/Landing';
import { NewCase } from './screens/NewCase';
import { Pipeline } from './screens/Pipeline';
import { CaseReview, DemoReview } from './screens/Review';
import { Verify } from './screens/Verify';

/**
 * Product shell: navigation on the left, one scrolling column on the right.
 * Each screen supplies its own header bar so the title and the actions stay
 * with the thing they describe.
 *
 * Nothing is gated. There is no session to read, no spinner to trade a page
 * for, and no sign-in to walk past: the worked example settles a whole claim
 * in the browser, and a real pack is one upload away.
 */
export function App() {
  const route = useRoute();

  if (route.name === 'landing') return <Landing />;

  const caseId = route.name === 'case' ? route.caseId : null;

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas font-geist tracking-[-0.01em] text-text">
      <Sidebar caseId={caseId} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileNav caseId={caseId} />
        <main className="scroll-quiet min-h-0 flex-1 overflow-auto">
          {route.name === 'cases' && <CasesList />}
          {route.name === 'new' && <NewCase />}
          {route.name === 'demo' && <DemoReview />}
          {route.name === 'case' && route.tab === 'pipeline' && <Pipeline caseId={route.caseId} />}
          {route.name === 'case' && route.tab === 'review' && <CaseReview caseId={route.caseId} />}
          {route.name === 'case' && route.tab === 'verify' && <Verify caseId={route.caseId} />}
        </main>
      </div>
    </div>
  );
}
