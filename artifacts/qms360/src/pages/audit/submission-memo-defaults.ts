import type { AuditMemoDefaults, AuditProgramme } from "@workspace/api-client-react";

export type ProgrammeSubmission = Pick<AuditProgramme, "id" | "title"> & Partial<Pick<AuditProgramme,
  "workflowState" | "submissionReference" | "submissionFrom" | "submissionTo" |
  "submissionSubject" | "submissionMailBody"
>>;

/** Initialize only when opening a popup, independently of asynchronous headings. */
export function submissionMemoContent(previous: ProgrammeSubmission) {
  return {
    reference: previous.submissionReference ?? "",
    subject: previous.submissionSubject?.trim() ? previous.submissionSubject : previous.title,
    mailBody: previous.submissionMailBody?.trim() ? previous.submissionMailBody : "",
  };
}

/** Fresh organization defaults win; empty defaults retain existing memo headings. */
export function submissionMemoDefaults(defaults: AuditMemoDefaults, previous: {
  submissionFrom?: string | null; submissionTo?: string | null;
}): AuditMemoDefaults {
  return {
    from: defaults.from.trim() || previous.submissionFrom?.trim() || "",
    to: defaults.to.trim() || previous.submissionTo?.trim() || "",
  };
}
