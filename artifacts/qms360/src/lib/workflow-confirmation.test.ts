import { afterEach, describe, expect, it, vi } from "vitest";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  confirmedWorkflowMutation, confirmWorkflowAction, getWorkflowConfirmation,
  requestWorkflowConfirmation, resolveWorkflowConfirmation, subscribeWorkflowConfirmation,
  workflowConfirmationMessage, WorkflowConfirmationCancelled, type WorkflowAction,
} from "./workflow-confirmation";

afterEach(() => {
  const pending = getWorkflowConfirmation();
  if (pending) resolveWorkflowConfirmation(pending.id, false);
});

const fixture = () => {
  const mutate = vi.fn();
  const mutateAsync = vi.fn().mockResolvedValue({ id: "document" });
  const original = { mutate, mutateAsync, isPending: false, data: undefined } as unknown as UseMutationResult<
    { id: string }, Error, { id: string; data?: { comments: string } }, unknown
  >;
  const guarded = confirmedWorkflowMutation(original, () => ({ action: "approve", document: "this audit schedule" }));
  return { mutate, mutateAsync, original, guarded };
};

describe("workflow confirmation decisions", () => {
  it.each<WorkflowAction>([
    "submit", "resubmit", "approve", "send_back", "reject", "accept", "send",
    "request_extension", "approve_extension", "reject_extension", "transfer",
  ])("%s explains the consequence and provides an affirmative label", action => {
    const message = workflowConfirmationMessage(action, "document QMS-123");
    expect(message.title).toContain("QMS-123");
    expect(message.title).toMatch(/\?$/);
    expect(message.description).toContain("Cancel");
    expect(message.confirmLabel).toMatch(/^Yes, /);
  });

  it("does not execute a handoff before a decision or after Cancel", async () => {
    const action = vi.fn();
    confirmWorkflowAction("submit", "this lesson", action);
    expect(action).not.toHaveBeenCalled();
    resolveWorkflowConfirmation(getWorkflowConfirmation()!.id, false);
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    expect(getWorkflowConfirmation()).toBeNull();
  });

  it("executes a confirmed handoff exactly once", async () => {
    const action = vi.fn();
    confirmWorkflowAction("submit", "this lesson", action);
    const id = getWorkflowConfirmation()!.id;
    resolveWorkflowConfirmation(id, true);
    resolveWorkflowConfirmation(id, true);
    await Promise.resolve();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not queue repeated clicks while a confirmation is open", async () => {
    const action = vi.fn();
    confirmWorkflowAction("approve", "this report", action);
    confirmWorkflowAction("approve", "this report", action);
    resolveWorkflowConfirmation(getWorkflowConfirmation()!.id, true);
    await Promise.resolve();
    expect(action).toHaveBeenCalledTimes(1);
    expect(getWorkflowConfirmation()).toBeNull();
  });

  it("ignores a stale dialog close instead of cancelling a newer request", async () => {
    const first = requestWorkflowConfirmation("approve", "the first report");
    const oldId = getWorkflowConfirmation()!.id;
    resolveWorkflowConfirmation(oldId, true);
    const second = requestWorkflowConfirmation("approve", "the second report");
    const newId = getWorkflowConfirmation()!.id;
    resolveWorkflowConfirmation(oldId, false);
    expect(getWorkflowConfirmation()!.id).toBe(newId);
    resolveWorkflowConfirmation(newId, false);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
  });

  it("notifies the UI only on open and resolution and unsubscribes cleanly", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkflowConfirmation(listener);
    const result = requestWorkflowConfirmation("reject", "this CAR");
    const snapshot = getWorkflowConfirmation();
    expect(getWorkflowConfirmation()).toBe(snapshot);
    resolveWorkflowConfirmation(snapshot!.id, false);
    expect(await result).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    const next = requestWorkflowConfirmation("approve", "this CAR");
    resolveWorkflowConfirmation(getWorkflowConfirmation()!.id, true);
    await next;
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("confirmed mutation compatibility", () => {
  it("preserves the original payload, mutation options and state on confirmation", async () => {
    const { guarded, mutate, original } = fixture();
    const variables = { id: "schedule", data: { comments: "Reviewed" } };
    const options = { onSuccess: vi.fn(), onError: vi.fn() };
    guarded.mutate(variables, options);
    expect(mutate).not.toHaveBeenCalled();
    expect(guarded.isPending).toBe(original.isPending);
    resolveWorkflowConfirmation(getWorkflowConfirmation()!.id, true);
    await Promise.resolve();
    expect(mutate).toHaveBeenCalledExactlyOnceWith(variables, options);
  });

  it("does not call the mutation or its success/error callbacks on Cancel", async () => {
    const { guarded, mutate } = fixture();
    const options = { onSuccess: vi.fn(), onError: vi.fn() };
    guarded.mutate({ id: "schedule" }, options);
    resolveWorkflowConfirmation(getWorkflowConfirmation()!.id, false);
    await Promise.resolve();
    expect(mutate).not.toHaveBeenCalled();
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it("guards async mutations too and preserves the successful return value", async () => {
    const { guarded, mutateAsync } = fixture();
    const variables = { id: "schedule" };
    const result = guarded.mutateAsync(variables);
    expect(mutateAsync).not.toHaveBeenCalled();
    resolveWorkflowConfirmation(getWorkflowConfirmation()!.id, true);
    expect(await result).toEqual({ id: "document" });
    expect(mutateAsync).toHaveBeenCalledExactlyOnceWith(variables, undefined);
  });

  it("distinguishes async cancellation from a failed API request", async () => {
    const { guarded, mutateAsync } = fixture();
    const result = guarded.mutateAsync({ id: "schedule" });
    const assertion = expect(result).rejects.toBeInstanceOf(WorkflowConfirmationCancelled);
    resolveWorkflowConfirmation(getWorkflowConfirmation()!.id, false);
    await assertion;
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("does not ask for confirmation or proceed when required remarks were cancelled", () => {
    const { original, mutate } = fixture();
    const guarded = confirmedWorkflowMutation(original, () => ({ action: "reject", document: "this CAR" }), v => !!v.data?.comments.trim());
    guarded.mutate({ id: "car" });
    expect(getWorkflowConfirmation()).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not change or intercept ordinary create/save mutations", () => {
    const { original, mutate } = fixture();
    original.mutate({ id: "draft" });
    expect(mutate).toHaveBeenCalledOnce();
    expect(getWorkflowConfirmation()).toBeNull();
  });
});