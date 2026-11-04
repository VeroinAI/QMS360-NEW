import { describe, expect, it } from 'vitest';
import { DAILY_CUMULATIVE } from '@workspace/field-controls';
import { copyPreviousDailyData } from './daily-entry-policy';

describe('Previous daily input copy', () => {
  it('copies all six business input groups without copying identity, approval or contract metadata', () => {
    const current = { dailyDisciplineInputMode: DAILY_CUMULATIVE, dailySupplementInputMode: DAILY_CUMULATIVE };
    const previous = {
      disciplines: { drawings: { Civil: { approved: 112 } } }, documentTypes: { drawing: 12 },
      revisions: { drawings: [{ name: 'A', value: 4 }] }, correspondence: { incoming: 10 },
      rejectedSubmissions: { drawing: 2 }, pending: { Client: { A: { upTo7: 3 } } },
      id: 'old', __dailyApproval: { state: 'approved' }, dailyDisciplineInputMode: 'old',
    };
    const result = copyPreviousDailyData(current, previous, () => true);
    expect(result.dailyDisciplineInputMode).toBe(DAILY_CUMULATIVE);
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('__dailyApproval');
    for (const key of ['disciplines', 'documentTypes', 'revisions', 'correspondence', 'rejectedSubmissions', 'pending']) {
      expect(result[key]).toEqual(previous[key as keyof typeof previous]);
      expect(result[key]).not.toBe(previous[key as keyof typeof previous]);
    }
  });
  it('preserves locked inputs and never invents absent previous values', () => {
    expect(copyPreviousDailyData({ correspondence: { incoming: 99 }, pending: { count: 2 } },
      { correspondence: { incoming: 10 } }, key => key !== 'correspondence'))
      .toEqual({ correspondence: { incoming: 99 }, pending: { count: 2 } });
  });
});
