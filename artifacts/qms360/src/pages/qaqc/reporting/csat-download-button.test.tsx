import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CsatDownloadButton, downloadCsatReport } from './csat-download-button';
import { ReportList } from './report-list';

const mocks=vi.hoisted(()=>({canExport:true,api:vi.fn(),save:vi.fn(),list:vi.fn(),ctx:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  exportQaqcSowReport:mocks.api,useListQaqcSowReports:mocks.list,useGetQaqcSowContext:mocks.ctx,
}));
vi.mock('@/lib/use-qaqc-capabilities',()=>({
  useQaqcCapabilities:()=>({can:(_module:string,op:string)=>op==='export'?mocks.canExport:false}),
}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('./shell',async()=>{
  const actual=await vi.importActual<typeof import('./shell')>('./shell');
  return {...actual,saveFile:mocks.save};
});
const report={id:'survey-1',period:'2026-10-16'};
beforeEach(()=>{
  vi.clearAllMocks();mocks.canExport=true;
  mocks.api.mockResolvedValue('pdf-response');
  mocks.ctx.mockReturnValue({data:{projects:[{id:'project-1',name:'Example Project'}]}});
  mocks.list.mockReturnValue({data:{total:2,items:[
    {...report,projectId:'project-1',projectName:'Example Project',state:'draft'},
    {...report,id:'survey-2',projectId:'project-1',projectName:'Example Project',state:'submitted'},
  ]}});
});
describe('Shared CSAT PDF download',()=>{
  it('uses the same Word-format selector, PDF response and filename for both entry points',async()=>{
    await downloadCsatReport(report);
    expect(mocks.api).toHaveBeenCalledWith('survey-1',{templateId:'csat-form'},{headers:{Accept:'application/pdf'}});
    expect(mocks.save).toHaveBeenCalledWith('pdf-response','csat-2026-10-16-survey-1.pdf');
  });
  it('does not save a file on an export failure',async()=>{
    mocks.api.mockRejectedValueOnce(new Error('Export denied'));
    await expect(downloadCsatReport(report)).rejects.toThrow('Export denied');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('labels the shared report button Download and respects export permissions',()=>{
    expect(renderToStaticMarkup(<CsatDownloadButton report={report}/>)).toContain('>Download<');
    mocks.canExport=false;
    expect(renderToStaticMarkup(<CsatDownloadButton report={report}/>)).toBe('');
  });
  it('adds a download on every CSAT row regardless of draft/submitted state',()=>{
    const html=renderToStaticMarkup(<Router ssrPath="/qaqc/csat"><ReportList reportType="csat"/></Router>);
    expect(html).toContain('download-csat-survey-1');expect(html).toContain('download-csat-survey-2');
    expect(mocks.list.mock.calls[0][0].reportType).toBe('csat');
  });
  it('does not add CSAT actions to daily or monthly lists or users without export rights',()=>{
    for(const type of ['daily','monthly'] as const) {
      expect(renderToStaticMarkup(<Router ssrPath={`/qaqc/${type}`}><ReportList reportType={type}/></Router>)).not.toContain('download-csat-');
    }
    mocks.canExport=false;
    expect(renderToStaticMarkup(<Router ssrPath="/qaqc/csat"><ReportList reportType="csat"/></Router>)).not.toContain('download-csat-');
  });
});
