/** Approved Lessons numbering fields. These are identifiers, not database paths. */
export const LESSON_NUMBER_FIELDS = [
  { source: "Project Master", label: "Cost Center", token: "{Project->Cost Center}", key: "costCentre" },
  { source: "Discipline Master", label: "Value", token: "{Discipline Master->Value}", key: "disciplineValue" },
] as const;

export type LessonNumberContext = { costCentre?: unknown; disciplineValue?: unknown };
export class ReferencePrefixError extends Error {}

export function referencePrefixError(prefix: string): string | null {
  if (prefix.length > 200) return "Prefix must be no longer than 200 characters.";
  let literal = prefix;
  for (const field of LESSON_NUMBER_FIELDS) literal = literal.split(field.token).join("");
  return /[{}]/.test(literal)
    ? "Unknown or incomplete field placeholder. Use Insert field to select a supported field."
    : /[\u0000-\u001f\u007f]/.test(literal)
      ? "Prefix cannot contain control characters." : null;
}

export function resolveReferencePrefix(prefix: string, context: LessonNumberContext = {}): string {
  const error = referencePrefixError(prefix);
  if (error) throw new ReferencePrefixError(error);
  let result = prefix;
  for (const field of LESSON_NUMBER_FIELDS) {
    if (!result.includes(field.token)) continue;
    const raw = context[field.key];
    if (typeof raw !== "string" || !raw.trim()) {
      throw new ReferencePrefixError(`${field.source} ${field.label} is missing. ${field.key === "costCentre"
        ? "Set the selected project's Cost Center in Project Master before creating this Lesson."
        : "Select a valid discipline before creating this Lesson."}`);
    }
    if (/[\u0000-\u001f\u007f{}]/.test(raw)) {
      throw new ReferencePrefixError(`${field.source} ${field.label} contains unsupported characters.`);
    }
    result = result.split(field.token).join(raw.trim());
  }
  return result;
}

export function projectNumberContext(customFields: Record<string, unknown>, disciplineValue?: string): LessonNumberContext {
  return { costCentre: customFields.costCentre ?? customFields.cost_centre, disciplineValue };
}
