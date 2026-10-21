---
name: Monthly historical balances
description: One-time project opening loads, atomic master-backed workbooks and immutable submitted history.
---

Monthly historical setup is a one-time opening balance per project, across all reporting months, not a recurring correction facility or mutable cumulative total. It establishes one go-live cutover without inventing pre-go-live monthly transactions.

**Why:** On 2026-10-21 the user explicitly changed the earlier recurring-correction policy: a project loaded once must never be loaded again, even for a different month, and any duplicate invalidates the entire file. Recording years of history as one month's movements would distort reporting.

**How to apply:** Existing setups from before this policy also consume the single load. Check every month and retained successful-load history, including manual/legacy/API paths and concurrent saves. Never recommend a different month to bypass an existing load. Cover all source balances, including separate QTBT and Training; keep derived rates and PQI computed.

Historical setup requires dedicated activity grants coupled to their project scope. Ordinary monthly edit, import and export permissions must not automatically authorize historical corrections.

**Why:** Changing opening balances changes downstream calculations and needs a narrower authorization boundary than entering normal monthly movements.

**How to apply:** Enforce each operation at the API as well as navigation/UI. Treat manual and Excel first loads as the same validated atomic package, with explicit confirmation, a load reason and retained audit history. Resolve project IDs internally from current authorized Project Master selections; do not ask users to enter IDs, codes or versions.

Never silently rewrite submitted monthly snapshots or dependent submitted history. A project's first opening load may refresh never-submitted drafts in its chosen month, but must not affect this or later submitted history.

**Why:** Historical maintenance must not change previously issued reports, including sent-back reports whose original submission snapshots may already support later reports.

**How to apply:** Preserve entered current-month movements and existing metric targets when refreshing drafts. Serialize correction versus report creation and detect concurrent submission/save conflicts. Later reports carry forward the cutover month's submitted closing balances normally; do not reapply an opening override to every future month.

Multi-project historical uploads are one all-or-nothing opening-load package across the entire workbook, not best-effort independent project saves.

**Why:** The user requested loading multiple projects in one file. A partial load would leave projects inconsistent while appearing to be one successful setup operation.

**How to apply:** Preview every included project, enforce its permission scope and load reason, and recheck prior loads and submission locks when applying. Errors must identify the Excel sheet and actual row. A blocked project must roll back the complete batch, including audit writes and draft refreshes.

Retain compatibility with previously downloaded single-project workbooks when changing the main template.

**Why:** The user supplied an existing single-project workbook when requesting the multi-project redesign; downloaded workbooks are already in use.

**How to apply:** Prefer the multi-project workflow, but recognize older templates and subject them to the same current authorization, validation and submission-history safeguards.
