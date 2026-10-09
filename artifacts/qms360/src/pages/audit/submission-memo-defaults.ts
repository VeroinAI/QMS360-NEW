import type { AuditMemoDefaults } from "@workspace/api-client-react";

/** Fresh organization defaults win; empty defaults retain existing memo headings. */
export function submissionMemoDefaults(defaults: AuditMemoDefaults, previous: {
  submissionFrom?: string | null; submissionTo?: string | null;
}): AuditMemoDefaults {
  return {
    from: defaults.from.trim() || previous.submissionFrom?.trim() || "",
    to: defaults.to.trim() || previous.submissionTo?.trim() || "",
  };
}
