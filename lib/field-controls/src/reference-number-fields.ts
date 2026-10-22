/** Approved Lessons numbering fields. These are identifiers, not database paths. */
export const LESSON_NUMBER_FIELDS = [
  { source: "Project Master", label: "Cost Center", token: "{Project->Cost Center}", key: "costCentre" },
  { source: "Discipline Master", label: "Value", token: "{Discipline Master->Value}", key: "disciplineValue" },
  { source: "Project Master", label: "Contract / project no.", token: "{Project->Contract}", key: "contract" },
  { source: "Department Master", label: "Cost ID", token: "{Department Master->Cost ID}", key: "departmentCostId" },
  { source: "Department Master", label: "Value", token: "{Department Master->Value}", key: "departmentValue" },
] as const;

export type LessonNumberContext = { costCentre?: unknown; disciplineValue?: unknown; contract?: unknown; departmentCostId?: unknown; departmentValue?: unknown };
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
        : field.key === "contract" ? "Set Contract / project no. in the selected project's Additional Data."
        : field.key === "departmentCostId" ? "Set Cost ID in the selected Department Master."
        : field.key === "departmentValue" ? "Set Value in the selected Department Master."
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
  const additional = customFields.qmsAdditionalData as Record<string, unknown> | undefined;
  return { costCentre: customFields.costCentre ?? customFields.cost_centre, disciplineValue,
    ...(additional?.contractProjectNumber !== undefined ? { contract: additional.contractProjectNumber } : {}) };
}

export function departmentNumberContext(metadata: Record<string, unknown> | null | undefined, code: string, disciplineValue?: string): LessonNumberContext {
  return { departmentCostId: metadata?.costId, departmentValue: code.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, ""), disciplineValue };
}

export function lessonSourcePrefixError(prefix: string, sourceType: "Project" | "Department"): string | null {
  const error = referencePrefixError(prefix);
  if (error) return error;
  const incompatible = LESSON_NUMBER_FIELDS.find(field => prefix.includes(field.token)
    && (sourceType === "Department" ? field.source === "Project Master" : field.source === "Department Master"));
  return incompatible ? `${incompatible.source} fields cannot be used for ${sourceType} Lessons. Select a field for this source.` : null;
}
