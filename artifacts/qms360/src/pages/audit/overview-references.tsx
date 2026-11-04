import type { Audit } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";

export function AuditOverviewReferences({ audit }: { audit: Pick<Audit, "projectName" | "planNumber" | "planAvailable"> }) {
  return <>
    <div className="min-w-0"><Label>Project</Label><p className="break-words [overflow-wrap:anywhere]">{audit.projectName?.trim() ? audit.projectName : "Not available"}</p></div>
    <div className="min-w-0"><Label>Plan</Label><p className="break-words [overflow-wrap:anywhere]">{audit.planNumber?.trim() ? audit.planNumber : audit.planAvailable ? "Not assigned" : "Not available"}</p></div>
  </>;
}
