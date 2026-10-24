// Speicherung auf dem Gerät (IndexedDB).

const NAME = 'rezeptkartei';
let opening;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('recipes', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: 'id' });
      db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  all: () => run('recipes', 'readonly', (s) => s.getAll()),
  get: (id) => run('recipes', 'readonly', (s) => s.get(id)),
  put: (r) => run('recipes', 'readwrite', (s) => s.put(r)),
  delete: (id) => run('recipes', 'readwrite', (s) => s.delete(id)),
  getFile: (id) => run('files', 'readonly', (s) => s.get(id)),
  putFile: (f) => run('files', 'readwrite', (s) => s.put(f)),
  deleteFile: (id) => run('files', 'readwrite', (s) => s.delete(id)),
  getSetting: (k) => run('settings', 'readonly', (s) => s.get(k)),
  setSetting: (k, v) => run('settings', 'readwrite', (s) => s.put(v, k)),
};

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
