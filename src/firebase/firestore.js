// Local stand-in for the parts of "firebase/firestore" the Blockly IDE uses.
// Documents live in localStorage under one key, as { "a/b/c/d": data }, so
// saves, submissions and unlocked steps survive a reload without a backend.

const STORAGE_KEY = "blockly-ide-db";

const readAll = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
};

const writeAll = (all) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
};

export const resetLocalDb = () => localStorage.removeItem(STORAGE_KEY);

// --- Sentinels and timestamps ---
const SERVER_TIMESTAMP = { __sentinel: "serverTimestamp" };

export const serverTimestamp = () => SERVER_TIMESTAMP;
export const arrayUnion = (...items) => ({ __sentinel: "arrayUnion", items });

const makeTimestamp = (ms) => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: (ms % 1000) * 1e6,
  toMillis: () => ms,
  toDate: () => new Date(ms),
});

// Turns sentinels into stored values; `previous` is the field's current value
const encode = (value, previous) => {
  if (value && value.__sentinel === "serverTimestamp") return { __ts: Date.now() };
  if (value && value.__sentinel === "arrayUnion") {
    const base = Array.isArray(previous) ? [...previous] : [];
    value.items.forEach((item) => {
      if (!base.some((b) => JSON.stringify(b) === JSON.stringify(item))) base.push(item);
    });
    return base;
  }
  if (value && typeof value.toMillis === "function") return { __ts: value.toMillis() };
  if (Array.isArray(value)) return value.map((v) => encode(v));
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      if (v !== undefined) out[k] = encode(v, previous?.[k]);
    });
    return out;
  }
  return value;
};

const decode = (value) => {
  if (value && typeof value === "object" && typeof value.__ts === "number") return makeTimestamp(value.__ts);
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      out[k] = decode(v);
    });
    return out;
  }
  return value;
};

// --- References ---
export const db = { __localDb: true };

const basePath = (parent) => (parent && parent.path ? parent.path : "");
const joinPath = (parent, segments) =>
  [basePath(parent), ...segments.map(String)].filter(Boolean).join("/");

export const doc = (parent, ...segments) => {
  const path = joinPath(parent, segments);
  return { type: "document", path, id: path.split("/").pop() };
};

export const collection = (parent, ...segments) => {
  const path = joinPath(parent, segments);
  return { type: "collection", path, id: path.split("/").pop() };
};

const snapshotOf = (ref, data) => ({
  id: ref.id,
  ref,
  exists: () => data !== undefined,
  data: () => (data === undefined ? undefined : decode(data)),
});

// --- Reads ---
export const getDoc = async (ref) => snapshotOf(ref, readAll()[ref.path]);

export const getDocs = async (collRef) => {
  const all = readAll();
  const prefix = `${collRef.path}/`;
  const docs = Object.keys(all)
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .map((path) => snapshotOf(doc(collRef, path.slice(prefix.length)), all[path]));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
};

// --- Writes ---
const applySet = (all, ref, data, options = {}) => {
  const previous = all[ref.path];
  all[ref.path] = options.merge && previous ? { ...previous, ...encode(data, previous) } : encode(data);
};

const applyUpdate = (all, ref, data) => {
  const previous = all[ref.path];
  if (previous === undefined) throw new Error(`No document to update: ${ref.path}`);
  all[ref.path] = { ...previous, ...encode(data, previous) };
};

export const setDoc = async (ref, data, options) => {
  const all = readAll();
  applySet(all, ref, data, options);
  writeAll(all);
};

export const updateDoc = async (ref, data) => {
  const all = readAll();
  applyUpdate(all, ref, data);
  writeAll(all);
};

export const deleteDoc = async (ref) => {
  const all = readAll();
  delete all[ref.path];
  writeAll(all);
};

export const writeBatch = () => {
  const ops = [];
  const batch = {
    set: (ref, data, options) => (ops.push((all) => applySet(all, ref, data, options)), batch),
    update: (ref, data) => (ops.push((all) => applyUpdate(all, ref, data)), batch),
    delete: (ref) => (ops.push((all) => delete all[ref.path]), batch),
    commit: async () => {
      const all = readAll();
      ops.forEach((op) => op(all));
      writeAll(all);
    },
  };
  return batch;
};

// Creates documents that don't exist yet, leaving saved ones alone
export const seedDocs = (docs) => {
  const all = readAll();
  let changed = false;
  Object.entries(docs).forEach(([path, data]) => {
    if (all[path] === undefined) {
      all[path] = encode(data);
      changed = true;
    }
  });
  if (changed) writeAll(all);
};
