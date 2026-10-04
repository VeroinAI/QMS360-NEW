import { useState } from 'react';
import { Link } from 'wouter';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useGetQaqcSowContext, useListQaqcSowReports } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Obj, ReportType } from './reporting-types';
import { Empty, ErrorBox, Loading, PageFrame, REPORT_MODULE, StateBadge } from './shell';

const LIMIT = 10;
const NAMES: Record<ReportType, [string, string]> = { monthly: ['Monthly reports', 'Project quality reports submitted for management review.'], daily: ['Daily reports', 'Daily document governance snapshots by project.'], csat: ['Customer Satisfaction (CSAT)', 'Customer survey ratings and outcomes by project.'] };
const ALL = 'all';

export function ReportList({ reportType }: { reportType: ReportType }) {
  const cap = useQaqcCapabilities();
  const [page, setPage] = useState(1); const [projectId, setProjectId] = useState(ALL); const [state, setState] = useState(ALL); const [period, setPeriod] = useState('');
  const ctx = useGetQaqcSowContext({ reportType });
  const projects: Obj[] = ((ctx.data ?? {}) as Obj).projects ?? [];
  const q = useListQaqcSowReports({ reportType, page, limit: LIMIT, ...(projectId !== ALL ? { projectId } : {}), ...(period ? { period: reportType === 'daily' ? period : `${period}-01` } : {}), ...(state !== ALL ? { state } : {}) } as never);
  const items = q.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / LIMIT));
  const names = Object.fromEntries(projects.map(p => [p.id, p.name]));
  return <PageFrame title={NAMES[reportType][0]} description={NAMES[reportType][1]} actions={cap.can(REPORT_MODULE[reportType], 'create_edit') ? <Link href={`/qaqc/${reportType}/new`}><Button variant="secondary"><Plus className="mr-2 size-4" />New report</Button></Link> : undefined}>
    <Card className="flex flex-col gap-3 p-4 sm:flex-row">
      <Select value={projectId} onValueChange={v => { setProjectId(v); setPage(1); }}><SelectTrigger className="sm:w-64"><SelectValue placeholder="Project" /></SelectTrigger><SelectContent><SelectItem value={ALL}>All projects</SelectItem>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
      <Select value={state} onValueChange={v => { setState(v); setPage(1); }}><SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger><SelectContent>{[ALL, 'draft', 'submitted', 'approved', 'sent_back'].map(s => <SelectItem key={s} value={s}>{s === ALL ? 'All states' : s.replace('_', ' ')}</SelectItem>)}</SelectContent></Select>
      <Input className="sm:w-44" type={reportType === 'daily' ? 'date' : 'month'} value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }} />
    </Card>
    {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : !items.length ? <Empty text="No reports match these filters" /> :
      <Card className="overflow-hidden"><Table><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Project</TableHead><TableHead>Period</TableHead><TableHead>State</TableHead><TableHead>Submitted</TableHead><TableHead className="text-right">Open</TableHead></TableRow></TableHeader><TableBody>
        {items.map(r => <TableRow key={r.id}><TableCell className="font-mono text-xs">{r.referenceNumber ?? '-'}</TableCell><TableCell className="font-medium">{r.projectName ?? names[r.projectId] ?? r.projectId}</TableCell><TableCell>{r.period}</TableCell><TableCell><StateBadge state={r.state} /></TableCell><TableCell>{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '-'}</TableCell><TableCell className="text-right"><Link href={`/qaqc/${reportType}/${r.id}`}><Button size="sm" variant="outline">{r.state === 'draft' || r.state === 'sent_back' ? 'Edit' : 'View'}</Button></Link></TableCell></TableRow>)}
      </TableBody></Table>
      <div className="flex items-center justify-between border-t px-4 py-3 text-sm"><span className="text-muted-foreground">Page {page} of {pages} - {q.data?.total ?? 0} reports</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="size-4" /></Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight className="size-4" /></Button></div></div></Card>}
  </PageFrame>;
}
