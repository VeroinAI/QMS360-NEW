# QMS360 — Replit Build Specification (v1.0)

**Client:** Algihaz Holding · **Built by:** VerionAI · **Source documents:** QMS360 Product & Technical Design Document v4.0 (client-approved for sign-off), the three original BRDs (SOW-QMS-V4 v6.0, Lesson Learned Form-SOW-V2 v2.0, QMS-SOW-V2 v2.0), and the Algihaz "Lovable Application → Self-Hosted AWS Deployment Guide."

This file is the single reference Replit's Agent should read before writing any code, and should re-read whenever a new build phase starts. It is longer than a normal chat prompt on purpose — treat it as the spec, not as something to retype from memory.

---

## 0. What this is, in one paragraph

QMS360 is **three separate, independently-launched applications** — QA/QC & Document Governance, Lesson Learned Management, and QMS Audit Management — that will live inside Algihaz's existing internal application platform (a container platform called **DronaHQ**, referred to as "the Algihaz Platform" throughout the design document). All three share one backend codebase, one database schema, and a common set of platform services (RBAC, escalation engine, AI settings, integrations, audit log), but each has its own home screen and its own independent Settings area — Algihaz's platform lists them as three distinct apps, not one app with three tabs. **There is no ERP integration anywhere in this product** — every BRD's data (NCR/RFI/RMI counts, submittal status, audit findings, etc.) is entered directly by users.

---

## 1. Non-negotiable architecture decisions

These come directly from the client-approved design document and from the confirmed 30-08-2026 architecture call with Algihaz's platform engineering team. Do not deviate from these without asking first — they are the parts most likely to get silently "simplified" by an AI builder into something generic.

1. **Three apps, one backend.** Build one modular-monolith backend organised into four domain modules — `app1-qaqc`, `app2-lesson-learned`, `app3-audit`, `admin-core` (shared services) — but present **three separate frontend entry points**, each with its own home screen, its own top nav, and its own Settings. Do not build a single shared "Launchpad" with three tiles under one login screen — that was explicitly rejected by the client.
2. **No ERP integration, anywhere.** Do not build a Unifier/PMIS connector, do not pull NCR/RFI/RMI from an external system, do not scaffold "future ERP integration" stubs. All transactional data is entered manually by users, exactly as the BRDs specify.
3. **One shared Postgres schema for all three apps** — not three separate schemas, not a separate database. This is what makes the cross-application Executive Dashboard possible without an integration step later. Every table carries `organization_id`, and most carry `project_id` and/or `business_unit_id`.
4. **No independent login system.** QMS360 does not build its own sign-up/password-reset/login screen for production. In production, each app trusts a session handed to it by Algihaz's DronaHQ container (see §2 below on auth). **For Replit development and UAT, build a simple local email+password login** (so the app is fully testable standalone) but architect auth as a pluggable strategy so the container-SSO path can be added later without a rewrite — see §7.
5. **Identity sync is username + project only.** Nothing else crosses the boundary from Algihaz's platform. QMS360 defines and stores every role itself (both organisation-wide "Platform Roles" and per-application "Workspace Roles"), never reads a role-mapping table from the platform.
6. **Every ratio/KPI field is calculated, never raw input**, and every one has an explicit, non-erroring answer for its zero-denominator case (see §5.1).
7. **Nothing is ever hard-deleted.** Every deletable record gets a `status`/`deleted_at` marker; uniqueness constraints (reference numbers, project codes) apply only to active (non-deleted) records via partial/filtered unique indexes.
8. **AI is always human-in-the-loop.** No AI-drafted field or AI-assembled transaction is ever submitted automatically — the user must explicitly Accept, Edit, or Reject, enforced at the API layer, not just the UI. Every AI call has a hard timeout (default 10s) with graceful fallback to manual entry.

---

## 2. What "the Algihaz Platform" actually is (read this before building auth)

The design document refers throughout to "Algihaz's existing application platform" or "Algihaz's Container." Per Algihaz's own deployment documentation, this is **DronaHQ** — a container platform that loads embedded apps and exposes a bridge SDK (`public/dronahq.js`) to the embedded app. That SDK, once a handshake with the container completes, exposes a `getProfile()`-style call returning the signed-in user's identity (at minimum username/email). This is the real-world mechanism behind the design document's "platform sign-in hand-off" and "username & project sync" — it is not a generic OAuth/SSO flow, it is this specific container bridge.

**Implication for the build:** architect the backend's auth layer around two interchangeable strategies from day one:
- **`local` strategy (used now, on Replit):** email + password against the app's own `users` table, bcrypt-hashed, issuing your own JWT. This is what makes the app fully testable in isolation.
- **`container` strategy (wired later, at deployment):** frontend calls the DronaHQ bridge SDK's profile fetch on mount (with a timeout, so it fails gracefully outside the container); if it resolves, POSTs the profile to a dedicated `POST /auth/sso` endpoint; backend finds-or-creates the user record by username/email and issues the same JWT shape the local strategy issues, so the rest of the app never needs to know which strategy authenticated the request.

Build both the `users` table and the JWT issuance/validation logic in a way that's agnostic to which strategy populated it. Stub the `container` strategy's endpoint and a feature flag to switch to it, but it doesn't need a real DronaHQ container to test against on Replit — that only exists once deployed.

---

## 3. Tech stack

| Layer | Use | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript, Tailwind CSS, shadcn/ui, TanStack Query | One frontend codebase serving all three app "front doors" as separate route trees/entry experiences. |
| Backend | Node.js + TypeScript (Express or Fastify), organised as domain modules | Same language front-to-back. Modules: `app1-qaqc`, `app2-lesson-learned`, `app3-audit`, `admin-core`, `auth`. |
| Shared validation | Zod schemas shared between frontend forms and backend routes | Define each field's type/validation once; import on both sides. |
| Database | PostgreSQL, one schema for the whole product | Use Replit's built-in Postgres (or Neon) for dev. Write the full schema as versioned, idempotent migrations (e.g. Drizzle ORM or Prisma) — never a manual one-off script — since this same migration set gets applied to Algihaz's production Postgres later, inside a dedicated schema there. |
| Object storage | S3-compatible storage, accessed only through the backend (never raw client-side URLs) | Backend returns a stable backend URL for any uploaded file, not a direct storage URL — this is what lets storage be swapped from dev to Algihaz's production S3 bucket later without touching frontend code. |
| Cache/queues | Redis-backed job queue (e.g. BullMQ) for escalation processing, scheduled report generation, notification delivery, sync jobs | Plus an independent 15–30 minute reconciliation sweep that re-checks every open SLA clock against wall-clock time — this is a deliberate second guarantee, not a duplicate of the event-driven trigger. |
| AI layer | Claude API behind a swappable-provider interface | Hard 10s timeout, graceful fallback, full prompt/response audit logging on every call including failures. |
| Auth | JWT-based, pluggable `local`/`container` strategy per §2 | No password-reset-via-email flow needs to be production-grade — this is a dev/UAT convenience path. |

**Portability constraints to build in from day one** (these matter because this app moves to Algihaz's own AWS-hosted infrastructure after Replit — see §8):
- Every environment-specific value (`DATABASE_URL`, `JWT_SECRET`, `S3_*` credentials, `CORS_ORIGINS`, `API_BASE_URL`, the base path the frontend is served under) comes from environment variables — nothing hardcoded.
- The backend must support running behind a URL path prefix (e.g. `/qaqc/`, `/lesson-learned/`, `/audit/` or similar) without breaking — auto-generated API docs, asset URLs, and any absolute links the backend generates must respect a configurable root path.
- Use hash-based client-side routing (or otherwise confirm the router works correctly when the app is served from a nested, versioned subpath rather than a domain root) so a page reload on any in-app route doesn't 404.
- Do not assume Postgres Row-Level Security is available for authorization — implement every access rule in application code at the API layer. (Production will connect with a role that bypasses RLS entirely.)

---

## 4. Design tokens — use Algihaz's brand palette, not a generic one

QMS360 will live inside Algihaz's own platform, so its UI should use **Algihaz's actual corporate colours**, not a generic SaaS palette:

- **AG Black** — `#3A3A3B` (primary, text/dark surfaces)
- **AG Purple** — `#582C83` (primary brand accent)
- **AG Yellow** — `#EB9823` (secondary — warnings/highlights)
- **AG Turquoise** — `#06AEBB` (secondary — informational accents)
- **AG Fuchsia** — `#A43C96` (secondary — accent, sparing use)

Use AG Black and AG Purple as the two primary colours (buttons, active states, headers); use the three secondary colours sparingly for status/accent purposes (e.g. Yellow for pending/warning states, Turquoise for informational badges, Fuchsia for a rare highlight — not as a rainbow of equal-weight colours). Build a proper design-token system (CSS variables or a Tailwind theme extension) rather than hardcoding hex values inline, so the palette can be refined once Algihaz's Digital Team reviews it.

Each of the three apps keeps the same design system (same components, spacing, type scale) but its own icon/identity mark in the top nav, so they read as related-but-distinct apps, matching the "separate front doors, shared design language" principle in the design document.

---

## 5. Data model

Single shared schema. Core entity groups (build all of these as real tables with real relationships, not placeholders):

**Identity & Access** — `organizations`, `users` (username, project association — synced field in production, manually seedable in dev), `platform_roles`, `workspace_roles`, `permissions`, `delegations` (links two users for a time window + scope).

**Master Data** — `projects` (in dev, seed directly; in production this syncs read-only from Algihaz's platform — build the table so it *can* be synced later, i.e. keep an external-ID/source field), `business_units`, `disciplines`, `categorisation_risk_master`, `target_benchmarks`, `distribution_lists`, `report_templates`.

**App 1 (QA/QC & Document Governance) records** — `qaqc_metric_entries`, `material_inspection_entries`, `qtbt_entries`, `customer_satisfaction_entries`, `document_governance_log_entries`, `quality_assessment_briefs`.

**App 2 (Lesson Learned) records** — `lesson_learned_forms`, `lesson_learned_photos` (up to 5 per before/after category).

**App 3 (QMS Audit) records** — `audit_schedules`, `audit_plans`, `audits`, `audit_findings`, `corrective_action_reports` (one finding → many CARs, one per responsible department — this is a deliberate enhancement over a strict 1:1 model; if it turns out to be wrong, it's a config/query change, not a schema rewrite).

**Cross-cutting** — `escalation_rules`, `escalation_instances`, `notifications`, `audit_log_entries` (append-only, immutable — no role, including Super Admin, can edit or delete an entry), `ai_suggestion_logs`, `integration_connectors`, `sync_jobs`.

### 5.1 Zero-denominator rule (apply everywhere a ratio/KPI is calculated)

Every calculated field (Closure Rate, PQI, and any other ratio-based metric) must have an explicit, defined behaviour when its denominator is zero — never a division error, never a silent default. Example given in the source BRD: **Closure Rate = 100% when both Issued and Closed are 0** for an active project in a given period. Apply the same discipline (explicit rule, not a guess) to every calculated field you build across all three apps.

---

## 6. RBAC — two layers, both QMS360-native

**Platform Roles** (organisation-wide, meaningful across all three apps) — build these seven as system defaults, each with the permission profile below (Full / Own / Select / — against: Create-Edit, Submit, Approve-Reject, View-Own, View-All, Configure, Delegate):

| Role | Create/Edit | Submit | Approve | View Own | View All | Configure | Delegate |
|---|---|---|---|---|---|---|---|
| Super Admin | Full | Full | Full | Full | Full | Full | Full |
| Org Admin | Masters | — | — | — | Full | Full | Admin only |
| Executive Viewer | — | — | Select | Full | Full | — | Select |
| BU / Project Head | — | — | Own | Full | Own | — | Own |
| Quality Manager | — | — | Select | Full | Full | — | Select |
| Employee (base) | — | — | — | — | — | — | — |
| External / Guest Auditor | — | — | — | Select* | — | — | — |

*Guest Auditor: time-boxed, read-only, scoped to one audit engagement, auto-expires at engagement close.

**Workspace Roles** (specific to one app):

| Role | App | Create/Edit | Submit | Approve | View Own | View All | Configure | Delegate |
|---|---|---|---|---|---|---|---|---|
| QAQC Representative | 1 | Full | Full | — | Full | — | — | Yes |
| Document Controller | 1 | Full | Full | — | Full | — | — | Yes |
| Approver / Reviewer | 1 | — | — | Full | Full | — | — | Yes |
| Form Creator | 2 | Full | Full | — | Full | — | — | Yes |
| Form Approver | 2 | — | — | Full | Full | — | — | Yes |
| Audit Program Manager | 3 | Full | Full | — | Full | Full | Masters | Yes |
| Audit Team Lead / Auditor | 3 | Full | Full | CAR only | Full | — | — | Yes |
| Process / Product Owner | 3 | CAR only | Full | — | Full | — | — | Yes |

A user's real permissions are the union of their one Platform Role and however many Workspace Roles they hold (zero, one, or one-per-app). Workspace Roles carry a scope (one or more BUs/Projects).

**Build a custom role builder, not just these defaults.** An Org Admin (per application) must be able to create a new role from the same underlying permission primitives (Create/Edit, Submit, Approve/Reject, View-Own, View-All, Configure Masters, Manage Integrations, Manage AI Settings, Export, Delegate) and assign any combination — the table above is a starting point, not a hard ceiling.

Build RBAC checks at the API layer (never only hide/disable in the UI).

---

## 7. Auth flow to build (Replit/dev version)

1. `POST /auth/register` or a seeded admin account (dev convenience — production won't use self-registration).
2. `POST /auth/login` — email+password, bcrypt, issues JWT.
3. Every API route validates the JWT, then checks that application's RBAC for the requested action (role-union logic from §6) — return 403, not a silently filtered response, when denied.
4. A stubbed `POST /auth/sso` route and a `container` auth-strategy interface, per §2 — not wired to a real DronaHQ instance (there isn't one to test against on Replit), but present and structured so swapping the active strategy is a config change.
5. On first login, a user with a Platform Role but no Workspace Role in a given app can sign in and see that app's home screen, but with no functional modules/tiles rendered — matching the "base role grants no access until a workspace role is also assigned" rule.

---

## 8. What changes at production deployment (context only — do not build this now)

This section is here so Replit's Agent doesn't optimise itself into a corner. Algihaz will eventually deploy this application onto their own shared AWS infrastructure (Postgres on a shared server in a dedicated schema, backend as a systemd service on a shared EC2 box behind nginx, frontend as a static build on S3+CloudFront under a versioned path prefix, optional DronaHQ container SSO). None of that infrastructure exists on Replit and none of it needs to be built now — but because of it:

- Never hardcode a port, a domain, or an absolute base path anywhere in the code — always read it from an environment variable (see the portability constraints in §3).
- Keep the Postgres schema creation as versioned, idempotent migrations that can be pointed at any Postgres instance via `DATABASE_URL` — this is exactly what gets re-run against Algihaz's production database later.
- Keep file storage behind a backend abstraction (an interface with a "local/dev" implementation and an "S3-compatible" implementation) rather than calling a specific storage SDK directly from business logic.
- Do not build a Docker-specific-only deployment path if it can be avoided — the target is a plain process manager (systemd) running the built app directly, so keep startup simple (a single build step, a single start command).

**Do not put any real Algihaz production credentials (AWS keys, database passwords, domain names) anywhere in this Replit project.** Those are provisioned separately by VerionAI's deployment engineer directly on Algihaz's infrastructure when the app is actually deployed, not during this build.

---

## 9. App 1 — QA/QC & Document Governance

**Source:** SOW-QMS-V4 v6.0. Digitises the monthly QAQC report and Daily Document Governance Log.

### Modules
- **QAQC Metrics** — External/Internal NCR, RFI, RMI counts (issued, closed, ageing buckets: 0–15 / 15–45 / >45 days), with auto-calculated month-over-month closure rate and variance.
- **Project Quality Index (PQI)** — system-calculated composite index across the four metric categories. Read-only, never manually entered.
- **QTBT (Quality Toolbox Talks)** — count, attendance, duration, with auto-accumulated totals.
- **Material Inspection** — MIRN counts, OSD (Overage/Shortage/Damage), status distribution (Approved, On Hold, Rejected, Hazardous, Handle-with-Care) — validate that the status breakdown reconciles to the entered total.
- **Customer Satisfaction Survey** — six 1–5 rated service dimensions, Yes/No/Partially outcome questions, free-text feedback, per project.
- **Daily Document Governance Log** — submittals & drawings by discipline and status (Approved/Resubmit/Rejected/Under Review), review-time tracking, pending-days matrix by entity (Client/Algihaz/Supplier), correspondence counts.
- **Quality Assessment Brief** — free-text monthly narrative; offer an AI-generated first draft (month-over-month variance, negative-variance categories, open critical NCRs >45 days, top/bottom performing category) which the user must Accept/Edit/Reject.

### Workflow
1. **Entry** — user selects project + reporting period; prior-month figures and project master data auto-fill; current-period figures entered manually.
2. **Auto-calculation** — closure rates, cumulative totals, variance, PQI compute in real time, read-only.
3. **AI-assisted brief** — AI drafts the Quality Assessment Brief; user reviews before submission.
4. **Submit → Approve** — Draft → Submitted → Approved / Sent Back with comments.
5. **Distribute** — on approval, auto-generate PDF/dashboard, distribute on a configured cadence (monthly for QAQC report, fortnightly for Document Governance log) — not on every update.

### Escalation
- Closure rate below target 2 consecutive months → L1 (Quality member); 3 months → L2 (Project Head); 4 months → L3 (BU/Department Head).
- Report unapproved 2 days → P2 reminder to pending approver (repeating daily); unapproved 5 days → P1, escalated to QAQC Director (repeating daily until approved).
- Missing-submission alerts on missed deadlines (11:00 AM daily deadline for Document Controller; 7th-of-month for QAQC Representative), escalating to QAQC Director if still missing the next day.

### Key screens
Project & Period Selector · QAQC Metrics entry form (per category) · Material Inspection entry form · QTBT entry form · Customer Satisfaction Survey · Daily Document Governance Log entry grid · Quality Assessment Brief editor with AI panel · Approval inbox · Main Dashboard (filterable by Project Group/Name/Month/Category) + distribution-layout dashboard.

---

## 10. App 2 — Lesson Learned Management

**Source:** Lesson Learned Form-SOW-V2 v2.0. Turns the Lesson Learned form into a searchable knowledge base.

### What it captures
- Project, system-generated non-duplicable reference number, title, discipline, categorisation, Issue Category (Minor/Moderate/Major), Impact (Positive/Negative) — from configurable masters.
- System-captured (not user-typed) date and GPS location.
- Description, Root Cause, Correction, Corrective Action — each with an AI rephrasing suggestion the user must Accept/Edit/Reject.
- New/Repeated-issue flag, with repeat count and location if repeated.
- Before/After photo evidence — up to 5 images per category, from camera or storage. Resize client-side to max 1920×1080 JPEG before queuing for upload/sync.

### Workflow
1. **Form Creation** — reference number auto-generates; AI rephrasing assist on the text fields; before/after photos attached.
2. **Form Submission** — creator's designation/name/signature auto-captured from the user record; triggers notification to the Approver.
3. **Form Approval** — Approver approves, or sends back with mandatory remarks (repeats until approved); approval auto-captures approver's designation/name/signature/date.

### Escalation — SLA to P1 varies by Issue Category × Impact

| Issue Category | Impact | SLA to P1 |
|---|---|---|
| Major | Negative | 2 days |
| Major | Positive | 5 days |
| Moderate | Negative | 5 days |
| Moderate | Positive | 5 days |
| Minor | Negative | 5 days |
| Minor | Positive | 5 days |

- P1 → Approver (CC Creator) once the applicable SLA elapses unresolved.
- P1 unresolved 3 more days → L1 (Project Manager, CC Creator & Approver).
- L1 unresolved 3 more days → L2 (BU Head/Director, CC Project Director, Creator & Approver), repeating every 2 days until closed.

### Offline requirement
Field-first: form entry, photo capture, GPS/timestamp tagging must work with no signal, cached locally, syncing automatically on reconnect. When two users edit the same record offline, merge non-conflicting field changes automatically and flag genuinely conflicting fields for the record owner to reconcile — never silently overwrite one submission with another.

### Key screens
New Lesson Learned form (guided, dropdown-first) · AI rephrasing review panel · Photo capture & annotation · Submission & signature capture · Approver inbox · Lesson Learned Log (searchable/filterable) · Escalation Summary report.

---

## 11. App 3 — QMS Audit Management

**Source:** QMS-SOW-V2 v2.0. Digitises the full ISO 9001:2015 internal audit lifecycle.

### Three-phase lifecycle
1. **Pre-Audit** — Scheduling & Approval → Feasibility & Plan Preparation → Team Assignment. Audit Program Manager builds the annual schedule; Director/CEO approves or sends back; on approval, auto-generate and distribute the memo; Audit Plan (scope, criteria, date, location) prepared and shared with Process/Product Owners.
2. **Audit Execution** — Opening Meeting → Evidence Collection → Findings & NC Evaluation → Closing Meeting. Log opening/closing meeting minutes; collect evidence (documents, photos, interviews) on-site with offline mobile capture; classify findings as Conformity / Observation / Minor NC / Major NC.
3. **Post-Audit** — Audit Report → CAR Workflow → Verification & Closure. Auto-generate the audit report from captured data; each NC auto-assigns a Corrective Action Report (CAR) to its Process/Product Owner (root cause, correction, corrective action fields); auditor verifies effectiveness and closes, or schedules a follow-up if not effective.

**Finding → CAR cardinality:** build this as **one Audit Finding can spawn one CAR per responsible department** (not a strict 1:1) — a documentation NC spanning both a project team and procurement, for example, gets two independently-tracked CARs, not one forced onto a single owner.

### Escalation matrix (Priority + Level)

| Priority | Risk Combination | SLA | On Breach |
|---|---|---|---|
| P1 | Major + High | 2 days | Escalates per level matrix |
| P2 | Major + Medium | 2 days | Auto-upgrades to P1 |
| P3 | Major + Low | 2 days | Auto-upgrades to P2 |
| P4 | Minor + High | 2 days | Auto-upgrades to P3 |
| P5 | Minor + Medium | 3 days | Auto-upgrades to P4 |
| P6 | Minor + Low | 3 days | Auto-upgrades to P5 |

- L1: P1 unresolved 3 days, or P6 unresolved 14 days → BU Head/Director, Project Manager, Functional Head, repeating every 2 days until closed.
- L2: management intervention to BU Head/Director when L1 remains unresolved.
- Extension request: Process/Product Owner may request an extension with Audit Lead approval — the escalation clock only re-applies once the approved extension elapses.

### Key screens
Annual Audit Schedule builder · Director/CEO Approval dashboard · Audit Plan builder · Opening/Closing Meeting minute-taker · On-site Evidence & Checklist executor (offline, GPS-tagged) · Findings & NC classifier · Auto-generated Audit Report preview · CAR workflow · Findings Log · Audit Dashboard.

---

## 12. Escalation & SLA engine (one engine, three independently-configured rule sets)

Build **one** underlying engine, not three copies of similar logic:

1. **Trigger** — a record enters a state a rule set watches (report submitted, deadline missed, metric under target, finding raised, CAR issued).
2. **Clock** — starts an SLA clock in working days, using a configurable working-week/holiday calendar.
3. **Reminder(s)** — configurable pre-breach reminders to the responsible party.
4. **Breach → escalation** — notifies the next role per the configured level, repeating on a configured cadence until closed.
5. **Resolution** — clock and escalation state clear the moment the underlying item is approved/closed.

Each app's Org Admin edits their own rule set (SLA day-counts, recipient roles, repeat cadence) from that app's own Settings → Escalation Matrix Configuration, without a code change and without affecting the other two apps' rules.

**Reliability:** don't rely purely on event-driven triggers. Build an independent scheduled sweep (every 15–30 minutes) that re-evaluates every open SLA clock against wall-clock time — this catches anything a dropped job or an idle/restarted environment would otherwise silently miss. Recalculate a clock immediately if the working calendar changes or an extension is approved on the specific item.

---

## 13. Shared Admin Core (build once, expose independently per app)

Escalation Rules (§12) and AI Settings are configured **separately per application**, from that application's own Settings. RBAC & User Management, the Integration Cockpit, Data Sync Cockpit, Notification Center, Audit Log, and the cross-app Reports Hub run on shared infrastructure every app draws on, administered per-app where noted below.

### 13.1 RBAC & User Management (per app)
User directory (username, Platform Role, Workspace Role(s) + scope, access status, last access) · Access queue (pending role grants) · Role builder (custom roles from the permission primitives in §6) · Permission matrix editor with change history · Delegation register with one-click revoke · Bulk role assignment via CSV/Excel upload with validation.

### 13.2 Integration Cockpit
A shared connector framework. Build these connector types (as real, working integrations where feasible on Replit, or clearly-stubbed interfaces where an external system doesn't exist yet):
- **Platform username/project sync** — the `local`/`container` auth pattern from §2/§7; in dev, this is just your own `users`/`projects` tables, seeded directly.
- **Email** (SMTP or similar) — for report distribution, escalation, and notification delivery. Use a real SMTP-compatible provider (or a dev-mode console logger) so this can be tested without real Algihaz credentials.
- **AI provider** — Claude API, swappable, per §3/§8.4.
- **Oracle ADW** — build this as a clearly-scoped, disabled-by-default connector interface (scheduled batch job that would extract/transform/load QMS360 data) — do not build a fake/fully-functional Oracle connection, since Algihaz hasn't confirmed whether this is even needed (their own container-to-ADW pipeline may already cover it). Just leave the extension point clean.
- **BI/Excel export** — build this for real: in-app Excel export of any report/dashboard.

Also build: a connector health monitor (Connected/Degraded/Failed status per connector), a field-mapping studio (no-code mapping UI, versioned), sandbox/test mode, and an encrypted credential vault pattern for API keys.

### 13.3 AI Settings & Controls (per app)
Feature toggles per AI-assisted feature · human-in-the-loop enforcement (non-negotiable, API-layer) · model/provider selection · data governance guardrails (what's sent to the provider, retention) · AI interaction audit log (every suggestion/prompt-transaction, accepted/edited/rejected, by whom — including timeouts/failures) · 10-second hard timeout with graceful fallback · org-level API key & quota controls · usage & cost dashboard.

**Prompt-to-transaction (build this — it's a headline capability):** alongside every standard form, let a user type a natural-language prompt to create a record instead. Example to build against: *"Log a lesson learned for the formwork rework on Project Alpha — root cause was late drawing approval, moderate severity, negative impact."* The system should: (1) extract what it can into real fields using the same validation as the standard form (Project → matched against the Project master; Issue Category → Moderate; Impact → Negative; Root Cause/Description → drafted text); (2) ask a clarifying question for anything it can't determine (e.g. "Which discipline does this fall under?" with a pick-list, never a guess or a blank); (3) open the assembled record in the same Accept/Edit/Reject review screen as any other AI draft — nothing is created until the user submits it themselves; (4) log the prompt, extracted fields, clarifying Q&A, and final record to the AI audit log.

### 13.4 Data Sync Cockpit
Job monitor (every sync job, schedule, last run, duration, outcome) · error queue with retry/manual-fix · reconciliation view (record counts vs. source) · manual override log.

### 13.5 Master Data & Configuration Center
Organisation Settings (branding, working calendar/holidays, locale/timezone) · Business Unit Master · Discipline Master · Categorisation/Risk Master · Target Benchmarks · Escalation Matrix Configuration · Distribution Lists & Report Templates — all QMS360-native and editable. **Project and Username/Project Association are read-only in this UI** (shown as synced data, not created/edited here) — build them as a synced/read-only view even in dev, to keep the UI honest about what's editable in production.

### 13.6 Notification Center
Channels: in-app bell, email, push (mobile PWA), SMS (optional, stubbed). Template library with merge fields for every system notification. Digest scheduling (not immediate-per-update) for the report distributions. Per-user channel preferences, with critical items (escalations, security) non-mutable.

### 13.7 Audit & Compliance Log
Immutable, append-only log of every state-changing action platform-wide (logins, approvals, delegations, role changes, master-data edits, AI interactions, every transaction). Filterable/exportable (PDF/Excel/CSV). Configurable retention policy.

### 13.8 Cross-Application Executive Dashboard & Reports Hub
Because all three apps share one schema, this queries across all three directly — no integration step. Build:
- **App 1 reports:** Monthly Project Quality Report, Fortnightly Document Governance Report, Daily Document Governance Log, Customer Satisfaction Summary & Trend, All-Project Quality Summary Dashboard.
- **App 2 reports:** Lesson Learned Log, Lesson Learned Form PDF export, Escalation Summary.
- **App 3 reports:** Open vs Closed Audits, Open vs Closed NCs & Observations, Escalation Summary, NC Recurrence & Trend, Audit Ageing, CAR Status & Closure, Real-Time Audit Schedule.
- **Cross-app:** Executive 360 Dashboard (combined KPIs from all three), Admin Usage & Adoption Report, AI Usage & Governance Report, Integration Health Report.

---

## 14. Navigation & information architecture

- Each app has its own icon/home screen (§0). A persistent top bar within each app: app identity, global search, notification bell, profile & delegation menu, plus a lightweight switcher to jump to either of the other two apps or the cross-app Executive Dashboard.
- Breadcrumbs inside every app tracing back to that app's home screen.
- Role-aware rendering: hide (don't just disable) anything a user's role doesn't permit.
- A user with a Platform Role but no Workspace Role in an app can sign in and reach that app's home screen, but sees no functional modules until a workspace role is granted.

---

## 15. Non-functional requirements to actually build against

- Soft-delete only, everywhere, with active-scoped uniqueness (partial unique indexes).
- Every calculated field is read-only, system-derived, with an explicit zero-denominator rule (§5.1).
- WCAG 2.1 AA target on the web app.
- Responsive web (desktop/tablet) + installable PWA (offline-capable via service worker, camera/GPS access) — this is the mobile strategy; do not build a separate native app from scratch, build one PWA.
- English + Arabic bilingual UI including right-to-left layout mirroring — build the design system with this in mind from the start (don't hardcode LTR-only spacing/icons), even if full Arabic translation content comes later.
- Centralised logging/error tracking.

---

## 16. Recommended build phases (do not attempt this all in one pass)

This is a multi-app enterprise platform — treat it as a sequence of checkpoints, not one shot:

1. **Foundation** — repo structure, design tokens (Algihaz palette, §4), database schema + migrations for every entity group in §5, auth (local strategy + container-strategy stub, §7), RBAC engine (permission-primitive checks at the API layer), the three apps' home-screen shells + each app's own empty Settings shell, seed script populating demo Business Units/Projects/users/sample records.
2. **App 1 — QA/QC & Document Governance** — full data entry, auto-calculation with zero-denominator safeguards, approval workflow, AI Quality Brief drafting, dashboards, Excel import/export.
3. **App 2 — Lesson Learned** — full lifecycle, AI rephrasing, photo evidence with compression, submission/approval, offline capture + conflict resolution.
4. **App 3 — QMS Audit** — full three-phase lifecycle, findings/CAR workflow (with the one-CAR-per-department model), escalation matrix.
5. **Shared Admin Core** — Integration Cockpit, AI Settings incl. prompt-to-transaction, Data Sync Cockpit, Notification Center, Audit Log, Master Data Center, Org Settings.
6. **Cross-app layer** — Executive Dashboard, cross-app reports, polish, WCAG pass, bilingual layout check.

Confirm each phase works end-to-end (real data flowing through real screens, not a static mockup) before moving to the next.
