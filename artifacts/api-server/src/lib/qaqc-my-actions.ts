export function personalReportAction(
  row: { reportType: string; state: string; createdById: string; approverId?: string | null; submittedById?: string | null },
  userId: string,
  access: { edit: boolean; review: boolean },
): boolean {
  if (row.state === "draft" || row.state === "sent_back") return row.createdById === userId && access.edit;
  return row.state === "submitted" && row.reportType !== "csat"
    && row.approverId === userId && row.submittedById !== userId && access.review;
}
