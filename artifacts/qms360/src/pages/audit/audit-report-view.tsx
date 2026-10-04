import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { customFetch, downloadAuditReportPdf, useGetGeneratedAuditReport, useGetAudit } from "@workspace/api-client-react";
import type { AuditReportSection } from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { isAuditReportEligible } from "./audit-complete";

const msg = (e: unknown) => e instanceof Error ? e.message : "Please try again.";

function Photo({ photo }: { photo: AuditReportSection["photos"][number] }) {
  const [url, setUrl] = useState<string | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke: string | null = null; let alive = true;
    customFetch<Blob>(`/api/files/${encodeURIComponent(photo.id)}`, { responseType: "blob" })
      .then(b => { if (!alive) return; revoke = URL.createObjectURL(b); setUrl(revoke); })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; if (revoke) URL.revokeObjectURL(revoke); };
  }, [photo.id]);
  return <figure className="space-y-1.5 break-inside-avoid">
    {url ? <img src={url} alt={photo.description || photo.fileName} className="aspect-video w-full rounded-md border object-cover" />
      : failed ? <div className="flex aspect-video items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">Photo unavailable</div>
      : <Skeleton className="aspect-video w-full" />}
    <figcaption className="text-xs"><span className="font-medium">{photo.reference || photo.fileName}</span>{photo.description && <span className="text-muted-foreground"> — {photo.description}</span>}</figcaption>
  </figure>;
}

function Section({ section, index }: { section: AuditReportSection; index: number }) {
  return <section aria-labelledby={`sec-${section.key}`} className="space-y-4 border-b pb-8 last:border-0" data-testid={`section-report-${section.key}`}>
    <h2 id={`sec-${section.key}`} className="text-lg font-semibold"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{section.title}</h2>
    {section.fields.length > 0 && <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{section.fields.map((f, i) => <div key={i} className="min-w-0"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{f.value || "—"}</dd></div>)}</dl>}
    {section.tables.map((t, i) => <div key={i} className="space-y-2">
      {t.title && <h3 className="text-sm font-semibold">{t.title}</h3>}
      {t.rows.length ? <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow>{t.columns.map((c, j) => <TableHead key={j}>{c}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{t.rows.map((r, ri) => <TableRow key={ri}>{r.map((c, ci) => <TableCell key={ci} className="whitespace-pre-wrap align-top text-sm">{c || "—"}</TableCell>)}</TableRow>)}</TableBody></Table></div>
        : <p className="text-sm text-muted-foreground">No entries.</p>}
    </div>)}
    {section.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{section.notes.map((n, i) => <li key={i} className="whitespace-pre-wrap">{n}</li>)}</ul>}
    {section.photos.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{section.photos.map(p => <Photo key={p.id} photo={p} />)}</div>}
  </section>;
}

export function AuditReportPage() {
  const { id = "" } = useParams<{ id: string }>(); const { toast } = useToast();
  const audit = useGetAudit(id);
  const eligible = isAuditReportEligible(audit.data?.status);
  const report = useGetGeneratedAuditReport(id, { query: { enabled: eligible, queryKey: [`/api/audit/audits/${id}/report`] } } as never);
  const [busy, setBusy] = useState(false);
  const back = <Button variant="ghost" asChild><Link href={`/audit/audits/${id}`}><ArrowLeft className="mr-2 size-4" />Workspace</Link></Button>;
  if (audit.isLoading) return <div className="space-y-4" aria-busy="true">{back}<Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (audit.error || !audit.data) return <div className="space-y-4">{back}<Card><CardContent className="py-10 text-center"><AlertTriangle className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-semibold">Unable to load audit</p><Button className="mt-4" variant="outline" onClick={() => void audit.refetch()}>Retry</Button></CardContent></Card></div>;
  if (!eligible) return <div className="space-y-4">{back}<Card role="status"><CardContent className="py-12 text-center" data-testid="state-report-unavailable"><AlertTriangle className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-semibold">Report not available yet</h2><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">The consolidated report for "{audit.data.title}" is available once the audit is marked Complete. Current status: {audit.data.status}.</p></CardContent></Card></div>;
  const download = async () => {
    setBusy(true);
    try {
      const blob = await downloadAuditReportPdf(id);
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `audit-report-${id}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { toast({ title: "Unable to download report PDF", description: msg(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const sections = report.data?.sections ?? [];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2">{back}
      <Button onClick={() => void download()} disabled={busy} data-testid="button-download-report-pdf"><Download className="mr-2 size-4" />{busy ? "Preparing…" : "Download PDF"}</Button></div>
    {report.isLoading ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
      : report.error || !report.data ? <Card><CardContent className="py-10 text-center"><AlertTriangle className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-semibold">Unable to load report</p><p className="text-sm text-muted-foreground">{msg(report.error)}</p><Button className="mt-4" variant="outline" onClick={() => void report.refetch()}>Retry</Button></CardContent></Card>
      : <Card><CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-2"><CardTitle className="text-2xl">{report.data.audit.title}</CardTitle><Badge>{report.data.audit.status}</Badge></div>
          <p className="text-sm text-muted-foreground">Consolidated audit report · Completed {report.data.audit.closedAt ? new Date(report.data.audit.closedAt).toLocaleDateString() : "—"} · Generated {new Date(report.data.generatedAt).toLocaleString()}</p></CardHeader>
        <CardContent className="space-y-8 pt-6">{sections.length ? sections.map((s, i) => <Section key={s.key} section={s} index={i} />) : <p className="text-sm text-muted-foreground">The report returned no sections.</p>}</CardContent></Card>}
  </div>;
}
