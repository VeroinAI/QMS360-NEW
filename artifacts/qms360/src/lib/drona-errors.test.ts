import { describe, expect, it } from 'vitest';
import { dronaSignInError } from './drona-errors';

describe('Drona sign-in errors', () => {
  it('shows a sanitized temporary-source 503 message instead of incorrectly blaming configuration', () => {
    const cause = Object.assign(new Error('503 Service Unavailable'), {
      status: 503, data: { error: 'Synthetic source temporarily unavailable' },
    });
    expect(dronaSignInError(cause)).toBe('Synthetic source temporarily unavailable');
  });
  it('retains meaningful identity/mapping rejection messages', () => {
    expect(dronaSignInError({ status: 403, data: { error: 'QMS identity mapping or account access is unavailable' } }))
      .toBe('QMS identity mapping or account access is unavailable');
  });
  it('does not render arbitrary remote profiles or raw error objects', () => {
    expect(dronaSignInError({ status: 503, data: { error: { nonce: 'not-for-display' }, uid: '123' } }))
      .toBe('Drona sign-in is temporarily unavailable. Retry or contact your administrator.');
  });
  it('keeps the existing safe SDK missing-email error', () => {
    expect(dronaSignInError(new Error('Drona did not supply a valid profile email.')))
      .toBe('Drona did not supply a valid profile email.');
  });
});
