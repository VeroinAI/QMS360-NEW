import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAuditQueryKey, getGetAuditFindingNumberingQueryKey,
  useGenerateMissingAuditFindingNumber,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export const canRepairFindingNumber = (type?: string | null, number?: string | null) =>
  !number?.trim() && ["Minor NC", "Moderate NC", "Major NC", "OFI"].includes(type ?? "");

export function FindingNumberRepair({ auditId, itemId }: { auditId: string; itemId: string }) {
  const generate = useGenerateMissingAuditFindingNumber();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState("");
  const issue = () => {
    if (!window.confirm("Generate the missing finding number using the current Finding number range, linked Plan source and Schedule From Date year? Finding content, evidence, CAR links and audit status will remain unchanged. An issued number cannot be reset.")) return;
    setError("");
    generate.mutate({ id: auditId, itemId }, {
      onSuccess: audit => {
        const number = audit.checklist?.find(item => item.id === itemId)?.findingNumber;
        queryClient.setQueryData(getGetAuditQueryKey(auditId), audit);
        void queryClient.invalidateQueries({ queryKey: getGetAuditQueryKey(auditId) });
        void queryClient.invalidateQueries({ queryKey: getGetAuditFindingNumberingQueryKey() });
        toast({ title: "Finding number generated", description: number || undefined });
      },
      onError: cause => setError(cause instanceof Error ? cause.message : "Could not generate the finding number."),
    });
  };
  return <div className="mt-2 font-sans">
    <Button type="button" size="sm" variant="outline" data-testid={`button-generate-finding-number-${itemId}`}
      disabled={generate.isPending} onClick={issue}>{generate.isPending ? "Generating…" : "Generate finding number"}</Button>
    {error && <p role="alert" className="mt-2 max-w-64 whitespace-normal text-destructive">{error}</p>}
  </div>;
}
