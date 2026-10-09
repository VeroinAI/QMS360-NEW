export const findingPriorityActions = ["Contain the risk now", "Correct and close", "Prevent recurrence"] as const;
export type FindingPriorityAction = (typeof findingPriorityActions)[number];

export function requireFindingPriorityAction(actionTakerId?: string | null, priority?: string | null): FindingPriorityAction | null {
  if (priority && !findingPriorityActions.some(value => value === priority)) {
    throw new Error("Select a valid Recommended priority actions value.");
  }
  if (actionTakerId?.trim() && !priority) {
    throw new Error("Recommended priority actions is required when an Action Taker is selected.");
  }
  return priority ? priority as FindingPriorityAction : null;
}
