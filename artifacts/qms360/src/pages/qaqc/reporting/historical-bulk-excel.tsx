import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { applyQaqcHistoricalBulkBalances, getQaqcHistoricalBulkTemplate, previewQaqcHistoricalBulkWorkbook, type QaqcHistoricalBulkPreview } from '@workspace/api-client-react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { errMsg, saveFile, useInvalidate } from './shell';

const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Props={period:string|null;canImport:boolean;canExport:boolean;canEdit:boolean;disabled:boolean;onApplied:()=>void;onBusyChange:(busy:boolean)=>void};

export function HistoricalBulkExcel({period,canImport,canExport,canEdit,disabled,onApplied,onBusyChange}:Props){
  const {toast}=useToast(),invalidate=useInvalidate();
  const fileRef=useRef<HTMLInputElement>(null),generation=useRef(0);
  const [reading,setReading]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  const [preview,setPreview]=useState<QaqcHistoricalBulkPreview|null>(null);
  useEffect(()=>()=>{generation.current++;},[]);
  const downloadM=useMutation({mutationFn:()=>getQaqcHistoricalBulkTemplate({period:period!},{headers:{Accept:XLSX}}),
    onSuccess:blob=>saveFile(blob,`historical-balances-multi-project-${period!.slice(0,7)}.xlsx`),
    onError:e=>setError(errMsg(e))});
  const previewM=useMutation({mutationFn:(body:Parameters<typeof previewQaqcHistoricalBulkWorkbook>[0])=>previewQaqcHistoricalBulkWorkbook(body)});
  const applyM=useMutation({mutationFn:(body:Parameters<typeof applyQaqcHistoricalBulkBalances>[0])=>applyQaqcHistoricalBulkBalances(body),
    onSuccess:result=>{
      setPreview(null);setConfirm(false);setError('');invalidate();onApplied();
      toast({title:'Historical balances saved',description:`${result.updatedProjects} projects updated for ${period!.slice(0,7)}; ${result.updatedDrafts} unsubmitted drafts refreshed.`});
    },
    onError:e=>{
      setConfirm(false);setError(`${errMsg(e)} This operation applies all projects or none. Reload the latest balances before retrying.`);
      setPreview(p=>p?{...p,canApply:false}:null);
    }});
  useEffect(()=>{onBusyChange(applyM.isPending);return()=>onBusyChange(false);},[applyM.isPending,onBusyChange]);
  const busy=disabled||reading||downloadM.isPending||previewM.isPending||applyM.isPending;
  const upload=(file:File|undefined)=>{
    if(!file||!period)return;
    setError('');setPreview(null);const request=++generation.current;
    if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>2*1024*1024){setError('Upload an .xlsx workbook no larger than 2 MB.');return;}
    setReading(true);
    const reader=new FileReader();
    reader.onerror=()=>{if(request===generation.current){setReading(false);setError('The file could not be read.');}};
    reader.onload=()=>{
      if(request!==generation.current)return;
      setReading(false);
      previewM.mutate({period,fileBase64:String(reader.result??'').replace(/^data:[^,]*,/,'')},{
        onSuccess:result=>{if(request===generation.current)setPreview(result);},
        onError:e=>{if(request===generation.current)setError(errMsg(e));},
      });
    };
    reader.readAsDataURL(file);
  };
  const ready=!!preview?.canApply&&canImport&&canEdit;
  return <Card className="min-w-0 border-primary/30">
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="size-4" aria-hidden/>Multi-project Excel setup</CardTitle>
      <CardDescription>One project per row, with all 14 historical opening balances in columns. A project selection is not required; select a month above.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">The template includes projects you are authorized to export. Edit balances and a correction reason for each included project. Delete rows you do not want to update, including locked/read-only rows. Keep project details, month, version and headers unchanged.</p>
      <div className="flex flex-wrap gap-2">
        {canExport&&<Button variant="outline" disabled={!period||busy} onClick={()=>{setError('');downloadM.mutate();}}><Download className="mr-2 size-4"/>{downloadM.isPending?'Preparing template…':'Download multi-project template'}</Button>}
        {canImport&&<><input ref={fileRef} type="file" accept=".xlsx" className="hidden" aria-label="Upload multi-project historical balances" disabled={!period||busy} onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/>
          <Button variant="outline" disabled={!period||busy} onClick={()=>fileRef.current?.click()}><Upload className="mr-2 size-4"/>{reading||previewM.isPending?'Checking workbook…':'Upload Excel to preview'}</Button></>}
      </div>
      <p className="text-xs text-muted-foreground">Maximum 500 project rows / 2 MB. Existing single-project templates are also accepted. Uploading does not save anything.</p>
      {error&&<Alert variant="destructive" role="alert"><AlertTitle>Workbook could not be applied</AlertTitle><AlertDescription className="whitespace-pre-line break-words">{error}</AlertDescription></Alert>}
      {preview&&<div className="space-y-4 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Workbook preview — {preview.rows.length} projects · {preview.period.slice(0,7)}</h3><Badge variant={ready?'secondary':'destructive'}>{ready?'Ready for confirmation':'Resolve issues before applying'}</Badge></div>
        {!ready&&<p className="text-sm text-destructive">No projects will be saved until every included row is valid and authorized. Applying also requires historical balance edit permission.</p>}
        <div className="space-y-2">{preview.rows.map(row=><details key={row.projectId} className="min-w-0 rounded-lg border p-3">
          <summary className="cursor-pointer text-sm"><span className="font-medium">{row.projectCode} — {row.projectName}</span><span className="ml-2 text-muted-foreground">Row {row.rowNumber} · v{row.version} · {row.changes.length} balance changes · {row.affectedDrafts} drafts</span>
            {row.errors.length>0&&<span className="ml-2 text-destructive">Blocked</span>}</summary>
          {row.errors.length>0&&<ul className="mt-2 list-inside list-disc text-sm text-destructive">{row.errors.map(message=><li key={message}>{message}</li>)}</ul>}
          <p className="mt-2 break-words text-sm"><span className="text-muted-foreground">Reason: </span>{row.reason}</p>
          {row.changes.length?<div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr><th className="p-2">Field</th><th className="p-2">Before</th><th className="p-2">After</th></tr></thead>
            <tbody>{row.changes.map(change=><tr key={change.key} className="border-t"><td className="p-2">{change.label}</td><td className="p-2 tabular-nums">{change.before}</td><td className="p-2 font-semibold tabular-nums">{change.after}</td></tr>)}</tbody></table></div>:<p className="mt-2 text-sm text-muted-foreground">No numeric changes. Applying still establishes the historical setup for this month.</p>}
        </details>)}</div>
        <div className="flex flex-wrap gap-2"><Button disabled={!ready||busy} onClick={()=>setConfirm(true)}>Apply all {preview.rows.length} projects</Button>
          <Button variant="ghost" disabled={busy} onClick={()=>{generation.current++;setPreview(null);setError('');}}>Discard preview</Button></div>
      </div>}
      <AlertDialog open={confirm} onOpenChange={open=>{if(!applyM.isPending)setConfirm(open);}}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Apply historical balances for {preview?.rows.length} projects?</AlertDialogTitle>
          <AlertDialogDescription>All included projects for {period?.slice(0,7)} will be updated in one transaction, with a separate audit record and correction reason for each project. Never-submitted drafts will be refreshed. Submitted history will not change. If any row fails, none are saved. The selected project view will reload, replacing unsaved manual balance edits.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={applyM.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!ready||busy} onClick={e=>{e.preventDefault();if(preview&&period)applyM.mutate({period,items:preview.rows.map(({projectId,period,version,reason,balances})=>({projectId,period,version,reason,balances}))});}}>{applyM.isPending?'Applying…':'Confirm and apply all'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardContent>
  </Card>;
}
