import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Match visible text, never an internal ID or value. */
export function selectionText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(selectionText).join(' ');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return selectionText(node.props.children);
  return '';
}
export const matchesSelection = (label: string, search: string) =>
  label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());

export const SelectionSearchInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, onKeyDown, ...props }, ref) => <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-2">
    <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <input ref={ref} type="search" aria-label="Search options" placeholder="Search options…" autoComplete="off"
      className={cn('h-10 min-w-0 w-full bg-transparent text-sm outline-none', className)}
      onKeyDown={event => {
        // Radix menu/select type-ahead must not consume editable text or Space.
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
        if (event.key === 'Enter') event.preventDefault();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const options = event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLElement>(
            '[data-selection-match="true"]:not([data-disabled])',
          );
          const option = event.key === 'ArrowDown' ? options?.[0] : options?.[options.length - 1];
          option?.focus();
        }
        onKeyDown?.(event);
      }} {...props} />
  </div>,
);
SelectionSearchInput.displayName = 'SelectionSearchInput';

export const SelectionSearchContext = React.createContext('');

/** Inline checkbox lists keep every row mounted: filtering cannot change selection. */
export function SearchableSelectionList({ children, label = 'Search options', className, listClassName, disabled }: {
  children: React.ReactNode; label?: string; className?: string; listClassName?: string; disabled?: boolean;
}) {
  const [search, setSearch] = React.useState('');
  const rows = React.Children.toArray(children).filter(React.isValidElement);
  const visible = rows.map(row => matchesSelection(selectionText(row), search));
  return <div className={className}>
    <SelectionSearchInput aria-label={label} disabled={disabled} value={search} onChange={event => setSearch(event.target.value)} />
    <div className={cn('max-h-60 overflow-y-auto pt-2', listClassName ?? 'space-y-2')} onKeyDown={event => {
      if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT'
        && (event.target as HTMLInputElement).type === 'search') event.preventDefault();
    }}>
      {rows.map((row, index) => <div key={row.key ?? index} hidden={!visible[index]}>{row}</div>)}
      {!visible.some(Boolean) && <p role="status" className="p-2 text-sm text-muted-foreground">No matching options.</p>}
    </div>
  </div>;
}

export function useSelectionEmpty(ref: React.RefObject<HTMLElement | null>, search: string, children: React.ReactNode) {
  const [empty, setEmpty] = React.useState(false);
  React.useEffect(() => {
    setEmpty(!ref.current?.querySelector('[data-selection-match="true"]'));
  }, [ref, search, children]);
  return empty;
}
