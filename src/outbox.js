// IndexedDB queue for reports made without a signal. Photo blobs are stored as-is.
const DB = 'floodmap', STORE = 'outbox';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); res(req?.result); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}

export const outbox = {
  add: (report) => run('readwrite', (s) => s.add({ report, at: Date.now() })),
  all: () => run('readonly', (s) => s.getAll()),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
};

export function isNetworkError(e) {
  return !navigator.onLine || e instanceof TypeError || /network|fetch|failed to fetch|load failed/i.test(e?.message || '');
}

/** Sends queued reports. Needs an existing session (the captcha can't run unattended). Returns the count sent. */
export async function flushOutbox(api) {
  let sent = 0;
  try {
    if (!navigator.onLine || !(await api.hasSession())) return 0;
    for (const item of await outbox.all()) {
      try {
        await api.createReport(item.report);
        await outbox.remove(item.id);
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        console.warn('outbox: dropped report', e);
        await outbox.remove(item.id);
      }
    }
  } catch (e) { console.warn('outbox unavailable', e); }
  return sent;
}
