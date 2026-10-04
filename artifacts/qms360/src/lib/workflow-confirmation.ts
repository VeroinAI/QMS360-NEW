import type { UseMutationResult } from "@tanstack/react-query";
export type WorkflowAction = "submit" | "resubmit" | "approve" | "send_back" | "reject" | "accept" | "send" | "request_extension" | "approve_extension" | "reject_extension" | "transfer";

export function workflowConfirmationMessage(action: WorkflowAction, document: string) {
  const messages: Record<WorkflowAction, [string, string, string]> = {
    submit: [`Submit ${document} for approval?`, "This will send the document to the designated approver's queue for review.", "Yes, submit"],
    resubmit: [`Resubmit ${document} for approval?`, "This will send the corrected document back to the designated approver's queue.", "Yes, resubmit"],
    approve: [`Approve ${document}?`, "This will record your approval and advance or finalize the workflow. The relevant participants will be notified according to the configured rules.", "Yes, approve"],
    send_back: [`Send ${document} back for correction?`, "This will return the document to its creator's queue with your remarks.", "Yes, send back"],
    reject: [`Reject ${document}?`, "This will record your rejection and return the document to the responsible person for further action.", "Yes, reject"],
    accept: [`Accept ${document}?`, "This will record your acceptance and move the document to the next workflow step.", "Yes, accept"],
    send: [`Send ${document} for audit?`, "This will hand the plan over to Audit Execution and notify the selected roles according to the configured rules.", "Yes, send"],
    request_extension: [`Request a due-date extension for ${document}?`, "This will send your extension request and justification to the designated reviewer.", "Yes, request extension"],
    approve_extension: [`Approve the extension for ${document}?`, "This will approve the requested due date and return the action to the responsible person's queue.", "Yes, approve extension"],
    reject_extension: [`Reject the extension for ${document}?`, "This will reject the requested due date and return the action with your remarks.", "Yes, reject extension"],
    transfer: [`Transfer ${document}?`, "This will move the selected pending actions to the chosen person's queue.", "Yes, transfer"],
  };
  const [title, description, confirmLabel] = messages[action];
  return { title, description: `${description} Choose Cancel to leave the workflow unchanged.`, confirmLabel };
}

type Confirmation = ReturnType<typeof workflowConfirmationMessage> & { id: number };
let nextId = 0;
let pending: { confirmation: Confirmation; resolve: (accepted: boolean) => void } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export const subscribeWorkflowConfirmation = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getWorkflowConfirmation = () => pending?.confirmation ?? null;

/** One decision at a time; repeated clicks cannot enqueue duplicate handoffs. */
export function requestWorkflowConfirmation(action: WorkflowAction, document: string): Promise<boolean> {
  if (pending) return Promise.resolve(false);
  return new Promise(resolve => {
    pending = { confirmation: { ...workflowConfirmationMessage(action, document), id: ++nextId }, resolve };
    notify();
  });
}

export function resolveWorkflowConfirmation(id: number, accepted: boolean) {
  if (!pending || pending.confirmation.id !== id) return;
  const request = pending;
  pending = null;
  notify();
  request.resolve(accepted);
}

export function confirmWorkflowAction(action: WorkflowAction, document: string, onConfirmed: () => void) {
  void requestWorkflowConfirmation(action, document).then(accepted => {
    if (accepted) onConfirmed();
  });
}

export class WorkflowConfirmationCancelled extends Error {
  constructor() {
    super("Workflow action cancelled");
    this.name = "WorkflowConfirmationCancelled";
  }
}

/** Guard every button/path using this mutation, without changing API or success/error behavior. */
export function confirmedWorkflowMutation<TData, TError, TVariables, TContext>(
  mutation: UseMutationResult<TData, TError, TVariables, TContext>,
  describe: (variables: TVariables) => { action: WorkflowAction; document: string },
  eligible: (variables: TVariables) => boolean = () => true,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const mutate: typeof mutation.mutate = (variables, options) => {
    if (!eligible(variables)) return;
    const { action, document } = describe(variables);
    confirmWorkflowAction(action, document, () => mutation.mutate(variables, options));
  };
  const mutateAsync: typeof mutation.mutateAsync = async (variables, options) => {
    if (!eligible(variables)) throw new WorkflowConfirmationCancelled();
    const { action, document } = describe(variables);
    if (!await requestWorkflowConfirmation(action, document)) throw new WorkflowConfirmationCancelled();
    return mutation.mutateAsync(variables, options);
  };
  return { ...mutation, mutate, mutateAsync };
}