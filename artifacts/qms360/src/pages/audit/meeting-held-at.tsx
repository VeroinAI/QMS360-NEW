import { getAuditPlanDateRange, meetingDateError } from "@workspace/field-controls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MeetingHeldAt({ kind, value, locked, loading, from, to, onChange }: {
  kind: "opening" | "closing"; value: string; locked: boolean; loading?: boolean;
  from?: string | null; to?: string | null; onChange: (value: string) => void;
}) {
  const range = getAuditPlanDateRange(from, to);
  const error = meetingDateError(kind, value, from, to);
  return <div>
    <Label htmlFor={`${kind}-held-at`}>Held at</Label>
    <Input id={`${kind}-held-at`} type="datetime-local" value={value.slice(0, 16)}
      min={range?.min}
      max={range ? `${range.to}T23:59:59.999` : undefined}
      disabled={locked || !range} aria-invalid={!!error}
      aria-describedby={`${kind}-held-at-help`}
      onChange={event => onChange(event.target.value)}/>
    <p id={`${kind}-held-at-help`} className={`mt-1 text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
      {loading ? "Loading individual audit dates…" : error ?? `Allowed period: ${range?.label}.`}
    </p>
  </div>;
}
