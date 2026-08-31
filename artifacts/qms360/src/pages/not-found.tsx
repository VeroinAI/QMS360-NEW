import { ArrowLeft, Compass, Home } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="page-grid flex min-h-[100dvh] items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-xl md:p-12" data-testid="state-not-found">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(258_24%_93%)] text-[hsl(var(--primary))]">
          <Compass className="h-7 w-7" />
        </div>
        <p className="mt-7 text-[11px] font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">QMS360 · Navigation check</p>
        <h1 className="mt-3 font-display text-5xl font-bold tracking-[-.07em]">This page is off the map.</h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted-foreground">The workspace you requested does not exist, or its route has moved. Your quality system is still right where you left it.</p>
        <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground" data-testid="link-not-found-home"><Home className="h-4 w-4" /> System overview</Link>
          <button onClick={() => window.history.back()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-xs font-bold" data-testid="button-not-found-back"><ArrowLeft className="h-4 w-4" /> Go back</button>
        </div>
      </div>
    </div>
  );
}