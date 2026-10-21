import { describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import {
  emailRichTextToPlain, emailRuleBodyText, plainTextToEmailRichText,
  renderEmailRuleTemplate, validateEmailRichText, type EmailRichDocument, type EmailRichMark,
} from "@workspace/field-controls";
import { CreateEmailRuleBody } from "@workspace/api-zod";
import { enqueueEmail } from "./email-queue";

const document = (text: string, marks: EmailRichMark[] = []): EmailRichDocument => ({
  type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text, marks }] }],
});
const defaults = { subject: "Default subject", text: "Default body" };

describe("Email body rich formatting", () => {
  it("renders bold, italic, underline and color together while keeping plain text", () => {
    const body = document("Dear {recipient_name}", [
      { type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "textStyle", attrs: { color: "#C0392B" } },
    ]);
    const result = renderEmailRuleTemplate({ bodyRichText: body }, defaults, { recipient_name: "Ali" });
    expect(result.text).toBe("Dear Ali");
    expect(result.html).toContain("<strong>Dear </strong>");
    expect(result.html).toContain("<strong>Ali</strong>");
    expect(result.html).toContain("<em>");
    expect(result.html).toContain('<u style="text-decoration:underline">');
    expect(result.html).toContain('style="color:#C0392B"');
    expect(result.subject).toBe(defaults.subject);
  });
  it("applies formatting only to selected characters and preserves surrounding text", () => {
    const body: EmailRichDocument = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "Hello " }, { type: "text", text: "world", marks: [{ type: "bold" }] }, { type: "text", text: "!" },
    ] }] };
    expect(renderEmailRuleTemplate({ bodyRichText: body }, defaults, {}).html).toContain("Hello <strong>world</strong>!");
  });
  it("resolves complete tokens split by formatting, retaining their starting style", () => {
    const body: EmailRichDocument = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "Dear {reci", marks: [{ type: "bold" }] },
      { type: "text", text: "pient_name}, thanks", marks: [{ type: "italic" }] },
    ] }] };
    const result = renderEmailRuleTemplate({ bodyRichText: body }, defaults, { recipient_name: "Aisha" });
    expect(result.text).toBe("Dear Aisha, thanks");
    expect(result.html).toContain("<strong>Aisha</strong>");
    expect(result.html).not.toContain("recipient_name");
    expect(result.html).toContain("<em>, thanks</em>");
  });
  it("escapes both user text and dynamic placeholder values, never treating them as HTML", () => {
    const result = renderEmailRuleTemplate({ bodyRichText: document('<img src=x> {record_name}', [{ type: "underline" }]) }, defaults,
      { record_name: '<script>alert("x")</script>&' });
    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain("<script");
    expect(result.html).toContain("&lt;img src=x&gt;");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.text).toBe('<img src=x> <script>alert("x")</script>&');
  });
  it("keeps blank lines and soft breaks in HTML and plain alternatives", () => {
    const body = plainTextToEmailRichText("First\n\nLast");
    body.content[2].content!.push({ type: "hardBreak" }, { type: "text", text: "Soft" });
    const result = renderEmailRuleTemplate({ bodyRichText: body }, defaults, {});
    expect(result.text).toBe("First\n\nLast\nSoft");
    expect(result.html).toContain("Last<br>Soft");
    expect(result.html).toContain('white-space:pre-wrap"><br></p>');
    expect(emailRichTextToPlain(body)).toBe(result.text);
  });
  it("uses missing/inactive placeholder fallbacks without losing style", () => {
    const result = renderEmailRuleTemplate({ bodyRichText: document("{missing} {lessons_title}", [{ type: "italic" }]) }, defaults,
      { lessons_title: "Not supplied" });
    expect(result.text).toBe("Not available Not supplied");
    expect(result.html).toContain("<em>Not supplied</em>");
  });
  it("does not alter existing plain templates or defaults", () => {
    expect(renderEmailRuleTemplate({ bodyTemplate: "Hi {recipient_name}\n\nThanks", bodyRichText: null }, defaults, { recipient_name: "Ali" }))
      .toEqual({ subject: "Default subject", text: "Hi Ali\n\nThanks" });
    expect(renderEmailRuleTemplate(undefined, defaults, {})).toEqual(defaults);
    expect(renderEmailRuleTemplate({ bodyRichText: plainTextToEmailRichText("") }, defaults, {})).toEqual(defaults);
  });
  it("rich content is authoritative for token validation and text, not stale plain content", () => {
    const template = { bodyTemplate: "Stale body", bodyRichText: document("{creator_name}") };
    expect(emailRuleBodyText(template)).toBe("{creator_name}");
    expect(renderEmailRuleTemplate(template, defaults, { creator_name: "Creator" }).text).toBe("Creator");
    expect(renderEmailRuleTemplate({ bodyTemplate: "Stale body", bodyRichText: plainTextToEmailRichText("") }, defaults, {})).toEqual(defaults);
  });
  it("subjects remain plain text and reject injected line breaks in resolved values", () => {
    const result = renderEmailRuleTemplate({ subjectTemplate: "For {recipient_name}", bodyRichText: document("Body") }, defaults,
      { recipient_name: "Ali\r\nBcc: attacker@example.test" });
    expect(result.subject).toBe("For Ali Bcc: attacker@example.test");
    expect(result.html).toContain("Body");
  });
  it("survives the generated request parser and retains both body representations", () => {
    const rich = document("Hello", [{ type: "bold" }]);
    const input = CreateEmailRuleBody.parse({
      name: "Test", enabled: false, priority: 1, eventType: "lessons.lesson_form.submit", recipientMode: "all_users",
      recipientConfig: { bodyTemplate: "Hello", bodyRichText: rich },
    });
    expect(input.recipientConfig!.bodyRichText).toEqual(rich);
  });
  it.each([
    { type: "doc", content: [{ type: "image", attrs: { src: "https://example.test" } }] },
    document("x", [{ type: "textStyle", attrs: { color: "red; background:url(x)" } }]),
    document("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }] as unknown as EmailRichMark[]),
    { ...document("x"), onclick: "alert(1)" },
    { type: "doc", content: [{ type: "paragraph", attrs: { style: "display:none" } }] },
    document("x", [{ type: "bold", attrs: { onclick: "x" } }] as unknown as EmailRichMark[]),
  ])("rejects unsupported structures and unsafe markup/styles", value => {
    expect(() => validateEmailRichText(value)).toThrow("Invalid email body formatting");
  });
  it("enforces plain text, node and serialized-size limits", () => {
    expect(() => validateEmailRichText(document("x".repeat(20001)))).toThrow("20,000");
    expect(() => validateEmailRichText({ type: "doc", content: Array.from({ length: 10001 }, () => ({ type: "paragraph" })) })).toThrow();
    const nodes = Array.from({ length: 2000 }, () => ({ type: "text" as const, text: "x", marks: [{ type: "textStyle" as const, attrs: { color: "#123456" } }] }));
    expect(() => validateEmailRichText({ type: "doc", content: [{ type: "paragraph", content: nodes }] })).toThrow("120,000");
  });
  it("queues personalized formatted bodies with plain alternatives and can build a multipart email without sending", async () => {
    let queued: Array<{ subject: string; bodyText: string; bodyHtml: string; recipientEmail: string }> = [];
    const database = {
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })),
      insert: vi.fn(() => ({ values: async (rows: typeof queued) => { queued = rows; } })),
    } as unknown as typeof db;
    await enqueueEmail(database, {
      organizationId: "11111111-1111-4111-8111-111111111111", recipientIds: [],
      recipients: [{ email: "one@example.test", name: "Ada" }, { email: "two@example.test", name: "Ben" }],
      ...defaults,
      ruleTemplate: { bodyRichText: document("Hi {recipient_name}", [{ type: "bold" }, { type: "italic" }]) },
      context: { app: "lessons", eventType: "lessons.lesson_form.submit" },
    });
    expect(queued).toHaveLength(1);
    expect(queued[0].bodyText).toBe("Hi Ada, Ben");
    expect(queued[0].bodyHtml).toContain("<em><strong>Ada, Ben</strong></em>");
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const result = await transport.sendMail({
      from: "qms@example.test", to: queued[0].recipientEmail, subject: queued[0].subject,
      text: queued[0].bodyText, html: queued[0].bodyHtml,
    });
    const mime = result.message.toString();
    expect(mime).toContain("Content-Type: multipart/alternative");
    expect(mime).toContain("Content-Type: text/plain");
    expect(mime).toContain("Content-Type: text/html");
    expect(mime).toContain("<em><strong>Ada, Ben</strong></em>");
    transport.close();
  });
});
