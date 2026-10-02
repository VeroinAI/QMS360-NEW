import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadQaqcPdfTemplate, useListQaqcPdfTemplates, type QaqcPdfTemplate } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { errMsg, saveFile } from './shell';

export const BUILTIN_TEMPLATE = 'builtin';

/** Published named exact-PDF forms for one report type and kind. Refetches on mount. */
export function usePublishedPdfTemplates(reportType: 'monthly' | 'daily' | 'csat', kind: 'report' | 'dashboard') {
  const q = useListQaqcPdfTemplates({ reportType, kind }, { query: { refetchOnMount: 'always', queryKey: ['/api/qaqc/reporting/pdf-templates', { reportType, kind }] } });
  const items: QaqcPdfTemplate[] = (q.data ?? []).filter(t => t.state === 'published');
  return { ...q, items };
}

export function PdfTemplatePicker({ reportType, kind, value, onChange, disabled }: {
  reportType: 'monthly' | 'daily' | 'csat'; kind: 'report' | 'dashboard'; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  const { toast } = useToast();
  const { items, isLoading, error, refetch } = usePublishedPdfTemplates(reportType, kind);
  const [busy, setBusy] = useState(false);
  const selected = items.find(t => t.id === value);
  const blank = async () => {
    if (!selected) return;
    setBusy(true);
    try { saveFile(await downloadQaqcPdfTemplate(selected.id, undefined, { headers: { Accept: 'application/pdf' } }), `${selected.name}-${selected.version}-blank.pdf`); }
    catch (e) { toast({ title: 'Blank form download failed', description: errMsg(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return <div className="flex flex-wrap items-end gap-2" data-testid="pdf-template-picker">
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">PDF form</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
        <SelectTrigger className="w-64" data-testid="select-pdf-template"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={BUILTIN_TEMPLATE}>Built-in complete report</SelectItem>
          {items.map(t => <SelectItem key={t.id} value={t.id}>{t.name} - {t.version}{t.isDefault ? ' (default)' : ''}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <Button variant="outline" size="sm" disabled={!selected || busy} onClick={blank} data-testid="button-blank-pdf"><Download className="mr-2 size-4" />Blank form</Button>
    {error && <button className="text-xs text-destructive underline" onClick={() => refetch()}>Forms could not be loaded ({errMsg(error)}). Retry</button>}
  </div>;
}
