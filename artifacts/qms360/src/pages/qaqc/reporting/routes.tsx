import { Redirect, Route } from 'wouter';
import { MyActionsPage } from './my-actions-page';
import { GovernanceDashboardPage } from './governance-dashboard-page';
import { ReportEditor } from './report-editor';
import { ReportList } from './report-list';
import { SettingsPage } from './settings-page';
import { HistoricalBalancesPage } from './historical-balances-page';
import type { ReportType } from './reporting-types';

const T: ReportType[] = ['monthly', 'daily', 'csat'];
export const reportingPaths = ['/qaqc/my-actions', '/qaqc/metrics/new', '/qaqc/metrics/reports/:id', '/qaqc/monthly', '/qaqc/monthly/new', '/qaqc/monthly/:id', '/qaqc/daily', '/qaqc/daily/new', '/qaqc/daily/:id', '/qaqc/csat', '/qaqc/csat/new', '/qaqc/csat/:id', '/qaqc/report-dashboard', '/qaqc/dashboard', '/qaqc/settings/historical-balances', '/qaqc/settings'];

// Rendered inside the QAQC switch. /new is declared before /:id.
export const reportingRoutes = [
  <Route key="my-actions" path="/qaqc/my-actions" component={MyActionsPage} />,
  <Route key="mx-n" path="/qaqc/metrics/new">{() => <ReportEditor key="mx-new" reportType="monthly" metricsEntry />}</Route>,
  <Route key="mx-d" path="/qaqc/metrics/reports/:id">{p => <ReportEditor key={`mx-${p.id}`} reportType="monthly" id={p.id} metricsEntry />}</Route>,
  ...T.flatMap(t => [
    <Route key={`${t}-l`} path={`/qaqc/${t}`}>{() => <ReportList reportType={t} />}</Route>,
    <Route key={`${t}-n`} path={`/qaqc/${t}/new`}>{() => <ReportEditor key={`${t}-new`} reportType={t} />}</Route>,
    <Route key={`${t}-d`} path={`/qaqc/${t}/:id`}>{p => <ReportEditor key={p.id} reportType={t} id={p.id} />}</Route>,
  ]),
  <Route key="dash" path="/qaqc/report-dashboard">{() => <Redirect to="/qaqc/dashboard" />}</Route>,
  <Route key="gdash" path="/qaqc/dashboard" component={GovernanceDashboardPage} />,
  <Route key="hist" path="/qaqc/settings/historical-balances" component={HistoricalBalancesPage} />,
  <Route key="set" path="/qaqc/settings" component={SettingsPage} />,
];
