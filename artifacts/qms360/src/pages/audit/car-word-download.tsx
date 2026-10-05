import { useState } from "react";
import { Download } from "lucide-react";
import { downloadCarWordReport, type CarRegisterEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function CarWordDownloadButton({ entry }: { entry: CarRegisterEntry }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await downloadCarWordReport({
        auditId: entry.auditId, itemId: entry.itemId, ...(entry.car && { carId: entry.car.id }),
      }, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Corrective_Action_Report_${entry.car?.id ?? entry.itemId}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ title: "Unable to download Word report",
        description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return <Button size="sm" variant="outline" disabled={busy} onClick={() => void download()}
    title="Download Corrective Action Report in Word format" aria-label="Download Word CAR report"
    data-testid={`button-download-car-${entry.id}`}>
    <Download className="mr-1 size-3.5" aria-hidden="true" />{busy ? "Preparing…" : "Download"}
  </Button>;
}
