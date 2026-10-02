import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftQualityBrief, rephraseText } from "./ai";

const mocks = vi.hoisted(() => ({ values: vi.fn(), fetch: vi.fn() }));
vi.mock("@workspace/db", () => ({
  aiSuggestionLogs: {}, lessonsAiSuggestionLogs: {},
  db: { insert: () => ({ values: mocks.values }) },
}));

const context = { app: "qaqc" as const, organizationId: "test-org", actorId: "test-actor" };

describe("quality brief provider timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.values.mockReset().mockResolvedValue(undefined);
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("AI_INTEGRATIONS_ANTHROPIC_BASE_URL", "https://example.invalid");
    vi.stubEnv("AI_INTEGRATIONS_ANTHROPIC_API_KEY", "synthetic-test-key");
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const provider = (delay?: number) => {
    mocks.fetch.mockImplementation((_url: string, options: RequestInit) => new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true });
      if (delay !== undefined) setTimeout(() => resolve({
        ok: true,
        json: async () => ({ content: [{ type: "text", text: JSON.stringify({ draft: "Evidence-based draft", suggestions: [] }) }] }),
      }), delay);
    }));
  };

  it("allows a real-provider-length brief beyond the old ten-second limit and audits it", async () => {
    provider(15_000);
    const pending = draftQualityBrief(context);
    const checked = expect(pending).resolves.toMatchObject({ draft: "Evidence-based draft" });
    await vi.advanceTimersByTimeAsync(15_000);
    await checked;
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).max_tokens).toBe(4096);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ featureKey: "draft_quality_brief", reviewState: "pending" }));
  });

  it("still bounds brief generation at sixty seconds and audits the failure", async () => {
    provider();
    const checked = expect(draftQualityBrief(context)).rejects.toThrow("VerionAI timed out");
    await vi.advanceTimersByTimeAsync(60_000);
    await checked;
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ featureKey: "draft_quality_brief", reviewState: "failed", durationMs: 60_000 }));
  });

  it("does not change the timeout or output budget of other AI features", async () => {
    provider();
    const checked = expect(rephraseText({ ...context, field: "remarks", text: "Test", tone: "concise" })).rejects.toThrow("AI assistance is temporarily unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await checked;
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).max_tokens).toBe(8192);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ featureKey: "rephrase_text", durationMs: 10_000 }));
  });
});