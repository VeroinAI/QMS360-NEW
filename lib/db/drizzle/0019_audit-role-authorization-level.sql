ALTER TABLE "app1_qaqc"."workspace_roles" ADD COLUMN "role_authorization_level" integer;--> statement-breakpoint
ALTER TABLE "app2_lessons"."workspace_roles" ADD COLUMN "role_authorization_level" integer;--> statement-breakpoint
ALTER TABLE "app3_audit"."workspace_roles" ADD COLUMN "role_authorization_level" integer;--> statement-breakpoint
-- Preserve the configured order of existing L1/L2 approval roles without changing their names or assignments.
UPDATE "app3_audit"."workspace_roles" AS role
SET "role_authorization_level" = substring(role."name" from '\m[Ll]([0-9]{1,9})\M')::integer
WHERE role."role_authorization_level" IS NULL
  AND role."name" ~ '\m[Ll][0-9]{1,9}\M'
  AND substring(role."name" from '\m[Ll]([0-9]{1,9})\M')::bigint BETWEEN 1 AND 2147483647
  AND EXISTS (
    SELECT 1 FROM "app3_audit"."workspace_role_permissions" AS rp
    JOIN "app3_audit"."permissions" AS permission ON permission."id" = rp."permission_id"
    WHERE rp."workspace_role_id" = role."id"
      AND rp."deleted_at" IS NULL
      AND permission."deleted_at" IS NULL
      AND rp."grant" = 'full'
      AND permission."key" IN ('approve_reject', 'schedules.approve_reject', 'schedules')
  );