// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './select';
import { NativeSelection } from './native-selection';
import { SearchableSelectionList } from './selection-search';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { ActivityMultiSelect } from '@/pages/audit/activity-role-fields';
import { PlanSelection } from '@/pages/audit/plan-selection';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollTo = vi.fn();
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);

function Single({ change = vi.fn(), disabled = false }: { change?: (value: string) => void; disabled?: boolean }) {
  return <Select defaultValue="uuid-a" onValueChange={change} disabled={disabled}>
    <SelectTrigger aria-label="Discipline"><SelectValue placeholder="Choose" /></SelectTrigger>
    <SelectContent><SelectGroup><SelectLabel>Disciplines</SelectLabel>
      <SelectItem value="uuid-a">Civil Engineering</SelectItem>
      <SelectItem value="uuid-b">Mechanical</SelectItem>
      <SelectItem value="uuid-c" disabled>Electrical</SelectItem>
    </SelectGroup></SelectContent>
  </Select>;
}
async function openSingle() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox'));
  const search = await screen.findByRole('combobox', { name: 'Search options' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  return { user, search };
}

describe('shared searchable selection', () => {
  it('matches partial visible labels without changing values or losing the selected label', async () => {
    const change = vi.fn();
    render(<Single change={change} />);
    const { user, search } = await openSingle();
    await user.type(search, 'CHAN');
    expect(screen.getByRole('option', { name: 'Mechanical' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Civil Engineering' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Discipline' }).textContent).toContain('Civil Engineering');
    expect(change).not.toHaveBeenCalled();
    await user.click(screen.getByRole('option', { name: 'Mechanical' }));
    expect(change).toHaveBeenCalledWith('uuid-b');
  });
  it('does not match opaque IDs; clearing and reopening restore all choices', async () => {
    render(<Single />);
    const { user, search } = await openSingle();
    await user.type(search, 'uuid-b');
    expect(screen.getByRole('status').textContent).toContain('No matching options');
    await user.clear(search);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await user.type(search, 'absent');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('combobox'));
    expect((await screen.findByRole('combobox', { name: 'Search options' }) as HTMLInputElement).value).toBe('');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
  it('keeps disabled items disabled and supports search-to-option keyboard selection', async () => {
    const change = vi.fn();
    render(<Single change={change} />);
    const { user, search } = await openSingle();
    expect(screen.getByRole('option', { name: 'Electrical' }).getAttribute('aria-disabled')).toBe('true');
    await user.type(search, 'mech');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(change).toHaveBeenCalledWith('uuid-b');
  });
  it('does not open a disabled field', async () => {
    render(<Single disabled />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('combobox', { name: 'Search options' })).toBeNull();
  });
  it('keeps popup focus and Escape local to a surrounding dialog', async () => {
    render(<Dialog defaultOpen><DialogContent><DialogTitle>Report</DialogTitle><Single /></DialogContent></Dialog>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Discipline' }));
    const input = await screen.findByRole('combobox', { name: 'Search options' });
    await user.type(input, 'mech');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Report' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Choose an option' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Discipline' })));
  });
  it('updates asynchronous eligible labels without changing a saved value', async () => {
    const change = vi.fn();
    const view = render(<Select value="a" onValueChange={change}><SelectTrigger aria-label="User"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">Previous user</SelectItem></SelectContent></Select>);
    expect(screen.getByRole('combobox').textContent).toBe('Previous user');
    view.rerender(<Select value="a" onValueChange={change}><SelectTrigger aria-label="User"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">Alice · Auditor</SelectItem><SelectItem value="b">Bob</SelectItem></SelectContent></Select>);
    const { user, search } = await openSingle();
    await user.type(search, 'AUDITOR');
    expect(screen.getByRole('option', { name: 'Alice · Auditor' })).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });
  it('typing and Enter in search never submit a form or change a field', async () => {
    const submit = vi.fn(event => event.preventDefault());
    const change = vi.fn();
    render(<form onSubmit={submit}><Single change={change} /><button type="submit">Save</button></form>);
    const { user, search } = await openSingle();
    await user.type(search, 'Civil Eng');
    expect(change).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('native-compatible selection', () => {
  it('retains empty values, native change handlers, name and form values', async () => {
    const change = vi.fn();
    function Field() {
      const [value, setValue] = React.useState('');
      return <form aria-label="Example"><NativeSelection aria-label="Project" name="projectId" value={value}
        onChange={event => { change(event.target.value); setValue(event.target.value); }}>
        <option value="">All projects</option><optgroup label="Active"><option value="p1">Project Alpha</option></optgroup>
      </NativeSelection></form>;
    }
    render(<Field />);
    const { user, search } = await openSingle();
    await user.type(search, 'alpha');
    expect(change).not.toHaveBeenCalled();
    await user.click(screen.getByRole('option', { name: 'Project Alpha' }));
    expect(change).toHaveBeenCalledWith('p1');
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('projectId')).toBe('p1');
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'All projects' }));
    expect(change).toHaveBeenLastCalledWith('');
  });
  it('supports uncontrolled selection and retains disabled options', async () => {
    render(<NativeSelection defaultValue="a"><option value="a">Alpha</option><option value="b" disabled>Beta</option><option value="g">Gamma</option></NativeSelection>);
    const { user } = await openSingle();
    expect(screen.getByRole('option', { name: 'Beta' }).getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(screen.getByRole('combobox').textContent).toContain('Gamma');
  });
  it('does not collide with former sentinel-like values and resets uncontrolled forms', async () => {
    render(<form aria-label="Reset example"><NativeSelection name="choice" defaultValue="a">
      <option value="">None</option><option value="a">Alpha</option><option value="__qms_native_empty__">Legacy sentinel</option>
    </NativeSelection><button type="reset">Reset</button></form>);
    const { user } = await openSingle();
    await user.click(screen.getByRole('option', { name: 'Legacy sentinel' }));
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('choice')).toBe('__qms_native_empty__');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('combobox').textContent).toContain('Alpha');
  });
  it('puts focus and validation attributes on the visible trigger, not the native bridge', () => {
    render(<NativeSelection id="discipline" data-report-field="manpower.1.department" required>
      <option value="">Select discipline</option><option value="a">Alpha</option>
    </NativeSelection>);
    const trigger = screen.getByRole('combobox');
    expect(document.querySelector('[data-report-field="manpower.1.department"]')).toBe(trigger);
    const bridge = document.querySelector('select')!;
    expect(bridge.checkValidity()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('multi-selection', () => {
  it('keeps real Audit activity values, unavailable removals, and search keyboard behavior', async () => {
    const change = vi.fn();
    function Field() {
      const [values, setValues] = React.useState(['a', 'legacy']);
      return <ActivityMultiSelect label="Activity users" options={[{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }]}
        value={values} onChange={next => { change(next); setValues(next); }} />;
    }
    render(<Field />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Activity users' });
    await user.click(trigger);
    const search = await screen.findByRole('searchbox');
    await user.type(search, 'bob');
    expect(change).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown} ');
    expect(change).toHaveBeenLastCalledWith(['a', 'legacy', 'b']);
    await user.click(search);
    await user.clear(search);
    await user.type(search, 'unavailable');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Unavailable selection — remove (legacy)' }));
    expect(change).toHaveBeenLastCalledWith(['a', 'b']);
    await user.keyboard('{Escape}');
    await user.click(trigger);
    expect((await screen.findByRole('searchbox') as HTMLInputElement).value).toBe('');
  });
  it('uses the real Audit Plan method picker without overwriting hidden methods', async () => {
    const change = vi.fn();
    render(<PlanSelection id="methods" number={1} label="Methods" options={['Interview', 'Observation']} value={['Interview']} onChange={change} disabled={false} required />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));
    await user.type(await screen.findByRole('searchbox'), 'observ');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Observation' }));
    expect(change).toHaveBeenCalledWith(['Interview', 'Observation']);
  });
  it('retains hidden selections and removal of unavailable choices in menus', async () => {
    function Multi() {
      const [value, setValue] = React.useState(['Alice', 'Unavailable user']);
      return <><output aria-label="Selections">{value.join(', ')}</output><DropdownMenu><DropdownMenuTrigger>Users</DropdownMenuTrigger>
        <DropdownMenuContent>{['Alice', 'Bob', 'Unavailable user'].map(name => <DropdownMenuCheckboxItem key={name}
          checked={value.includes(name)} onSelect={event => event.preventDefault()}
          onCheckedChange={checked => setValue(old => checked ? [...old, name] : old.filter(item => item !== name))}>{name}</DropdownMenuCheckboxItem>)}</DropdownMenuContent>
      </DropdownMenu></>;
    }
    render(<Multi />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Users' }));
    const input = await screen.findByRole('searchbox');
    await user.type(input, 'bob');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Bob' }));
    expect(screen.getByLabelText('Selections').textContent).toBe('Alice, Unavailable user, Bob');
    await user.clear(input);
    await user.type(input, 'unavailable');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Unavailable user' }));
    expect(screen.getByLabelText('Selections').textContent).toBe('Alice, Bob');
  });
  it('filters inline checkbox labels without changing checked state', async () => {
    render(<SearchableSelectionList><label><input type="checkbox" defaultChecked />Alice · QA</label><label><input type="checkbox" />Bob · Audit</label></SearchableSelectionList>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'AUDIT' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'none' } });
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect((screen.getByRole('checkbox', { name: 'Alice · QA' }) as HTMLInputElement).checked).toBe(true);
  });
  it('offers search and feedback even before options have loaded', async () => {
    render(<DropdownMenu><DropdownMenuTrigger>Empty users</DropdownMenuTrigger><DropdownMenuContent /></DropdownMenu>);
    await userEvent.click(screen.getByRole('button', { name: 'Empty users' }));
    expect(await screen.findByRole('searchbox')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('No matching options');
  });
  it('keeps all/clear callbacks independent of filtered checkbox rows', async () => {
    function Multi() {
      const [values, setValues] = React.useState(['a']);
      return <><output aria-label="Selected IDs">{values.join(',')}</output>
        <button onClick={() => setValues(['a', 'b', 'c'])}>Select all</button>
        <button onClick={() => setValues([])}>Clear</button>
        <SearchableSelectionList>{['a', 'b', 'c'].map(id => <label key={id}><input type="checkbox" checked={values.includes(id)}
          onChange={event => setValues(old => event.target.checked ? [...old, id] : old.filter(value => value !== id))} />{id}</label>)}</SearchableSelectionList></>;
    }
    render(<Multi />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'b');
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByLabelText('Selected IDs').textContent).toBe('a,b,c');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Selected IDs').textContent).toBe('');
  });
});
