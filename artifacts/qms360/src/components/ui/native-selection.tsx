import * as React from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './select';
import { selectionText } from './selection-search';

// Encode every value, including empty: no real option can collide with a sentinel.
const encode = (value: string) => `native:${value}`;
function choices(children: React.ReactNode, parentDisabled = false): React.ReactNode {
  return React.Children.map(children, child => {
    if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode; label?: string; disabled?: boolean }>(child)) return null;
    if (child.type === 'option') {
      const value = String(child.props.value ?? selectionText(child.props.children));
      return <SelectItem value={encode(value)} disabled={parentDisabled || child.props.disabled}>{child.props.children}</SelectItem>;
    }
    if (child.type === 'optgroup') return <SelectGroup><SelectLabel>{child.props.label}</SelectLabel>{choices(child.props.children, parentDisabled || child.props.disabled)}</SelectGroup>;
    return choices(child.props.children, parentDisabled);
  });
}

/** Native-compatible event/form bridge; only choosing an option dispatches change. */
export function NativeSelection({ children, className, value, defaultValue, onChange, id, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const native = React.useRef<HTMLSelectElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const [localValue, setLocalValue] = React.useState(() => String(defaultValue ?? ''));
  const current = value === undefined ? localValue : String(value);
  React.useEffect(() => {
    if (value === undefined && native.current) setLocalValue(native.current.value);
  }, [children, value]);
  React.useEffect(() => {
    const parent = native.current?.form;
    if (!parent) return;
    const reset = () => {
      if (value === undefined) setLocalValue(String(defaultValue ?? native.current?.options[0]?.value ?? ''));
    };
    parent.addEventListener('reset', reset);
    return () => parent.removeEventListener('reset', reset);
  }, [value, defaultValue]);
  const nativeProps = Object.fromEntries(Object.entries(props).filter(([key]) => !key.startsWith('aria-') && !key.startsWith('data-')));
  return <>
    <select {...nativeProps} ref={native} value={current} onChange={event => onChange?.(event)} aria-hidden="true" tabIndex={-1}
      onInvalid={event => { props.onInvalid?.(event); event.preventDefault(); trigger.current?.focus(); }}
      className="sr-only" style={{ display: 'none' }}>{children}</select>
    <Select value={encode(current)} disabled={props.disabled} onValueChange={next => {
      const chosen = next.slice('native:'.length);
      setLocalValue(chosen);
      if (!native.current) return;
      // Use the native setter so React sees a genuine value change.
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(native.current, chosen);
      native.current.dispatchEvent(new Event('change', { bubbles: true }));
    }}>
      <SelectTrigger {...Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith('aria-') || key.startsWith('data-')))}
        ref={trigger} id={id} className={className} onBlur={props.onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{choices(children)}</SelectContent>
    </Select>
  </>;
}
