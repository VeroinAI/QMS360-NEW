import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectAdditionalDataEditor } from './project-additional-data-editor';
import { projectContactErrors } from './project-contact-validation';
import type { DronaProjectMasterRecord } from '@workspace/api-client-react';

vi.mock('@workspace/api-client-react', () => ({
  useUpdateProjectAdditionalData: () => ({ isPending: false, mutate: vi.fn(), reset: vi.fn() }),
}));
const record = { id: 'project-1', additionalData: { email: 'quality@example.com', phone: '+91 9876543210' } } as DronaProjectMasterRecord;
const props = { record, canEdit: true, onSaved: vi.fn(), onPendingChange: vi.fn(), onCancel: vi.fn() };

describe('Project Additional Data contact fields', () => {
  it('renders saved contacts with email and international telephone inputs', () => {
    const html = renderToStaticMarkup(<ProjectAdditionalDataEditor {...props} />);
    expect(html).toContain('Email address');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="tel"');
    expect(html).toContain('quality@example.com');
    expect(html).toContain('+91 9876543210');
  });
  it.each(['', 'person@example.com', 'name+project@example.co.in'])('accepts optional or valid email %s', email => {
    expect(projectContactErrors(email, '').email).toBe('');
  });
  it.each(['missing-at', 'a@@example.com', 'a@invalid', 'a..b@example.com'])('rejects invalid email %s', email => {
    expect(projectContactErrors(email, '').email).not.toBe('');
  });
  it.each(['', '+91 9876543210', '+1 202-555-0123', '+442079460958'])('accepts optional or valid international phone %s', phone => {
    expect(projectContactErrors('', phone).phone).toBe('');
  });
  it.each(['9876543210', '+0 12345678', '+91 abc', '+1234567890123456'])('rejects invalid phone %s', phone => {
    expect(projectContactErrors('', phone).phone).not.toBe('');
  });
  it('shows validation and disables saving invalid contact data', () => {
    const html = renderToStaticMarkup(<ProjectAdditionalDataEditor {...props} record={{ ...record, additionalData: { ...record.additionalData!, email: 'bad' } }} />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Enter a valid email address');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="button-save-project-additional-data"/);
  });
  it('keeps read-only users unable to save', () => {
    const html = renderToStaticMarkup(<ProjectAdditionalDataEditor {...props} canEdit={false} />);
    expect(html).not.toContain('button-save-project-additional-data');
    expect(html).toMatch(/type="email"[^>]*disabled=""/);
  });
});
