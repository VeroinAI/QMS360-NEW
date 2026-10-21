import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jumpToMonthlyIssue, monthlyIssuePath } from './monthly-validation-navigation';
import { validateMetricsEntry } from './metrics-entry-validation';
import { MetricsEntryForm, Tile } from './metrics-entry-form';
import { AdditionalMetricsTiles } from './additional-metrics-tiles';
import { FormCtx } from './form-kit';
import { calcMonthly, type Obj } from './reporting-types';

describe('Monthly validation field navigation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ['PQP Approval Date is required.', 'pqpApprovedDate'],
    ['Next Internal Audit Conducted Date is required.', 'internalAudit.nextDate'],
    ['Meeting 2 Report Date (To) is required.', 'meetings.1.nextDate'],
    ['Quality Manpower 3: rejected count must be an integer greater than or equal to zero.', 'manpower.2.rejected'],
    ['Internal NCR ageing 2: select an Ageing Bucket.', 'metrics.internal_ncr.ageing.1.bucket'],
    ['External NCR: ageing counts (1) must equal Open NCRs (2).', 'metrics.external_ncr.ageing.0.count'],
    ['Material: status tags total 11 must equal total items 1.', 'material.totalItems'],
    ['Training: Duration (minutes) must be an integer greater than or equal to zero.', 'training.durationMinutes'],
    ['Submittals: Average Review Time (Algihaz) must be an integer greater than or equal to zero.', 'documents.submittals.internalReviewDays'],
    ['QMS Report 2: select a valid Type.', 'qmsReports.1.type'],
    ['Review and confirm the quality assessment before submission.', 'assessmentConfirmed'],
  ])('maps %s to %s', (message, path) => expect(monthlyIssuePath(message)).toBe(path));

  it('all current validation errors resolve to rendered fields or their add-row group', () => {
    const data: Obj = {
      pqpStatus: 'Others', reportReference: 'REF', reportFrom: 'invalid', meetings: [{type:'invalid'}],
      internalAudit: {}, manpower: [{approvalRequired:true}], qmsReports:[{}],
      metrics: {
        external_ncr:{issued:4,closed:1,ageing:[{bucket:'invalid',count:0}]},
        internal_ncr:{issued:3,closed:0,ageing:[]},rfi:{issued:-1},rmi:{closed:-1},
      },
      material:{issued:-1,closed:-1,osdAvailable:true,totalItems:2,approved:3},
      qtbt:{talkCount:1,durationMinutes:-1},training:{trainingCount:1,attendance:-1},documents:{},
    };
    const ctx={data,readOnly:false,set:()=>{},fc:()=>({disabled:false,required:false}),departments:['Quality']};
    const calc=calcMonthly(data,{});
    const html=renderToStaticMarkup(<FormCtx.Provider value={ctx}>
      <MetricsEntryForm calc={calc.metrics}/><AdditionalMetricsTiles Tile={Tile} calc={calc}
        onDraftAi={()=>{}} aiBusy={false} aiDraft="" onUseDraft={()=>{}} />
    </FormCtx.Provider>);
    const paths=new Set(Array.from(html.matchAll(/data-report-field="([^"]+)"/g), match=>match[1]));
    for(const issue of [...validateMetricsEntry(data), 'Review and confirm the quality assessment before submission.']){
      let path=monthlyIssuePath(issue);
      expect(path,issue).toBeTruthy();
      while(path&&!paths.has(path))path=path.includes('.')?path.slice(0,path.lastIndexOf('.')):undefined;
      expect(path,`Missing navigation destination for ${issue}`).toBeTruthy();
    }
    expect(paths.has('material.osdAvailable')).toBe(true);
    expect(paths.has('assessmentConfirmed')).toBe(true);
  });

  it('opens the collapsed tile before scrolling and focusing the exact field', () => {
    const order:string[]=[];
    const control={matches:()=>false,focus:()=>order.push('focus')};
    const target={dataset:{reportField:'metrics.rfi.closed'},closest:()=>({querySelector:()=>({click:()=>order.push('open')})}),
      matches:()=>false,querySelector:()=>control,scrollIntoView:()=>order.push('scroll')};
    vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>{fn();return 1;});
    const root={querySelectorAll:()=>[target]} as unknown as HTMLElement;
    expect(jumpToMonthlyIssue(root,'metrics.rfi.closed')).toBe(true);
    expect(order).toEqual(['open','scroll','focus']);
    expect(jumpToMonthlyIssue(root,'missing')).toBe(false);
  });

  it('falls back to the add-row collection if a required row does not exist', () => {
    const focus=vi.fn();
    const group={dataset:{reportField:'metrics.external_ncr.ageing'},closest:()=>null,matches:()=>false,
      querySelector:()=>({matches:()=>false,focus}),scrollIntoView:vi.fn()};
    vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>{fn();return 1;});
    expect(jumpToMonthlyIssue({querySelectorAll:()=>[group]} as unknown as HTMLElement,'metrics.external_ncr.ageing.0.count')).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });
});
