import { pool } from "@workspace/db";
import { logger } from "./logger";

// pg removes failed idle clients before emitting this event. Handling it keeps
// the API alive so later requests can acquire a fresh connection. Do not retry
// active queries or transactions here: their callers must still receive errors.
pool.on("error", (error: Error & { code?: string }) => {
  // Never log the client object: it may contain connection credentials.
  logger.error(
    { databaseError: { code: error.code, message: error.message } },
    "Idle database connection failed; the pool will replace the disconnected client",
  );
});
