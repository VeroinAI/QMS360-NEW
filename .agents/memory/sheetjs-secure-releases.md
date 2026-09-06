---
name: SheetJS secure releases
description: How to source patched SheetJS Community Edition releases when npm only offers the vulnerable legacy package.
---

The npm `xlsx` package is stale at 0.18.5. Use the official SheetJS CDN tarball as the dependency source for secure Community Edition releases rather than reverting to npm or suppressing audit findings.

**Why:** Security fixes after 0.18.5 are distributed through SheetJS's official CDN, while the npm registry still reports 0.18.5 as latest and has no patched version.

**How to apply:** Keep every workspace consumer on the same explicit `https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz` release, regenerate the pnpm lockfile, and verify workbook read/write behavior plus `pnpm audit`.