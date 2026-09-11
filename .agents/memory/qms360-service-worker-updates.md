---
name: QMS360 service-worker updates
description: Preventing installed QMS360 clients from remaining on stale frontend bundles after a successful publish.
---

QMS360 page navigations must use a network-first service-worker strategy, and service-worker registrations must bypass the HTTP cache when checking for updates. Increment the cache name when changing cache behavior so old app-shell entries are removed.

**Why:** A successfully published frontend remained visually unchanged because the service worker cached `/` indefinitely under a fixed cache name. Browsers kept receiving the old HTML and its old hashed JavaScript bundle even though production had rebuilt.

**How to apply:** Keep navigation HTML network-first, reserve cache-first behavior for immutable hashed assets, and verify both the live `/sw.js` cache version and the JavaScript asset referenced by live HTML after publishing frontend changes.