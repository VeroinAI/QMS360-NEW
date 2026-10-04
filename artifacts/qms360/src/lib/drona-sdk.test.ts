import { describe, expect, it } from 'vitest';
import { dronaProfileProof } from './drona-sdk';

describe('Drona SDK profile normalization', () => {
  it('preserves exact large string IDs and returns only the proof fields', () => {
    const data = { uid: '9007199254740993', nonce: 'synthetic-proof', name: 'Synthetic person', email: 'example@example.invalid' };
    expect(dronaProfileProof(data)).toEqual({ uid: data.uid, nonce: data.nonce });
  });
  it('accepts a safe small SDK integer', () => {
    expect(dronaProfileProof({ uid: 12, nonce: 'proof' }).uid).toBe('12');
  });
  it('rejects a missing profile with a safe message', () => {
    expect(() => dronaProfileProof(null as unknown as Parameters<typeof dronaProfileProof>[0]))
      .toThrow('Drona did not supply a supported user ID and session proof.');
  });
  it.each([
    { uid: Number.MAX_SAFE_INTEGER + 1, nonce: 'proof' }, { uid: '01', nonce: 'proof' },
    { uid: '9223372036854775808', nonce: 'proof' }, { uid: '1', nonce: '' },
    { uid: '1', nonce: ' ' }, { uid: null, nonce: 'proof' },
    { uid: '1', nonce: 'x'.repeat(4097) },
  ])('rejects invalid identity/proof without including it in the error', data => {
    expect(() => dronaProfileProof(data)).toThrow('Drona did not supply a supported user ID and session proof.');
  });
});