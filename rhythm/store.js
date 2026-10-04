// Rhythm: where learned songs live — a tiny IndexedDB wrapper (database 'rr-rhythm').
//   analyses  keyed by analysis id   (one Analysis object per "learn" of a song; see RHYTHM_GUIDE)
//   versions  keyed by version id    (index 'key' = song key) — a version = an analysis + a chart seed
// If IndexedDB can't be opened (private mode, old browser, blocked storage) everything keeps working
// in memory for this session.
const DB = 'rr-rhythm';
const STORES = ['analyses', 'versions'];

let dbP = null;
let mem = null;           // in-memory fallback: { analyses: Map, versions: Map }

function useMemory() {
  if (!mem) mem = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  return null;
}

function open() {
  if (dbP) return dbP;
  dbP = new Promise((resolve) => {
    if (mem || typeof indexedDB === 'undefined') { resolve(useMemory()); return; }
    let req;
    try { req = indexedDB.open(DB, 1); } catch { resolve(useMemory()); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath: 'id' });
        os.createIndex('key', 'key', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch {} dbP = null; };
      resolve(db);
    };
    req.onerror = () => resolve(useMemory());
    req.onblocked = () => resolve(useMemory());
  });
  return dbP;
}

const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null, mem[store]);
  try {
    const t = db.transaction(store, mode);
    const fin = new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    const out = await fn(t.objectStore(store), null);
    if (mode === 'readwrite') await fin; else fin.catch(() => {});
    return out;
  } catch (e) {
    // storage broke mid-session (quota, eviction…): carry on in memory
    console.warn('[rhythm store]', e);
    dbP = Promise.resolve(useMemory());
    return fn(null, mem[store]);
  }
}

const clone = (v) => (v == null ? v : (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))));

export const rstore = {
  /** One record by id (or null). */
  get(store, id) { return tx(store, 'readonly', (os, m) => (m ? clone(m.get(id) ?? null) : done(os.get(id)).then((v) => v ?? null))); },
  /** Insert or replace a record (needs an `id`). */
  put(store, obj) { return tx(store, 'readwrite', (os, m) => { if (m) { m.set(obj.id, clone(obj)); return obj; } os.put(obj); return obj; }); },
  delete(store, id) { return tx(store, 'readwrite', (os, m) => { if (m) { m.delete(id); return; } os.delete(id); }); },
  /** Every record of a song (by its `key`), oldest first. */
  listBySong(key, store = 'versions') {
    return tx(store, 'readonly', (os, m) => (m ? [...m.values()].filter((v) => v.key === key).map(clone) : done(os.index('key').getAll(key))))
      .then((list) => (list || []).sort((a, b) => (a.created || 0) - (b.created || 0)));
  },
  /** Every record in a store. */
  all(store) { return tx(store, 'readonly', (os, m) => (m ? [...m.values()].map(clone) : done(os.getAll()))); },
  /** Empty one store, or both. */
  async clear(store = null) {
    for (const s of store ? [store] : STORES) await tx(s, 'readwrite', (os, m) => { if (m) m.clear(); else os.clear(); });
  },
  /** true when IndexedDB works (false = in-memory for this session only). */
  async persistent() { return !!(await open()); },
};
