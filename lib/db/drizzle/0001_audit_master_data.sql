-- Seed audit-scope master-data groups (locations, process/product owners, L1/L2 level names)
-- with sensible defaults for every existing organization. Idempotent: skips orgs that
-- already have a group with the same code. New values remain editable in the Master Data Cockpit.
INSERT INTO "shared"."master_data_groups" ("organization_id", "code", "name", "description", "app_scope", "is_system", "sort_order")
SELECT o.id, g.code, g.name, g.description, 'audit', true, g.sort_order
FROM "shared"."organizations" o
CROSS JOIN (VALUES
  ('locations', 'Locations', 'Audit locations and sites', 10),
  ('process_product_owners', 'Process / Product Owners', 'Owners of audited processes or products', 11),
  ('audit_levels', 'Audit Level Names', 'Names or roles for L1 and L2 reviewers', 12)
) AS g(code, name, description, sort_order)
WHERE o.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM "shared"."master_data_groups" existing
  WHERE existing.organization_id = o.id AND existing.code = g.code AND existing.deleted_at IS NULL
);
--> statement-breakpoint
INSERT INTO "shared"."master_data_values" ("organization_id", "group_id", "value", "label", "sort_order", "active")
SELECT g.organization_id, g.id, v.value, v.label, v.sort_order, true
FROM "shared"."master_data_groups" g
CROSS JOIN LATERAL (VALUES
  ('locations', 'head-office', 'Head Office', 1),
  ('locations', 'project-site', 'Project Site', 2),
  ('locations', 'workshop', 'Workshop / Yard', 3),
  ('process_product_owners', 'qaqc-manager', 'QA/QC Manager', 1),
  ('process_product_owners', 'project-manager', 'Project Manager', 2),
  ('process_product_owners', 'operations-manager', 'Operations Manager', 3),
  ('audit_levels', 'qaqc-manager', 'QA/QC Manager', 1),
  ('audit_levels', 'technical-director', 'Technical Director', 2),
  ('audit_levels', 'operations-director', 'Operations Director', 3)
) AS v(group_code, value, label, sort_order)
WHERE g.code = v.group_code AND g.app_scope = 'audit' AND g.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM "shared"."master_data_values" existing
  WHERE existing.group_id = g.id AND existing.value = v.value AND existing.deleted_at IS NULL
);
