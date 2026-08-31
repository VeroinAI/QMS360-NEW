import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  FolderKanban,
  Globe2,
  History,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  LogIn,
  Menu,
  Network,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  useContainerSso,
  useGetAppOverview,
  useGetAppSettings,
  useGetCurrentUser,
  useGetExecutiveOverview,
  useGetPlatformContext,
  useHealthCheck,
  useListProjects,
  useLogin,
  useRegister,
  getGetCurrentUserQueryKey,
  setAuthTokenGetter,
} from '@workspace/api-client-react';
import type {
  AppKey,
  AppOverview,
  AppSettings,
  CurrentUser,
  ExecutiveOverview,
  PlatformApp,
  PlatformContext,
  Project,
  OverviewRecord,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

setAuthTokenGetter(() =>
  typeof window === 'undefined' ? null : window.localStorage.getItem('qms360_token'),
);

const demoUser: CurrentUser = {
  id: 'demo-user',
  email: 'noura.alharbi@algihaz.com',
  username: 'noura.alharbi',
  fullName: 'Noura Alharbi',
  platformRole: 'Quality Director',
  organizationName: 'Algihaz Holding',
  workspaceRoles: ['Platform administrator', 'Quality director'],
};

const demoProjects: Project[] = [
  { id: 'p1', code: 'SHR-04', name: 'Shuqaiq Expansion', businessUnit: 'Energy', status: 'Active', location: 'Jazan' },
  { id: 'p2', code: 'NGR-17', name: 'North Grid Modernization', businessUnit: 'Utilities', status: 'Active', location: 'Riyadh' },
  { id: 'p3', code: 'DMM-22', name: 'Dammam Operations Centre', businessUnit: 'Infrastructure', status: 'Planning', location: 'Dammam' },
];

const demoApps: PlatformApp[] = [
  { key: 'qaqc', name: 'QA/QC & Document Governance', shortName: 'QA/QC', description: 'Keep project evidence, approvals, and controlled documents moving together.', accent: 'hsl(var(--ag-purple))', workspaceRoleCount: 8, hasAccess: true },
  { key: 'lessons', name: 'Lesson Learned Management', shortName: 'Lessons', description: 'Turn field experience into searchable, reusable practice across the group.', accent: 'hsl(var(--ag-turquoise))', workspaceRoleCount: 5, hasAccess: true },
  { key: 'audit', name: 'QMS Audit Management', shortName: 'Audits', description: 'Plan, conduct, and close audits with one dependable line of sight.', accent: 'hsl(var(--ag-yellow))', workspaceRoleCount: 6, hasAccess: true },
];

const appAccentColor: Record<string, string> = {
  purple: 'hsl(var(--ag-purple))',
  turquoise: 'hsl(var(--ag-turquoise))',
  yellow: 'hsl(var(--ag-yellow))',
  fuchsia: 'hsl(var(--ag-fuchsia))',
  black: 'hsl(var(--ag-black))',
};

const demoContext: PlatformContext = { organizationName: 'Algihaz Holding', apps: demoApps, projects: demoProjects };

const demoOverviews: Record<AppKey, AppOverview> = {
  qaqc: {
    appKey: 'qaqc', title: 'QA/QC & Document Governance', eyebrow: 'Quality delivery office',
    summary: 'A clear operating picture for the evidence, documents, and approvals that keep delivery moving.',
    metrics: [
      { label: 'Open submittals', value: '24', detail: '6 need attention this week', tone: 'purple' },
      { label: 'Controlled documents', value: '186', detail: '98.4% current revision', tone: 'turquoise' },
      { label: 'Inspections due', value: '08', detail: 'Across 3 active projects', tone: 'yellow' },
      { label: 'Approval cycle', value: '2.6d', detail: 'Down from 3.1d last month', tone: 'fuchsia' },
    ],
    recentRecords: [
      { id: 'q1', title: 'Method statement — cable trenching', reference: 'MS-SHR-041', status: 'Awaiting review', meta: 'Shuqaiq Expansion · Civil', updatedAt: '18 min ago' },
      { id: 'q2', title: 'Inspection & test plan — switchgear', reference: 'ITP-NGR-118', status: 'Approved', meta: 'North Grid Modernization · Electrical', updatedAt: 'Today, 09:42' },
      { id: 'q3', title: 'Concrete pour checklist', reference: 'CHK-DMM-009', status: 'Action required', meta: 'Dammam Operations Centre · Structural', updatedAt: 'Yesterday' },
    ],
    modules: ['Submittals', 'Inspections', 'Document register', 'Non-conformances', 'Transmittals'],
    canConfigure: true,
  },
  lessons: {
    appKey: 'lessons', title: 'Lesson Learned Management', eyebrow: 'Organizational learning',
    summary: 'Make experience useful at the moment decisions are made—not six months after closeout.',
    metrics: [
      { label: 'Published lessons', value: '47', detail: '12 added this quarter', tone: 'turquoise' },
      { label: 'Pending validation', value: '09', detail: '3 submitted from site teams', tone: 'yellow' },
      { label: 'Reuse signals', value: '31', detail: 'Matched to active projects', tone: 'purple' },
      { label: 'Avg. time to share', value: '4.2d', detail: 'From capture to publication', tone: 'fuchsia' },
    ],
    recentRecords: [
      { id: 'l1', title: 'Early utility scans reduced redesign', reference: 'LL-SHR-014', status: 'Published', meta: 'Shuqaiq Expansion · Planning', updatedAt: 'Today, 08:16' },
      { id: 'l2', title: 'Sequence energization permits earlier', reference: 'LL-NGR-008', status: 'In validation', meta: 'North Grid Modernization · Commissioning', updatedAt: 'Yesterday' },
      { id: 'l3', title: 'Vendor data pack ownership at handover', reference: 'LL-GRP-022', status: 'Draft', meta: 'Group practice · Handover', updatedAt: '2 days ago' },
    ],
    modules: ['Capture lesson', 'Library', 'Validation queue', 'Themes', 'Impact tracking'],
    canConfigure: true,
  },
  audit: {
    appKey: 'audit', title: 'QMS Audit Management', eyebrow: 'Assurance & oversight',
    summary: 'Coordinate the audit programme, close findings with confidence, and see where risk is changing.',
    metrics: [
      { label: 'Active audits', value: '06', detail: '2 in fieldwork this week', tone: 'yellow' },
      { label: 'Open findings', value: '18', detail: '4 high-priority actions', tone: 'fuchsia' },
      { label: 'On-time closures', value: '91%', detail: 'Above the 85% target', tone: 'turquoise' },
      { label: 'Next audit', value: '12d', detail: 'ISO 9001 surveillance', tone: 'purple' },
    ],
    recentRecords: [
      { id: 'a1', title: 'Supplier quality audit — Gulf Cables', reference: 'AUD-2024-031', status: 'Fieldwork', meta: 'North Grid Modernization · Supplier', updatedAt: 'Today, 10:05' },
      { id: 'a2', title: 'Project delivery system review', reference: 'AUD-2024-028', status: '2 actions open', meta: 'Shuqaiq Expansion · Internal', updatedAt: 'Yesterday' },
      { id: 'a3', title: 'Corporate QMS surveillance', reference: 'AUD-2024-024', status: 'Scheduled', meta: 'Algihaz Holding · External', updatedAt: '14 Jun 2024' },
    ],
    modules: ['Audit programme', 'My audits', 'Findings', 'Actions', 'Evidence'],
    canConfigure: true,
  },
};

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3" data-testid="brand-qms360">
      <div className="relative flex h-9 w-9 items-end justify-center gap-0.5 rounded-[10px] bg-[hsl(var(--sidebar-primary))] px-2 pb-1.5 shadow-sm">
        <span className="h-3 w-1.5 rounded-sm bg-[hsl(var(--sidebar))]" />
        <span className="h-5 w-1.5 rounded-sm bg-[hsl(var(--sidebar))]" />
        <span className="h-6 w-1.5 rounded-sm bg-[hsl(var(--sidebar))]" />
      </div>
      {!compact && <div className="leading-none"><span className="font-display text-[17px] font-bold tracking-[-.04em]">qms<span className="text-[hsl(var(--accent))]">360</span></span><span className="mt-1 block text-[9px] font-semibold uppercase tracking-[.18em] text-muted-foreground">Algihaz quality system</span></div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const style = lower.includes('approved') || lower.includes('published') || lower.includes('on-time')
    ? 'bg-[hsl(163_47%_92%)] text-[hsl(165_57%_28%)]'
    : lower.includes('action') || lower.includes('open') || lower.includes('review') || lower.includes('validation')
      ? 'bg-[hsl(38_90%_91%)] text-[hsl(28_80%_36%)]'
      : lower.includes('draft') || lower.includes('scheduled')
        ? 'bg-[hsl(258_24%_93%)] text-[hsl(258_49%_34%)]'
        : 'bg-[hsl(var(--muted))] text-muted-foreground';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${style}`} data-testid={`status-${status.toLowerCase().replace(/\s+/g, '-')}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>;
}

function LoadingState({ label = 'Loading your quality view' }: { label?: string }) {
  return <div className="space-y-5" data-testid="state-loading">
    <div className="skeleton h-32 rounded-2xl opacity-70" />
    <div className="grid gap-4 md:grid-cols-4"><div className="skeleton h-28 rounded-xl" /><div className="skeleton h-28 rounded-xl" /><div className="skeleton h-28 rounded-xl" /><div className="skeleton h-28 rounded-xl" /></div>
    <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><div className="skeleton h-80 rounded-xl" /><div className="skeleton h-80 rounded-xl" /></div>
    <p className="text-center text-xs text-muted-foreground">{label}</p>
  </div>;
}

function ErrorState({ onRetry, compact = false }: { onRetry: () => void; compact?: boolean }) {
  return <div className={`rounded-xl border border-[hsl(28_80%_65%/.45)] bg-[hsl(38_90%_94%)] ${compact ? 'p-3' : 'p-8 text-center'}`} data-testid="state-error">
    <div className={`flex ${compact ? 'items-center' : 'flex-col items-center'} gap-3`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(38_90%_86%)] text-[hsl(28_80%_36%)]"><CircleDot className="h-4 w-4" /></div>
      <div className={compact ? 'flex-1' : ''}><p className="font-semibold text-[hsl(258_20%_17%)]">Snapshot unavailable</p><p className="mt-1 text-xs text-[hsl(258_10%_47%)]">We kept the workspace open, but the latest service response did not arrive.</p></div>
      <button onClick={onRetry} className="inline-flex items-center gap-2 rounded-md border border-[hsl(28_80%_65%/.6)] bg-transparent px-3 py-2 text-xs font-semibold text-[hsl(28_80%_36%)] transition hover:bg-[hsl(38_90%_88%)]" data-testid="button-retry"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
    </div>
  </div>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: string }) {
  return <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-[hsl(var(--card)/.45)] px-6 py-14 text-center" data-testid="state-empty">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><FolderKanban className="h-5 w-5" /></div>
    <h3 className="font-display text-lg font-semibold">{title}</h3><p className="mt-2 max-w-sm text-sm text-muted-foreground">{detail}</p>
    {action && <button className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="button-empty-action"><Plus className="h-4 w-4" />{action}</button>}
  </div>;
}

function TopBar({ currentUser, appKey, onMenu }: { currentUser: CurrentUser; appKey?: AppKey; onMenu: () => void }) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const app = demoApps.find((item) => item.key === appKey);
  return <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border bg-[hsl(var(--background)/.9)] px-4 backdrop-blur-md md:px-8">
    <div className="flex items-center gap-3">
      <button onClick={onMenu} className="rounded-md p-2 text-muted-foreground hover:bg-muted md:hidden" data-testid="button-mobile-menu"><Menu className="h-5 w-5" /></button>
      {app ? <div className="flex items-center gap-2.5"><div className="h-2 w-2 rounded-full" style={{ backgroundColor: appAccentColor[app.accent] || app.accent }} /><div><p className="font-display text-sm font-semibold">{app.shortName}</p><p className="hidden text-[11px] text-muted-foreground sm:block">Independent workspace</p></div></div> : <div className="hidden items-center gap-2 md:flex"><Globe2 className="h-4 w-4 text-[hsl(var(--accent))]" /><span className="text-sm font-medium">Quality system overview</span></div>}
    </div>
    <div className="flex items-center gap-2 sm:gap-4">
      <div className="relative hidden sm:block">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input className="h-9 w-40 rounded-md border border-border bg-card pl-9 pr-3 text-xs outline-none transition focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/.14)] lg:w-56" placeholder="Search quality system" data-testid="input-global-search" />
      </div>
      <button className="relative rounded-md p-2 text-muted-foreground hover:bg-muted" data-testid="button-notifications"><Bell className="h-[18px] w-[18px]" /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /></button>
      <div className="relative">
        <button onClick={() => setSwitcherOpen(!switcherOpen)} className="flex items-center gap-2 rounded-md p-1.5 pr-2 hover:bg-muted" data-testid="button-user-menu"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-xs font-bold text-primary-foreground">{currentUser.fullName.split(' ').map((name) => name[0]).slice(0, 2).join('')}</span><span className="hidden max-w-[110px] truncate text-left text-xs font-semibold lg:block">{currentUser.fullName}</span><ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground lg:block" /></button>
        {switcherOpen && <div className="absolute right-0 top-12 z-30 w-64 rounded-xl border border-border bg-popover p-2 shadow-xl" data-testid="menu-user">
          <div className="border-b border-border px-3 py-2.5"><p className="text-sm font-semibold">{currentUser.fullName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{currentUser.email}</p></div>
          <Link href="/" className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium hover:bg-muted" data-testid="link-system-overview"><Globe2 className="h-3.5 w-3.5" /> System overview</Link>
          <Link href="/login" onClick={() => window.localStorage.removeItem('qms360_token')} className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted" data-testid="link-sign-out"><LogIn className="h-3.5 w-3.5" /> Sign out</Link>
        </div>}
      </div>
    </div>
  </header>;
}

function SideNav({ appKey, open, onClose }: { appKey?: AppKey; open: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const app = demoApps.find((item) => item.key === appKey);
  const nav = appKey === 'qaqc'
    ? [{ label: 'Overview', icon: LayoutDashboard, href: '/qaqc' }, { label: 'Submittals', icon: FileCheck2 }, { label: 'Inspections', icon: ClipboardCheck }, { label: 'Document register', icon: FileText }, { label: 'Non-conformances', icon: ListChecks }]
    : appKey === 'lessons'
      ? [{ label: 'Overview', icon: LayoutDashboard, href: '/lessons' }, { label: 'Capture lesson', icon: Lightbulb }, { label: 'Lesson library', icon: FileText }, { label: 'Validation queue', icon: ListChecks }, { label: 'Themes', icon: Network }]
      : appKey === 'audit'
        ? [{ label: 'Overview', icon: LayoutDashboard, href: '/audit' }, { label: 'Audit programme', icon: CalendarIcon }, { label: 'My audits', icon: ClipboardCheck }, { label: 'Findings', icon: Target }, { label: 'Actions', icon: ListChecks }]
        : [{ label: 'System overview', icon: Globe2, href: '/' }, { label: 'Executive view', icon: BarChart3, href: '/executive' }, { label: 'Projects', icon: FolderKanban }];
  return <aside className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 md:relative md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
    <div className="flex h-[72px] items-center justify-between border-b border-sidebar-border px-5"><Link href="/" className="flex items-center gap-3" onClick={onClose} data-testid="link-brand"><BrandMark compact /><span className="font-display text-base font-bold tracking-tight">qms<span className="text-[hsl(var(--sidebar-primary))]">360</span></span></Link><button className="rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent md:hidden" onClick={onClose} data-testid="button-close-menu"><X className="h-4 w-4" /></button></div>
    <div className="flex-1 overflow-y-auto px-3 py-6">
      {app && <div className="mb-7 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3"><div className="mb-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: appAccentColor[app.accent] || app.accent }} /><span className="text-[10px] font-bold uppercase tracking-[.16em] text-sidebar-foreground/60">{app.shortName} workspace</span></div><p className="text-xs leading-5 text-sidebar-foreground/80">{app.description}</p></div>}
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/40">Workspace</p>
      <nav className="space-y-1">{nav.map((item, index) => { const Icon = item.icon; return item.href ? <Link key={item.label} href={item.href} onClick={onClose} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition ${index === 0 ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`} data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}><Icon className="h-[17px] w-[17px]" />{item.label}{index === 0 && <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-60" />}</Link> : <button key={item.label} onClick={() => setLocation(appKey ? `/${appKey}` : '/')} className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid={`button-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}><Icon className="h-[17px] w-[17px]" />{item.label}</button>; })}</nav>
      <p className="mb-2 mt-8 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/40">Administration</p>
      <Link href={appKey ? `/${appKey}/settings` : '/executive'} onClick={onClose} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid="link-settings"><Settings2 className="h-[17px] w-[17px]" />Settings</Link>
    </div>
    <div className="border-t border-sidebar-border p-4"><div className="flex items-center gap-3 rounded-lg bg-sidebar-accent/70 px-3 py-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--sidebar-primary))] text-xs font-bold text-sidebar-primary-foreground">AH</div><div className="min-w-0"><p className="truncate text-xs font-semibold">Algihaz Holding</p><p className="mt-0.5 text-[10px] text-sidebar-foreground/50">Enterprise quality</p></div><PanelLeft className="ml-auto h-3.5 w-3.5 text-sidebar-foreground/40" /></div></div>
  </aside>;
}

function CalendarIcon(props: { className?: string }) { return <Clock3 {...props} />; }

function Shell({ children, appKey, currentUser = demoUser }: { children: ReactNode; appKey?: AppKey; currentUser?: CurrentUser }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="flex min-h-[100dvh] bg-background"><SideNav appKey={appKey} open={menuOpen} onClose={() => setMenuOpen(false)} /><div className="fixed inset-0 z-30 bg-[hsl(258_27%_12%/.38)] md:hidden" onClick={() => setMenuOpen(false)} aria-hidden={!menuOpen} style={{ display: menuOpen ? 'block' : 'none' }} /><div className="min-w-0 flex-1"><TopBar currentUser={currentUser} appKey={appKey} onMenu={() => setMenuOpen(true)} /><main className="mx-auto max-w-[1440px] p-4 md:p-8">{children}</main></div></div>;
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  const toneStyles: Record<string, string> = { purple: 'bg-[hsl(258_49%_34%)] text-white', turquoise: 'bg-[hsl(188_93%_35%)] text-white', yellow: 'bg-[hsl(47_92%_52%)] text-[hsl(258_27%_16%)]', fuchsia: 'bg-[hsl(315_47%_44%)] text-white', black: 'bg-[hsl(258_27%_16%)] text-white' };
  return <div className={`relative overflow-hidden rounded-xl p-5 ${toneStyles[tone] || toneStyles.purple}`} data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}><div className="absolute -right-8 -top-8 h-24 w-24 rounded-full border-[14px] border-white/10" /><p className="relative text-[11px] font-semibold uppercase tracking-[.12em] opacity-75">{label}</p><p className="relative mt-3 font-display text-3xl font-bold tracking-[-.06em]">{value}</p><p className="relative mt-1 text-xs opacity-75">{detail}</p></div>;
}

function ProjectSelect({ projects }: { projects: Project[] }) {
  const [selected, setSelected] = useState(projects[0]?.id || '');
  return <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5"><Building2 className="h-4 w-4 text-muted-foreground" /><select value={selected} onChange={(event) => setSelected(event.target.value)} className="max-w-[180px] bg-transparent text-xs font-semibold outline-none" data-testid="select-project"><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></div>;
}

function AppOverviewPage({ appKey }: { appKey: AppKey }) {
  const { data, isLoading, isError, refetch } = useGetAppOverview(appKey);
  const { data: projectsData } = useListProjects();
  const overview = data || demoOverviews[appKey];
  const projects = projectsData || demoProjects;
  if (isLoading && !data) return <Shell appKey={appKey}><LoadingState /></Shell>;
  return <Shell appKey={appKey}>
    <div className="rise-in">
      {isError && <div className="mb-5"><ErrorState onRetry={() => void refetch()} compact /></div>}
      <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />{overview.eyebrow}</p><h1 className="max-w-3xl font-display text-3xl font-bold tracking-[-.055em] text-foreground md:text-[40px]">{overview.title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{overview.summary}</p></div><div className="flex items-center gap-2"><ProjectSelect projects={projects} /><button className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5" data-testid={`button-add-${appKey}`}><Plus className="h-4 w-4" /> Add record</button></div></div>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{overview.metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card soft-shadow" data-testid={`section-recent-${appKey}`}><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-display text-base font-semibold">Recent activity</h2><p className="mt-1 text-xs text-muted-foreground">The latest work across your workspace</p></div><button className="flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))] hover:underline" data-testid={`button-view-all-${appKey}`}>View all <ArrowRight className="h-3.5 w-3.5" /></button></div><div>{overview.recentRecords.length === 0 ? <EmptyState title="No records yet" detail="Your first workspace records will appear here as your team starts working." action="Create a record" /> : overview.recentRecords.map((record, index) => <RecordRow key={record.id} record={record} index={index} />)}</div></section>
        <section className="rounded-xl border border-border bg-card p-5 soft-shadow" data-testid={`section-modules-${appKey}`}><div className="mb-5 flex items-start justify-between"><div><h2 className="font-display text-base font-semibold">Workspace modules</h2><p className="mt-1 text-xs text-muted-foreground">Your team's working set</p></div><div className="rounded-lg bg-[hsl(var(--muted))] p-2 text-[hsl(var(--primary))]"><SlidersHorizontal className="h-4 w-4" /></div></div><div className="space-y-2">{overview.modules.map((module, index) => <button key={module} className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition hover:border-border hover:bg-muted" data-testid={`button-module-${index}`}><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-[11px] font-bold text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span className="flex-1 text-sm font-semibold">{module}</span><ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-[hsl(var(--accent))]" /></button>)}</div><div className="mt-5 border-t border-border pt-4"><p className="text-[11px] leading-5 text-muted-foreground">Need a different view? Your workspace administrator can configure modules and access.</p></div></section>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><section className="rounded-xl border border-border bg-[hsl(var(--primary))] p-5 text-primary-foreground" data-testid="card-workspace-note"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[hsl(var(--sidebar-primary))]">Quality signal</p><h2 className="mt-3 max-w-md font-display text-xl font-semibold leading-tight">One system, three specialist workspaces.</h2></div><ShieldCheck className="h-7 w-7 text-[hsl(var(--sidebar-primary))]" /></div><p className="mt-8 max-w-md text-xs leading-5 text-primary-foreground/70">Move between trusted apps without losing the shared project context, people, and standards that connect the work.</p></section><section className="rounded-xl border border-border bg-card p-5 soft-shadow" data-testid="card-project-snapshot"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-display text-base font-semibold">Project snapshot</h2><p className="mt-1 text-xs text-muted-foreground">Active delivery context</p></div><FolderKanban className="h-5 w-5 text-[hsl(var(--accent))]" /></div><div className="grid gap-3 sm:grid-cols-3">{projects.slice(0, 3).map((project) => <div key={project.id} className="rounded-lg bg-muted p-3" data-testid={`project-snapshot-${project.id}`}><div className="flex items-center justify-between"><span className="font-mono text-[10px] font-bold text-[hsl(var(--primary))]">{project.code}</span><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /></div><p className="mt-2 truncate text-xs font-semibold">{project.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{project.businessUnit} · {project.location}</p></div>)}</div></section></div>
    </div>
  </Shell>;
}

function RecordRow({ record, index }: { record: OverviewRecord; index: number }) {
  return <button className="group flex w-full items-start gap-3 border-b border-border px-5 py-4 text-left transition last:border-0 hover:bg-muted/60" data-testid={`record-${record.id}`}><span className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${index % 3 === 0 ? 'bg-[hsl(258_24%_93%)] text-[hsl(var(--primary))]' : index % 3 === 1 ? 'bg-[hsl(188_50%_91%)] text-[hsl(188_93%_35%)]' : 'bg-[hsl(38_90%_91%)] text-[hsl(28_80%_36%)]'}`}><FileText className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="flex flex-col justify-between gap-1 sm:flex-row"><span className="truncate text-sm font-semibold">{record.title}</span><span className="shrink-0 text-[11px] text-muted-foreground">{record.updatedAt || 'Recently'}</span></span><span className="mt-1 block truncate font-mono text-[10px] font-semibold tracking-wide text-muted-foreground">{record.reference} <span className="font-sans font-normal">· {record.meta}</span></span><span className="mt-2 block"><StatusPill status={record.status} /></span></span><ArrowUpRight className="mt-1 h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" /></button>;
}

function SettingsPage({ appKey }: { appKey: AppKey }) {
  const { data, isLoading, isError, refetch } = useGetAppSettings(appKey);
  const fallback: AppSettings = { appKey, title: demoOverviews[appKey].title, description: 'Configure the working agreements that keep this workspace clear, consistent, and ready for the next decision.', sections: [{ key: 'roles', title: 'Roles & access', description: 'Manage who can view, contribute, approve, and administer this workspace.', available: true }, { key: 'workflow', title: 'Workflow rules', description: 'Set review stages, reminders, and escalation paths for this workspace.', available: true }, { key: 'fields', title: 'Fields & terminology', description: 'Align labels and required fields to how your delivery teams work.', available: false }, { key: 'notifications', title: 'Notifications', description: 'Choose the moments that should prompt an email or in-product alert.', available: false }] };
  if (isLoading && !data) return <Shell appKey={appKey}><LoadingState label="Preparing workspace settings" /></Shell>;
  const settings = data || fallback;
  return <Shell appKey={appKey}><div className="rise-in max-w-4xl"><div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-[11px] font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">Workspace administration</p><h1 className="font-display text-3xl font-bold tracking-[-.05em]">{settings.title} settings</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{settings.description}</p></div><button className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs font-bold shadow-sm" data-testid="button-settings-help"><LockKeyhole className="h-4 w-4 text-[hsl(var(--accent))]" /> Admin controls</button></div>{isError && <div className="mb-5"><ErrorState onRetry={() => void refetch()} compact /></div>}<div className="space-y-3">{settings.sections.map((section, index) => <div className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition hover:border-[hsl(var(--accent)/.45)] hover:shadow-sm sm:flex-row sm:items-center" key={section.key} data-testid={`settings-section-${section.key}`}><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-[hsl(var(--primary))]">{index === 0 ? <Users className="h-5 w-5" /> : index === 1 ? <ListChecks className="h-5 w-5" /> : index === 2 ? <FileText className="h-5 w-5" /> : <Bell className="h-5 w-5" />}</div><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-base font-semibold">{section.title}</h2>{!section.available && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Coming soon</span>}</div><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{section.description}</p></div><button disabled={!section.available} className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-bold transition hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-45" data-testid={`button-configure-${section.key}`}>{section.available ? 'Configure' : 'Unavailable'}{section.available && <ArrowRight className="h-3.5 w-3.5" />}</button></div>)}</div><div className="mt-6 rounded-xl border border-[hsl(188_50%_75%/.55)] bg-[hsl(188_50%_94%)] p-5"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(188_93%_35%)]" /><div><p className="text-sm font-semibold text-[hsl(188_80%_22%)]">Settings stay specific to this workspace</p><p className="mt-1 text-xs leading-5 text-[hsl(188_55%_30%)]">Global identity and project context are managed in the system overview. These controls only shape how {settings.title} works for your teams.</p></div></div></div></div></Shell>;
}

function AppChooser() {
  const { data: userData } = useGetCurrentUser();
  const { data: contextData, isLoading, isError, refetch } = useGetPlatformContext();
  const { data: projectsData } = useListProjects();
  const { data: health } = useHealthCheck();
  const user = userData || demoUser;
  const context = contextData || demoContext;
  const projects = projectsData || context.projects || demoProjects;
  const [activeProject, setActiveProject] = useState(projects[0]?.id || '');
  if (isLoading && !contextData) return <Shell currentUser={user}><LoadingState label="Loading your quality system" /></Shell>;
  return <Shell currentUser={user}><div className="rise-in">
    {isError && <div className="mb-5"><ErrorState onRetry={() => void refetch()} compact /></div>}
    <div className="page-grid relative overflow-hidden rounded-2xl border border-border bg-card p-6 md:p-10"><div className="absolute -right-20 -top-28 h-72 w-72 rounded-full border-[42px] border-[hsl(47_92%_52%/.16)]" /><div className="relative max-w-3xl"><div className="mb-5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />{context.organizationName} · Quality system</div><h1 className="max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-[-.06em] md:text-6xl">A sharper view of<br /><span className="text-[hsl(var(--primary))]">quality in motion.</span></h1><p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">Three trusted workspaces. One shared context. Choose the place where your next quality decision needs to happen.</p><div className="mt-7 flex flex-wrap items-center gap-3"><div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"><FolderKanban className="h-4 w-4 text-[hsl(var(--accent))]" /><select value={activeProject} onChange={(event) => setActiveProject(event.target.value)} className="bg-transparent text-xs font-semibold outline-none" data-testid="select-overview-project"><option value="">All active projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></div><span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-[hsl(163_57%_44%)]" />System operational {health?.status ? `· ${health.status}` : ''}</span></div></div></div>
    <div className="mb-5 mt-10 flex items-end justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-muted-foreground">Your workspaces</p><h2 className="mt-2 font-display text-2xl font-bold tracking-[-.04em]">Pick up where quality needs you</h2></div><Link href="/executive" className="hidden items-center gap-1.5 text-xs font-bold text-[hsl(var(--primary))] sm:flex" data-testid="link-executive-view">Executive view <ArrowUpRight className="h-3.5 w-3.5" /></Link></div>
    <div className="grid gap-4 lg:grid-cols-3">{context.apps.map((app, index) => <WorkspaceCard key={app.key} app={app} index={index} />)}</div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><section className="rounded-xl border border-border bg-card p-5 soft-shadow" data-testid="section-projects"><div className="mb-5 flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.15em] text-muted-foreground">Shared context</p><h2 className="mt-1 font-display text-lg font-semibold">Active projects</h2></div><FolderKanban className="h-5 w-5 text-[hsl(var(--accent))]" /></div><div className="space-y-1">{projects.map((project) => <div key={project.id} className="flex items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-muted" data-testid={`row-project-${project.id}`}><span className="font-mono text-[10px] font-bold text-[hsl(var(--primary))]">{project.code}</span><span className="flex-1 truncate text-xs font-semibold">{project.name}</span><span className="hidden text-[11px] text-muted-foreground sm:block">{project.businessUnit}</span><StatusPill status={project.status} /></div>)}</div></section><section className="rounded-xl border border-border bg-[hsl(258_27%_16%)] p-5 text-[hsl(42_32%_94%)]" data-testid="card-system-principles"><p className="text-[11px] font-bold uppercase tracking-[.15em] text-[hsl(var(--sidebar-primary))]">The QMS360 principle</p><h2 className="mt-4 font-display text-2xl font-semibold leading-tight">Specialist tools.<br />Shared confidence.</h2><div className="mt-8 space-y-4">{['Clear ownership at every step', 'Evidence where decisions happen', 'Learning that travels across projects'].map((item, index) => <div key={item} className="flex items-center gap-3 border-t border-white/10 pt-3 text-xs text-white/70"><span className="font-mono text-[10px] text-[hsl(var(--sidebar-primary))]">0{index + 1}</span>{item}</div>)}</div></section></div>
  </div></Shell>;
}

function WorkspaceCard({ app, index }: { app: PlatformApp; index: number }) {
  const Icon = app.key === 'qaqc' ? FileCheck2 : app.key === 'lessons' ? Lightbulb : ClipboardCheck;
  const accent = appAccentColor[app.accent] || app.accent;
  return <Link href={`/${app.key}`} className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 soft-shadow transition duration-300 hover:-translate-y-1 hover:border-[hsl(var(--accent)/.45)]" data-testid={`card-workspace-${app.key}`}><div className="absolute right-0 top-0 h-28 w-28 rounded-bl-[70px] opacity-15 transition duration-300 group-hover:scale-110" style={{ backgroundColor: accent }} /><div className="relative flex items-start justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ backgroundColor: accent }}><Icon className="h-5 w-5" /></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground">{app.workspaceRoleCount} roles</span></div><div className="relative mt-8"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.17em] text-muted-foreground">0{index + 1} · Independent workspace</p><h3 className="max-w-[220px] font-display text-xl font-semibold leading-tight">{app.name}</h3><p className="mt-3 min-h-[48px] text-xs leading-5 text-muted-foreground">{app.description}</p></div><div className="relative mt-7 flex items-center justify-between border-t border-border pt-4 text-xs font-bold text-[hsl(var(--primary))]"><span>Open workspace</span><span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted transition group-hover:bg-[hsl(var(--primary))] group-hover:text-primary-foreground"><ArrowRight className="h-3.5 w-3.5" /></span></div></Link>;
}

function ExecutivePage() {
  const { data, isLoading, isError, refetch } = useGetExecutiveOverview();
  const fallback: ExecutiveOverview = { periodLabel: 'June 2024 · Month to date', kpis: [{ label: 'Quality health', value: '87.4', delta: '+3.8%', context: 'vs. previous period', tone: 'purple' }, { label: 'Open actions', value: '51', delta: '-12.6%', context: 'across all workspaces', tone: 'turquoise' }, { label: 'Evidence currency', value: '94.2%', delta: '+1.7%', context: 'controlled records current', tone: 'yellow' }, { label: 'Audit readiness', value: '82%', delta: '+6.4%', context: 'programme confidence', tone: 'fuchsia' }], appHighlights: [...demoOverviews.qaqc.recentRecords.slice(0, 2), ...demoOverviews.audit.recentRecords.slice(0, 1)], activity: [...demoOverviews.lessons.recentRecords, ...demoOverviews.audit.recentRecords.slice(0, 1)] };
  if (isLoading && !data) return <Shell><LoadingState label="Assembling the executive view" /></Shell>;
  const overview = data || fallback;
  return <Shell><div className="rise-in"><div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]"><BarChart3 className="h-3.5 w-3.5" /> Cross-app intelligence</p><h1 className="font-display text-3xl font-bold tracking-[-.055em] md:text-4xl">Executive view</h1><p className="mt-3 text-sm text-muted-foreground">A concise read on how quality is moving across Algihaz Holding.</p></div><div className="flex items-center gap-2"><span className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground" data-testid="text-period">{overview.periodLabel}</span><button className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:bg-muted" onClick={() => void refetch()} data-testid="button-refresh-executive"><RefreshCw className="h-4 w-4" /></button></div></div>{isError && <div className="mb-5"><ErrorState onRetry={() => void refetch()} compact /></div>}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{overview.kpis.map((kpi) => <MetricCard key={kpi.label} label={kpi.label} value={kpi.value} detail={`${kpi.delta} ${kpi.context}`} tone={kpi.tone} />)}</div><div className="mt-6 grid gap-5 xl:grid-cols-[1fr_.78fr]"><section className="rounded-xl border border-border bg-card p-5 soft-shadow" data-testid="section-app-highlights"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-display text-lg font-semibold">Signals across workspaces</h2><p className="mt-1 text-xs text-muted-foreground">Records worth a closer look</p></div><Activity className="h-5 w-5 text-[hsl(var(--accent))]" /></div><div className="space-y-1">{overview.appHighlights.length ? overview.appHighlights.map((record, index) => <RecordRow key={`${record.id}-${index}`} record={record} index={index} />) : <EmptyState title="No cross-app signals" detail="Highlights will appear once the workspaces have activity." />}</div></section><section className="rounded-xl border border-border bg-card p-5 soft-shadow" data-testid="section-activity-feed"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-display text-lg font-semibold">Activity pulse</h2><p className="mt-1 text-xs text-muted-foreground">Recent changes in the system</p></div><History className="h-5 w-5 text-[hsl(var(--primary))]" /></div><div className="space-y-5">{overview.activity.length ? overview.activity.map((item, index) => <div className="flex gap-3" key={`${item.id}-${index}`} data-testid={`activity-${item.id}-${index}`}><span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${index % 2 ? 'bg-[hsl(188_50%_91%)] text-[hsl(188_93%_35%)]' : 'bg-[hsl(258_24%_93%)] text-[hsl(var(--primary))]'}`}><Clock3 className="h-3.5 w-3.5" /></span><div><p className="text-xs font-semibold leading-5">{item.title}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.meta} · {item.updatedAt || 'Recently'}</p></div></div>) : <EmptyState title="The pulse is quiet" detail="New activity will show up here." />}</div></section></div><div className="mt-5 rounded-xl border border-[hsl(47_70%_68%/.5)] bg-[hsl(47_90%_92%)] p-5" data-testid="card-executive-note"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(35_84%_42%)]" /><div><p className="text-sm font-semibold text-[hsl(35_60%_27%)]">A useful view is not a louder view</p><p className="mt-1 max-w-2xl text-xs leading-5 text-[hsl(35_45%_35%)]">Executive signals are intentionally focused on movement, ownership, and readiness. Open each workspace when the detail behind a signal matters.</p></div></div></div></div></Shell>;
}

function AuthPage({ register }: { register: boolean }) {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const registration = useRegister();
  const sso = useContainerSso();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [formError, setFormError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (register) {
      registration.mutate({ data: { email, password, fullName, username } }, { onSuccess: (session) => { window.localStorage.setItem('qms360_token', session.token); setLocation('/'); }, onError: () => setFormError('We could not create that account. Check the details and try again.') });
    } else {
      login.mutate({ data: { email, password } }, { onSuccess: (session) => { window.localStorage.setItem('qms360_token', session.token); setLocation('/'); }, onError: () => setFormError('Those credentials did not match. Please try again.') });
    }
  };
  const handleSso = () => {
    sso.mutate({ data: { username: 'algihaz.container.user', email: 'user@algihaz.com', fullName: 'Algihaz user' } }, { onSuccess: (session) => { window.localStorage.setItem('qms360_token', session.token); setLocation('/'); }, onError: () => setFormError('The container sign-in is not available in this environment.') });
  };
  const pending = login.isPending || registration.isPending || sso.isPending;
  return <div className="flex min-h-[100dvh] bg-[hsl(var(--background))]"><div className="hidden w-[43%] flex-col justify-between overflow-hidden bg-[hsl(var(--sidebar))] p-10 text-[hsl(var(--sidebar-foreground))] lg:flex"><Link href="/" data-testid="link-auth-brand"><BrandMark /></Link><div className="relative"><div className="absolute -left-16 -top-24 h-72 w-72 rounded-full border-[38px] border-[hsl(47_92%_52%/.18)]" /><p className="relative mb-5 max-w-sm text-[11px] font-bold uppercase tracking-[.2em] text-[hsl(var(--sidebar-primary))]">Algihaz Holding · QMS360</p><h1 className="relative max-w-md font-display text-5xl font-bold leading-[1.03] tracking-[-.065em]">Quality work<br />should feel<br /><span className="text-[hsl(var(--sidebar-primary))]">connected.</span></h1><p className="relative mt-6 max-w-sm text-sm leading-6 text-sidebar-foreground/65">A dependable system for the records, learning, and assurance behind every delivery decision.</p></div><div className="relative flex items-center gap-3 text-xs text-sidebar-foreground/45"><ShieldCheck className="h-4 w-4 text-[hsl(var(--sidebar-primary))]" /> Trusted by the Algihaz quality community</div></div><div className="flex flex-1 items-center justify-center p-5 sm:p-10"><div className="w-full max-w-[430px]"><div className="mb-10 lg:hidden"><Link href="/" data-testid="link-auth-brand-mobile"><BrandMark /></Link></div><div className="mb-8"><p className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">{register ? 'Create local account' : 'Welcome back'}</p><h2 className="font-display text-3xl font-bold tracking-[-.05em]">{register ? 'Join the quality system.' : 'Sign in to QMS360.'}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{register ? 'Set up a local account for the Phase 1 workspace experience.' : 'Continue to the workspaces your role makes possible.'}</p></div>{formError && <div className="mb-5 rounded-lg border border-[hsl(4_68%_70%/.45)] bg-[hsl(4_68%_95%)] px-4 py-3 text-xs font-medium text-[hsl(4_68%_35%)]" data-testid="status-auth-error">{formError}</div>}<form onSubmit={submit} className="space-y-4" data-testid={`form-${register ? 'register' : 'login'}`}>{register && <><label className="block"><span className="mb-1.5 block text-xs font-semibold">Full name</span><input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/.14)]" placeholder="e.g. Noura Alharbi" data-testid="input-full-name" autoComplete="name" /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold">Username <span className="font-normal text-muted-foreground">(optional)</span></span><input value={username} onChange={(event) => setUsername(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/.14)]" placeholder="noura.alharbi" data-testid="input-username" autoComplete="username" /></label></>}<label className="block"><span className="mb-1.5 block text-xs font-semibold">Work email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/.14)]" placeholder="you@algihaz.com" data-testid="input-email" autoComplete={register ? 'email' : 'username'} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold">Password</span><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/.14)]" placeholder="Minimum 8 characters" data-testid="input-password" autoComplete={register ? 'new-password' : 'current-password'} /></label><button disabled={pending} type="submit" className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 disabled:opacity-60" data-testid={`button-submit-${register ? 'register' : 'login'}`}>{pending ? 'Connecting…' : register ? 'Create account' : 'Sign in'}{!pending && <ArrowRight className="h-4 w-4" />}</button></form><div className="my-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground"><span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" /></div><button type="button" onClick={handleSso} disabled={pending} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-semibold transition hover:bg-muted disabled:opacity-60" data-testid="button-container-sso"><Network className="h-4 w-4 text-[hsl(var(--accent))]" /> Continue with Algihaz container</button><p className="mt-7 text-center text-xs text-muted-foreground">{register ? 'Already have a local account?' : 'New to the local environment?'} <Link href={register ? '/login' : '/register'} className="font-bold text-[hsl(var(--primary))] hover:underline" data-testid={`link-${register ? 'login' : 'register'}`}>{register ? 'Sign in' : 'Register'}</Link></p><p className="mt-12 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground"><LockKeyhole className="h-3 w-3" /> Protected workspace access</p></div></div></div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/login"><AuthPage register={false} /></Route><Route path="/register"><AuthPage register /></Route><Route path="/"><AppChooser /></Route><Route path="/executive"><ExecutivePage /></Route><Route path="/qaqc/settings"><SettingsPage appKey="qaqc" /></Route><Route path="/qaqc"><AppOverviewPage appKey="qaqc" /></Route><Route path="/lessons/settings"><SettingsPage appKey="lessons" /></Route><Route path="/lessons"><AppOverviewPage appKey="lessons" /></Route><Route path="/audit/settings"><SettingsPage appKey="audit" /></Route><Route path="/audit"><AppOverviewPage appKey="audit" /></Route><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function AuthenticatedRouter() {
  const [location, setLocation] = useLocation();
  const isAuthRoute = location === '/login' || location === '/register';
  const token = typeof window === 'undefined' ? null : window.localStorage.getItem('qms360_token');
  const session = useGetCurrentUser({
    query: {
      enabled: !isAuthRoute && Boolean(token),
      queryKey: getGetCurrentUserQueryKey(),
    },
  });

  useEffect(() => {
    if (isAuthRoute) return;
    if (!token || session.isError) {
      if (session.isError) window.localStorage.removeItem('qms360_token');
      setLocation('/login');
    }
  }, [isAuthRoute, token, session.isError, setLocation]);

  if (!isAuthRoute && (!token || session.isLoading)) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /><p className="mt-4 text-sm text-muted-foreground">Preparing your workspace</p></div></div>;
  }
  return <Router />;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AuthenticatedRouter /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;