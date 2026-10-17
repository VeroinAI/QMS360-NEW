# Drona mobile container: portable frontend build

Use this instead of the normal frontend build for the Drona container. Normal
Replit development and production builds retain their existing behavior.

## Build and deployment

From the repository root, after pulling the updated code:

```sh
pnpm install --frozen-lockfile
PORT=5173 pnpm --filter @workspace/qms360 run build:drona
pnpm --filter @workspace/qms360 run check:drona-build
```

`PORT` is a build-tool input here, not a publicly exposed port.
The Drona build deliberately ignores `BASE_PATH` for assets: Vite emits relative
JavaScript, CSS and SDK URLs rather than a fixed `/qms360/1.0.5/` prefix.
Do not override the command with `--base /qms360/1.0.5/`.

Deploy the complete contents of `artifacts/qms360/dist/public` together,
preserving the `assets` subdirectory. Replace the HTML and matching assets as one
release. Do not patch generated filenames or deploy only index.html.

Set the container entry to the deployed `index.html` URL or its directory URL
ending in `/`. A directory URL without a trailing slash can resolve relative
assets in the wrong parent directory. Keep assets at the paths relative to that
entry; do not introduce a root-level HTML `<base>` override.

Navigation in this build uses `#/audit/...`, `#/qaqc/...`, etc. The document path
therefore stays fixed, including when refreshing or opening a nested screen.
Existing external links into the container must use that entry URL plus the
corresponding hash route, rather than append an application route to the
document path. The root-scoped PWA manifest and service worker are not activated
by this build; Drona owns its container caching/lifecycle.

## Existing backend connectivity must remain available

This fix changes frontend asset loading, not API hosting or authentication.
Existing same-origin `/api/...` and protected file routes must still reach the
QMS360 backend. Do not redirect those paths to index.html or intercept them as
frontend assets. If the mobile container uses a different origin or a local URL
scheme, its existing API bridge/proxy must provide those routes; relative assets
alone do not configure backend connectivity. Do not put credentials in the build.

No database migration, SQL script, schema change, new bucket, or DBA work is
required for this correction. Existing backend/auth/storage settings stay intact.

## Clear stale clients and verify on the actual device

Invalidate cached old HTML/bundles in the CDN and Drona client where applicable.
If an earlier QMS360 release installed a service worker, retire only the
QMS360-owned registration/cache for that app origin/scope. Do not clear or
unregister other applications' service workers on a shared origin.

Check Android/iOS Drona clients and the browser:

1. Fresh launch: HTML, JavaScript, CSS, and the emitted DronaHQ SDK asset return
   successful responses with the correct content types (not empty 404s or HTML).
2. Drona profile handoff and QMS360 sign-in complete with existing authorization.
3. Open Audit and QA/QC, navigate to a detail page, then refresh/reopen it.
4. Confirm API calls and authorized attachment downloads still succeed.

Please report the actual mobile entry URL (without tokens), client/OS version
and sanitized failed request paths if anything remains blocked.
