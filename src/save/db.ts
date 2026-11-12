/** 原生 IndexedDB 的最小 Promise 封装。 */

export const STORES = ['profiles', 'runs', 'meta'] as const;
export type StoreName = (typeof STORES)[number];
const DB_VERSION = 1;

export function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB open blocked'));
  });
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/**
 * 在一个事务里执行 fn；事务提交后 resolve fn 的返回值。
 * fn 内只能使用 IDB 请求（await reqToPromise 不会让事务提前结束）。
 */
export function tx<T>(
  db: IDBDatabase,
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let value: T;
    let failed = false;
    fn(t).then(
      (v) => {
        value = v;
      },
      (e: unknown) => {
        failed = true;
        try {
          t.abort();
        } catch {
          // 事务可能已结束
        }
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
    t.oncomplete = () => {
      if (!failed) resolve(value);
    };
    t.onabort = () => {
      if (!failed) reject(t.error ?? new Error('indexedDB transaction aborted'));
    };
    t.onerror = () => {
      // 交给 onabort 处理
    };
  });
}
