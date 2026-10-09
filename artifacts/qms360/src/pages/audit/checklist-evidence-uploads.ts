export type PendingChecklistEvidence = { clientReference: string; file: File };

export function appendChecklistEvidence(
  pending: PendingChecklistEvidence[],
  files: File[],
  createReference = () => crypto.randomUUID(),
): PendingChecklistEvidence[] {
  const key = (file: File) => JSON.stringify([file.name, file.size, file.type, file.lastModified]);
  const selected = new Set(pending.map(item => key(item.file)));
  const additions: PendingChecklistEvidence[] = [];
  for (const file of files) {
    if (selected.has(key(file))) continue;
    selected.add(key(file));
    additions.push({ clientReference: createReference(), file });
  }
  return [...pending, ...additions];
}

/** Retain successful uploads across a failed batch or a failed item save. */
export async function uploadChecklistEvidence(
  pending: PendingChecklistEvidence[],
  completed: Map<string, string>,
  upload: (item: PendingChecklistEvidence) => Promise<string>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const item of pending) {
    let id = completed.get(item.clientReference);
    if (!id) {
      id = await upload(item);
      completed.set(item.clientReference, id);
    }
    ids.push(id);
  }
  return ids;
}
