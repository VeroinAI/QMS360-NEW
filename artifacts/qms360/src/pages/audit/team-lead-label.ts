import type { AuditTeamLeadOption } from "@workspace/api-client-react";

export function auditTeamLeadLabel(user: Pick<AuditTeamLeadOption, "fullName" | "email">): string {
  return `${user.fullName} (${user.email?.trim() || "Email unavailable"})`;
}