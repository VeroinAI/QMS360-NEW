/** Selecting Drona must not accidentally fall back to password/bridge login.
 * No environment flag can bypass the missing verifier or access reconciliation.
 * Replace the gate only together with the reviewed, tested real integration. */
export const DRONA_ACTIVATION_BLOCKERS = [
  "Drona backend session verification is not connected.",
  "Confirmed active-user/project mappings must be reconciled with each user's QMS application access.",
  "Environment-specific schema and existing-record mappings need reconciliation.",
] as const;

export function authenticationConfiguration(strategy: string | undefined) {
  const configured = strategy ?? "local";
  const mode = configured === "local" || configured === "container" || configured === "drona"
    ? configured : "disabled";
  return {
    mode,
    // Preserve the established container bridge behavior; Drona is separate.
    localLoginAllowed: mode === "local" || mode === "container",
    dronaReady: false,
    blockers: mode === "drona" ? [...DRONA_ACTIVATION_BLOCKERS]
      : mode === "disabled" ? ["Unsupported authentication strategy."] : [],
  };
}

export function authenticationUnavailableMessage(strategy: string | undefined): string | null {
  const config = authenticationConfiguration(strategy);
  return config.mode === "drona"
    ? "Drona sign-in is not activated: backend session verification and access reconciliation are required."
    : config.mode === "disabled" ? "Authentication configuration is invalid." : null;
}