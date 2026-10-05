import type { AuditPlan, AuditPlanUserOption, AuditSchedule } from '@workspace/api-client-react';
import { auditPlanReplayMatches } from '@workspace/field-controls';

const DB_NAME = 'qms360-offline';
const STORE_NAME = 'reference-snapshots';
const AUDIT_PLAN_CONTEXT_STORE = 'audit-plan-context';
const AUDIT_PLAN_OUTBOX_STORE = 'audit-plan-outbox';
const DB_VERSION = 2;

type ReferenceKind = 'platform' | 'lessons';
export type CachedReferenceSnapshot<T = unknown> = { kind: ReferenceKind; cachedAt: string; data: T };
export type AuditPlanOfflineContext = {
  id: string;
  cachedAt: string;
  schedules: AuditSchedule[];
  users: AuditPlanUserOption[];
};
export type QueuedAuditPlan = { id: string; ownerScope: string; queuedAt: string; revision?: string; plan: AuditPlan; lastError?: string; savedPlanConflict?: boolean; operation?: 'create' | 'update' };

function currentAuthScope(): string | null {
  const token = localStorage.getItem('qms360_token');
  if (!token) return null;
  try {
    const encoded = token.split('.')[1];
    const payload = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as {
      sub?: string;
      organizationId?: string;
    };
    return payload.sub && payload.organizationId ? `${payload.organizationId}:${payload.sub}` : null;
  } catch {
    return null;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'kind' });
      if (!request.result.objectStoreNames.contains(AUDIT_PLAN_CONTEXT_STORE)) request.result.createObjectStore(AUDIT_PLAN_CONTEXT_STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(AUDIT_PLAN_OUTBOX_STORE)) request.result.createObjectStore(AUDIT_PLAN_OUTBOX_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the offline reference database.'));
  });
}

function requestResult<T>(request: IDBRequest<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(message));
  });
}

export async function cacheAuditPlanContext(schedules: AuditSchedule[], users: AuditPlanUserOption[]): Promise<void> {
  const id = currentAuthScope();
  if (!id) return;
  const database = await openDatabase();
  await requestResult(
    database.transaction(AUDIT_PLAN_CONTEXT_STORE, 'readwrite').objectStore(AUDIT_PLAN_CONTEXT_STORE)
      .put({
        id,
        cachedAt: new Date().toISOString(),
        schedules: schedules.filter(schedule => !schedule.hasPlan && schedule.feasibilityDecision !== 'cancelled'),
        users,
      }),
    'Unable to cache Audit Plan form data.',
  );
}

export async function readAuditPlanContext(): Promise<AuditPlanOfflineContext | null> {
  const id = currentAuthScope();
  if (!id) return null;
  const database = await openDatabase();
  return (await requestResult(
    database.transaction(AUDIT_PLAN_CONTEXT_STORE, 'readonly').objectStore(AUDIT_PLAN_CONTEXT_STORE).get(id),
    'Unable to read cached Audit Plan form data.',
  ) as AuditPlanOfflineContext | undefined) ?? null;
}

export async function queueAuditPlan(plan: AuditPlan, operation: 'create' | 'update' = 'create'): Promise<void> {
  const ownerScope = currentAuthScope();
  if (!ownerScope) throw new Error('Authentication is required to save an Audit Plan offline.');
  const database = await openDatabase();
  await requestResult(
    database.transaction(AUDIT_PLAN_OUTBOX_STORE, 'readwrite').objectStore(AUDIT_PLAN_OUTBOX_STORE)
      .put({ id: plan.id, ownerScope, queuedAt: new Date().toISOString(), revision: crypto.randomUUID(), plan, operation, savedPlanConflict: operation === 'update' }),
    'Unable to save the Audit Plan for offline synchronization.',
  );
}

export async function listQueuedAuditPlans(): Promise<QueuedAuditPlan[]> {
  const database = await openDatabase();
  const items = await requestResult(
    database.transaction(AUDIT_PLAN_OUTBOX_STORE, 'readonly').objectStore(AUDIT_PLAN_OUTBOX_STORE).getAll(),
    'Unable to read queued Audit Plans.',
  ) as QueuedAuditPlan[];
  return items.filter(item => item.ownerScope === currentAuthScope());
}

let syncInProgress: Promise<{ synced: number; failed: number; errors?: string[] }> | null = null;
function finishReplay(database: IDBDatabase, item: QueuedAuditPlan, lastError?: string, savedPlanConflict = false): Promise<boolean> {
  const store = database.transaction(AUDIT_PLAN_OUTBOX_STORE, 'readwrite').objectStore(AUDIT_PLAN_OUTBOX_STORE);
  return new Promise((resolve, reject) => {
    const read = store.get(item.id);
    read.onerror = () => reject(read.error ?? new Error('Unable to read queued Audit Plan.'));
    read.onsuccess = () => {
      const current = read.result as QueuedAuditPlan | undefined;
      // A user may have corrected the row while this request was in flight.
      if (!current || current.ownerScope !== item.ownerScope || current.queuedAt !== item.queuedAt || current.revision !== item.revision) {
        resolve(false); return;
      }
      const write = lastError ? store.put({ ...current, lastError, savedPlanConflict: current.savedPlanConflict || savedPlanConflict }) : store.delete(item.id);
      write.onsuccess = () => resolve(true);
      write.onerror = () => reject(write.error ?? new Error('Unable to update queued Audit Plan.'));
    };
  });
}
export function syncQueuedAuditPlans(): Promise<{ synced: number; failed: number; errors?: string[] }> {
  if (syncInProgress) return syncInProgress;
  syncInProgress = replayQueuedAuditPlans().finally(() => { syncInProgress = null; });
  return syncInProgress;
}
async function replayQueuedAuditPlans(): Promise<{ synced: number; failed: number; errors?: string[] }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  const token = localStorage.getItem('qms360_token');
  if (!token) return { synced: 0, failed: 0 };
  const ownerScope = currentAuthScope();
  if (!ownerScope) return { synced: 0, failed: 0 };
  const database = await openDatabase();
  const queued = (await listQueuedAuditPlans()).filter(item => item.ownerScope === ownerScope);
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const item of queued) {
    try {
      const response = await fetch(item.operation === 'update' ? `/api/audit/plans/${encodeURIComponent(item.id)}` : '/api/audit/plans', {
        method: item.operation === 'update' ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(item.plan),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const message = typeof detail.error === 'string' ? detail.error : `Synchronization failed (${response.status}).`;
        errors.push(`${item.plan.auditTitle}: ${message}`);
        await finishReplay(database, item, message, response.status === 409 && message.includes('already saved with different planned data'));
        failed += 1;
        continue;
      }
      if (response.status === 200) {
        const saved = await response.json().catch(() => null);
        if (!saved || !auditPlanReplayMatches(item.plan as unknown as Record<string, unknown>, saved)) {
          const message = 'A different dated version is already saved. Your correction remains on this device. Compare the saved plan, then review and apply the correction to its draft.';
          errors.push(`${item.plan.auditTitle}: ${message}`);
          await finishReplay(database, item, message, true);
          failed += 1;
          continue;
        }
      }
      if (await finishReplay(database, item)) synced += 1;
    } catch {
      failed += 1;
      break;
    }
  }
  window.dispatchEvent(new Event('audit-plan-outbox-changed'));
  return { synced, failed, errors };
}

export async function readReferenceSnapshot<T = unknown>(kind: ReferenceKind): Promise<CachedReferenceSnapshot<T> | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(kind);
    request.onsuccess = () => resolve((request.result as CachedReferenceSnapshot<T> | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Unable to read the offline reference snapshot.'));
  });
}

export async function refreshReferenceSnapshots(): Promise<void> {
  const token = localStorage.getItem('qms360_token');
  if (!token) throw new Error('Authentication is required to cache reference data.');
  const entries: Array<[ReferenceKind, string]> = [
    ['platform', '/api/platform/reference-data'],
    ['lessons', '/api/lessons/reference-data'],
  ];
  const snapshots = await Promise.all(entries.map(async ([kind, url]) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Unable to cache ${kind} reference data (${response.status}).`);
    return { kind, cachedAt: new Date().toISOString(), data: await response.json() };
  }));
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    snapshots.forEach(snapshot => transaction.objectStore(STORE_NAME).put(snapshot));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save offline reference snapshots.'));
  });
}