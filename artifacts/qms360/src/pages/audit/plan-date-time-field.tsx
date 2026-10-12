import { useId, useState, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function PlanDateTimeField({ number, label, remark = "", onRemarkChange, remarkReadOnly = false, inputProps, error }: {
  number: number;
  label: string;
  remark?: string;
  onRemarkChange: (value: string) => void;
  remarkReadOnly?: boolean;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  error?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  return <div>
    <Label htmlFor={`${id}-date`}>{number}. {label} *</Label>
    <div className="mt-2 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <Input id={`${id}-date`} type="datetime-local" {...inputProps}/>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant={remark.trim() ? "secondary" : "outline"} className="shrink-0"
            aria-label={`${remarkReadOnly ? "View" : "Maintain"} remark for ${label}`}
            title={remark.trim() ? "A remark has been entered" : "Add an optional remark"}
            onClick={() => setDraft(remark)}>Remark{remark.trim() ? " •" : ""}</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{label} — Remark</DialogTitle>
            <DialogDescription>{remarkReadOnly ? "View the optional remark for this field." : "Optional remark for this field only. Changes are stored when you save the Audit Plan. Leave empty to remove the remark."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${id}-remark`}>Remark (optional)</Label>
            <Textarea id={`${id}-remark`} value={draft} onChange={event => setDraft(event.target.value)}
              readOnly={remarkReadOnly} maxLength={4000} rows={5} placeholder={remarkReadOnly ? "No remark entered." : "Enter a remark for this field"}/>
            {!remarkReadOnly && <p className="text-xs text-muted-foreground">{draft.length}/4000 characters</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{remarkReadOnly ? "Close" : "Cancel"}</Button>
            {!remarkReadOnly && <Button type="button" onClick={() => { onRemarkChange(draft); setOpen(false); }}>Save remark</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
  </div>;
}
