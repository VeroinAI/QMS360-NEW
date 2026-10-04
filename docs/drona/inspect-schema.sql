-- Schema-only review. Contains no source personal data and no DDL.
-- Run manually with a read-only role in the intended environment.
BEGIN TRANSACTION READ ONLY;

SELECT table_name, column_name, ordinal_position, data_type, udt_name,
       character_maximum_length, is_nullable, column_default, is_identity,
       identity_generation
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_master', 'user_role_master', 'user_role_mapping',
                     'project_mapping', 'project_master')
ORDER BY table_name, ordinal_position;

-- format_type includes actual array element types. Do not infer these from ARRAY.
SELECT c.relname AS table_name, a.attname AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS exact_type
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
  AND c.relname IN ('user_master', 'user_role_master', 'user_role_mapping',
                    'project_mapping', 'project_master')
ORDER BY c.relname, a.attnum;

SELECT c.relname AS table_name, k.conname, k.contype,
       pg_catalog.pg_get_constraintdef(k.oid) AS definition
FROM pg_catalog.pg_constraint k
JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('user_master', 'user_role_master', 'user_role_mapping',
                    'project_mapping', 'project_master')
ORDER BY c.relname, k.conname;

SELECT tablename, indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('user_master', 'user_role_master', 'user_role_mapping',
                    'project_mapping', 'project_master')
ORDER BY tablename, indexname;

SELECT c.relname AS table_name, t.tgname,
       pg_catalog.pg_get_triggerdef(t.oid) AS definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
  AND c.relname IN ('user_master', 'user_role_master', 'user_role_mapping',
                    'project_mapping', 'project_master')
ORDER BY c.relname, t.tgname;

SELECT table_name, column_name,
       pg_catalog.pg_get_serial_sequence(
         format('%I.%I', table_schema, table_name), column_name
       ) AS owned_sequence
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('user_master', 'user_id'), ('user_role_master', 'user_role_id'),
    ('user_role_mapping', 'user_role_map_id'),
    ('project_mapping', 'project_map_id'), ('project_master', 'project_id')
  )
ORDER BY table_name;

COMMIT;