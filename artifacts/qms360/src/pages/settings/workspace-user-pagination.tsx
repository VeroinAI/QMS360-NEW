import { Button } from "@/components/ui/button";

export function WorkspaceUserPagination({ page, total, limit = 20, busy, onPageChange }: {
  page: number; total: number; limit?: number; busy?: boolean; onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const numbers = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => page - 2 + i), pages])]
    .filter(number => number >= 1 && number <= pages).sort((a, b) => a - b);
  return <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
    <p className="text-sm text-muted-foreground" role="status">
      {total ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} users` : "0 users"}
      {` · Page ${page} of ${pages}`}
    </p>
    <nav aria-label="User list pages" className="flex flex-wrap gap-1">
      <Button type="button" size="sm" variant="outline" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
      {numbers.map((number, index) => <span key={number} className="flex items-center gap-1">
        {index > 0 && number > numbers[index - 1]! + 1 && <span className="px-1" aria-hidden="true">…</span>}
        <Button type="button" size="sm" variant={page === number ? "default" : "outline"}
          aria-label={`Page ${number}`} aria-current={page === number ? "page" : undefined}
          disabled={busy} onClick={() => onPageChange(number)}>{number}</Button>
      </span>)}
      <Button type="button" size="sm" variant="outline" disabled={busy || page >= pages} onClick={() => onPageChange(page + 1)}>Next</Button>
    </nav>
  </div>;
}
