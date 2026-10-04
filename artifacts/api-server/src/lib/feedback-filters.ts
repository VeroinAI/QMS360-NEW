import { HttpError } from "./workspace";

const modules = ["qaqc", "lessons", "audit", "system"] as const;
const resolutions = ["open", "reviewing", "hold", "additional_info_required", "resolved", "closed"] as const;
type Resolution = typeof resolutions[number];

/** Shared by the paginated list and Excel export so both use identical filters. */
export function parseFeedbackFilters(query: { module?: unknown; resolution?: unknown }) {
  if (query.module !== undefined
    && (typeof query.module !== "string" || !modules.includes(query.module as typeof modules[number]))) {
    throw new HttpError(422, "Invalid feedback module");
  }
  if (query.resolution !== undefined
    && (typeof query.resolution !== "string" || !resolutions.includes(query.resolution as Resolution))) {
    throw new HttpError(422, "Invalid feedback status");
  }
  const resolution = query.resolution as Resolution | undefined;
  return {
    module: query.module as typeof modules[number] | undefined,
    resolutions: resolution === "reviewing"
      ? ["reviewing", "additional_info_required"] as Resolution[]
      : resolution ? [resolution] : undefined,
  };
}