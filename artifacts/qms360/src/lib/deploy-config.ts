/**
 * Deploy-target config, baked in at build time (Vite env var, not a runtime
 * secret -- same trust model as every other split-frontend app in this
 * environment: the value is visible in the public bundle).
 *
 * Defaults to "" for local dev, where the frontend is served by this same
 * backend (Vite's dev proxy or same-origin), so relative /api/... calls
 * already work.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';
