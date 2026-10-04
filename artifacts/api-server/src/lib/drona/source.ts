import { dronaId } from "./ids";

/** Inject a server-side database client; this reader never creates a connection,
 * writes a source record, issues a session, or interprets a role as a grant. */
export interface DronaReadClient {
  query<Row extends Record<string, unknown>>(text: string, values: string[]): Promise<{ rows: Row[] }>;
}

export type DronaAssignment = {
  assignmentId: string;
  projectMapId: string;
  projectId: string;
  roleId: string;
  roleName: string;
  assignmentActive: boolean | null;
  projectActive: boolean;
  coordinator: boolean | null;
  sbgId: string;
  businessUnitId: string;
  divisionId: string;
  departmentId: string | null;
  assignmentModule: string | null;
  assignmentModules: unknown;
  projectMappingModules: unknown;
  projectModule: string | null;
  projectModules: unknown;
};

export type DronaSourceSnapshot = {
  userId: string;
  userActive: boolean;
  assignments: DronaAssignment[];
  /** Deliberately not an authentication or authorization result. */
  authorizationReady: false;
};

type SourceRow = {
  user_id: string; user_active: boolean;
  assignment_id: string | null; project_map_id: string | null;
  project_id: string | null; role_id: string | null; role_name: string | null;
  assignment_active: boolean | null; project_active: boolean | null;
  coordinator: boolean | null;
  sbg_id: string | null; bu_id: string | null; division_id: string | null;
  department_id: string | null; assignment_module: string | null;
  assignment_modules: unknown; mapping_modules: unknown;
  project_module: string | null; project_modules: unknown;
};

export const DRONA_USER_SNAPSHOT_SQL = `
SELECT u.user_id::text AS user_id, u.is_active AS user_active,
       a.user_role_map_id::text AS assignment_id,
       m.project_map_id::text AS project_map_id, p.project_id::text AS project_id,
       r.user_role_id::text AS role_id, r.user_role AS role_name,
       a.is_active AS assignment_active, p.is_active AS project_active,
       a.is_coordinator AS coordinator,
       m.sbg_id::text AS sbg_id, m.bu_id::text AS bu_id,
       m.division_id::text AS division_id, m.department_id::text AS department_id,
       a.module AS assignment_module, a.modules AS assignment_modules,
       m.modules AS mapping_modules, p.module AS project_module,
       p.modules AS project_modules
FROM public.user_master u
LEFT JOIN public.user_role_mapping a ON a.user_id = u.user_id
LEFT JOIN public.project_mapping m ON m.project_map_id = a.project_map_id
LEFT JOIN public.project_master p ON p.project_id = m.project_id
LEFT JOIN public.user_role_master r ON r.user_role_id = a.user_role_id
WHERE u.user_id = $1::bigint
ORDER BY a.user_role_map_id`;

function required<T>(value: T | null): T {
  if (value === null || value === undefined) throw new Error("Drona assignment has an unresolved source reference");
  return value;
}

/** Hierarchy identifiers have no confirmed positivity constraint. Preserve
 * zero/negative sentinels for review rather than guessing their semantics. */
function hierarchyId(value: string | null): string {
  const id = required(value);
  if (!/^(0|-?[1-9][0-9]*)$/.test(id) || id.length > 11
    || BigInt(id) < -2147483648n || BigInt(id) > 2147483647n) {
    throw new Error("Drona hierarchy identifiers must be PostgreSQL integer strings");
  }
  return id;
}

/** All assignments, including inactive ones, are retained for parity review.
 * Array values remain uninterpreted until element types/precedence are confirmed.
 * No email, phone number, password, or signature is selected. */
export async function readDronaUserSnapshot(
  client: DronaReadClient, externalUserId: string,
): Promise<DronaSourceSnapshot | null> {
  const userId = dronaId(externalUserId);
  const { rows } = await client.query<SourceRow>(DRONA_USER_SNAPSHOT_SQL, [userId]);
  if (!rows.length) return null;
  if (rows.some((row) => row.user_id !== userId || typeof row.user_active !== "boolean"
    || row.user_active !== rows[0]!.user_active)) {
    throw new Error("Drona source returned an inconsistent user");
  }
  const seen = new Set<string>();
  const assignments = rows.filter((row) => row.assignment_id !== null).map((row): DronaAssignment => {
    const assignmentId = dronaId(row.assignment_id);
    if (seen.has(assignmentId)) throw new Error("Drona source returned a duplicate assignment");
    seen.add(assignmentId);
    return {
      assignmentId,
      projectMapId: dronaId(required(row.project_map_id)),
      projectId: dronaId(required(row.project_id)),
      roleId: dronaId(required(row.role_id)),
      roleName: required(row.role_name),
      assignmentActive: row.assignment_active,
      projectActive: required(row.project_active),
      coordinator: row.coordinator,
      sbgId: hierarchyId(row.sbg_id),
      businessUnitId: hierarchyId(row.bu_id),
      divisionId: hierarchyId(row.division_id),
      departmentId: row.department_id === null ? null : hierarchyId(row.department_id),
      assignmentModule: row.assignment_module,
      assignmentModules: row.assignment_modules,
      projectMappingModules: row.mapping_modules,
      projectModule: row.project_module,
      projectModules: row.project_modules,
    };
  });
  return { userId, userActive: rows[0]!.user_active, assignments, authorizationReady: false };
}