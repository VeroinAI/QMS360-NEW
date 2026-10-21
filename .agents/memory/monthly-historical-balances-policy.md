---
name: Monthly historical balances
description: Restricted project/month opening balances, go-live cutover and immutable submitted history.
---

Monthly historical setup is a project-specific, reporting-month-specific opening balance, not a mutable global cumulative total. It can establish a go-live cutover without inventing monthly transactions for the pre-go-live history.

**Why:** The user requested a long-term manual and Excel maintenance facility for all monthly historical values, usable only by limited authorized people. Recording years of accumulated data as one month's issued/closed movements would distort reports.

**How to apply:** Cover every source balance carried forward by Monthly Reporting, including separate QTBT and Training accumulations. Maintain underlying issued/closed counts and counts/hours; keep rates, open quantities, variance and PQI derived. Do not mix Daily Submission or CSAT history into this facility.

Historical setup requires dedicated activity grants coupled to their project scope. Ordinary monthly edit, import and export permissions must not automatically authorize historical corrections.

**Why:** Changing opening balances changes downstream calculations and needs a narrower authorization boundary than entering normal monthly movements.

**How to apply:** Enforce each operation at the API as well as navigation/UI. Treat manual and Excel changes as the same validated atomic package, with an explicit confirmation, correction reason, version conflict check and retained old/new audit history.

Never silently rewrite a submitted monthly snapshot or its dependent submitted history. Corrections can refresh never-submitted drafts in their selected month, but if that month or a later month has submission history, use a future unsubmitted cutover period.

**Why:** Historical maintenance must not change previously issued reports, including sent-back reports whose original submission snapshots may already support later reports.

**How to apply:** Preserve entered current-month movements and existing metric targets when refreshing drafts. Serialize correction versus report creation and detect concurrent submission/save conflicts. Later reports carry forward the cutover month's submitted closing balances normally; do not reapply an opening override to every future month.

Multi-project historical uploads are one all-or-nothing correction package across the entire workbook, not best-effort independent project saves.

**Why:** The user requested loading multiple projects in one file. Partial go-live corrections would leave projects inconsistent while appearing to be one successful setup operation.

**How to apply:** Preview every included project, enforce its own permission scope and correction reason, and recheck versions and submission locks when applying. A blocked or stale project must roll back the complete batch, including its audit writes and draft refreshes.

Retain compatibility with previously downloaded single-project workbooks when changing the main template.

**Why:** The user supplied an existing single-project workbook when requesting the multi-project redesign; downloaded workbooks are already in use.

**How to apply:** Prefer the multi-project workflow, but recognize older templates and subject them to the same current authorization, validation and submission-history safeguards.
