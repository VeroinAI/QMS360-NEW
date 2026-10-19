import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { exportQaqcSowReport } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { saveFile } from './shell';

export const DAILY_PDF_TEMPLATE='daily-submission';
export async function downloadDailyReport(report:{id:string;period:string}) {
  const response=await exportQaqcSowReport(report.id,{templateId:DAILY_PDF_TEMPLATE},{headers:{Accept:'application/pdf'}});
  saveFile(response,`daily-${report.period}-${report.id}.pdf`);
}

export async function downloadDailyDashboard(report:{id:string;period:string}) {
  const response=await exportQaqcSowReport(report.id,{templateId:'daily-dashboard'},{headers:{Accept:'application/pdf'}});
  saveFile(response,`daily-dashboard-${report.period}-${report.id}.pdf`);
}

/** Both Daily report entry points use the same format and export permission. */
export function DailyDownloadButton({report,disabled=false,variant='outline',label='Download',dashboard=false}:{
  report:{id:string;period:string};disabled?:boolean;variant?:'outline'|'secondary';label?:string;dashboard?:boolean;
}) {
  const cap=useQaqcCapabilities(),{toast}=useToast(),[pending,setPending]=useState(false);
  if(!cap.can('daily_reports','export'))return null;
  return <Button size="sm" variant={variant} disabled={disabled||pending}
    data-testid={`download-daily-${dashboard?'dashboard-':''}${report.id}`} aria-label={dashboard?'Export Daily dashboard as PDF':'Download Daily report as PDF'}
    onClick={async()=>{
      if(pending)return;setPending(true);
      try{await (dashboard?downloadDailyDashboard:downloadDailyReport)(report);}
      catch(e){toast({title:'Download failed',description:e instanceof Error?e.message:'The Daily report could not be downloaded.',variant:'destructive'});}
      finally{setPending(false);}
    }}>
    {pending?<Loader2 className="mr-2 size-4 animate-spin"/>:<Download className="mr-2 size-4"/>}
    {pending?'Preparing…':label}
  </Button>;
}
