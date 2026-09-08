import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  connectorFieldMappings, db, importTemplates, integrationConnectors, projects, syncJobs, users,
} from "@workspace/db";
import { decryptSecret } from "./secrets";
import { HttpError } from "./workspace";

// Source-system sync (Integration Cockpit). Two entity kinds are supported —
// project details and user details — via two channels: API pull from a
// `source_api` connector (ERP, custom app, ...) and Excel file-drop import.
// Connector configuration stores per-entity endpoints so a future "push"
// direction can reuse the same mappings in reverse without a schema change.

export type SyncEntity = "projects" | "users";
export type TemplateColumn = { header: string; field: string; required: boolean };
export type RowError = { row: number; message: string };
export type ApplyResult = { sourceCount: number; targetCount: number; errors: RowError[] };

// Only deliberate, user-facing validation messages may leave the importer.
// Database errors can contain full SQL statements and bound row values.
class ImportRowError extends Error {}

export const SYNC_ENTITIES = new Set<SyncEntity>(["projects", "users"]);

// Target field keys starting with `custom.` are stored in the entity's
// custom_fields JSONB — that is how a new template column becomes an accepted
// "DB field" without ALTER TABLE on shared multi-tenant tables.
export const CUSTOM_FIELD_PATTERN = /^custom\.[a-z0-9_]+$/i;

export type EntityCatalogEntry = {
  entity: string;
  label: string;
  sourceSuggestions: string[];
  targetFields: Array<{ key: string; label: string; required: boolean }>;
};

export const ENTITY_CATALOG: EntityCatalogEntry[] = [
  {
    entity: "projects", label: "Project details",
    sourceSuggestions: ["project_code", "project_name", "location", "status", "external_id"],
    targetFields: [
      { key: "code", label: "Project code", required: true },
      { key: "name", label: "Project name", required: true },
      { key: "location", label: "Location", required: false },
      { key: "status", label: "Status (active/inactive)", required: false },
      { key: "externalId", label: "External reference", required: false },
    ],
  },
  {
    entity: "users", label: "User details",
    sourceSuggestions: ["email", "full_name", "username", "project_code", "department", "job_title"],
    targetFields: [
      { key: "email", label: "Email", required: true },
      { key: "fullName", label: "Full name", required: true },
      { key: "username", label: "Username", required: false },
      { key: "projectCode", label: "Project code (links the user to a project)", required: false },
    ],
  },
];

export const DEFAULT_TEMPLATES: Record<SyncEntity, { name: string; columns: TemplateColumn[] }> = {
  projects: {
    name: "Default — Project details",
    columns: [
      { header: "Project Code", field: "code", required: true },
      { header: "Project Name", field: "name", required: true },
      { header: "Location", field: "location", required: false },
      { header: "Status", field: "status", required: false },
      { header: "External Ref", field: "externalId", required: false },
    ],
  },
  users: {
    name: "Default — User details",
    columns: [
      { header: "Email", field: "email", required: true },
      { header: "Full Name", field: "fullName", required: true },
      { header: "Username", field: "username", required: false },
      { header: "Project Code", field: "projectCode", required: false },
    ],
  },
};

// ---------------------------------------------------------------------------
// API pull

/** Reads a (possibly dotted) path from a JSON payload — `data.items` etc. */
export function getPath(payload: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((node, key) => (
    node && typeof node === "object" && !Array.isArray(node) ? (node as Record<string, unknown>)[key] : undefined
  ), payload);
}

function readSecret(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" && value ? decryptSecret(value) : "";
}

function authHeaders(config: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.authType === "bearer") {
    const token = readSecret(config, "token");
    if (token) headers.authorization = `Bearer ${token}`;
  } else if (config.authType === "api_key") {
    const key = readSecret(config, "apiKey");
    // apiKeyHeader matches the generic "api.?key" secret-key pattern, so it may
    // be stored encrypted too — decrypt it like the key itself.
    const headerName = readSecret(config, "apiKeyHeader") || "x-api-key";
    if (key) headers[headerName] = key;
  } else if (config.authType === "basic") {
    const user = readSecret(config, "username");
    const password = readSecret(config, "password");
    if (user || password) headers.authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }
  return headers;
}

type EndpointConfig = { path?: unknown; rootPath?: unknown };

function isPrivateOrReservedIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19)); // benchmark range
}

/** Parses an IPv6 address (any RFC 4291 form, incl. dotted-IPv4 tails) into 16 bytes, or null. */
function parseIpv6Bytes(value: string): number[] | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const expand = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(":");
    const bytes: number[] = [];
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index]!;
      if (group.includes(".")) {
        if (index !== groups.length - 1) return null;
        const v4 = group.split(".").map(Number);
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        bytes.push(v4[0]!, v4[1]!, v4[2]!, v4[3]!);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
        const n = parseInt(group, 16);
        bytes.push((n >> 8) & 0xff, n & 0xff);
      }
    }
    return bytes;
  };
  const head = expand(halves[0]!);
  const tail = halves.length === 2 ? expand(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 16 ? head : null;
  const missing = 16 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * Complete IP classification for the SSRF guard (exported for tests). Works
 * on the 16-byte form so EVERY IPv4-mapped/compatible encoding — dotted or
 * hex groups, e.g. ::ffff:127.0.0.1 vs ::ffff:7f00:1 — is classified by its
 * embedded IPv4 address; anything unparsable or non-global-unicast is treated
 * as private/reserved (fail closed).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const value = ip.toLowerCase().split("%")[0]!.trim(); // strip any zone id
  if (!value.includes(":")) return isPrivateOrReservedIpv4(value);
  const bytes = parseIpv6Bytes(value);
  if (!bytes) return true;
  if (bytes.slice(0, 10).every((b) => b === 0)) {
    if (bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateOrReservedIpv4(bytes.slice(12).join(".")); // IPv4-mapped
    if (bytes[10] === 0 && bytes[11] === 0) {
      const rest = bytes.slice(12);
      if (rest.every((b) => b === 0)) return true; // :: unspecified
      if (rest[0] === 0 && rest[1] === 0 && rest[2] === 0 && rest[3] === 1) return true; // ::1 loopback
      return isPrivateOrReservedIpv4(rest.join(".")); // IPv4-compatible (deprecated)
    }
    return true; // other ::/80 reserved space
  }
  if ((bytes[0]! & 0xfe) === 0xfc) return true; // unique local fc00::/7
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (bytes[0] === 0xff) return true; // multicast ff00::/8
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // documentation 2001:db8::/32
  if (bytes[0] === 0x01 && bytes.slice(1, 8).every((b) => b === 0)) return true; // discard-only 100::/64
  return false;
}

/**
 * SSRF guard for tenant-configured source URLs. Decrypted credentials are
 * attached to these requests, so the destination is constrained AND pinned:
 * - Endpoint paths must be relative to the configured base URL (an absolute
 *   URL must never steer credentials to a different host); origin verified.
 * - The host is DNS-resolved ONCE and the request connects only to those
 *   validated answers via a custom `lookup` — DNS-rebinding safe. `fetch` is
 *   deliberately not used here because it would re-resolve the hostname.
 * - Private/loopback/reserved addresses are rejected unless the hostname is
 *   in the deployment-managed SOURCE_SYNC_ALLOWED_HOSTS allowlist
 *   (comma-separated hostnames/IPs, e.g. "erp.internal,10.0.0.5"). There is
 *   deliberately no blanket private-network opt-out.
 * - Redirects are never followed, so a source cannot bounce credentials on.
 */
function allowedSourceHosts(): string[] {
  return (process.env.SOURCE_SYNC_ALLOWED_HOSTS ?? "")
    .split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

type ResolvedAddress = { address: string; family: number };

async function resolveSourceAddresses(url: URL): Promise<ResolvedAddress[]> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new HttpError(422, `Source host "${url.hostname}" could not be resolved`);
  }
  if (!addresses.length) throw new HttpError(422, `Source host "${url.hostname}" could not be resolved`);
  if (!allowedSourceHosts().includes(url.hostname.toLowerCase())) {
    for (const { address } of addresses) {
      if (isPrivateOrReservedIp(address)) {
        throw new HttpError(422, `Source host "${url.hostname}" resolves to a private/reserved address; add the hostname to the SOURCE_SYNC_ALLOWED_HOSTS allowlist to enable an internal source system`);
      }
    }
  }
  return addresses;
}

/** GETs a URL, connecting ONLY to the pre-validated DNS answers. */
function fetchJsonPinned(url: URL, headers: Record<string, string>, addresses: ResolvedAddress[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => { req.destroy(); reject(error); };
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, {
      method: "GET",
      headers,
      timeout: 15000,
      // Pin DNS to the validated answers: the socket can never be steered to
      // an address the SSRF guard did not approve, no matter what DNS says now.
      lookup: (_hostname, options, callback) => {
        if ((options as { all?: boolean }).all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        fail(new HttpError(502, "Source system attempted a redirect — redirects are not followed on credentialled pulls"));
        return;
      }
      if (status < 200 || status >= 300) {
        fail(new HttpError(502, `Source system responded with HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) { fail(new HttpError(502, "Source response exceeded the 10 MB limit")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new HttpError(502, "Source system did not return JSON")); }
      });
      res.on("error", fail);
    });
    req.on("timeout", () => fail(new HttpError(502, "Source system did not respond within 15 seconds")));
    req.on("error", (error) => reject(new HttpError(502, `Source system unreachable: ${error.message}`)));
    req.end();
  });
}

function endpointFor(config: Record<string, unknown>, entity: SyncEntity): { url: string; rootPath: string } {
  const endpoints = (config.endpoints ?? {}) as Record<string, EndpointConfig | undefined>;
  const endpoint = endpoints[entity];
  const path = typeof endpoint?.path === "string" ? endpoint.path.trim() : "";
  if (!path) throw new HttpError(422, `No ${entity} endpoint path is configured for this connector`);
  if (/^(\/\/|[a-z][a-z0-9+.-]*:)/i.test(path)) {
    throw new HttpError(422, "Endpoint paths must be relative to the connector base URL, not absolute URLs");
  }
  const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : "";
  let url: URL;
  try {
    url = new URL(path, baseUrl);
  } catch {
    throw new HttpError(422, "The connector base URL or endpoint path is not a valid URL");
  }
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(422, "Only http(s) source URLs are supported");
  try {
    if (url.origin !== new URL(baseUrl).origin) throw new Error("origin mismatch");
  } catch {
    throw new HttpError(422, "Endpoint path must stay on the connector base URL host");
  }
  return { url: url.toString(), rootPath: typeof endpoint?.rootPath === "string" ? endpoint.rootPath : "" };
}

/** Fetches the configured entity endpoint and returns the record array. */
export async function fetchEntityRows(connector: typeof integrationConnectors.$inferSelect, entity: SyncEntity): Promise<Array<Record<string, unknown>>> {
  const config = connector.configuration;
  const { url, rootPath } = endpointFor(config, entity);
  const target = new URL(url);
  const addresses = await resolveSourceAddresses(target);
  const payload = await fetchJsonPinned(target, authHeaders(config), addresses);
  const rows = rootPath ? getPath(payload, rootPath) : payload;
  if (!Array.isArray(rows)) {
    throw new HttpError(422, "The endpoint response is not a JSON array — set the root path to the array inside the payload");
  }
  return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

/** Applies active connector field mappings to raw source rows. */
export function mapSourceRows(
  mappings: Array<{ sourceField: string; targetField: string }>,
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((row) => Object.fromEntries(mappings.map((mapping) => [mapping.targetField, getPath(row, mapping.sourceField)])));
}

// ---------------------------------------------------------------------------
// Upserts

const text = (value: unknown): string | null => {
  if (value == null) return null;
  const out = String(value).trim();
  return out || null;
};

function pickCustomFields(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row)
    .filter(([key, value]) => CUSTOM_FIELD_PATTERN.test(key) && value != null && String(value).trim() !== "")
    .map(([key, value]) => [key.slice("custom.".length), typeof value === "string" ? value.trim() : value]));
}

async function upsertProject(organizationId: string, source: string, row: Record<string, unknown>): Promise<void> {
  const code = text(row.code);
  if (!code) throw new ImportRowError("Missing project code");
  const name = text(row.name) ?? code;
  const custom = pickCustomFields(row);
  const location = text(row.location);
  const externalId = text(row.externalId);
  const rawStatus = text(row.status);
  // Optional mapped values only overwrite when the source actually sent a
  // value — a missing cell must never erase stored data.
  const status = rawStatus ? (/^(inactive|disabled|closed)$/i.test(rawStatus) ? "inactive" : "active") : undefined;
  const [existing] = await db.select().from(projects).where(and(
    eq(projects.organizationId, organizationId), eq(projects.code, code), isNull(projects.deletedAt),
  )).limit(1);
  if (existing) {
    await db.update(projects).set({
      name, source,
      ...(location !== null ? { location } : {}),
      ...(externalId !== null ? { externalId } : {}),
      ...(status ? { status } : {}),
      customFields: { ...existing.customFields, ...custom },
      updatedAt: new Date(),
    }).where(eq(projects.id, existing.id));
    return;
  }
  await db.insert(projects).values({
    organizationId, code, name, location, externalId, source, customFields: custom,
    ...(status ? { status } : {}),
  });
}

async function upsertUser(organizationId: string, source: string, row: Record<string, unknown>): Promise<void> {
  const email = text(row.email)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ImportRowError("Missing or invalid email");
  const fullName = text(row.fullName) ?? email.split("@")[0]!;
  const username = text(row.username) ?? email.split("@")[0]!;
  const custom = pickCustomFields(row);
  let projectId: string | null | undefined;
  const projectCode = text(row.projectCode);
  if (projectCode) {
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.organizationId, organizationId), eq(projects.code, projectCode), isNull(projects.deletedAt),
    )).limit(1);
    if (!project) throw new ImportRowError(`Unknown project code "${projectCode}"`);
    projectId = project.id;
  }
  const [existing] = await db.select({
    id: users.id, username: users.username, customFields: users.customFields,
  }).from(users).where(and(
    eq(users.organizationId, organizationId), eq(users.email, email), isNull(users.deletedAt),
  )).limit(1);
  if (existing) {
    const wantedUsername = text(row.username);
    if (wantedUsername && wantedUsername !== existing.username) {
      const [taken] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.organizationId, organizationId), eq(users.username, wantedUsername), isNull(users.deletedAt),
      )).limit(1);
      if (taken) throw new ImportRowError(`Username "${wantedUsername}" is already in use`);
    }
    await db.update(users).set({
      fullName,
      ...(wantedUsername ? { username: wantedUsername } : {}),
      customFields: { ...existing.customFields, ...custom },
      ...(projectId !== undefined ? { projectId } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, existing.id));
    return;
  }
  const [usernameTaken] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.organizationId, organizationId), eq(users.username, username), isNull(users.deletedAt),
  )).limit(1);
  if (usernameTaken) throw new ImportRowError(`Username "${username}" is already in use`);
  // Keep the import independent of unrelated account-management columns.
  await db.execute(sql`
    insert into shared.users (
      organization_id, email, username, full_name, project_id,
      password_hash, auth_source, custom_fields
    ) values (
      ${organizationId}, ${email}, ${username}, ${fullName}, ${projectId ?? null},
      null, ${source}, ${JSON.stringify(custom)}::jsonb
    )
  `);
}

/**
 * Upserts keyed rows (target field → value) into projects or users. Row
 * failures are collected, never fatal — one bad row must not block the rest.
 */
export async function applyEntityRows(
  organizationId: string, entity: SyncEntity, source: string, keyedRows: Array<Record<string, unknown>>,
): Promise<ApplyResult> {
  const errors: RowError[] = [];
  let targetCount = 0;
  for (let index = 0; index < keyedRows.length; index++) {
    try {
      if (entity === "projects") await upsertProject(organizationId, source, keyedRows[index]!);
      else await upsertUser(organizationId, source, keyedRows[index]!);
      targetCount += 1;
    } catch (error) {
      errors.push({ row: index + 1, message: error instanceof ImportRowError ? error.message : "Row could not be imported" });
    }
  }
  return { sourceCount: keyedRows.length, targetCount, errors };
}

/** Records a pull/import run. A trailing `summary` entry keeps record counts
 *  in the job row without being mistaken for an error by sync job DTOs. */
export async function recordSyncJob(
  organizationId: string, connectorId: string | null, jobType: string, startedAt: number, result: ApplyResult,
): Promise<void> {
  await db.insert(syncJobs).values({
    organizationId, connectorId, jobType,
    outcome: result.errors.length === 0 || result.targetCount > 0 ? "success" : "failed",
    durationMs: Date.now() - startedAt,
    lastRunAt: new Date(),
    errorQueue: [
      ...result.errors.map((error) => ({ ...error, kind: "row" })),
      { kind: "summary", sourceCount: result.sourceCount, targetCount: result.targetCount, errorCount: result.errors.length },
    ],
  });
}

// ---------------------------------------------------------------------------
// Excel import templates

export async function ensureDefaultTemplates(organizationId: string): Promise<void> {
  for (const entity of ["projects", "users"] as const) {
    const [existing] = await db.select({ id: importTemplates.id }).from(importTemplates).where(and(
      eq(importTemplates.organizationId, organizationId), eq(importTemplates.entity, entity),
      eq(importTemplates.isDefault, true), isNull(importTemplates.deletedAt),
    )).limit(1);
    if (!existing) {
      await db.insert(importTemplates).values({
        organizationId, entity, name: DEFAULT_TEMPLATES[entity].name,
        isDefault: true, columns: DEFAULT_TEMPLATES[entity].columns,
      });
    }
  }
}

/** Returns an error message, or null when the column set is valid. */
export function validateTemplateColumns(entity: SyncEntity, columns: TemplateColumn[]): string | null {
  const catalog = ENTITY_CATALOG.find((entry) => entry.entity === entity);
  if (!catalog) return `Unknown entity "${entity}"`;
  if (!columns.length) return "A template needs at least one column";
  const coreFields = new Set(catalog.targetFields.map((field) => field.key));
  const seenHeaders = new Set<string>();
  const seenFields = new Set<string>();
  for (const column of columns) {
    const header = column.header?.trim();
    if (!header) return "Column headers cannot be blank";
    if (seenHeaders.has(header.toLowerCase())) return `Duplicate column header "${header}"`;
    seenHeaders.add(header.toLowerCase());
    if (!coreFields.has(column.field) && !CUSTOM_FIELD_PATTERN.test(column.field)) {
      return `Unknown target field "${column.field}" — use a listed field or custom.<name>`;
    }
    if (seenFields.has(column.field)) return `Field "${column.field}" is used by more than one column`;
    seenFields.add(column.field);
  }
  const missing = catalog.targetFields.filter((field) => field.required && !seenFields.has(field.key));
  if (missing.length) return `Required fields missing: ${missing.map((field) => field.label).join(", ")}`;
  return null;
}

/** Builds the downloadable .xlsx for a template. Header row only — a hint row
 *  would round-trip through parseImportFile as a bogus data row. */
export function buildTemplateFile(template: { entity: string; name: string; columns: TemplateColumn[] }): { fileName: string; contentBase64: string } {
  const headers = template.columns.map((column) => column.header);
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(14, header.length + 4) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Template");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fileName = `${template.entity}-${template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.xlsx`;
  return { fileName, contentBase64: buffer.toString("base64") };
}

/** Parses an uploaded workbook into keyed rows validated against the template. */
export function parseImportFile(buffer: Buffer, template: { columns: TemplateColumn[] }): Array<Record<string, unknown>> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new HttpError(422, "The uploaded file could not be read — upload an .xlsx or .xls workbook");
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new HttpError(422, "The workbook has no sheets");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const headerRow = (grid[0] ?? []).map((cell) => String(cell ?? "").trim().toLowerCase());
  const positions = template.columns.map((column) => ({ column, index: headerRow.indexOf(column.header.trim().toLowerCase()) }));
  const missing = positions.filter((position) => position.column.required && position.index === -1);
  if (missing.length) {
    throw new HttpError(422, `Missing required column(s): ${missing.map((position) => position.column.header).join(", ")}`);
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const cells of grid.slice(1)) {
    const keyed: Record<string, unknown> = {};
    let hasValue = false;
    for (const { column, index } of positions) {
      if (index === -1) continue;
      const value = cells[index];
      if (value != null && String(value).trim() !== "") hasValue = true;
      keyed[column.field] = typeof value === "string" ? value.trim() : value;
    }
    if (hasValue) rows.push(keyed);
  }
  if (!rows.length) throw new HttpError(422, "The workbook contains no data rows");
  return rows;
}
