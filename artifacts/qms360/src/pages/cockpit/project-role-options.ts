/** Additional Data stores role labels, preserving its existing text/report contract. */
export function uniqueProjectRoles(roles: ReadonlyArray<{ name: string; active: boolean }>): string[] {
  const unique = new Map<string, string>();
  for (const role of roles) {
    const name = role.name.trim();
    if (role.active && name && !unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}
