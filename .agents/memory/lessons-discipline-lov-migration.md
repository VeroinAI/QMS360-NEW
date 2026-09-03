---
name: Lesson discipline_id LOV migration
description: lesson_learned_forms.discipline_id stores master-data LOV values (text), not UUIDs; dev DB was migrated manually, production still needs the ALTER.
---

`app2_lessons.lesson_learned_forms.discipline_id` now stores master-data LOV values (e.g. "Electrical" from the `disciplines` group), matching `categorisation` (`lesson_categorisations` group). Legacy rows hold UUID strings; the lessons update route accepts them via `assertLovValue(..., { allowLegacy: before.disciplineId })`.

**Why:** The LOV refactor (merged from main) changed frontend + backend to LOV values but never updated the schema/DB. Dev was fixed manually: dropped FK `lesson_learned_forms_discipline_id_disciplines_id_fk` and ran `ALTER COLUMN discipline_id TYPE text USING discipline_id::text`.

**How to apply:** When deploying or touching migrations (baseline/drift tasks), production's `app2_lessons.lesson_learned_forms.discipline_id` needs the same FK drop + type change, or lesson creation will 500 on an invalid-uuid insert. Seed data relies on the `lesson_categorisations` master-data group — re-run the seed after pulling schema changes.
