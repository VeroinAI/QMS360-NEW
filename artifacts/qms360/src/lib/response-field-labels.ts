export const responseFieldLabels = {
  rootCause: "Why Did It Happen? (Root Cause)",
  correction: "How can we rectify? (Correction)",
  correctiveAction: "How It can Be Avoided in Future? (Corrective Action)",
} as const;

/** Presentation only: never changes field keys, values, or permission metadata. */
export function responseFieldLabel(label: string): string {
  switch (label.trim().toLowerCase().replace(/\s+/g, " ")) {
    case "rootcause":
    case "root cause":
      return responseFieldLabels.rootCause;
    case "correction":
      return responseFieldLabels.correction;
    case "correctiveaction":
    case "corrective action":
      return responseFieldLabels.correctiveAction;
    case "corrective action recorded":
      return `${responseFieldLabels.correctiveAction} — Recorded`;
    case "correction and corrective action":
      return `${responseFieldLabels.correction} / ${responseFieldLabels.correctiveAction}`;
    default:
      return label;
  }
}
