# QA/QC and Document Governance reporting

This implements the reporting workflows in section 6 onward of the QMS SOW in the existing QMS360 application. Existing Lessons Learned and Audit workflows, legacy QA/QC entries, central Projects, central Users and shared administration remain available.

## Reporting workflows

| Area | Scope |
| --- | --- |
| Monthly quality report | PQP status and dates, client report reference, meetings, internal audit dates, manpower, four closure KPIs and NCR ageing, PQI, material/MIRN and OSD, status tags, QTBT, document review status, QMS documents and quality assessment brief |
| Daily document report | Drawing and submittal discipline snapshots, separate revision tables, document types, three-entity pending matrices and correspondence |
| Customer satisfaction | Six 1–5 ratings, expectations and recommendation outcomes, optional feedback and score trends |
| Approval | Draft, Submitted, Approved or Sent Back; assigned reviewer; mandatory send-back comments; submitted and approved data is not directly editable |
| Import/export | Standard Excel workbooks, validation and form preview before persistence, complete PDF/XLSX report exports and filtered dashboard exports |
| Management | Project-specific KPI targets and existing-user assignments, reporting start date, distribution recipients and calendar dates |

## Shared project and user setup

Reporting configuration belongs to the existing central project; it is not a second Project Master. Administrators select existing active organization users for PM, PE, DC, quality representative, project head, business-unit head, corporate quality manager, data governance manager and director. Project identity and the PM/PE/DC display are read-only in report forms.

The role must have access to QA/QC and the appropriate existing capability:

- Monthly report: QA/QC metrics.
- Daily report: document governance.
- Survey: customer satisfaction.
- Reporting configuration: QA/QC application administration within the administrator's project scope.

Organization QA/QC benchmarks provide defaults; a project's explicit KPI targets take precedence. Configure the project's reporting roles and distribution recipients before relying on approval routing or scheduled delivery.

## Historical data and calculations

- Monthly and daily reports use the preceding **submitted or approved** period. Waiting for approval does not prevent the next reporting period.
- A first report without usable historical data starts with a visible zero-baseline notice. Later periods require the immediately preceding submission.
- Daily values are **absolute snapshots**, not additive daily events. The default dashboard shows the latest snapshot; a selected date or range shows end minus start.
- Daily dashboard movement includes each discipline status, pending bucket and named revision. Removed revision rows contribute negative movement. Dashboard source links open the corresponding project report.
- Monthly closure percentages use closed ÷ issued × 100. An active project's zero-issued/zero-closed metric is 100%. Accumulated variance compares the current accumulated percentage with the preceding accumulated percentage.
- NCR ageing totals must equal the outstanding NCR count. Material status tags must equal the total item count.
- QTBT manhours are **attendees × duration in minutes ÷ 60**. This is the dimensional interpretation used instead of the apparent copied formula in the SOW.
- CSAT uses an independent survey date, not a forced monthly cadence.

## Scheduling

Schedules use the organization's configured timezone and the existing notification and outbound-email queue.

- Approval reminders use calendar-day thresholds: P2 from day 2, P1 director escalation from day 5.
- Missing daily and monthly submission reminders follow the SOW deadlines.
- Consecutive below-target KPI performance routes escalation to the configured project quality representative, project head and business-unit head.
- Approved monthly reports are distributed monthly; approved daily document reports are distributed fortnightly. Approval itself does not trigger stakeholder PDF distribution.
- Distribution days are **calendar days of month**, not weekdays. Typically use 1 and 15 for fortnightly delivery.
- Persistent delivery markers prevent a scheduler rerun from creating the same delivery again.

## Explicit boundaries

Phase 2 NCR/RFI/RMI and Unifier integrations are not included. The application remains the existing responsive web application.

The Digital Team's approved final PDF and dashboard layouts were not supplied. The implementation uses QMS360's current presentation and complete reporting data. Supplied final layouts can replace the presentation without replacing project/user masters or changing stored report data.

Development schema changes are additive generated migrations. No production database write, reset, force push or automatic startup schema migration is part of this work.