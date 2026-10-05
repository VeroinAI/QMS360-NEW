---
name: Application settings navigation
description: Settings pages stay within their owning application's navigation context.
---

Settings belongs within each application. QMS Audit Settings must retain QMS Audit navigation, just as QA/QC and Lessons Settings retain their own application navigation.

**Why:** The user explicitly reported Audit Settings switching to the main system sidebar and confirmed that the other two applications' behaviour is correct.

**How to apply:** Treat application settings and all their tabs as application routes when choosing navigation context, including direct page loads and reloads. Do not redirect settings to system navigation or change the working QA/QC and Lessons behaviour.