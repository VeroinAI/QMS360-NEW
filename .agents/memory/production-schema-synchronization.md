---
name: Production schema synchronization
description: Production database schema drift observed after an otherwise successful QMS360 publish.
---

Do not assume a successful application build means the production database schema was synchronized. When published APIs fail with missing columns or relations, compare production information_schema with development before changing application code.

**Why:** A quality-server publish completed successfully while production remained behind the development schema, causing HTML 500 responses across email rules, email delivery, and organization settings. Replit Support subsequently told the user that this project's automatic Publish migration only propagates `public` schema changes; custom schemas are not propagated, which explains the empty schema diff despite confirmed missing objects.

**How to apply:** Do not suggest another Publish alone as a remedy for missing custom-schema objects. For this project, seek a support-reviewed manual schema-only reconciliation for custom schemas, preserve production data, and avoid the overwrite-data option unless the user explicitly intends to replace it. Do not add startup DDL or deployment migration hooks. Treat a proposed move into `public` as a separate high-risk redesign, not a quick incident fix.