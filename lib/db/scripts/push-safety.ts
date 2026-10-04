export type PushPlan = {
  hasDataLoss: boolean;
  warnings: string[];
  statementsToExecute: string[];
};

export function assertDevelopment(env: NodeJS.ProcessEnv, args: string[]): void {
  if (env.NODE_ENV === "production" || env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Schema push is development-only. Use Publish / Replit Support for production.");
  }
  if (args.length) {
    throw new Error("Development push accepts no arguments, connection overrides or force flags.");
  }
}

export async function applySafePlan(
  plan: PushPlan,
  execute: (statement: string) => Promise<unknown>,
): Promise<number> {
  // Drizzle's hasDataLoss check can allow dropping *empty* objects. Refuse
  // those too: automatic post-merge setup is not a rename/removal workflow.
  const destructive = plan.statementsToExecute.some((statement) =>
    /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|TYPE)\b|^\s*(?:TRUNCATE|DELETE\s+FROM|UPDATE)\b|\bALTER\s+COLUMN\s+"[^"]+"\s+(?:SET\s+DATA\s+)?TYPE\b/i.test(statement),
  );
  if (plan.hasDataLoss || destructive) {
    throw new Error("Automatic development push refused destructive or data-rewriting changes. Review the schema diff manually; do not use a broad force push.");
  }
  for (const warning of plan.warnings) console.warn(`WARNING: ${warning}`);
  // Only additions belong in unattended setup. Preserve existing indexes,
  // defaults and constraints instead of letting introspection/name differences
  // rewrite them. A DROP/ADD constraint pair is maintenance, not an addition.
  const tableIdentifier = '"[^"]+"(?:\\."[^"]+")?';
  const dropConstraintPattern = new RegExp(`^ALTER TABLE (${tableIdentifier}) DROP CONSTRAINT "([^"]+)"`, "i");
  const addConstraintPattern = new RegExp(`^ALTER TABLE (${tableIdentifier}) ADD CONSTRAINT "([^"]+)"`, "i");
  const constraintReplacements = new Set(
    plan.statementsToExecute.flatMap((statement) => {
      const match = statement.match(dropConstraintPattern);
      return match ? [`${match[1]}.${match[2]}`] : [];
    }),
  );
  // DROP uses schema.index; CREATE normally uses index ON schema.table.
  // Index names are unique within a schema, not across the whole database.
  const indexIdentity = (identifier: string, defaultSchema = "public"): string => {
    const parts = identifier.match(/^"([^"]+)"(?:\."([^"]+)")?$/);
    if (!parts) throw new Error(`Unrecognized index identifier: ${identifier}`);
    return JSON.stringify(parts[2] ? [parts[1], parts[2]] : [defaultSchema, parts[1]]);
  };
  const dropIndexPattern = new RegExp(`^\\s*DROP INDEX (?:CONCURRENTLY )?(?:IF EXISTS )?(${tableIdentifier})`, "i");
  const createIndexPattern = new RegExp(`^\\s*CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?(${tableIdentifier}) ON (?:ONLY )?(${tableIdentifier})`, "i");
  const indexReplacements = new Set(
    plan.statementsToExecute.flatMap((statement) => {
      const match = statement.match(dropIndexPattern);
      return match ? [indexIdentity(match[1])] : [];
    }),
  );
  const additivePattern = new RegExp(
    `^\\s*CREATE\\s+(?:SCHEMA|TABLE|TYPE|(?:UNIQUE\\s+)?INDEX)\\b|^\\s*ALTER\\s+TABLE\\s+${tableIdentifier}\\s+ADD\\s+(?:COLUMN|CONSTRAINT)\\b|^\\s*ALTER\\s+TYPE\\s+${tableIdentifier}\\s+ADD\\s+VALUE\\b`,
    "i",
  );
  const additions: string[] = [];
  for (const statement of plan.statementsToExecute) {
    const addConstraint = statement.match(addConstraintPattern);
    // PG truncates identifiers to 63 bytes; Drizzle also changed the default
    // FK name suffix. Preserve those replacement pairs, but allow genuinely
    // new constraints on the same table.
    const replacement = addConstraint && [
      addConstraint[2].slice(0, 63),
      addConstraint[2].replace(/_fk$/, "").slice(0, 63),
    ].some((name) => constraintReplacements.has(`${addConstraint[1]}.${name}`));
    const createIndex = statement.match(createIndexPattern);
    const tableParts = createIndex?.[2].match(/^"([^"]+)"(?:\."([^"]+)")?$/);
    const indexReplacement = createIndex && indexReplacements.has(
      indexIdentity(createIndex[1], tableParts?.[2] ? tableParts[1] : "public"),
    );
    if (additivePattern.test(statement) && !replacement && !indexReplacement) {
      additions.push(statement);
    } else {
      console.warn(`MAINTENANCE (not applied by additive development setup): ${statement.trim()}`);
    }
  }
  // Unlike drizzle-kit's CLI (which catches pgPush errors without a failing
  // exit status), this API rejects SQL errors. Never swallow that rejection.
  for (const statement of additions) await execute(statement);
  return additions.length;
}