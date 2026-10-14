import { useRef, useState } from "react";
import { useAddDronaUser, useLookupDronaUser, type DronaUserCandidate } from "@workspace/api-client-react";
import { Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Only mounted for Super Admin. Server authorization remains authoritative. */
export function DronaAddUser({ onAdded }: { onAdded: (userId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [candidate, setCandidate] = useState<DronaUserCandidate>();
  const [error, setError] = useState("");
  const version = useRef(0);
  const lookup = useLookupDronaUser();
  const add = useAddDronaUser();
  const busy = lookup.isPending || add.isPending;
  const message = (cause: unknown) => cause instanceof Error ? cause.message : "The request failed. Please try again.";

  function changeOpen(next: boolean) {
    if (add.isPending) return;
    version.current++;
    setOpen(next);
    setEmail("");
    setCandidate(undefined);
    setError("");
  }
  async function search() {
    if (busy || !email.trim()) return;
    const request = ++version.current;
    setError("");
    setCandidate(undefined);
    try {
      const found = await lookup.mutateAsync({ data: { email: email.trim() } });
      if (request === version.current) setCandidate(found);
    } catch (cause) {
      if (request === version.current) setError(message(cause));
    }
  }
  async function confirm() {
    if (!candidate || busy) return;
    setError("");
    try {
      const result = await add.mutateAsync({ data: {
        email: candidate.email, externalUserId: candidate.externalUserId,
      } });
      setOpen(false);
      version.current++;
      setCandidate(undefined);
      setEmail("");
      onAdded(result.userId);
    } catch (cause) { setError(message(cause)); }
  }

  return <>
    <Button variant="outline" onClick={() => changeOpen(true)}>
      <UserPlus className="mr-2 h-4 w-4" />Add user from Drona
    </Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add user from Drona</DialogTitle>
          <DialogDescription>Find an existing Drona user assigned QMS360 access, without requiring their first QMS360 login.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void search(); }}>
          <div className="space-y-2">
            <Label htmlFor="drona-user-email">Drona user email</Label>
            <div className="flex gap-2">
              <Input id="drona-user-email" type="email" required maxLength={320}
                autoComplete="off" placeholder="user@example.com" value={email} disabled={busy}
                onChange={event => { version.current++; setEmail(event.target.value); setCandidate(undefined); setError(""); }} />
              <Button type="submit" disabled={busy || !email.trim()}>
                <Search className="mr-2 h-4 w-4" />{lookup.isPending ? "Searching…" : "Search"}
              </Button>
            </div>
          </div>
          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          {candidate && <section aria-label="Drona user details" className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <p className="font-medium">{candidate.fullName}</p>
            <p className="break-all text-sm">{candidate.email}</p>
            <p className="text-sm text-muted-foreground">{candidate.alreadyPresent
              ? "Already in QMS360 — the existing user will be reused."
              : "Not yet in QMS360 — Add user will create the internal link."}</p>
          </section>}
          <p className="text-sm text-muted-foreground">Search does not change any records. Adding a user does not grant a role or application approval. You will select roles using the existing role-assignment screen.</p>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={add.isPending} onClick={() => changeOpen(false)}>Cancel</Button>
          <Button disabled={!candidate || busy} onClick={() => void confirm()}>
            {add.isPending ? "Adding…" : candidate?.alreadyPresent ? "Continue to role assignment" : "Add user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
