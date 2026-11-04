import { lessonDepartments } from "./lessons-source";
import { HttpError } from "./workspace";

/** Canonical organization Department Master, shared by all applications. */
export const roleDepartments = lessonDepartments;

export async function validateRoleDepartments(organizationId: string, input: unknown): Promise<string[]> {
  if (!Array.isArray(input) || !input.length || input.some(id => typeof id !== "string")) {
    throw new HttpError(422, "Select at least one active department from Department Master");
  }
  const ids = [...new Set(input as string[])];
  const valid = new Set((await roleDepartments(organizationId)).map(row => row.id));
  if (ids.some(id => !valid.has(id))) {
    throw new HttpError(422, "Selected departments must be active departments in this organization's Department Master");
  }
  return ids;
}
