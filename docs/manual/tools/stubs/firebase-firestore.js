// 説明書の画面写真を撮るためだけの、メモリ上だけで動く偽 Firestore。
// 製品には入りません。

import { SEED } from './seed.js';

const store = new Map();
for (const [path, data] of Object.entries(SEED)) {
  store.set(path, JSON.parse(JSON.stringify(data)));
}

const DB = { __isDb: true };

export function getFirestore() {
  return DB;
}

function pathOf(base, segs) {
  const parts = [];
  if (base && base.__path) parts.push(base.__path);
  for (const s of segs) parts.push(String(s));
  return parts.join('/');
}

export function doc(base, ...segs) {
  const path = pathOf(base, segs);
  const bits = path.split('/');
  return { __kind: 'doc', __path: path, id: bits[bits.length - 1], path };
}

export function collection(base, ...segs) {
  const path = pathOf(base, segs);
  return { __kind: 'col', __path: path, path };
}

function snapOf(path) {
  const data = store.get(path);
  const bits = path.split('/');
  return {
    id: bits[bits.length - 1],
    ref: { __kind: 'doc', __path: path, id: bits[bits.length - 1], path },
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
  };
}

export function getDoc(ref) {
  return Promise.resolve(snapOf(ref.__path));
}

export function query(col, ...constraints) {
  return { __kind: 'query', col, constraints };
}

export function where(field, op, value) {
  return { t: 'where', field, op, value };
}
export function orderBy(field, dir) {
  return { t: 'orderBy', field, dir: dir === 'desc' ? 'desc' : 'asc' };
}
export function limit(n) {
  return { t: 'limit', n };
}

function childrenOf(colPath) {
  const prefix = colPath + '/';
  const out = [];
  for (const key of store.keys()) {
    if (!key.startsWith(prefix)) continue;
    if (key.slice(prefix.length).includes('/')) continue;
    out.push(snapOf(key));
  }
  return out;
}

export function getDocs(target) {
  const col = target.__kind === 'query' ? target.col : target;
  const constraints = target.__kind === 'query' ? target.constraints : [];
  let docs = childrenOf(col.__path);

  for (const c of constraints) {
    if (c.t === 'where') {
      docs = docs.filter((d) => {
        const v = d.data()?.[c.field];
        if (c.op === '==') return v === c.value;
        // Firestore の範囲検索は型ごとに区切られていて、
        // null や未設定の項目は数値の範囲に入りません。
        // ここを JS のまま比較すると null <= 数値 が true になり、
        // 本物と違う絵が撮れてしまいます。
        if (v === null || v === undefined) return false;
        if (typeof v !== typeof c.value) return false;
        if (c.op === '>=') return v >= c.value;
        if (c.op === '<=') return v <= c.value;
        if (c.op === '>') return v > c.value;
        if (c.op === '<') return v < c.value;
        return true;
      });
    }
  }
  for (const c of constraints) {
    if (c.t === 'orderBy') {
      docs.sort((a, b) => {
        const x = a.data()?.[c.field];
        const y = b.data()?.[c.field];
        const r = x === y ? 0 : x > y ? 1 : -1;
        return c.dir === 'desc' ? -r : r;
      });
    }
  }
  for (const c of constraints) {
    if (c.t === 'limit') docs = docs.slice(0, c.n);
  }

  return Promise.resolve({
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (fn) => docs.forEach(fn),
  });
}

export function increment(n) {
  return { __op: 'inc', n };
}
export function arrayUnion(...values) {
  return { __op: 'union', values };
}

function resolveOps(next, prev) {
  const out = {};
  for (const [k, v] of Object.entries(next)) {
    if (v && typeof v === 'object' && v.__op === 'inc') {
      out[k] = (typeof prev?.[k] === 'number' ? prev[k] : 0) + v.n;
    } else if (v && typeof v === 'object' && v.__op === 'union') {
      const base = Array.isArray(prev?.[k]) ? prev[k].slice() : [];
      for (const item of v.values) if (!base.includes(item)) base.push(item);
      out[k] = base;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function setDoc(ref, data, options) {
  const prev = store.get(ref.__path);
  const resolved = resolveOps(data, prev);
  store.set(ref.__path, options?.merge === true ? { ...(prev ?? {}), ...resolved } : resolved);
  return Promise.resolve();
}

export function addDoc(col, data) {
  const id = 'x' + Math.random().toString(36).slice(2, 10);
  const path = col.__path + '/' + id;
  store.set(path, resolveOps(data, undefined));
  return Promise.resolve({ __kind: 'doc', __path: path, id, path });
}

export function deleteDoc(ref) {
  store.delete(ref.__path);
  return Promise.resolve();
}
