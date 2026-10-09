import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { meetingAttendeeLabel, notRepresentedClosingAttendees } from "@/lib/meeting-attendees";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function NotRepresentedClosingAttendees({ opening, closing, users, loading = false, error = false }: {
  opening?: readonly string[];
  closing: readonly string[];
  users: ReadonlyArray<{ id: string; fullName: string; designation?: string | null }>;
  loading?: boolean;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const missing = notRepresentedClosingAttendees(opening, closing);
  return <div className="space-y-2">
    <Label id="closing-meeting-not-represented">Not Represented in closing meeting</Label>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-readonly="true"
          aria-labelledby="closing-meeting-not-represented" aria-describedby="closing-meeting-not-represented-help"
          aria-expanded={open} disabled={loading || error} className="w-full justify-between font-normal">
          {loading ? "Loading Audit users…" : missing.length ? `${missing.length} automatically selected` : "None"}
          <ChevronDown className="ml-2 size-4 opacity-50"/>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Search not represented attendees…"/>
          <CommandList>
            <CommandEmpty>{missing.length ? "No matching attendees." : "No opening-meeting attendees are missing from the closing meeting."}</CommandEmpty>
            <CommandGroup>
              {missing.map(id => {
                const name = meetingAttendeeLabel(id, users);
                const user = users.find(user => user.id.toLowerCase() === id.trim().toLowerCase());
                return <CommandItem key={id} value={`${name} ${user?.designation ?? ""} ${id}`} disabled className="data-[disabled=true]:opacity-100">
                  <Check className="mr-2 size-4" aria-hidden="true"/>
                  <span>{name}{user?.designation ? <span className="text-muted-foreground"> — {user.designation}</span> : null}</span>
                </CommandItem>;
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <p id="closing-meeting-not-represented-help" className="text-xs text-muted-foreground">
      Read-only. Automatically selected from opening-meeting attendees who are not in the closing-meeting Attendees.
    </p>
    {!loading && !error && missing.length > 0 && <div className="flex flex-wrap gap-2" aria-live="polite">
      {missing.map(id => <Badge key={id} variant="secondary" className="py-1">{meetingAttendeeLabel(id, users)}</Badge>)}
    </div>}
  </div>;
}
