import { useState } from "react";
import { Download } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function AuditPlanDownload({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const download = async () => {
    setBusy(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const blob = await customFetch<Blob>(`/api/audit/plans/${encodeURIComponent(id)}/report`, { responseType: "blob", headers: { "X-Report-Time-Zone": timeZone } });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `audit-plan-${id}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ title: "Unable to download Audit Plan", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally { setBusy(false); }
  };
  return <Button size="sm" variant="outline" disabled={busy} onClick={() => void download()} aria-label="Download Audit Plan PDF">
    <Download className="mr-2 size-4"/>{busy ? "Preparing…" : "Download PDF"}
  </Button>;
}