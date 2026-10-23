# Project Audit Plan PDF mapping verification

## Missing-value rule

This rule applies only to the Project Audit Plan PDF. An implemented mapping
with no available saved value prints `-`, including absent related records and
unresolved user/role IDs. Finite numbers, including zero, remain visible.
User-authored text is not globally rewritten. Unused cells in overflow
continuations remain blank.

**Only Revision remains genuinely unmapped**, and prints exactly `To be mapped`.
Audit Plans have no persisted revision business field or revision workflow.
Neither update timestamps nor numbering counters are revision values.

## Complete printed field map

| Printed field | Authoritative saved source / existing compatibility fallback |
| --- | --- |
| Cover title and repeated page title | Linked Project name; legacy Plan metadata audit title, then Plan scope if no Project name |
| Cover reference and header Audit Reference Number | Plan metadata plan number; legacy linked individual Schedule audit number |
| Header Audit No | Individual Schedule metadata audit number |
| Header Date | Plan creation timestamp, converted to requested report timezone and organization date format |
| Lead/Internal Auditor and Prepared By | Plan metadata Lead Auditor; legacy first Plan team member; scoped User name |
| Audit Team | Saved Plan team member IDs resolved to scoped User names |
| Cover Auditee | Saved Plan Auditee role IDs resolved to scoped Audit roles; legacy saved auditee/process-owner User |
| Scope | Saved Plan QA/QC scope, with Plan scope legacy fallback |
| Audit Type | Saved Plan audit types, with legacy Plan criteria |
| Standards | Individual Schedule QA/QC clauses |
| Audit Language | Saved Plan language, not an invented UI default |
| SHEQ Audit Ref. | Saved Plan QA/QC reference, with linked Schedule QA/QC reference fallback |
| Start Date | Plan start date/time; legacy Plan audit date, then Schedule planned start |
| End Date | Plan end date/time; legacy Schedule planned end |
| Opening / Closing Meeting | Respective saved Plan meeting date/time |
| Four date-table Remarks | Independent Plan metadata startDateTimeRemark, endDateTimeRemark, openingMeetingDateTimeRemark, closingMeetingDateTimeRemark |
| Project Name | Scoped linked Project name |
| Contract # and header Contract Number | Project custom-field aliases contractNumber / contractNo / contract #; never Project code |
| Client / Consultant | Project custom fields client / clientName and consultant / consultantName |
| Main contractor | Project custom fields mainContractor / mainContractorName |
| Project Manager | Project custom fields projectManager / projectManagerName / pmName |
| TCC / PAC / FAC | Project custom fields tcc / tccDate, pac / pacDate, fac / facDate |
| Contract Value | Project custom field contractValue, including zero |
| Contract Signed Date | Project custom field contractSignedDate |
| PTS # | Project custom fields ptsNumber / ptsNo / pts # |
| Section/Activities to be Accessed | Each saved activity section resolved to organization Activities master label; historical free text retained; legacy single section uses Plan activitySection / location |
| Activity notes | Each saved activity's remarks; legacy activityRemarks / feasibilityNotes |
| Activity Auditee Role | Each saved activity's role IDs resolved to scoped Audit roles; no substitution of people or live defaults |
| Planned Start / Planned End | Each saved activity's independent range; existing saved legacy shared timestamp derivation retains its explicit explanatory label |
| Audit Program Manager | Earliest retained Plan creation audit event's actor, resolved to scoped User; never current downloader or last editor |
| Both signature images | Corresponding Lead Auditor / original creator's scoped User-master signature; storage errors still fail rather than pretending the image is absent |
| Continuation headers and footers | Same mapped data as above; actual generated page numbers |

Custom-field aliases retain the existing case/punctuation-insensitive matching.
Missing aliases mean missing data, not missing mapping logic. Planned dates and
meeting times preserve their saved calendar day and wall-clock time, including
legacy offset-suffixed timestamps. Existing custom-field text is not reinterpreted
as new business dates.

## Verification

Focused tests cover mapper values, the actual report route's assembly using
read-only mocked database sources, organization-bound query predicates, creator
and Lead signatures, no saved-record mutation, response headers, and extracted
PDF text using `pdftotext`. Existing date contracts, legacy fallbacks, activity
labels and signature-format/failure tests remain included.

Cases include populated and sparse reports; all four distinct multiline remarks;
absent, explicitly cleared and whitespace-only remarks; each remark at exactly
4,000 characters with every unique content marker and final marker extracted;
missing users, roles, Project and Schedule; numeric zero; literal mapping-like
user text; and complete long signer-name continuations.

Run:

```sh
pnpm --filter @workspace/api-server exec vitest run \
  src/routes/audit-plan-report.test.ts \
  src/lib/audit-plan-pdf.test.ts \
  src/lib/audit-plan-pdf-mappings.test.ts \
  src/lib/audit-plan-date-remarks.test.ts \
  src/lib/audit-plan-signatures.test.ts \
  src/lib/audit-plan-activity-labels.test.ts
pnpm --filter @workspace/api-server run typecheck
```

Representative PDFs generated by these tests were rendered with
`.agents/scripts/render-audit-plan-verification.py`. Visual inspection covered
the populated cover/artwork, populated date/project/activity page, sparse
multiline date remarks, continuation content, final continuation/signature
page, and both embedded synthetic test signatures. Branding, cell alignment,
organization-formatted dates, saved meeting times, blank structural continuation
cells and footer clearance were retained. Synthetic fixtures are test-only;
no template sample people, business data or signatures are introduced.

The generation remains read-only. No form, workflow, permission, numbering,
stored record, other report template or missing-value convention is changed.
