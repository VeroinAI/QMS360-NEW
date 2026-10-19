import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { exportQaqcSowReport } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { saveFile } from './shell';

export const CSAT_PDF_TEMPLATE = 'csat-form';
export async function downloadCsatReport(report: { id: string; period: string }) {
  const response = await exportQaqcSowReport(report.id, { templateId: CSAT_PDF_TEMPLATE }, { headers: { Accept: 'application/pdf' } });
  saveFile(response, `csat-${report.period}-${report.id}.pdf`);
}

/** Shared by the CSAT landing row and individual report: identical format and policy. */
export function CsatDownloadButton({ report, disabled=false, variant='outline' }: {
  report: { id: string; period: string }; disabled?: boolean; variant?: 'outline' | 'secondary';
}) {
  const cap=useQaqcCapabilities(), {toast}=useToast();
  const [pending,setPending]=useState(false);
  if(!cap.can('csat_reports','export'))return null;
  return <Button size="sm" variant={variant} disabled={disabled||pending}
    data-testid={`download-csat-${report.id}`} aria-label="Download CSAT report as PDF"
    onClick={async()=>{
      if(pending)return;
      setPending(true);
      try { await downloadCsatReport(report); }
      catch(e) { toast({title:'Download failed',description:e instanceof Error ? e.message : 'The CSAT report could not be downloaded.',variant:'destructive'}); }
      finally { setPending(false); }
    }}>
    {pending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
    {pending?'Preparing…':'Download'}
  </Button>;
}
