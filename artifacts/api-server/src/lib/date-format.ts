import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings } from "@workspace/db";
import { isDateFormat, setDateFormatResolver, type DateFormat } from "@workspace/spreadsheet-dates";

const context = new AsyncLocalStorage<DateFormat>();
const cache = new Map<string, { format: DateFormat; until: number }>();
setDateFormatResolver(() => context.getStore() ?? "DD/MM/YYYY");

export async function organizationDateFormat(organizationId: string): Promise<DateFormat> {
  const cached = cache.get(organizationId);
  if (cached && cached.until > Date.now()) return cached.format;
  const [settings] = await db.select({ branding: organizationSettings.branding }).from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt))).limit(1);
  const raw = settings?.branding?.dateFormat;
  const format = isDateFormat(raw) ? raw : "DD/MM/YYYY";
  if (cache.size > 2000) cache.clear();
  cache.set(organizationId, { format, until: Date.now() + 30_000 });
  return format;
}
export function invalidateOrganizationDateFormat(organizationId: string) { cache.delete(organizationId); }
export async function withOrganizationDateFormat<T>(organizationId: string, work: () => T): Promise<Awaited<T>> {
  return await context.run(await organizationDateFormat(organizationId), work);
}
