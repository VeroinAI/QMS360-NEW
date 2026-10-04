import { dronaId, environmentKey } from "./ids";

export type DronaLinkKind = "user" | "project";
export type DronaLink = {
  environment: string;
  organizationId: string;
  kind: DronaLinkKind;
  internalId: string;
  externalId: string;
  reviewReference: string;
};
export type InternalLinkTarget = {
  kind: DronaLinkKind; id: string; organizationId: string; deleted: boolean;
};
export type SourceLinkTarget = { kind: DronaLinkKind; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateLink(link: DronaLink, environment: string): void {
  if (link.environment !== environment) throw new Error("Cross-environment identity mapping is not permitted");
  if (link.kind !== "user" && link.kind !== "project") throw new Error("Unsupported identity mapping kind");
  if (!UUID.test(link.internalId) || !UUID.test(link.organizationId)) throw new Error("Identity links require UUID internal references");
  if (link.internalId !== link.internalId.toLowerCase() || link.organizationId !== link.organizationId.toLowerCase()) {
    throw new Error("Identity links require canonical lowercase UUIDs");
  }
  dronaId(link.externalId);
  if (!link.reviewReference?.trim()) throw new Error("Identity links require an explicit review reference");
}

/** Pure preparation only: no inferred matches, identity updates, grants or SQL.
 * One reviewed external ID maps to one stable UUID per organization/environment.
 * Missing links are reported, never converted into organization-wide access. */
export function prepareDronaLinks(input: {
  environment: string;
  internalTargets: InternalLinkTarget[];
  sourceTargets: SourceLinkTarget[];
  existingLinks: DronaLink[];
  reviewedLinks: DronaLink[];
}): { additions: DronaLink[]; unresolved: InternalLinkTarget[] } {
  const environment = environmentKey(input.environment);
  const targets = new Map<string, InternalLinkTarget>();
  for (const target of input.internalTargets) {
    const key = `${target.kind}:${target.organizationId}:${target.id}`;
    if (targets.has(key)) throw new Error("Duplicate internal inventory entry");
    targets.set(key, target);
  }
  const sources = new Set(input.sourceTargets.map((target) => `${target.kind}:${dronaId(target.id)}`));
  const byInternal = new Map<string, DronaLink>();
  const byExternal = new Map<string, DronaLink>();
  const additions: DronaLink[] = [];
  for (const [links, existing] of [[input.existingLinks, true], [input.reviewedLinks, false]] as const) {
    for (const link of links) {
      validateLink(link, environment);
      const internalKey = `${link.kind}:${link.organizationId}:${link.internalId}`;
      const externalKey = `${link.kind}:${link.organizationId}:${link.externalId}`;
      const target = targets.get(internalKey);
      if (!target || target.deleted) throw new Error("Identity mapping has an unavailable or wrong-organization internal target");
      if (!sources.has(`${link.kind}:${link.externalId}`)) throw new Error("Identity mapping has an unavailable Drona source target");
      const oldInternal = byInternal.get(internalKey);
      const oldExternal = byExternal.get(externalKey);
      if ((oldInternal && oldInternal.externalId !== link.externalId)
        || (oldExternal && oldExternal.internalId !== link.internalId)) {
        throw new Error("Conflicting identity mappings require manual reconciliation");
      }
      if (existing && (oldInternal || oldExternal)) throw new Error("Duplicate stored identity mapping");
      if (oldInternal) continue; // Idempotent repeat of an already reviewed pair.
      byInternal.set(internalKey, { ...link });
      byExternal.set(externalKey, { ...link });
      if (!existing) additions.push({ ...link });
    }
  }
  return {
    additions,
    unresolved: input.internalTargets.filter((target) => !target.deleted
      && !byInternal.has(`${target.kind}:${target.organizationId}:${target.id}`)).map((target) => ({ ...target })),
  };
}