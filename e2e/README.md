# QMS360 end-to-end tests

The suite runs against a provisioned QMS360 development environment.

## Required environment

Before running `pnpm test:e2e`:

1. Apply the current database migrations and seed the QMS360 demo foundation.
2. Start the managed API Server and QMS360 web workflows.
3. Set `PLAYWRIGHT_BASE_URL` when the target is not the current Replit development domain.
4. Optionally override the seeded administrator with `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`.

The suite verifies its required projects, audits, reference data, and application-access records through the API before using them. Test-created business records use unique values so repeated runs do not depend on a clean database.

Run:

```sh
pnpm test:e2e
```