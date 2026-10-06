import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { issueDronaToken, issueToken, verifyToken } from "../auth";

const user = { id: "20000000-0000-0000-0000-000000000001", organizationId: "10000000-0000-0000-0000-000000000001" };
describe("Drona exception session claims", () => {
  it("signs an environment-bound 30-minute token and retains the bigint source identity", () => {
    const token = issueDronaToken(user, "9007199254740993", "aws");
    expect(verifyToken(token)).toEqual({
      sub: user.id, organizationId: user.organizationId,
      source: "drona-email-exception", externalUserId: "9007199254740993", environment: "aws",
    });
    const claims = jwt.decode(token) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(1800);
  });
  it("leaves existing local token claims and expiry unchanged", () => {
    const token = issueToken(user);
    expect(verifyToken(token)).toEqual({ sub: user.id, organizationId: user.organizationId });
    const claims = jwt.decode(token) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(8 * 3600);
  });
});
