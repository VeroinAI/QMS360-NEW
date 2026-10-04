import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCompleteAudit } from "@workspace/api-client-react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFieldAccess } from "@/lib/use-field-access";
import { useFieldControls } from "@/lib/field-controls";

export const isAuditReportEligible = (status?: string) => status === "Complete" || status === "Closed";

// Record-level capability from the backend plus platform field access for the given execution field.
export function useAuditEditAccess(audit: { canEdit?: boolean }, fieldKey?: "status" | "reportDetails") {
  const fa = useFieldAccess("audit");
  const fc = useFieldControls("audit", "audit-execution");
  return audit.canEdit === true && !(fieldKey && (fa.readOnly("audit-execution", fieldKey) || fc.fieldProps(fieldKey).disabled));
}

export function ReportButton({ audit, size }: { audit: { id: string; status: string }; size?: "sm" }) {
  const ok = isAuditReportEligible(audit.status);
  return ok
    ? <Button variant="outline" size={size} asChild><Link href={`/audit/audits/${audit.id}/report`} data-testid={`link-report-${audit.id}`}>Report</Link></Button>
    : <Button variant="outline" size={size} disabled title="Report is available once the audit is marked Complete" data-testid={`button-report-${audit.id}`}>Report</Button>;
}

export function MarkCompleteButton({ audit, size }: { audit: { id: string; title: string; status: string; canEdit?: boolean }; size?: "sm" }) {
  const [open, setOpen] = useState(false);
  const canEdit = useAuditEditAccess(audit, "status");
  const qc = useQueryClient(); const { toast } = useToast();
  const complete = useCompleteAudit();
  if (!canEdit || isAuditReportEligible(audit.status)) return null;
  const confirm = () => complete.mutate({ id: audit.id }, {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [`/api/audit/audits/${audit.id}`] });
      void qc.invalidateQueries({ queryKey: ["/api/audit/audits"] });
      void qc.invalidateQueries({ queryKey: [`/api/audit/audits/${audit.id}/report`] });
      setOpen(false); toast({ title: "Audit marked Complete" });
    },
    onError: e => toast({ title: "Unable to mark audit Complete", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" }),
  });
  return <>
    <Button size={size} onClick={() => setOpen(true)} data-testid={`button-complete-${audit.id}`}><CheckCircle2 className="mr-2 size-4"/>Mark Complete</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>Mark this audit Complete?</DialogTitle>
        <DialogDescription>{audit.title}. Completing the audit enables the consolidated audit report and its PDF download. It does not close any Corrective Action Reports; those continue to be tracked separately.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button disabled={complete.isPending} onClick={confirm} data-testid="button-confirm-complete">{complete.isPending ? "Completing…" : "Mark Complete"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
