import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings } from "@workspace/db";

export type FieldControlSetting = { access: "editable" | "read_only"; requirement: "optional" | "mandatory" };
export type FieldControlsMatrix = Record<string, Record<string, FieldControlSetting>>;

// Field-control matrices live in the shared organization_settings.branding JSON payload
// under the `fieldControls` key, shaped { [appKey]: { [formKey]: { [fieldKey]: setting } } }.
export async function readFieldControls(organizationId: string, appKey: string): Promise<FieldControlsMatrix> {
  const [settings] = await db.select({ branding: organizationSettings.branding }).from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt))).limit(1);
  return (((settings?.branding as any)?.fieldControls?.[appKey]) ?? {}) as FieldControlsMatrix;
}

export async function writeFieldControls(organizationId: string, appKey: string, matrix: FieldControlsMatrix): Promise<FieldControlsMatrix | undefined> {
  const [existing] = await db.select().from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt))).limit(1);
  const before = (existing?.branding as any)?.fieldControls?.[appKey] as FieldControlsMatrix | undefined;
  const branding = {
    ...(existing?.branding ?? {}),
    fieldControls: { ...((existing?.branding as any)?.fieldControls ?? {}), [appKey]: matrix },
  };
  if (existing) {
    await db.update(organizationSettings).set({ branding, updatedAt: new Date() }).where(eq(organizationSettings.id, existing.id));
  } else {
    await db.insert(organizationSettings).values({ organizationId, branding });
  }
  return before;
}
