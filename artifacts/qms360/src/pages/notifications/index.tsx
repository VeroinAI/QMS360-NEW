import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Search } from 'lucide-react';
import { Link } from 'wouter';
import {
  getListAuditNotificationsQueryKey, getListLessonsNotificationsQueryKey, getListQaqcNotificationsQueryKey,
  useListAuditNotifications, useListLessonsNotifications, useListQaqcNotifications,
  useMarkAuditNotificationRead, useMarkLessonsNotificationRead, useMarkQaqcNotificationRead,
} from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

type AppNotification = Notification & { app: 'qaqc' | 'lessons' | 'audit' };

export function LessonsNotificationsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const params = { page, limit: 20 };
  const lessons = useListLessonsNotifications(params);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const markRead = useMarkLessonsNotificationRead({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListLessonsNotificationsQueryKey() });
        toast({ title: 'Notification marked as read' });
      },
      onError: () => toast({ title: 'Could not update notification', variant: 'destructive' }),
    },
  });
  const items = useMemo(() => (lessons.data?.items ?? []).filter(item =>
    (!unreadOnly || !item.read) && `${item.title} ${item.message}`.toLowerCase().includes(search.toLowerCase()),
  ), [lessons.data, search, unreadOnly]);
  const total = lessons.data?.total ?? 0;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-bold">Lessons notifications</h1><p className="mt-2 text-sm text-muted-foreground">Updates from Lesson Learned Management. Notifications are history; your approval queue shows what still needs action.</p></div><Button asChild variant="outline"><Link href="/lessons/approvals">Pending my approval</Link></Button></header>
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search Lessons notifications" className="pl-9" /></div>
      <Button variant={unreadOnly ? 'default' : 'outline'} onClick={() => setUnreadOnly(value => !value)}>Unread only</Button>
    </div>
    {lessons.isLoading ? <div className="space-y-3">{[1, 2, 3].map(value => <Skeleton key={value} className="h-24" />)}</div> :
      lessons.isError ? <State title="Notifications unavailable" detail="Try again after the service reconnects." /> :
      items.length === 0 ? <State title="No Lessons notifications" detail="There are no updates matching this view." /> :
      <div className="space-y-3">{items.map(item => <article key={item.id} className={`flex flex-wrap gap-4 rounded-xl border border-border p-4 ${item.read ? 'bg-card' : 'bg-muted'}`}><div className="rounded-lg bg-primary p-2 text-primary-foreground"><Bell className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="font-semibold">{item.title}</p><p className="mt-1 text-sm text-muted-foreground">{item.message}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p></div>{!item.read && <Button size="sm" variant="outline" onClick={() => markRead.mutate({ id: item.id })} disabled={markRead.isPending}><Check className="h-4 w-4" />Mark read</Button>}</article>)}</div>}
    <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page}</span><Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage(value => value + 1)}>Next</Button></div>
  </div>;
}

export function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const params = { page, limit: 20 };
  const qaqc = useListQaqcNotifications(params);
  const lessons = useListLessonsNotifications(params);
  const audit = useListAuditNotifications(params);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListQaqcNotificationsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListLessonsNotificationsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListAuditNotificationsQueryKey() }),
  ]);
  const mutationOptions = { mutation: { onSuccess: () => { void refresh(); toast({ title: 'Notification marked as read' }); }, onError: () => toast({ title: 'Could not update notification', variant: 'destructive' as const }) } };
  const markQaqc = useMarkQaqcNotificationRead(mutationOptions);
  const markLessons = useMarkLessonsNotificationRead(mutationOptions);
  const markAudit = useMarkAuditNotificationRead(mutationOptions);
  const items = useMemo(() => {
    const all: AppNotification[] = [
      ...(qaqc.data?.items ?? []).map(item => ({ ...item, app: 'qaqc' as const })),
      ...(lessons.data?.items ?? []).map(item => ({ ...item, app: 'lessons' as const })),
      ...(audit.data?.items ?? []).map(item => ({ ...item, app: 'audit' as const })),
    ];
    return all.filter(item => (!unreadOnly || !item.read) && `${item.title} ${item.message}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [qaqc.data, lessons.data, audit.data, search, unreadOnly]);
  const loading = qaqc.isLoading || lessons.isLoading || audit.isLoading;
  const error = qaqc.isError || lessons.isError || audit.isError;
  const total = Math.max(qaqc.data?.total ?? 0, lessons.data?.total ?? 0, audit.data?.total ?? 0);
  const markRead = (item: AppNotification) => {
    if (item.app === 'qaqc') markQaqc.mutate({ id: item.id });
    else if (item.app === 'lessons') markLessons.mutate({ id: item.id });
    else markAudit.mutate({ id: item.id });
  };

  return <div className="space-y-6">
    <header><h1 className="text-3xl font-bold">Notifications</h1><p className="mt-2 text-sm text-muted-foreground">Updates from all three quality applications.</p></header>
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search notifications" className="pl-9" /></div>
      <Button variant={unreadOnly ? 'default' : 'outline'} onClick={() => setUnreadOnly(value => !value)}>Unread only</Button>
    </div>
    {loading ? <div className="space-y-3">{[1, 2, 3].map(value => <Skeleton key={value} className="h-24" />)}</div> :
      error ? <State title="Notifications unavailable" detail="Try again after the service reconnects." /> :
      items.length === 0 ? <State title="No notifications" detail="There are no updates matching this view." /> :
      <div className="space-y-3">{items.map(item => <article key={`${item.app}-${item.id}`} className={`flex flex-wrap gap-4 rounded-xl border border-border p-4 ${item.read ? 'bg-card' : 'bg-muted'}`}><div className="rounded-lg bg-primary p-2 text-primary-foreground"><Bell className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.title}</p><Badge variant="secondary">{item.app.toUpperCase()}</Badge>{item.critical && <Badge variant="destructive">Critical</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{item.message}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p></div>{!item.read && <Button size="sm" variant="outline" onClick={() => markRead(item)} disabled={markQaqc.isPending || markLessons.isPending || markAudit.isPending}><Check className="h-4 w-4" />Mark read</Button>}</article>)}</div>}
    <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page}</span><Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage(value => value + 1)}>Next</Button></div>
  </div>;
}

function State({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center"><p className="font-semibold">{title}</p><p className="mt-2 text-sm text-muted-foreground">{detail}</p></div>;
}