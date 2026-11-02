---
name: Daily Submission go-live balances
description: Cutover, authorization and snapshot safety rules for daily opening loads.
---

Daily opening balances are cumulative snapshots through the day before the selected go-live date, not daily movements or synthetic submitted reports. Real earlier submitted/approved Daily Submissions subsequently take precedence.

**Why:** The opening load is a cumulative balance, not a synthetic daily transaction. New Daily Current Date inputs are cumulative again per the user's 2026-11-02 instruction; see [Daily discipline input policy](daily-discipline-input-policy.md). Older daily-addition reports retain their original meaning. Never add the opening snapshot to a new cumulative input.

**How to apply:** Keep imported source counts separate from calculated totals and percentages. Keep legacy document types distinct instead of relabelling them as newer types.

Daily setup is independent from monthly setup and is one-time per project across all dates. It must precede any active Daily Submission, including drafts, and must not overwrite retained submitted history. Retained load audit history also consumes the opening load if project metadata is later removed.

**Why:** This is an initial go-live load, not a recurring correction facility. Preventing existing daily transactions avoids silently changing their frozen yesterday values.

**How to apply:** Serialize initial daily report creation and opening loads against one another. Reject the whole multi-project file if any project is loaded, blocked, unauthorized or invalid, with Excel row references.

Use dedicated Historical Balances activities coupled to their project scopes; ordinary Daily Submission edit rights do not authorize opening uploads. Resolve projects from authorized Project Master dropdown choices, and honor the organization spreadsheet date format.

**Why:** Opening values affect later reports for the project and require limited, explicit authorization rather than normal report-entry permissions.

Manual entry and Excel upload are alternative ways to perform the same one-time Daily opening load. Go-Live is the first reporting date; historical balances include data only through the previous day.

**Why:** The user explicitly requested manual entry like Monthly historical balances, with a Go-Live cutoff, without replacing the upload option.

**How to apply:** Manual entry requires scoped Historical Balances edit rights, not Excel import rights. Both paths must share validation, locking, prior-load guards and retained audit history; completing either consumes the project's opening load.
