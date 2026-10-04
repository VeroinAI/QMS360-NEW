import { useState } from 'react';
import { dronaSignIn, type AuthResponse, type AuthenticationConfiguration } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { fetchDronaSessionProof } from '@/lib/drona-sdk';

export function DronaSignIn({ config, onSession }: {
  config: AuthenticationConfiguration;
  onSession: (session: AuthResponse) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const proof = await fetchDronaSessionProof();
      const session = await dronaSignIn(proof);
      onSession(session);
    } catch (cause) {
      // Server errors are generic; never render arbitrary SDK profile/error payloads.
      const status = (cause as { status?: number }).status;
      setError(status === 503
        ? 'Drona is connected, but QMS360 sign-in is awaiting backend verification and access setup.'
        : status ? 'Drona sign-in could not be completed. Contact your administrator.'
          : cause instanceof Error ? cause.message : 'Drona sign-in could not be completed.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="mt-6 space-y-4" data-testid="drona-sign-in">
    <p className="text-sm text-muted-foreground">Use your existing Drona session. No separate QMS360 password is required.</p>
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