import {renderToStaticMarkup} from 'react-dom/server';
import {Router} from 'wouter';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {DailyDownloadButton,downloadDailyReport} from './daily-download-button';
import {ReportList} from './report-list';

const mocks=vi.hoisted(()=>({canExport:true,api:vi.fn(),save:vi.fn(),list:vi.fn(),ctx:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  exportQaqcSowReport:mocks.api,useListQaqcSowReports:mocks.list,useGetQaqcSowContext:mocks.ctx,
}));
vi.mock('@/lib/use-qaqc-capabilities',()=>({
  useQaqcCapabilities:()=>({can:(_module:string,op:string)=>op==='export'?mocks.canExport:false}),
}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('./shell',async()=>({...await vi.importActual<typeof import('./shell')>('./shell'),saveFile:mocks.save}));
const report={id:'daily-1',period:'2026-10-19'};
beforeEach(()=>{
  vi.clearAllMocks();mocks.canExport=true;mocks.api.mockResolvedValue('pdf-response');
  mocks.ctx.mockReturnValue({data:{projects:[{id:'project-1',name:'Example Project'}]}});
  mocks.list.mockReturnValue({data:{total:2,items:[
    {...report,projectId:'project-1',projectName:'Example Project',state:'draft'},
    {...report,id:'daily-2',projectId:'project-1',projectName:'Example Project',state:'submitted'},
  ]}});
});
describe('Daily Download shared by landing and individual report',()=>{
  it('uses the same Word template, PDF accept type and saved report ID',async()=>{
    await downloadDailyReport(report);
    expect(mocks.api).toHaveBeenCalledWith('daily-1',{templateId:'daily-submission'},{headers:{Accept:'application/pdf'}});
    expect(mocks.save).toHaveBeenCalledWith('pdf-response','daily-2026-10-19-daily-1.pdf');
  });
  it('does not create a file after a failed export',async()=>{
    mocks.api.mockRejectedValueOnce(new Error('Export denied'));
    await expect(downloadDailyReport(report)).rejects.toThrow('Export denied');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('uses Download label, supports busy state, and hides for users without export rights',()=>{
    const html=renderToStaticMarkup(<DailyDownloadButton report={report} disabled/>);
    expect(html).toContain('>Download<');expect(html).toContain('disabled=""');
    mocks.canExport=false;expect(renderToStaticMarkup(<DailyDownloadButton report={report}/>)).toBe('');
  });
  it('adds Download to every Daily row including saved draft and submitted reports',()=>{
    const html=renderToStaticMarkup(<Router ssrPath="/qaqc/daily"><ReportList reportType="daily"/></Router>);
    expect(html).toContain('download-daily-daily-1');expect(html).toContain('download-daily-daily-2');
    expect(mocks.list.mock.calls[0][0].reportType).toBe('daily');
  });
  it('does not add Daily actions to monthly/CSAT rows or users without export rights',()=>{
    for(const type of ['monthly','csat'] as const)
      expect(renderToStaticMarkup(<Router ssrPath={`/qaqc/${type}`}><ReportList reportType={type}/></Router>)).not.toContain('download-daily-');
    mocks.canExport=false;
    expect(renderToStaticMarkup(<Router ssrPath="/qaqc/daily"><ReportList reportType="daily"/></Router>)).not.toContain('download-daily-');
  });
});
