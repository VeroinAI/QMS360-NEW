import { ReadOnlyValue } from './form-kit';
import { fmt, type Obj } from './reporting-types';

export type PortfolioPqi = {
  average: number | null;
  activeProjectCount: number;
  reportedProjectCount: number;
  pendingProjectCount: number;
  status: 'complete' | 'pending' | 'empty';
  period: string;
};

export type PqiFieldsProps = {
  pqi?: Obj;
  portfolio?: PortfolioPqi;
  portfolioLoading?: boolean;
  portfolioError?: boolean;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const percentage = (value: unknown) => finite(value) ? `${fmt(value)}%` : '—';

export function PqiFields({ pqi, portfolio, portfolioLoading, portfolioError }: PqiFieldsProps) {
  const variance = pqi?.diff;
  const varianceText = finite(variance) ? `${variance >= 0 ? '+' : ''}${fmt(variance)} pp` : '—';
  const varianceTone = finite(variance) && variance > 0 ? 'text-emerald-700 font-semibold' : finite(variance) && variance < 0 ? 'text-destructive font-semibold' : '';
  const complete = portfolio?.status === 'complete' && portfolio.activeProjectCount > 0
    && portfolio.reportedProjectCount === portfolio.activeProjectCount && portfolio.pendingProjectCount === 0;
  const average = portfolioLoading ? 'Loading…' : portfolioError ? 'Unavailable'
    : complete && finite(portfolio?.average) ? percentage(portfolio.average)
      : portfolio?.status === 'pending' ? 'Pending reports' : '—';
  return <>
    <p className="text-sm text-muted-foreground">Calculated from External NCR, Internal NCR, RFI and RMI for the selected project and reporting period. These values are read-only.</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <ReadOnlyValue label="PQI - Acc. till Last Month" value={<span data-testid="text-pqi-prior">{percentage(pqi?.prior)}</span>} />
      <ReadOnlyValue label="PQI - Acc. till this Month" value={<span data-testid="text-pqi-current">{percentage(pqi?.current)}</span>} />
      <ReadOnlyValue label="PQI - Variance" value={<span data-testid="text-pqi-variance" className={varianceTone}>{varianceText}</span>} />
      <ReadOnlyValue label="PQI - This Month Score" value={<span data-testid="text-pqi-monthly">{percentage(pqi?.monthly)}</span>} />
      <ReadOnlyValue label="Average of All Projects" value={<span data-testid="text-pqi-average" aria-live="polite">{average}</span>} />
    </div>
    {!pqi && <p className="text-xs text-muted-foreground">Select a project to calculate its PQI.</p>}
    <p className="text-xs text-muted-foreground">The project average uses only submitted/approved reports for this period, within your permitted project scope. It remains pending until every active project has a valid report.</p>
    {portfolioError ? <p className="text-xs text-destructive">Unable to load the project average. Refresh the page to retry.</p>
      : !portfolioLoading && portfolio && <p className="text-xs text-muted-foreground" data-testid="text-pqi-coverage">{portfolio.status === 'empty' ? 'No active projects in your permitted scope.'
        : `${portfolio.reportedProjectCount} of ${portfolio.activeProjectCount} active projects reported${portfolio.pendingProjectCount ? ` (${portfolio.pendingProjectCount} pending)` : ''}.`}</p>}
  </>;
}