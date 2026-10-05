/** Settings belongs to its application, including nested tabs and direct page loads. */
export function applicationSection(location: string) {
  if (location.startsWith('/qaqc') || location.startsWith('/settings/qaqc')) return 'qaqc';
  if (location.startsWith('/lessons') || location.startsWith('/settings/lessons')) return 'lessons';
  if (location.startsWith('/audit') || location.startsWith('/settings/audit')) return 'audit';
  return null;
}