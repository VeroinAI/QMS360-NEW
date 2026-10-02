import { Route } from 'wouter';
import { DashboardPage } from './dashboard-page';
import { ReportEditor } from './report-editor';
import { ReportList } from './report-list';
import { SettingsPage } from './settings-page';
import type { ReportType } from './reporting-types';

const T: ReportType[] = ['monthly', 'daily', 'csat'];
export const reportingPaths = ['/qaqc/monthly', '/qaqc/monthly/new', '/qaqc/monthly/:id', '/qaqc/daily', '/qaqc/daily/new', '/qaqc/daily/:id', '/qaqc/csat', '/qaqc/csat/new', '/qaqc/csat/:id', '/qaqc/report-dashboard', '/qaqc/settings'];

// Rendered inside the QAQC switch. /new is declared before /:id.
export const reportingRoutes = [
  ...T.flatMap(t => [
    <Route key={`${t}-l`} path={`/qaqc/${t}`}>{() => <ReportList reportType={t} />}</Route>,
    <Route key={`${t}-n`} path={`/qaqc/${t}/new`}>{() => <ReportEditor key={`${t}-new`} reportType={t} />}</Route>,
    <Route key={`${t}-d`} path={`/qaqc/${t}/:id`}>{p => <ReportEditor key={p.id} reportType={t} id={p.id} />}</Route>,
  ]),
  <Route key="dash" path="/qaqc/report-dashboard" component={DashboardPage} />,
  <Route key="set" path="/qaqc/settings" component={SettingsPage} />,
];
