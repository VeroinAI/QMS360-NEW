import { useEffect, useRef, useState } from 'react';
import { dronaSignIn, type AuthResponse, type AuthenticationConfiguration } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { fetchDronaEmail } from '@/lib/drona-sdk';
import { dronaSignInError } from '@/lib/drona-errors';

export function DronaSignIn({ config, onSession }: {
  config: AuthenticationConfiguration;
  onSession: (session: AuthResponse) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempted = useRef(false);
  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const proof = await fetchDronaEmail();
      const session = await dronaSignIn(proof);
      onSession(session);
    } catch (cause) {
      setError(dronaSignInError(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (config.dronaReady && !attempted.current) {
      attempted.current = true;
      void connect();
    }
  }, [config.dronaReady]);
  return <div className="mt-6 space-y-4" data-testid="drona-sign-in">
    <p className="text-sm text-muted-foreground">Use your existing Drona session. No separate QMS360 password is required.</p>
    {config.dronaEmailException && <p className="text-xs text-muted-foreground" role="status">
      Approved email-only exception: Drona session and nonce validation are currently bypassed.
    </p>}
    {!config.dronaReady && <div className="rounded-lg border border-border bg-muted p-4 text-sm" role="status">
      <p className="font-medium">Drona sign-in is awaiting activation</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        {config.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
      </ul>
      <p className="mt-3 text-muted-foreground">The connection check below does not grant access until the backend setup is complete.</p>
    </div>}
    {error && <div className="rounded-lg bg-destructive p-3 text-sm text-destructive-foreground" role="alert">{error}</div>}
    <Button className="w-full" disabled={busy} onClick={connect}>
      {busy ? 'Checking Drona session…' : config.dronaReady ? 'Continue with Drona' : 'Check Drona connection'}
    </Button>
  </div>;
}