'use client';

import * as React from 'react';
import type * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { Command as CommandPrimitive } from 'cmdk';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command, CommandInput, CommandList } from './command';
import { cn } from '@/lib/utils';
import { matchesSelection, selectionText } from './selection-search';

type Choice = { value: string; label: React.ReactNode; disabled?: boolean };
type State = {
  value: string; choose: (value: string) => void; disabled?: boolean; required?: boolean;
  open: boolean; setOpen: (open: boolean) => void; listId: string; choices: Choice[];
};
const Context = React.createContext<State | null>(null);
function useSelect() {
  const state = React.useContext(Context);
  if (!state) throw new Error('Selection components must be inside Select');
  return state;
}
function collectChoices(children: React.ReactNode): Choice[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<{ value: string; children?: React.ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === SelectItem) return [{ value: child.props.value, label: child.props.children, disabled: child.props.disabled }];
    return collectChoices(child.props.children);
  });
}

/** Searchable combobox retaining the public value/onValueChange Select contract. */
function Select({ children, value, defaultValue, onValueChange, open, defaultOpen, onOpenChange, disabled, required, name, form, dir }:
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>) {
  const [localValue, setLocalValue] = React.useState(defaultValue ?? '');
  const [localOpen, setLocalOpen] = React.useState(defaultOpen ?? false);
  const current = value ?? localValue;
  const isOpen = open ?? localOpen;
  const choices = collectChoices(children);
  const listId = React.useId();
  const trigger = React.useRef<HTMLSelectElement>(null);
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  const choose = (next: string) => {
    if (disabled || !choices.some(choice => choice.value === next && !choice.disabled)) return;
    setLocalValue(next);
    if (next !== current) onValueChange?.(next);
    setOpen(false);
  };
  React.useEffect(() => {
    const native = trigger.current;
    const parent = native?.form;
    if (!parent) return;
    const reset = () => { if (value === undefined) setLocalValue(defaultValue ?? ''); };
    parent.addEventListener('reset', reset);
    return () => parent.removeEventListener('reset', reset);
  }, [value, defaultValue]);
  return <Context.Provider value={{ value: current, choose, disabled, required, open: isOpen, setOpen, listId, choices }}>
    <Popover open={isOpen} onOpenChange={setOpen}>
      <div dir={dir} className="contents">
        {children}
        {(name || required || form) && <select ref={trigger} aria-hidden="true" tabIndex={-1} className="sr-only" name={name} form={form}
          disabled={disabled} required={required} value={current} onChange={event => choose(event.target.value)}>
          <option value="" />{choices.map(choice => <option key={choice.value} value={choice.value} disabled={choice.disabled}>{selectionText(choice.label)}</option>)}
        </select>}
      </div>
    </Popover>
  </Context.Provider>;
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(
  ({ className, children, onKeyDown, ...props }, ref) => {
    const state = useSelect();
    return <PopoverTrigger asChild><button type="button" {...props} ref={ref} role="combobox"
      aria-expanded={state.open} aria-controls={state.listId} aria-haspopup="dialog" aria-required={state.required}
      data-placeholder={!state.value ? '' : undefined} disabled={state.disabled || props.disabled}
      className={cn('flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1', className)}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); state.setOpen(true); }
      }}>
      {children}<ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
    </button></PopoverTrigger>;
  },
);
SelectTrigger.displayName = 'SelectTrigger';

const SelectValue = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Value>>(
  ({ placeholder, children, ...props }, ref) => {
    const state = useSelect();
    return <span {...props} ref={ref}>{children ?? (state.value ? state.choices.find(choice => choice.value === state.value)?.label : placeholder)}</span>;
  },
);
SelectValue.displayName = 'SelectValue';

const SearchContext = React.createContext('');
const SelectContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
  ({ className, children, position: _position, ...props }, ref) => {
    const state = useSelect();
    return <PopoverContent ref={ref} align="start" {...props as React.ComponentPropsWithoutRef<typeof PopoverContent>} id={state.listId} aria-label="Choose an option"
      className={cn('w-[var(--radix-popover-trigger-width)] min-w-[8rem] max-w-[calc(100vw-1rem)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-0', className)}>
      <SelectionCommand>{children}</SelectionCommand>
    </PopoverContent>;
  },
);
SelectContent.displayName = 'SelectContent';
function SelectionCommand({ children }: { children: React.ReactNode }) {
  const state = useSelect();
  const [search, setSearch] = React.useState('');
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { input.current?.focus(); }, []);
  const anyMatch = state.choices.some(choice => matchesSelection(selectionText(choice.label), search));
  return <Command label="Search options" shouldFilter={false} loop>
    <CommandInput ref={input} aria-label="Search options" placeholder="Search options…" value={search} onValueChange={setSearch} />
    <CommandList className="max-h-[min(300px,50dvh)] p-1">
      <SearchContext.Provider value={search}>{children}</SearchContext.Provider>
      {!anyMatch && <p role="status" className="p-3 text-center text-sm text-muted-foreground">No matching options.</p>}
    </CommandList>
  </Command>;
}
const SelectItem = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  ({ className, children, value, disabled, textValue: _textValue, onSelect: _onSelect, ...props }, ref) => {
    const state = useSelect();
    const matches = matchesSelection(selectionText(children), React.useContext(SearchContext));
    return <CommandPrimitive.Item {...props as React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>} ref={ref}
      value={value} disabled={disabled || !matches} forceMount hidden={!matches}
      style={!matches ? { display: 'none' } : props.style}
      aria-selected={state.value === value} onSelect={() => state.choose(value)}
      className={cn('relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50', className)}>
      {children}{state.value === value && <Check className="absolute right-2 size-4" aria-hidden="true" />}
    </CommandPrimitive.Item>;
  },
);
SelectItem.displayName = 'SelectItem';
const SelectGroup = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(
  ({ children, ...props }, ref) => {
    const search = React.useContext(SearchContext);
    const nodes = React.Children.toArray(children);
    const label = nodes.find(child => React.isValidElement(child) && child.type === SelectLabel);
    const matches = collectChoices(children).some(choice => matchesSelection(selectionText(choice.label), search));
    return <CommandPrimitive.Group {...props} ref={ref} heading={selectionText(label)} forceMount hidden={!matches}
      style={!matches ? { display: 'none' } : props.style}>
      {nodes.filter(child => child !== label)}
    </CommandPrimitive.Group>;
  },
);
SelectGroup.displayName = 'SelectGroup';
const SelectLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} role="presentation" {...props} className={cn('px-2 py-1.5 text-sm font-semibold', className)} />,
);
SelectLabel.displayName = 'SelectLabel';
const SelectSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} role="separator" {...props} className={cn('-mx-1 my-1 h-px bg-muted', className)} />,
);
SelectSeparator.displayName = 'SelectSeparator';
const SelectScrollUpButton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => <div {...props} ref={ref} />);
const SelectScrollDownButton = SelectScrollUpButton;

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton };
