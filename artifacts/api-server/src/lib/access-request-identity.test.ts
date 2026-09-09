import { describe, expect, it } from "vitest";
import { accessRequestIdentity, activeUserIdentityByUsername } from "./access-request-identity";

const tenantId = "tenant-a";

const user = (overrides: Partial<{
  id: string;
  organizationId: string;
  username: string;
  fullName: string;
  email: string;
  deletedAt: Date | null;
}> = {}) => ({
  id: "active-id",
  organizationId: tenantId,
  username: "requester",
  fullName: "Active Requester",
  email: "active@example.com",
  deletedAt: null,
  ...overrides,
});

describe("activeUserIdentityByUsername", () => {
  it("uses the active tenant user when a deleted account reused the username", () => {
    const identities = activeUserIdentityByUsername([
      user({ id: "deleted-id", fullName: "Former Requester", email: "former@example.com", deletedAt: new Date("2026-01-01") }),
      user(),
    ], tenantId);

    expect(accessRequestIdentity("requester", identities)).toEqual({
      userId: "active-id",
      fullName: "Active Requester",
      username: "requester",
      email: "active@example.com",
    });
  });

  it("returns the unavailable-user payload without exposing deleted or cross-tenant users", () => {
    const identities = activeUserIdentityByUsername([
      user({ id: "deleted-id", deletedAt: new Date("2026-01-01") }),
      user({ id: "other-tenant-id", organizationId: "tenant-b" }),
    ], tenantId);

    expect(accessRequestIdentity("requester", identities)).toEqual({
      userId: "requester",
      fullName: null,
      username: "requester",
      email: null,
    });
  });
});