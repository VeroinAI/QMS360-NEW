/** Email-only activation is an explicitly approved exception, not verified SSO.
 * Keep local/bridge login disabled in Drona mode, including during this exception. */
export const DRONA_ACTIVATION_BLOCKERS = [
  "Drona backend session verification is not connected.",
  "Confirmed active-user/project mappings must be reconciled with each user's QMS application access.",
  "Environment-specific schema and existing-record mappings need reconciliation.",
] as const;

export function authenticationConfiguration(strategy: string | undefined) {
  const configured = strategy ?? "local";
  const mode = configured === "local" || configured === "container" || configured === "drona"
    ? configured : "disabled";
  const exception = mode === "drona" && process.env.DRONA_EMAIL_EXCEPTION_ENABLED === "true";
  const ready = exception && process.env.DRONA_MAPPING_REVIEWED === "true"
    && /^[a-z][a-z0-9_-]{1,63}$/.test(process.env.DRONA_ENVIRONMENT ?? "")
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(process.env.DRONA_ORGANIZATION_ID ?? "");
  return {
    mode,
    // Preserve the established container bridge behavior; Drona is separate.
    localLoginAllowed: mode === "local" || mode === "container",
    dronaReady: ready,
    ...(exception ? { dronaEmailException: true } : {}),
    blockers: mode === "drona" ? ready ? [] : exception
      ? ["Reviewed target organization/environment and automatic-setup database migrations are required."]
      : [...DRONA_ACTIVATION_BLOCKERS]
      : mode === "disabled" ? ["Unsupported authentication strategy."] : [],
  };
}

export function authenticationUnavailableMessage(strategy: string | undefined): string | null {
  const config = authenticationConfiguration(strategy);
  return config.mode === "drona" && !config.dronaReady
    ? config.dronaEmailException
      ? "Drona email-only exception is not activated: reviewed target configuration and automatic-setup database migrations are required."
      : "Drona sign-in is not activated: backend session verification and access reconciliation are required."
    : config.mode === "disabled" ? "Authentication configuration is invalid." : null;
}