import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@workspace/db", async () => {
  const { EventEmitter } = await import("node:events");
  return { pool: new EventEmitter() };
});
vi.mock("./logger", () => ({ logger: { error: mocks.error } }));

import { pool } from "@workspace/db";
import "./database-pool-errors";

describe("idle database connection failures", () => {
  it("handles a terminated connection without crashing the API", () => {
    const error = Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
    expect(() => (pool as unknown as EventEmitter).emit("error", error, { connectionParameters: { password: "do-not-log" } }))
      .not.toThrow();
    expect(mocks.error).toHaveBeenCalledWith(
      { databaseError: { code: "57P01", message: error.message } },
      expect.stringContaining("replace the disconnected client"),
    );
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("do-not-log");
  });

  it("also handles network errors without a PostgreSQL error code", () => {
    expect(() => (pool as unknown as EventEmitter).emit("error", new Error("Connection terminated unexpectedly")))
      .not.toThrow();
    expect(mocks.error).toHaveBeenLastCalledWith(
      { databaseError: { code: undefined, message: "Connection terminated unexpectedly" } },
      expect.any(String),
    );
  });
});
