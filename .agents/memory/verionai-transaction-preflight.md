---
name: VerionAI transaction preflight
description: Completeness and continuation rules for AI-assisted business transactions.
---

VerionAI transactions must not trust the model's own claim that an extraction is complete. The application must independently recompute missing mandatory inputs from the target form's base requirements and configured field controls after extraction and after every clarification answer.

**Why:** Model extraction can omit required fields without listing them as missing. Treating that output as ready causes incomplete drafts or late API validation failures.

**How to apply:** Before an AI-assisted create or material update, return canonical missing fields and readiness. If anything is missing, let the user either answer through VerionAI or continue to the normal target form with extracted values prefilled. The normal form/API remains the final authority.