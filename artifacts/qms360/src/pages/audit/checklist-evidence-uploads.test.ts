import { describe, expect, it, vi } from "vitest";
import { appendChecklistEvidence, uploadChecklistEvidence } from "./checklist-evidence-uploads";

const file = (name: string) => new File(["evidence"], name, { type: "application/pdf", lastModified: 123 });
const pending = () => [{ clientReference: "a", file: file("first.pdf") }, { clientReference: "b", file: file("second.pdf") }];

describe("Checklist multi-file evidence", () => {
  it("adds all selected files while preserving earlier selections", () => {
    const initial = pending().slice(0, 1);
    const next = appendChecklistEvidence(initial, [file("second.pdf"), file("third.pdf")], () => "new");
    expect(next.map(item => item.file.name)).toEqual(["first.pdf", "second.pdf", "third.pdf"]);
    expect(next[0]).toBe(initial[0]);
    expect(initial).toHaveLength(1);
  });
  it("does not add the same pending file twice and leaves the queue intact when selection is cancelled", () => {
    const initial = pending();
    expect(appendChecklistEvidence(initial, [file("first.pdf")])).toEqual(initial);
    expect(appendChecklistEvidence(initial, [])).toEqual(initial);
  });
  it("uploads every selected file and returns all confirmed evidence IDs", async () => {
    const uploaded = new Map<string, string>();
    const upload = vi.fn(async item => `stored-${item.clientReference}`);
    expect(await uploadChecklistEvidence(pending(), uploaded, upload)).toEqual(["stored-a", "stored-b"]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(uploaded.size).toBe(2);
  });
  it("reuses completed uploads when an item save fails after the uploads", async () => {
    const uploaded = new Map<string, string>();
    const upload = vi.fn(async item => `stored-${item.clientReference}`);
    await uploadChecklistEvidence(pending(), uploaded, upload);
    expect(await uploadChecklistEvidence(pending(), uploaded, upload)).toEqual(["stored-a", "stored-b"]);
    expect(upload).toHaveBeenCalledTimes(2);
  });
  it("stops on failure and retries only the failed and remaining files", async () => {
    const items = [...pending(), { clientReference: "c", file: file("third.pdf") }];
    const uploaded = new Map<string, string>();
    const upload = vi.fn()
      .mockResolvedValueOnce("stored-a")
      .mockRejectedValueOnce(new Error("Second upload failed"));
    await expect(uploadChecklistEvidence(items, uploaded, upload)).rejects.toThrow("Second upload failed");
    expect(upload).toHaveBeenCalledTimes(2);
    expect([...uploaded]).toEqual([["a", "stored-a"]]);
    const retry = vi.fn(async item => `stored-${item.clientReference}`);
    expect(await uploadChecklistEvidence(items, uploaded, retry)).toEqual(["stored-a", "stored-b", "stored-c"]);
    expect(retry.mock.calls.map(([item]) => item.clientReference)).toEqual(["b", "c"]);
  });
  it("never relinks an uploaded selection that was removed from the queue", async () => {
    const uploaded = new Map([["a", "stored-a"], ["b", "stored-b"]]);
    const remaining = pending().filter(item => item.clientReference !== "a");
    const upload = vi.fn();
    expect(await uploadChecklistEvidence(remaining, uploaded, upload)).toEqual(["stored-b"]);
    expect(upload).not.toHaveBeenCalled();
  });
  it("supports clearing all pending files without affecting existing evidence", async () => {
    const existing = ["saved-evidence"];
    const uploaded = new Map([["a", "stored-a"]]);
    const upload = vi.fn();
    expect([...existing, ...await uploadChecklistEvidence([], uploaded, upload)]).toEqual(existing);
    expect(upload).not.toHaveBeenCalled();
  });
});
