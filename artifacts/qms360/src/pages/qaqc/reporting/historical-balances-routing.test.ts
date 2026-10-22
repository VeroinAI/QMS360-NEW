import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('Historical balances deep route', () => {
  it('registers the exact path at both application and QA/QC routing levels', () => {
    const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
    const routes = readFileSync(new URL('./routes.tsx', import.meta.url), 'utf8');
    expect(app).toContain('<Route path="/qaqc/settings/historical-balances"><QaqcRoutes /></Route>');
    expect(routes).toContain('path="/qaqc/settings/historical-balances" component={HistoricalBalancesPage}');
    expect(routes.indexOf('key="hist"')).toBeLessThan(routes.indexOf('key="set"'));
  });
});
