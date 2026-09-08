import { useEffect, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  getGetCurrentUserQueryKey, setAuthTokenGetter, useChangePassword, useGetCurrentUser, useLogin,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { userFacingApiError } from '@/lib/api-error';
import { LandingPage } from '@/pages/landing';
import { SyncPage } from '@/pages/landing/sync';
import { ExecutivePage } from '@/pages/executive';
import { NotificationsPage } from '@/pages/notifications';
import NotFound from '@/pages/not-found';
import { QaqcRoutes } from './pages/qaqc';
import { LessonsRoutes } from './pages/lessons';
import { AuditRoutes } from './pages/audit';
import { AdminRoutes } from './pages/settings';
import { MasterDataRoutes } from './pages/master-data';
import { FeedbackPage } from './pages/feedback';

const queryClient = new QueryClient();
setAuthTokenGetter(() => typeof window === 'undefined' ? null : localStorage.getItem('qms360_token'));

function LoginPage() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    login.mutate({ data: { email, password } }, {
      onSuccess: session => {
        localStorage.setItem('qms360_token', session.token);
        void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        setLocation(session.user.mustChangePassword ? '/change-password' : '/');
      },
      onError: loginError => {
        const details = userFacingApiError(loginError, 'Sign-in could not be completed.');
        setError(details.technicalCode === 'HTTP 401'
          ? 'Email or password is incorrect. Please try again.'
          : `${details.message} (${details.technicalCode})`);
      },
    });
  };
  return <div className="grid min-h-dvh lg:grid-cols-[1.05fr_.95fr]">
    <section className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
      <div className="flex items-center gap-3 text-xl font-bold"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">Q</span>QMS360</div>
      <div><p className="text-xs font-bold uppercase tracking-[.2em] text-sidebar-primary">Algihaz Holding</p><h1 className="mt-5 max-w-xl text-5xl font-bold leading-tight">One quality system.<br />Three specialist applications.</h1><p className="mt-6 max-w-lg text-sm leading-6 text-sidebar-foreground/70">Connected quality governance, organizational learning, and audit assurance.</p></div>
      <p className="flex items-center gap-2 text-xs text-sidebar-foreground/60"><LockKeyhole className="h-4 w-4 text-sidebar-primary" />Secure enterprise access</p>
    </section>
    <section className="flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-lg">
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Welcome to QMS360</p>
        <h2 className="mt-3 text-3xl font-bold">Sign in</h2>
        <p className="mt-2 text-sm text-muted-foreground">Algihaz platform sign-in (UAT simulation)</p>
        {error && <div className="mt-5 rounded-lg bg-destructive p-3 text-sm text-destructive-foreground">{error}</div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /></div>
          <Button className="w-full" type="submit" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <div className="mt-6 rounded-lg bg-muted p-3 text-xs text-muted-foreground"><strong>UAT demo:</strong> noura.alharbi@algihaz.com / Demo1234!</div>
      </div>
    </section>
  </div>;
}

function ChangePasswordPage() {
  const [, setLocation] = useLocation();
  const changePassword = useChangePassword();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    changePassword.mutate({ data: { password } }, {
      onSuccess: user => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), user);
        setLocation('/');
      },
      onError: () => setError('We could not update your password. Please try again.'),
    });
  };
  return <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-lg">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><LockKeyhole className="h-6 w-6" /></div>
      <p className="mt-6 text-xs font-bold uppercase tracking-widest text-accent">Account security</p>
      <h1 className="mt-2 text-3xl font-bold">Choose a new password</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Your administrator issued a temporary password. Replace it before continuing to QMS360.</p>
      {error && <div className="mt-5 rounded-lg bg-destructive p-3 text-sm text-destructive-foreground">{error}</div>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={8} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" /></div>
        <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" minLength={8} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" /></div>
        <Button className="w-full" type="submit" disabled={changePassword.isPending}>{changePassword.isPending ? 'Updating password…' : 'Update password and continue'}</Button>
      </form>
    </div>
  </div>;
}

function AuthenticatedRouter() {
  const [location, setLocation] = useLocation();
  const token = typeof window === 'undefined' ? null : localStorage.getItem('qms360_token');
  const isLogin = location === '/login';
  const isPasswordChange = location === '/change-password';
  const session = useGetCurrentUser({ query: { enabled: Boolean(token) && !isLogin, queryKey: getGetCurrentUserQueryKey() } });
  useEffect(() => {
    if (!isLogin && (!token || session.isError)) {
      if (session.isError) localStorage.removeItem('qms360_token');
      setLocation('/login');
    }
    if (isLogin && token) setLocation('/');
    if (session.data?.mustChangePassword && !isPasswordChange) setLocation('/change-password');
    if (session.data && !session.data.mustChangePassword && isPasswordChange) setLocation('/');
  }, [isLogin, isPasswordChange, token, session.data, session.isError, setLocation]);
  if (isLogin) return <LoginPage />;
  if (!token || session.isLoading || !session.data) return <div className="flex min-h-dvh items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (session.data.mustChangePassword) return <ChangePasswordPage />;
  const isAdmin = ['Super Admin', 'Org Admin'].includes(session.data.platformRole ?? '')
    || (session.data.workspaceRoles?.some((role) => /\b(admin|administrator)\b/i.test(role)) ?? false);
  return <AppShell user={session.data}><ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={LandingPage} />
    <Route path="/executive" component={ExecutivePage} />
    <Route path="/sync" component={SyncPage} />
    <Route path="/notifications" component={NotificationsPage} />
    <Route path="/qaqc"><QaqcRoutes /></Route><Route path="/qaqc/:rest*"><QaqcRoutes /></Route>
    <Route path="/lessons"><LessonsRoutes /></Route><Route path="/lessons/:rest*"><LessonsRoutes /></Route>
    <Route path="/audit/audits/:id/report"><AuditRoutes /></Route>
    <Route path="/audit/audits/:id"><AuditRoutes /></Route>
    <Route path="/audit"><AuditRoutes /></Route><Route path="/audit/:rest*"><AuditRoutes /></Route>
    <Route path="/cockpit">{isAdmin ? <AdminRoutes /> : <NotFound />}</Route><Route path="/cockpit/:rest*">{isAdmin ? <AdminRoutes /> : <NotFound />}</Route>
    <Route path="/settings/:app/:tab">{isAdmin ? <AdminRoutes /> : <NotFound />}</Route><Route path="/settings/:rest*">{isAdmin ? <AdminRoutes /> : <NotFound />}</Route>
    <Route path="/master-data"><MasterDataRoutes /></Route>
    <Route path="/feedback" component={FeedbackPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary></AppShell>;
}

export default function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AuthenticatedRouter /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
