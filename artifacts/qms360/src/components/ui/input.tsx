import * as React from 'react';
import { formatDate, getDateFormat, parseSpreadsheetDate, type DateFormat } from '@workspace/spreadsheet-dates';
import { CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const base =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function display(value: string, withTime: boolean, format: DateFormat = getDateFormat()) {
  if (!value) return '';
  const [d, t] = value.split('T');
  if (!parseSpreadsheetDate(d, { dateFormat: 'YYYY-MM-DD' })) return value;
  const text = formatDate(d, format);
  if (!/\d/.test(text)) return '';
  return withTime && t ? `${text} ${t.slice(0, 5)}` : text;
}

function parse(text: string, withTime: boolean, format: DateFormat = getDateFormat()): string | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!withTime) return parseSpreadsheetDate(trimmed, { dateFormat: format });
  const [d, t = '', ...rest] = trimmed.split(/\s+/);
  const m = TIME.exec(t);
  if (rest.length || !m) return null;
  const iso = parseSpreadsheetDate(d, { dateFormat: format });
  return iso ? `${iso}T${m[1].padStart(2, '0')}:${m[2]}` : null;
}

type Props = React.ComponentProps<'input'>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_VALUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;

/**
 * Typed date entry in the organization format plus a calendar picker.
 * Valid text emits ISO; invalid text emits the raw text (never an empty string)
 * so server validation rejects it, and native validity blocks form submission.
 */
const DateInput = React.forwardRef<HTMLInputElement, Props>(({ className, type, value, defaultValue, onChange, onBlur, onFocus, min, max, disabled, ...props }, ref) => {
  const withTime = type === 'datetime-local';
  const format = getDateFormat();
  const [uncontrolledValue, setUncontrolledValue] = React.useState(() => String(defaultValue ?? ''));
  const current = value === undefined ? uncontrolledValue : String(value ?? '');
  const [text, setText] = React.useState(() => display(current, withTime));
  const [editing, setEditing] = React.useState(false);
  const [entryFormat, setEntryFormat] = React.useState(format);
  // A preference refresh must not reinterpret a valid, ambiguous date mid-edit.
  const activeFormat = editing || (text.trim() !== '' && !ISO_VALUE.test(current)) ? entryFormat : format;
  const [open, setOpen] = React.useState(false);
  const inner = React.useRef<HTMLInputElement | null>(null);
  const lastEmitted = React.useRef(current);
  React.useEffect(() => {
    // External value changes resync the text; our own emissions and partial edits never do.
    if (editing || current === lastEmitted.current) return;
    lastEmitted.current = current;
    if (ISO_VALUE.test(current) || current === '') setText(display(current, withTime));
  }, [current, withTime, editing]);
  React.useEffect(() => {
    // Format change while not editing: repaint the stored ISO value in the new format.
    if (!editing && ISO_VALUE.test(current)) setText(display(current, withTime));
  }, [format, current, withTime, editing]);
  const setRef = (node: HTMLInputElement | null) => {
    inner.current = node;
    if (typeof ref === 'function') ref(node); else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
  };
  React.useEffect(() => {
    const parsed = parse(text, withTime, activeFormat);
    let message = '';
    if (text.trim() && parsed === null) message = `Enter a valid date as ${activeFormat}${withTime ? ' HH:mm' : ''}.`;
    else if (parsed && min && parsed < String(min)) message = `Date must be on or after ${display(String(min), withTime)}.`;
    else if (parsed && max && parsed > String(max)) message = `Date must be on or before ${display(String(max), withTime)}.`;
    inner.current?.setCustomValidity(message);
  });
  const emit = (next: string) => {
    lastEmitted.current = next;
    if (value === undefined) setUncontrolledValue(next);
    onChange?.({ target: { value: next, name: props.name }, currentTarget: { value: next, name: props.name } } as unknown as React.ChangeEvent<HTMLInputElement>);
  };
  const selectedIso = parse(text, withTime, activeFormat);
  const selected = selectedIso && ISO_DATE.test(selectedIso.slice(0, 10)) ? new Date(`${selectedIso.slice(0, 10)}T12:00:00`) : undefined;
  return (
    <div className="relative w-full">
      <input type="hidden" name={props.name} value={current} disabled={disabled} />
      <input
        {...props}
        name={undefined}
        ref={setRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={text.trim() !== '' && selectedIso === null ? true : undefined}
        placeholder={props.placeholder ?? (withTime ? `${activeFormat} HH:mm` : activeFormat)}
        className={cn(base, 'pr-9', className)}
        value={text}
        onFocus={(event) => {
          setEntryFormat(format);
          setEditing(true);
          onFocus?.(Object.assign(Object.create(event), {
            target: { value: current, name: props.name },
            currentTarget: { value: current, name: props.name },
          }) as React.FocusEvent<HTMLInputElement>);
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const parsed = parse(raw, withTime, activeFormat);
          emit(parsed ?? raw);
        }}
        onBlur={(event) => {
          const parsed = parse(text, withTime, activeFormat);
          if (parsed !== null) {
            setText(display(parsed, withTime, format));
            setEntryFormat(format);
            if (parsed !== current) emit(parsed);
          }
          setEditing(false);
          onBlur?.(Object.assign(Object.create(event), {
            target: { value: parsed ?? text, name: props.name },
            currentTarget: { value: parsed ?? text, name: props.name },
          }) as React.FocusEvent<HTMLInputElement>);
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled || props.readOnly} aria-label="Open calendar" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"><CalendarIcon className="h-4 w-4" /></button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            disabled={(day) => {
              const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
              return Boolean((min && iso < String(min).slice(0, 10)) || (max && iso > String(max).slice(0, 10)));
            }}
            onSelect={(day) => {
              if (!day || disabled || props.readOnly) return;
              const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
              const time = withTime ? (selectedIso?.split('T')[1] ?? '00:00') : '';
              const next = withTime ? `${iso}T${time}` : iso;
              setText(display(next, withTime));
              emit(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
});
DateInput.displayName = 'DateInput';

const Input = React.forwardRef<HTMLInputElement, Props>(({ className, type, ...props }, ref) => {
  if (type === 'date' || type === 'datetime-local') return <DateInput ref={ref} type={type} className={className} {...props} />;
  return <input type={type} className={cn(base, className)} ref={ref} {...props} />;
});
Input.displayName = 'Input';

export { Input, DateInput };
