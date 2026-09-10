---
name: Password rotation policy
description: QMS360 does not force users to replace administrator-assigned passwords.
---

Administrator-assigned sign-in passwords remain valid until an administrator replaces them. Do not add a first-login or forced password-change gate.

**Why:** The user explicitly rejected forced password rotation, and its schema flag caused production compatibility failures without providing wanted behavior.

**How to apply:** Keep password assignment and ordinary password-update capabilities independent of any session field or database flag. Do not add or retain a password-change database column for compatibility, and never block normal routes pending password replacement.