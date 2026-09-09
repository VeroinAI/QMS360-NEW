type TenantUserIdentity = {
  id: string;
  organizationId: string;
  username: string;
  fullName: string;
  email: string;
  deletedAt: Date | null;
};

export function activeUserIdentityByUsername<T extends TenantUserIdentity>(
  rows: T[],
  organizationId: string,
): Map<string, T> {
  return new Map(
    rows
      .filter((user) => user.organizationId === organizationId && user.deletedAt === null)
      .map((user) => [user.username, user]),
  );
}

export function accessRequestIdentity(
  username: string,
  identities: Map<string, TenantUserIdentity>,
) {
  const requester = identities.get(username);
  return {
    userId: requester?.id ?? username,
    fullName: requester?.fullName ?? null,
    username,
    email: requester?.email ?? null,
  };
}