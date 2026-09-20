---
name: Production schema synchronization
description: Production database schema drift observed after an otherwise successful QMS360 publish.
---

Do not assume a successful application build means the production database schema was synchronized. When published APIs fail with missing columns or relations, compare production information_schema with development before changing application code.

**Why:** A quality-server publish completed successfully while production remained behind the development schema, causing HTML 500 responses across email rules, email delivery, and organization settings.

**How to apply:** Use the supported Publish schema-sync flow and preserve production data; do not add startup DDL or deployment migration scripts. Avoid the overwrite-data option unless the user explicitly intends to replace production data.