import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Bell, Blocks, ChevronDown, ClipboardCheck, Download, FileText,
  Globe2, LayoutDashboard, Lightbulb, LogOut, Menu, MessageSquarePlus, Network,
  PanelLeftClose, PanelLeftOpen, Settings, X,
} from 'lucide-react';
import {
  useGetOrganizationSettings, useListAuditMyActions, useListAuditNotifications, useListLessonsNotifications,
  useListPlatformProjects, useListQaqcNotifications, useSearchLessonsLog
} from '@workspace/api-client-react';
import type { CurrentUser } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { FeedbackWidget } from '@/components/feedback-widget';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const appNav = {
  qaqc: [
    ['Overview', '/qaqc', LayoutDashboard], ['Metrics', '/qaqc/metrics', BarChart3],
    ['Inspections', '/qaqc/material-inspections', ClipboardCheck], ['Documents', '/qaqc/documents', FileText],
    ['Monthly reports', '/qaqc/monthly', FileText], ['Daily reports', '/qaqc/daily', ClipboardCheck], ['CSAT', '/qaqc/csat', ClipboardCheck],
    ['Report dashboard', '/qaqc/report-dashboard', BarChart3], ['Reporting settings', '/qaqc/settings', LayoutDashboard],
  ],
  lessons: [
    ['Overview', '/lessons', LayoutDashboard], ['For my Action', '/lessons/approvals', ClipboardCheck],
    ['Lesson log', '/lessons/log', Lightbulb],
    ['New lesson', '/lessons/new', FileText], ['Notifications', '/lessons/notifications', Bell],
  ],
  audit: [
    ['Overview', '/audit', LayoutDashboard], ['For my Action', '/audit/my-actions', ClipboardCheck],
    ['Programme', '/audit/schedules', ClipboardCheck],
    ['Audits', '/audit/audits', FileText], ['Reports', '/audit/reports', Download],
  ],
} as const;

const systemNav = [
  ['System Overview', '/', Globe2], ['Executive Page', '/executive', BarChart3],
  ['Project Sync View', '/sync', Network],
] as const;

export function AppShell({ children, user }: { children: ReactNode; user: CurrentUser }) {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const section = location.startsWith('/qaqc') ? 'qaqc' : (location.startsWith('/lessons') || location.startsWith('/settings/lessons')) ? 'lessons' : location.startsWith('/audit') ? 'audit' : null;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const organization = useGetOrganizationSettings();
  const projects = useListPlatformProjects({ page: 1, limit: 200 });
  const qaqcNotifications = useListQaqcNotifications({ page: 1, limit: 200 });
  const lessonNotifications = useListLessonsNotifications({ page: 1, limit: 200 });
  const auditNotifications = useListAuditNotifications({ page: 1, limit: 200 });
  const unread = useMemo(() => [
    ...(qaqcNotifications.data?.items ?? []),
    ...(lessonNotifications.data?.items ?? []),
    ...(auditNotifications.data?.items ?? []),
  ].filter(item => !item.read).length, [qaqcNotifications.data, lessonNotifications.data, auditNotifications.data]);
  const notificationsUnavailable = qaqcNotifications.isError || lessonNotifications.isError || auditNotifications.isError;

  const userPendingQuery = useSearchLessonsLog(
    { pendingApproval: true, limit: 1 },
    { query: { enabled: section === 'lessons' && !!user.id, refetchInterval: 30000, queryKey: ['/api/lessons/log', 'pendingApproval', user.id, { limit: 1 }] } }
  );
  const auditPendingQuery = useListAuditMyActions(
    { page: 1, limit: 1 },
    { query: { enabled: section === 'audit' && !!user.id, refetchInterval: 30000, queryKey: ['/api/audit/my-actions', user.id, { page: 1, limit: 1 }] } }
  );

  useEffect(() => {
    const listener = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    window.addEventListener('beforeinstallprompt', listener);
    return () => window.removeEventListener('beforeinstallprompt', listener);
  }, []);

  const isAdmin = ['Super Admin', 'Org Admin'].includes(user.platformRole ?? '')
    || (user.workspaceRoles?.some((role) => /\b(admin|administrator)\b/i.test(role)) ?? false);
  const nav = section
    ? [...appNav[section].filter(([, href]) => isAdmin || href !== '/qaqc/settings'), ...(isAdmin ? [
      ['User Feedback', '/feedback', MessageSquarePlus] as const,
    ] : [])]
    : [...systemNav, ...(isAdmin ? [
      ['Integration Cockpit', '/cockpit', Blocks] as const,
      ['User Feedback', '/feedback', MessageSquarePlus] as const,
    ] : [])];
  const orgName = organization.data?.organizationName ?? user.organizationName;
  const logout = () => {
    localStorage.removeItem('qms360_token');
    queryClient.clear();
    setLocation('/login');
  };
  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  return (
    <div className="flex min-h-dvh bg-background">
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-foreground/30 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-sidebar-foreground transition-all md:sticky md:top-0 md:h-dvh ${collapsed ? 'w-20' : 'w-64'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <Link href="/" className="flex items-center gap-3 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">Q</span>
            {!collapsed && <span>QMS360</span>}
          </Link>
          <button className="md:hidden" onClick={() => setMobileOpen(false)}><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map(([label, href, Icon]) => {
            const isLessonsActions = href === '/lessons/approvals';
            const isAuditActions = href === '/audit/my-actions';
            const isApprovals = isLessonsActions || isAuditActions;
            const count = isLessonsActions ? userPendingQuery.data?.total : isAuditActions ? auditPendingQuery.data?.total : null;
            const isError = (isLessonsActions && userPendingQuery.isError) || (isAuditActions && auditPendingQuery.isError);
            const actionLabel = isAuditActions ? 'audit' : 'lessons';
            return (
            <Link key={href as string} href={href as string} onClick={() => setMobileOpen(false)}
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm ${location === href ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}>
              <div className="flex items-center gap-3"><Icon className="h-4 w-4 shrink-0" />{!collapsed && label}</div>
              {!collapsed && isApprovals && count !== undefined && count !== null && count > 0 && <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-destructive-foreground" aria-label={`${count} ${actionLabel} For my Action`}>{count}</span>}
              {!collapsed && isApprovals && isError && <span className="text-[10px] font-bold text-destructive" title="For my Action count unavailable" aria-label="For my Action count unavailable">!</span>}
            </Link>
          )})}
          {section && isAdmin && <Link href={`/settings/${section}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent"><Settings className="h-4 w-4" />{!collapsed && 'Settings'}</Link>}
        </nav>
        <button className="m-3 hidden items-center gap-3 rounded-lg px-3 py-2 text-sidebar-foreground/70 hover:bg-sidebar-accent md:flex" onClick={() => setCollapsed(value => !value)}>
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" />Collapse</>}
        </button>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur md:px-6">
          <button className="md:hidden" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{orgName}</p>
            <p className="text-xs text-muted-foreground">Enterprise Quality Management</p>
          </div>
          <select aria-label="Project selector" className="hidden max-w-56 rounded-md border border-border bg-background px-3 py-2 text-xs sm:block">
            <option value="">All projects</option>
            {(projects.data?.items ?? []).map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
          </select>
          <Link href="/notifications" className="relative rounded-md p-2 hover:bg-muted" aria-label={notificationsUnavailable ? 'Notifications unavailable' : `${unread} unread notifications`}>
            <Bell className="h-5 w-5" />
            {!notificationsUnavailable && unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">{unread > 99 ? '99+' : unread}</span>}
            {notificationsUnavailable && <span className="absolute -right-1 -top-1 text-xs font-bold text-destructive" title="Notification count unavailable">!</span>}
          </Link>
          <div className="relative">
            <button className="flex items-center gap-2 rounded-md p-1.5 hover:bg-muted" onClick={() => setUserOpen(value => !value)}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{user.fullName.split(' ').map(word => word[0]).slice(0, 2).join('')}</span>
              <span className="hidden text-sm font-medium lg:block">{user.fullName}</span><ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
            {userOpen && <div className="absolute right-0 mt-2 w-64 rounded-lg border border-border bg-popover p-2 shadow-lg">
              <div className="border-b border-border p-2"><p className="text-sm font-semibold">{user.fullName}</p><p className="truncate text-xs text-muted-foreground">{user.email}</p></div>
              {installEvent && <Button variant="ghost" className="mt-1 w-full justify-start" onClick={() => void install()}><Download className="h-4 w-4" />Install app</Button>}
              <Button variant="ghost" className="w-full justify-start text-destructive" onClick={logout}><LogOut className="h-4 w-4" />Sign out</Button>
            </div>}
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] p-4 md:p-8">{children}</main>
      </div>
      <FeedbackWidget />
    </div>
  );
}