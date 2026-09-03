import { aiSuggestionLogs, db, lessonsAiSuggestionLogs } from "@workspace/db";

export class AiUnavailableError extends Error {
  constructor(message = "AI assistance is temporarily unavailable") { super(message); }
}

type AiContext = { app?: "qaqc" | "lessons"; organizationId?: string; actorId?: string };

export async function logAiCall(input: AiContext & {
  featureKey: string; prompt: string; response?: string; failureReason?: string; durationMs: number;
}) {
  if (!input.app || !input.organizationId) return;
  const table = input.app === "qaqc" ? aiSuggestionLogs : lessonsAiSuggestionLogs;
  await db.insert(table).values({
    organizationId: input.organizationId, actorId: input.actorId,
    featureKey: input.featureKey, prompt: input.prompt, response: input.response,
    failureReason: input.failureReason, durationMs: input.durationMs,
    reviewState: input.failureReason ? "failed" : "pending",
  });
}

async function invoke(featureKey: string, prompt: string, context: AiContext): Promise<string> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    if (!baseUrl || !apiKey) throw new Error("Anthropic integration is not configured");
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5", max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`AI proxy returned ${response.status}`);
    const result = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const text = result.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("AI proxy returned an empty response");
    await logAiCall({ ...context, featureKey, prompt, response: text, durationMs: Date.now() - started });
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI error";
    try { await logAiCall({ ...context, featureKey, prompt, failureReason: message, durationMs: Date.now() - started }); } catch {}
    throw new AiUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T>(text: string): T {
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  try { return JSON.parse(candidate.trim()) as T; } catch { throw new AiUnavailableError("AI returned an invalid structured response"); }
}

export async function rephraseText(input: AiContext & { field: string; text: string; tone: string }) {
  return invoke("rephrase_text", `Rephrase the following ${input.field} in a ${input.tone} professional QMS tone. Return only the revised text.\n\n${input.text}`, input);
}

export async function draftQualityBrief(context: AiContext & Record<string, unknown>) {
  const text = await invoke("draft_quality_brief", `Draft a concise quality assessment brief from this context. Return strict JSON with draft:string and suggestions:string[].\n${JSON.stringify(context)}`, context);
  return parseJson<{ draft: string; suggestions: string[] }>(text);
}

export async function promptToTransaction(input: AiContext & { app: "qaqc" | "lessons"; prompt: string; schemaDescription: string }) {
  const text = await invoke("prompt_to_transaction", `Extract a ${input.app} transaction using this schema: ${input.schemaDescription}. Return strict JSON with extracted:object and missing:[{field,question,options?}]. User request: ${input.prompt}`, input);
  return parseJson<{ extracted: Record<string, unknown>; missing: Array<{ field: string; question: string; options?: string[] }> }>(text);
}