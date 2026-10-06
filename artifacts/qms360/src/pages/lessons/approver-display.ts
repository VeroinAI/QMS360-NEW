type NamedUser = { id: string; fullName: string };

export function lessonApproverDisplayName(
  selectedId: string,
  saved: { approverId?: string | null; approverName?: string | null } | undefined,
  options: readonly NamedUser[],
  currentUser?: NamedUser,
): string | undefined {
  if (!selectedId) return undefined;
  if (saved?.approverId === selectedId && saved.approverName?.trim()) {
    return saved.approverName;
  }
  const eligible = options.find(option => option.id === selectedId);
  if (eligible) return eligible.fullName;
  if (currentUser?.id === selectedId) return currentUser.fullName;
  return "Approver name unavailable";
}
