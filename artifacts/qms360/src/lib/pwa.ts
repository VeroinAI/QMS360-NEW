const DB_NAME = 'qms360-offline';
const STORE_NAME = 'reference-snapshots';
const DB_VERSION = 1;

type ReferenceKind = 'platform' | 'lessons';
export type CachedReferenceSnapshot<T = unknown> = { kind: ReferenceKind; cachedAt: string; data: T };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'kind' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the offline reference database.'));
  });
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