import { describe, expect, it } from 'vitest';
import {
  CreateMasterDataValueBody, CreateMasterDataValueResponse,
  GetMasterDataLovResponse, UpdateMasterDataValueBody,
} from '@workspace/api-zod';

describe('Department Cost ID API contract', () => {
  it('accepts a text Cost ID without losing leading zeroes or other metadata', () => {
    const parsed = CreateMasterDataValueBody.parse({
      value: 'Civil', metadata: { costId: '001-CIV/A', assignedRoles: [], legacyNote: 'preserve' },
    });
    expect(parsed.metadata).toEqual({ costId: '001-CIV/A', assignedRoles: [], legacyNote: 'preserve' });
  });
  it('supports explicitly clearing the value', () => {
    expect(UpdateMasterDataValueBody.parse({ metadata: { costId: '' } }).metadata?.costId).toBe('');
  });
  it('keeps legacy departments and partial updates valid', () => {
    expect(CreateMasterDataValueBody.parse({ value: 'Civil' }).metadata).toBeUndefined();
    expect(UpdateMasterDataValueBody.parse({ active: false }).metadata).toBeUndefined();
  });
  it.each([123, true, null, {}])('rejects non-text input %j', costId => {
    expect(CreateMasterDataValueBody.safeParse({ value: 'Civil', metadata: { costId } }).success).toBe(false);
  });
  it('retains Cost ID and other metadata in saved responses and dropdown responses', () => {
    const metadata = { costId: '001-CIV/A', legacyNote: 'preserve' };
    const row = CreateMasterDataValueResponse.parse({
      id: 'row', groupId: 'departments', value: 'Civil', label: 'Civil',
      active: true, sortOrder: 0, metadata,
    });
    expect(row.metadata).toEqual(metadata);
    const lov = GetMasterDataLovResponse.parse({
      code: 'departments', values: [{ value: row.value, label: row.label, sortOrder: 0, metadata: row.metadata }],
    });
    expect(lov.values[0].metadata).toEqual(metadata);
  });
});
