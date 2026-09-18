import nodemailer from "nodemailer";
import net from "node:net";
import { promises as dns } from "node:dns";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, integrationConnectors, syncJobs, users } from "@workspace/db";
import { decryptSecret } from "./secrets";

/**
 * Outbound email delivery through the SMTP connector configured in the
 * Integration Cockpit (connectorType "email").
 *
 * Connector configuration contract (edited in the Cockpit; secret keys are
 * masked in API responses but stored in `configuration`):
 *   host       string  SMTP server hostname (required)
 *   port       number  SMTP port (default 587, or 465 when secure)
 *   secure     boolean use implicit TLS (default: port === 465)
 *   username   string  SMTP auth user (also accepted: user)
 *   password   string  SMTP auth password (also accepted: pass) — stored
 *               encrypted (enc:v1 envelope, see lib/secrets.ts), masked in the UI
 *   fromAddress string envelope/header From address (also accepted: from; default: username)
 *   fromName   string  display name for the From header (default: "QMS360")
 *
 * Egress policy (tenant admins supply the SMTP host, so destinations are
 * constrained to prevent the connector being used to probe internal networks):
 *   SMTP_ALLOWED_HOSTS        comma-separated allowlist; when set, only these
 *                             hosts may be used (explicit authorization)
 *   SMTP_ALLOW_PRIVATE_HOSTS  "true" permits hosts resolving to private/
 *                             loopback/reserved addresses (e.g. an internal
 *                             relay); blocked by default otherwise
 * Connections are pinned to the validated DNS answer: the hostname is resolved
 * once, every resolved address is vetted, and nodemailer then connects to the
 * vetted IP literal (which it does not re-resolve) while the original hostname
 * is passed as `servername` so TLS certificate verification and SNI still use
 * the hostname. A DNS rebinding between validation and connect therefore
 * cannot redirect the connection.
 *
 * Every delivery batch is recorded as a `sync_jobs` row (jobType
 * "email_delivery") so successes and failures appear in the Cockpit sync-jobs
 * log, and the connector's `configuration.status` is updated to
 * "Connected"/"Failed" so the Cockpit health view reflects the last outcome.
 *
 * Delivery never throws: in-app notifications are the fallback channel and
 * must keep working when SMTP is unconfigured or down.
 */

type Database = typeof db;

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  fromAddress: string;
  fromName: string;
};

export type EmailDeliveryInput = {
  organizationId: string;
  recipientIds: string[];
  /** Explicit external recipients, used by organization email rules. */
  recipients?: Array<{ email: string; name?: string | null }>;
  /** Optional visible sender. SMTP authentication and envelope delivery still use the connector sender. */
  sender?: { email: string; name?: string | null };
  subject: string;
  text: string;
  context?: Record<string, unknown>;
};

export type EmailDeliveryResult =
  | { attempted: false; reason: "no_connector" | "disabled" | "incomplete_config" | "no_recipients" | "unexpected_error" }
  | {
    attempted: true; sent: number; failed: number; error?: string;
    failedRecipients: Array<{ email: string; name?: string | null }>;
  };

function readSmtpConfig(configuration: Record<string, unknown>): SmtpConfig | null {
  const host = typeof configuration.host === "string" ? configuration.host.trim() : "";
  if (!host) return null;
  const secure = typeof configuration.secure === "boolean"
    ? configuration.secure
    : Number(configuration.port) === 465;
  const port = Number(configuration.port) || (secure ? 465 : 587);
  const rawUsername = typeof configuration.username === "string" ? configuration.username
    : typeof configuration.user === "string" ? configuration.user : undefined;
  const username = rawUsername ? decryptSecret(rawUsername) : undefined;
  const rawPassword = typeof configuration.password === "string" ? configuration.password
    : typeof configuration.pass === "string" ? configuration.pass : undefined;
  const password = rawPassword ? decryptSecret(rawPassword) : undefined;
  const fromAddress = typeof configuration.fromAddress === "string" && configuration.fromAddress.trim()
    ? configuration.fromAddress.trim()
    : typeof configuration.from === "string" && configuration.from.trim()
      ? configuration.from.trim()
      : username;
  if (!fromAddress) return null;
  const fromName = typeof configuration.fromName === "string" && configuration.fromName.trim()
    ? configuration.fromName.trim()
    : "QMS360";
  return { host, port, secure, username, password, fromAddress, fromName };
}

function isPrivateOrReservedIp(ip: string): boolean {
  let value = ip.toLowerCase();
  if (value.startsWith("::ffff:")) value = value.slice(7); // IPv4-mapped IPv6
  if (value.includes(":")) {
    return value === "::1" || value === "::"
      || value.startsWith("fc") || value.startsWith("fd") // unique local
      || /^fe[89ab]/.test(value); // link-local fe80::/10
  }
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

type LookupFn = (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname, options) => dns.lookup(hostname, options);

/**
 * Where the SMTP connection is actually allowed to go. `host` is always an IP
 * literal from the validated DNS answer (nodemailer performs no further DNS
 * resolution for IP hosts), and `servername` carries the original hostname for
 * TLS SNI/certificate verification.
 */
export type SmtpTarget = { host: string; servername?: string };

/**
 * Constrains where tenant-configured connectors may open SMTP connections and
 * pins the connection to the vetted DNS answer (DNS-rebinding safe):
 * - An explicit SMTP_ALLOWED_HOSTS allowlist wins (hostname match = authorized,
 *   private-address check skipped, result still pinned).
 * - Otherwise hosts resolving to private/loopback/reserved addresses are
 *   rejected unless the deployment opts in via SMTP_ALLOW_PRIVATE_HOSTS=true.
 * Every call validates a fresh resolution, and the caller connects to the
 * returned IP — never to the hostname — so a rebound DNS answer cannot steer
 * the socket. `lookup` is injectable for tests.
 */
export async function resolveSmtpTarget(host: string, lookup: LookupFn = defaultLookup): Promise<SmtpTarget> {
  const hostname = host.trim();
  if (!hostname) throw new Error("SMTP host is empty");
  const allowlist = (process.env.SMTP_ALLOWED_HOSTS ?? "")
    .split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const allowlisted = allowlist.length > 0 && allowlist.includes(hostname.toLowerCase());
  if (allowlist.length > 0 && !allowlisted) {
    throw new Error(`SMTP host "${hostname}" is not in the SMTP_ALLOWED_HOSTS allowlist`);
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error(`SMTP host "${hostname}" could not be resolved`);
  }
  if (!addresses.length) throw new Error(`SMTP host "${hostname}" could not be resolved`);
  if (!allowlisted && process.env.SMTP_ALLOW_PRIVATE_HOSTS !== "true") {
    for (const { address } of addresses) {
      if (isPrivateOrReservedIp(address)) {
        throw new Error(`SMTP host "${hostname}" resolves to private/reserved address ${address}; set SMTP_ALLOW_PRIVATE_HOSTS=true to allow an internal relay`);
      }
    }
  }
  const target = addresses[0]!.address;
  // IP literals must not be sent as TLS servername; hostnames must be.
  return net.isIP(hostname) ? { host: target } : { host: target, servername: hostname };
}

async function findEmailConnector(database: Database, organizationId: string) {
  const rows = await database.select().from(integrationConnectors).where(and(
    eq(integrationConnectors.organizationId, organizationId),
    eq(integrationConnectors.connectorType, "email"),
    isNull(integrationConnectors.deletedAt),
  ));
  return rows.find((row) => row.isEnabled) ?? rows[0] ?? null;
}

async function setConnectorStatus(
  database: Database,
  connector: typeof integrationConnectors.$inferSelect,
  status: "Connected" | "Failed",
) {
  if (connector.configuration.status === status) return;
  await database.update(integrationConnectors).set({
    configuration: { ...connector.configuration, status },
    updatedAt: new Date(),
  }).where(eq(integrationConnectors.id, connector.id));
}

async function recordSyncJob(
  database: Database,
  input: {
    organizationId: string; connectorId: string; outcome: "success" | "failed";
    durationMs: number; errors: Array<Record<string, unknown>>;
  },
) {
  await database.insert(syncJobs).values({
    organizationId: input.organizationId,
    connectorId: input.connectorId,
    jobType: "email_delivery",
    lastRunAt: new Date(),
    durationMs: Math.round(input.durationMs),
    outcome: input.outcome,
    errorQueue: input.errors,
  });
}

function createTransporter(config: SmtpConfig, target: SmtpTarget) {
  return nodemailer.createTransport({
    host: target.host, // vetted IP literal — nodemailer will not re-resolve it
    port: config.port,
    secure: config.secure,
    // hostname for TLS SNI + certificate verification (merged into both the
    // implicit-TLS connect and the STARTTLS upgrade)
    tls: target.servername ? { servername: target.servername } : undefined,
    auth: config.username ? { user: config.username, pass: config.password ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export async function deliverEmail(
  database: Database,
  input: EmailDeliveryInput,
): Promise<EmailDeliveryResult> {
  try {
    const recipientIds = [...new Set(input.recipientIds)].filter(Boolean);
    const explicitRecipients = (input.recipients ?? []).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
    if (!recipientIds.length && !explicitRecipients.length) return { attempted: false, reason: "no_recipients" };
    // Embedded in every recorded failure so the Cockpit sync-job retry action
    // can resend the exact original email without the caller reconstructing it.
    const retryPayload = { recipientIds, recipients: explicitRecipients, sender: input.sender, subject: input.subject, text: input.text };

    const connector = await findEmailConnector(database, input.organizationId);
    if (!connector) return { attempted: false, reason: "no_connector" };
    if (!connector.isEnabled) return { attempted: false, reason: "disabled" };

    const config = readSmtpConfig(connector.configuration);
    if (!config) {
      await recordSyncJob(database, {
        organizationId: input.organizationId, connectorId: connector.id, outcome: "failed",
        durationMs: 0,
        errors: [{ message: "SMTP connector is missing host/from configuration", ...input.context, ...retryPayload }],
      });
      await setConnectorStatus(database, connector, "Failed");
      return { attempted: false, reason: "incomplete_config" };
    }

    const recipients = await database.select({ id: users.id, email: users.email }).from(users).where(and(
      eq(users.organizationId, input.organizationId),
      inArray(users.id, recipientIds),
      eq(users.accessStatus, "active"),
      isNull(users.deletedAt),
    ));
    const allRecipients = [
      ...recipients.map((recipient) => ({ email: recipient.email, name: null as string | null })),
      ...explicitRecipients,
    ];
    if (!allRecipients.length) return { attempted: false, reason: "no_recipients" };
    const allRecipientRetryPayload = {
      recipientIds: [] as string[], recipients: allRecipients, sender: input.sender, subject: input.subject, text: input.text,
    };

    const startedAt = Date.now();
    const errors: Array<Record<string, unknown>> = [];
    const failedRecipients: Array<{ email: string; name?: string | null }> = [];
    let sent = 0;
    let target: SmtpTarget | null = null;
    try {
      target = await resolveSmtpTarget(config.host);
    } catch (error) {
      failedRecipients.push(...allRecipients);
      errors.push({ message: error instanceof Error ? error.message : String(error), ...input.context, ...allRecipientRetryPayload });
    }
    if (target) {
      const transporter = createTransporter(config, target);
      const visibleSender = input.sender && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.sender.email)
        ? input.sender : { email: config.fromAddress, name: config.fromName };
      const from = `"${(visibleSender.name ?? visibleSender.email).replaceAll('"', "")}" <${visibleSender.email}>`;
      const results = await Promise.allSettled(allRecipients.map((recipient) =>
        transporter.sendMail({
          from,
          envelope: { from: config.fromAddress, to: recipient.email },
          replyTo: visibleSender.email,
          to: recipient.name ? `"${recipient.name.replaceAll('"', "")}" <${recipient.email}>` : recipient.email,
          subject: input.subject,
          text: input.text,
        })));
      transporter.close();
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") {
          sent++;
        } else {
          failedRecipients.push(allRecipients[index]!);
          errors.push({
            recipient: allRecipients[index]!.email,
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
            ...input.context,
            recipientIds: [], recipients: [allRecipients[index]!],
            sender: input.sender,
            subject: input.subject, text: input.text,
          });
        }
      }
    }

    const outcome = errors.length ? "failed" : "success";
    await recordSyncJob(database, {
      organizationId: input.organizationId, connectorId: connector.id, outcome,
      durationMs: Date.now() - startedAt, errors,
    });
    await setConnectorStatus(database, connector, errors.length ? "Failed" : "Connected");
    return {
      attempted: true, sent, failed: errors.length,
      failedRecipients: [...new Map(failedRecipients.map((recipient) => [recipient.email.toLowerCase(), recipient])).values()],
      error: errors[0]?.message as string | undefined,
    };
  } catch (error) {
    // Delivery must never break the caller; in-app notification already stands.
    console.error("Email delivery failed unexpectedly", error);
    return { attempted: false, reason: "unexpected_error" };
  }
}

/**
 * Sends a single test email through a specific email connector (used by the
 * Integration Cockpit "Send test email" action). Unlike deliverEmail this
 * reports failure to the caller, and it still records a sync job + updates
 * connector status so the Cockpit log reflects the attempt.
 */
export async function sendConnectorTestEmail(
  database: Database,
  connector: typeof integrationConnectors.$inferSelect,
  recipientEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  const startedAt = Date.now();
  const record = (outcome: "success" | "failed", errors: Array<Record<string, unknown>>) =>
    recordSyncJob(database, {
      organizationId: connector.organizationId, connectorId: connector.id, outcome,
      durationMs: Date.now() - startedAt, errors,
    });
  const config = readSmtpConfig(connector.configuration);
  if (!config) {
    await record("failed", [{ message: "SMTP connector is missing host/from configuration", kind: "connector_test" }]);
    await setConnectorStatus(database, connector, "Failed");
    return { ok: false, error: "SMTP connector is missing host/from configuration" };
  }
  try {
    const target = await resolveSmtpTarget(config.host);
    const transporter = createTransporter(config, target);
    const from = `"${config.fromName.replaceAll('"', "")}" <${config.fromAddress}>`;
    await transporter.sendMail({
      from,
      to: recipientEmail,
      subject: "QMS360 connector test",
      text: "This is a test email from the QMS360 Integration Cockpit. If you received it, this connector's SMTP settings are working.",
    });
    transporter.close();
    await record("success", []);
    await setConnectorStatus(database, connector, "Connected");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await record("failed", [{ message, kind: "connector_test" }]);
    await setConnectorStatus(database, connector, "Failed");
    return { ok: false, error: message };
  }
}
