import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import {
  getWorkflowConfirmation, resolveWorkflowConfirmation, subscribeWorkflowConfirmation,
} from "@/lib/workflow-confirmation";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Shared accessible confirmation for workflow handoffs; Cancel is the safe default. */
export function WorkflowConfirmationHost() {
  const confirmation = useSyncExternalStore(subscribeWorkflowConfirmation, getWorkflowConfirmation, () => null);
  const [location] = useLocation();
  useEffect(() => () => {
    const current = getWorkflowConfirmation();
    if (current) resolveWorkflowConfirmation(current.id, false);
  }, [location]);
  return <AlertDialog open={!!confirmation} onOpenChange={open => {
    if (!open && confirmation) resolveWorkflowConfirmation(confirmation.id, false);
  }}>
    {confirmation && <AlertDialogContent data-testid="workflow-confirmation">
      <AlertDialogHeader>
        <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
        <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={() => resolveWorkflowConfirmation(confirmation.id, false)}>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={() => resolveWorkflowConfirmation(confirmation.id, true)}>{confirmation.confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>}
  </AlertDialog>;
}