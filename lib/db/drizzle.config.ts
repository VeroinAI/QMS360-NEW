import { defineConfig } from "drizzle-kit";
import path from "path";
import { managedSchemas } from "./src/managed-schemas";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/*.ts"),
  dialect: "postgresql",
  // Push introspection defaults to public only. Include every schema declared
  // in src/schema, otherwise existing app enums look missing and are recreated.
  schemaFilter: managedSchemas,
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
