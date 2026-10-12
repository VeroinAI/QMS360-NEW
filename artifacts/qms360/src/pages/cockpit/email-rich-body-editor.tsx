import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { emailRichTextToPlain, plainTextToEmailRichText, type EmailRichDocument, type EmailRichMark } from '@workspace/field-controls';
import { Bold, Italic, Redo2, Underline, Undo2, Eraser } from 'lucide-react';
import { cn } from '@/lib/utils';

export const EMAIL_BODY_MAX_CHARS = 20000;
export const EMAIL_BODY_MAX_JSON = 120000;
export const EMAIL_BODY_MAX_NODES = 10000;
const HEX = /^#[0-9a-fA-F]{6}$/;
const SWATCHES = ['#3a3a3a', '#5a2d82', '#0e8f99', '#b0408f', '#c0392b', '#e8a025'];

export type InsertResult = { ok: true } | { ok: false; error: string };
export interface EmailRichBodyEditorHandle { insertPlaceholder: (token: string) => InsertResult; focus: () => void }

function toHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (HEX.test(v)) return v.toLowerCase();
  const m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!m) return null;
  return '#' + m.slice(1, 4).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
}

/** Reduce editor JSON to the strict EmailRichDocument contract. */
export function sanitizeRichDoc(json: JSONContent): { doc: EmailRichDocument; nodes: number } {
  let nodes = 1;
  const paragraphs = (json.content ?? []).map(p => {
    nodes++;
    const content: NonNullable<EmailRichDocument['content'][number]['content']> = [];
    for (const n of p.content ?? []) {
      if (n.type === 'hardBreak') { content.push({ type: 'hardBreak' }); nodes++; continue; }
      if (n.type !== 'text' || !n.text) continue;
      const marks: EmailRichMark[] = [];
      for (const mk of n.marks ?? []) {
        if (mk.type === 'bold' || mk.type === 'italic' || mk.type === 'underline') marks.push({ type: mk.type });
        else if (mk.type === 'textStyle') { const c = toHex(mk.attrs?.color); if (c) marks.push({ type: 'textStyle', attrs: { color: c } }); }
      }
      nodes++;
      content.push(marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text });
    }
    return content.length ? { type: 'paragraph' as const, content } : { type: 'paragraph' as const };
  });
  return { doc: { type: 'doc', content: paragraphs } as EmailRichDocument, nodes };
}

function isBlank(doc: EmailRichDocument) {
  return doc.content.every(p => !p.content?.length);
}

export const EmailRichBodyEditor = forwardRef<EmailRichBodyEditorHandle, {
  value: EmailRichDocument | null | undefined; plain: string;
  onChange: (next: { bodyTemplate: string; bodyRichText: EmailRichDocument | null }) => void;
  onFocus?: () => void; onError?: (message: string | null) => void; placeholder?: string;
}>(function EmailRichBodyEditor({ value, plain, onChange, onFocus, onError, placeholder }, ref) {
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const onFocusRef = useRef(onFocus); onFocusRef.current = onFocus;
  const lastEmitted = useRef<{ rich: EmailRichDocument | null | undefined; plain: string }>({ rich: value, plain });
  const lastGood = useRef<JSONContent | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [color, setColor] = useState('#5a2d82');

  const initial = () => (value ?? plainTextToEmailRichText(plain ?? '')) as JSONContent;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false,
        code: false, codeBlock: false, blockquote: false, strike: false, horizontalRule: false,
        link: false, trailingNode: false,
      }),
      TextStyle, Color,
    ],
    content: initial(),
    editorProps: {
      attributes: {
        id: 'rule-email-body', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Email body',
        'data-testid': 'input-email-body-rich',
        class: 'email-rich-body min-h-[220px] max-h-[420px] overflow-y-auto px-3 py-2.5 text-sm leading-relaxed outline-none',
      },
    },
    onCreate: ({ editor: e }) => { lastGood.current = e.getJSON(); },
    onFocus: () => onFocusRef.current?.(),
    onUpdate: ({ editor: e }) => {
      const { doc, nodes } = sanitizeRichDoc(e.getJSON());
      // Check limits before calling the shared validator, which rejects oversized
      // documents. An invalid paste must show feedback rather than throw in React.
      const text = doc.content.map(p => (p.content ?? []).map(n => n.type === 'text' ? n.text : '\n').join('')).join('\n');
      const json = JSON.stringify(doc).length;
      const problem = text.length > EMAIL_BODY_MAX_CHARS ? `The email body cannot exceed ${EMAIL_BODY_MAX_CHARS.toLocaleString()} characters (now ${text.length.toLocaleString()}). That change was not applied.`
        : json > EMAIL_BODY_MAX_JSON ? 'The email body has too much formatting to save. Remove some colors or styles; that change was not applied.'
        : nodes > EMAIL_BODY_MAX_NODES ? 'The email body has too many formatted segments. Simplify formatting; that change was not applied.' : null;
      if (problem) {
        setLimitError(problem); onErrorRef.current?.(problem);
        if (lastGood.current) e.commands.setContent(lastGood.current, { emitUpdate: false });
        return;
      }
      setLimitError(null); onErrorRef.current?.(null);
      lastGood.current = e.getJSON();
      const blank = isBlank(doc);
      const rich = blank ? null : doc;
      const plainOut = blank ? '' : text;
      lastEmitted.current = { rich, plain: plainOut };
      onChangeRef.current({ bodyTemplate: plainOut, bodyRichText: rich });
    },
  });

  // Sync external replacements (e.g. "Use example" sets bodyRichText null + new plain text).
  useEffect(() => {
    if (!editor) return;
    const last = lastEmitted.current;
    if (value === last.rich && plain === last.plain) return;
    if (value == null && last.rich == null && plain === last.plain) return;
    lastEmitted.current = { rich: value, plain };
    editor.commands.setContent((value ?? plainTextToEmailRichText(plain ?? '')) as JSONContent, { emitUpdate: false });
    lastGood.current = editor.getJSON();
  }, [editor, value, plain]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
    insertPlaceholder: (token: string) => {
      if (!editor) return { ok: false, error: 'The body editor is still loading.' };
      const { from, to, empty } = editor.state.selection;
      const selectedLen = empty ? 0 : editor.state.doc.textBetween(from, to, '\n').length;
      const current = emailRichTextToPlain(sanitizeRichDoc(editor.getJSON()).doc).length;
      if (current - selectedLen + token.length > EMAIL_BODY_MAX_CHARS) {
        return { ok: false, error: `The email body cannot exceed ${EMAIL_BODY_MAX_CHARS.toLocaleString()} characters. Shorten it or select text to replace.` };
      }
      editor.chain().focus().insertContentAt({ from, to }, token).run();
      return { ok: true };
    },
  }), [editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: !!e?.isActive('bold'), italic: !!e?.isActive('italic'), underline: !!e?.isActive('underline'),
      color: toHex(e?.getAttributes('textStyle').color) ?? null,
      canUndo: !!e?.can().undo(), canRedo: !!e?.can().redo(),
      empty: !!e?.isEmpty,
    }),
  });

  const keep = (event: React.MouseEvent) => event.preventDefault();
  const applyColor = (hex: string) => { setColor(hex); editor?.chain().focus().setColor(hex).run(); };
  const tool = (active: boolean) => cn('inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
    active && 'bg-primary/12 text-primary ring-1 ring-primary/30');

  return <div className={cn('overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring', limitError && 'border-destructive')}>
    <div role="toolbar" aria-label="Body formatting" aria-controls="rule-email-body" className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
      <button type="button" className={tool(!!state?.bold)} aria-label="Bold" aria-pressed={!!state?.bold} title="Bold (Ctrl+B)" data-testid="button-format-bold"
        onMouseDown={keep} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></button>
      <button type="button" className={tool(!!state?.italic)} aria-label="Italic" aria-pressed={!!state?.italic} title="Italic (Ctrl+I)" data-testid="button-format-italic"
        onMouseDown={keep} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></button>
      <button type="button" className={tool(!!state?.underline)} aria-label="Underline" aria-pressed={!!state?.underline} title="Underline (Ctrl+U)" data-testid="button-format-underline"
        onMouseDown={keep} onClick={() => editor?.chain().focus().toggleUnderline().run()}><Underline className="h-4 w-4" /></button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <div className="flex items-center gap-1" role="group" aria-label="Text color">
        {SWATCHES.map(hex => <button key={hex} type="button" aria-label={`Text color ${hex}`} aria-pressed={state?.color === hex} title={hex}
          data-testid={`button-color-${hex.slice(1)}`} onMouseDown={keep} onClick={() => applyColor(hex)}
          className={cn('h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            state?.color === hex && 'ring-2 ring-offset-1 ring-offset-background ring-foreground/60')} style={{ backgroundColor: hex }} />)}
        <label className="relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted" title="Custom color">
          <span className="h-4 w-4 rounded-sm border border-black/10" style={{ background: 'conic-gradient(#c0392b,#e8a025,#0e8f99,#5a2d82,#b0408f,#c0392b)' }} />
          <input type="color" aria-label="Custom text color" data-testid="input-color-custom" className="absolute inset-0 cursor-pointer opacity-0"
            value={state?.color ?? color} onChange={e => applyColor(e.target.value)} />
        </label>
        <button type="button" className={tool(false)} aria-label="Remove text color" title="Remove color" data-testid="button-color-clear"
          onMouseDown={keep} onClick={() => editor?.chain().focus().unsetColor().removeEmptyTextStyle().run()}><Eraser className="h-4 w-4" /></button>
      </div>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button type="button" className={tool(false)} aria-label="Undo" title="Undo" disabled={!state?.canUndo} data-testid="button-format-undo"
        onMouseDown={keep} onClick={() => editor?.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></button>
      <button type="button" className={tool(false)} aria-label="Redo" title="Redo" disabled={!state?.canRedo} data-testid="button-format-redo"
        onMouseDown={keep} onClick={() => editor?.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></button>
    </div>
    <div className="relative">
      {state?.empty && placeholder && <p aria-hidden className="pointer-events-none absolute left-3 top-2.5 whitespace-pre-line text-sm text-muted-foreground">{placeholder}</p>}
      <EditorContent editor={editor} />
    </div>
    {limitError && <p role="alert" data-testid="text-body-limit-error" className="border-t border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">{limitError}</p>}
  </div>;
});
