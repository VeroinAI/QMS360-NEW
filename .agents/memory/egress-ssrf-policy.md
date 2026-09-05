---
name: SSRF policy for tenant-configured outbound URLs
description: any feature that lets admins configure a URL the server calls with credentials must use pinned DNS + allowlist, never plain fetch
---

Any feature that fetches a tenant/admin-configured URL with decrypted credentials attached (Integration Cockpit source pulls) must go through the pinned-egress pattern in `source-sync.ts`: resolve DNS once, reject private/reserved IPs unless the hostname is in the `SOURCE_SYNC_ALLOWED_HOSTS` allowlist, then connect via `http(s).request` with a custom `lookup` that returns only the validated addresses. Never use `fetch` for this — it re-resolves DNS (rebinding TOCTOU) and follows redirects.

**Why:** three review rounds found bypasses — absolute endpoint paths overriding the base host, validate-then-fetch rebinding, and hex-encoded IPv4-mapped IPv6 (`::ffff:7f00:1` = 127.0.0.1) slipping past prefix-based IP checks.

**How to apply:** endpoint paths must be relative to the configured base URL (reject absolute/protocol-relative); classify IPs on the 16-byte form (parse IPv6 fully, classify embedded IPv4, fail closed on unparsable); reject 3xx; there is no blanket private-network env bypass — allowlist entries are per-hostname. Note: `lib/email.ts` still uses the older prefix-based IP classifier and has the same hex-mapped-IPv6 gap if it is ever hardened further.
