import { getAuditPlanDateRange, openingMeetingDateError } from "@workspace/field-controls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MeetingHeldAt({ kind, value, locked, loading, from, to, onChange }: {
  kind: "opening" | "closing"; value: string; locked: boolean; loading?: boolean;
  from?: string | null; to?: string | null; onChange: (value: string) => void;
}) {
  const range = getAuditPlanDateRange(from, to);
  const error = kind === "opening" ? openingMeetingDateError(value, from, to) : null;
  return <div>
    <Label htmlFor={`${kind}-held-at`}>Held at</Label>
    <Input id={`${kind}-held-at`} type="datetime-local" value={value.slice(0, 16)}
      min={kind === "opening" ? range?.min : undefined}
      max={kind === "opening" && range ? `${range.to}T23:59:59.999` : undefined}
      disabled={locked || (kind === "opening" && !range)} aria-invalid={!!error}
      aria-describedby={kind === "opening" ? "opening-held-at-help" : undefined}
      onChange={event => onChange(event.target.value)}/>
    {kind === "opening" && <p id="opening-held-at-help" className={`mt-1 text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
      {loading ? "Loading individual audit dates…" : error ?? `Allowed period: ${range?.label}.`}
    </p>}
  </div>;
}
