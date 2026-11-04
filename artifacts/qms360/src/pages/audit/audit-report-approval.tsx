import {useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useReviewAuditReport,type AuditReportApproval} from "@workspace/api-client-react";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";
import {useToast} from "@/hooks/use-toast";

export function AuditReportApprovalControls({audit}:{audit:{id:string;reportApproval?:AuditReportApproval}}){
  const [open,setOpen]=useState(false),[remarks,setRemarks]=useState("");
  const approval=audit.reportApproval;
  const mutation=useReviewAuditReport(),qc=useQueryClient(),{toast}=useToast();
  if(!approval)return null;
  const act=(decision:"approve"|"send_back")=>mutation.mutate({id:audit.id,data:{decision,remarks}},{
    onSuccess:()=>{
      void qc.invalidateQueries({queryKey:[`/api/audit/audits/${audit.id}`]});
      void qc.invalidateQueries({queryKey:["/api/audit/audits"]});
      void qc.invalidateQueries({queryKey:["/api/audit/my-actions"]});
      void qc.invalidateQueries({queryKey:["/api/audit/notifications"]});
      setOpen(false);setRemarks("");
      toast({title:decision==="send_back"?"Report sent back for correction":"Approval recorded"});
    },
    onError:error=>toast({title:"Unable to review report",description:error.message,variant:"destructive"}),
  });
  return <>
    <div className="flex flex-wrap items-center gap-2" data-testid={`audit-report-approval-${audit.id}`}>
      <Badge variant={approval.status==="Approved"?"default":"outline"} title={approval.pendingApprovers.map(user=>user.name).join(", ")}>
        Report approval: {approval.status}{approval.pendingLevel!=null?` · Level ${approval.pendingLevel}`:""}
      </Badge>
      {approval.status!=="Not submitted"&&<Button variant={approval.canReview?"default":"outline"} size="sm" onClick={()=>{setRemarks("");setOpen(true);}}>
        {approval.canReview?"Review report":"Approval details"}
      </Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Audit Report approval</DialogTitle><DialogDescription>
        {approval.status==="Pending approval"?`Awaiting Level ${approval.pendingLevel}: ${approval.pendingApprovers.map(user=>user.name).join(", ")}. Only the final level completes approval.`:approval.status}
      </DialogDescription></DialogHeader>
      {approval.history.length>0&&<div className="space-y-2 text-sm" data-testid="audit-report-approval-history">
        {approval.history.map((entry,i)=><div key={`${entry.at}-${i}`} className="rounded border p-2">
          <p className="font-medium">Level {entry.level} · {entry.userName} · {entry.decision==="send_back"?"Sent back":"Approved"}</p>
          {entry.remarks&&<p className="whitespace-pre-wrap">{entry.remarks}</p>}
        </div>)}
      </div>}
      {approval.canReview&&<div className="space-y-2"><Label htmlFor="audit-report-review-remarks">Review remarks (required when sending back)</Label>
        <Textarea id="audit-report-review-remarks" value={remarks} maxLength={4000} onChange={event=>setRemarks(event.target.value)}/>
      </div>}
      <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={()=>setOpen(false)}>Close</Button>
        {approval.canReview&&<>
          <Button variant="outline" disabled={mutation.isPending||!remarks.trim()} onClick={()=>act("send_back")}>Send back</Button>
          <Button disabled={mutation.isPending} onClick={()=>act("approve")}>{mutation.isPending?"Saving…":"Approve this level"}</Button>
        </>}
      </DialogFooter>
    </DialogContent></Dialog>
  </>;
}
