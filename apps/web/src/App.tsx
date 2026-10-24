import { Link, Route, Switch } from 'wouter';
import { Toaster } from './components/ui.tsx';
import { Home } from './pages/Home.tsx';
import { Join } from './pages/Join.tsx';
import { Operator } from './pages/Operator.tsx';
import { Places } from './pages/Places.tsx';
import { ReceiptPage } from './pages/Receipt.tsx';
import { SignIn } from './pages/SignIn.tsx';
import { WorkspaceShell } from './pages/workspace/Shell.tsx';
import { SessionProvider } from './session.tsx';

function NotFound() {
  return (
    <div className="narrow" style={{ padding: '96px 0' }}>
      <h1 style={{ fontSize: '2.4rem' }}>Nothing here</h1>
      <p className="muted" style={{ margin: '12px 0 24px' }}>
        That address does not lead anywhere.
      </p>
      <Link href="/" className="btn">
        Home
      </Link>
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/signin" component={SignIn} />
        <Route path="/app" component={Places} />
        <Route path="/join" component={Join} />
        <Route path="/receipt/:id" component={ReceiptPage} />
        <Route path="/operator" component={Operator} />
        <Route path="/w/:slug/*?" component={WorkspaceShell} />
        <Route component={NotFound} />
      </Switch>
      <Toaster />
    </SessionProvider>
  );
}
