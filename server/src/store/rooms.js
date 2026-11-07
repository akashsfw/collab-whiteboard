import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_FILE = path.resolve(DATA_DIR, 'rooms.json');

// Default seed room (password: "1234")
const DEFAULT_SEED_ROOM = {
  id: 'main-board',
  name: 'Main Collaboration Room',
  passwordHash: '$2a$10$XtLSk.Hgjidx14mKSiYjX.tUbJ3wMD431bKMSqKM9I0dkATXww/yy',
  isLocked: false,
  autoLockEnabled: false,
  canvasState: [],
  mediaElements: [],
  createdAt: new Date().toISOString(),
};

/**
 * In-memory room store backed by:
 * 1) Local JSON file (server/data/rooms.json)
 * 2) Optional MongoDB Atlas cloud database if MONGODB_URI is provided
 */
const rooms = new Map();

// Cloud MongoDB client if configured
let mongoCollection = null;
const MONGODB_URI = process.env.MONGODB_URI || '';

async function initMongo() {
  if (!MONGODB_URI) {
    console.log('[store] No MONGODB_URI set, using local disk persistence.');
    return;
  }
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'collab_whiteboard');
    mongoCollection = db.collection('rooms');
    console.log('[store] Connected to MongoDB Atlas. Syncing rooms from cloud...');

    const cloudRooms = await mongoCollection.find({}).toArray();
    if (cloudRooms.length > 0) {
      cloudRooms.forEach((r) => {
        const { _id, ...roomData } = r;
        rooms.set(roomData.id, roomData);
      });
      console.log(`[store] Loaded ${cloudRooms.length} rooms from MongoDB Atlas.`);
      saveToDiskSync();
    } else if (rooms.size > 0) {
      // Seed mongo with existing local rooms
      const arr = Array.from(rooms.values());
      for (const r of arr) {
        await mongoCollection.updateOne({ id: r.id }, { $set: r }, { upsert: true });
      }
      console.log(`[store] Seeded ${arr.length} rooms to MongoDB Atlas.`);
    }
  } catch (err) {
    console.error('[store] MongoDB connection error (falling back to disk):', err.message);
  }
}

// ── Local Disk Persistence ──────────────────────────────────────────────────
function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('[store] Error creating data directory:', err.message);
  }
}

function loadFromDisk() {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        data.forEach((r) => rooms.set(r.id, r));
        console.log(`[store] Loaded ${rooms.size} room(s) from ${DATA_FILE}`);
      }
    }
  } catch (err) {
    console.error('[store] Error loading rooms from disk:', err.message);
  }

  // Ensure at least one default room exists
  if (rooms.size === 0) {
    rooms.set(DEFAULT_SEED_ROOM.id, { ...DEFAULT_SEED_ROOM });
    saveToDiskSync();
    console.log('[store] Initialized default seed room: main-board');
  }
}

function saveToDiskSync() {
  ensureDataDir();
  try {
    const arr = Array.from(rooms.values());
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(arr, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error('[store] Error saving rooms to disk:', err.message);
  }
}

let saveTimeout = null;
function triggerSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveToDiskSync();
    // Also save to MongoDB if connected
    if (mongoCollection) {
      const arr = Array.from(rooms.values());
      for (const r of arr) {
        mongoCollection.updateOne({ id: r.id }, { $set: r }, { upsert: true }).catch((err) => {
          console.error(`[store] Mongo update error for room ${r.id}:`, err.message);
        });
      }
    }
  }, 1000);
}

// Ensure pending saves flush before process exit
process.on('SIGTERM', () => {
  console.log('[store] SIGTERM received. Flushing rooms to disk...');
  saveToDiskSync();
});
process.on('SIGINT', () => {
  console.log('[store] SIGINT received. Flushing rooms to disk...');
  saveToDiskSync();
});

// Boot: load from disk first, then attempt MongoDB init
loadFromDisk();
initMongo().catch(() => {});

// ── Exported Room Store Methods ─────────────────────────────────────────────
export function getRoom(id) {
  return rooms.get(id) ?? null;
}

export function setRoom(id, data) {
  rooms.set(id, data);
  triggerSave();
}

export function deleteRoom(id) {
  rooms.delete(id);
  triggerSave();
  if (mongoCollection) {
    mongoCollection.deleteOne({ id }).catch(() => {});
  }
}

export function roomExists(id) {
  return rooms.has(id);
}

/** Return a lightweight summary of a single room (no password hash). */
export function getRoomSummary(id) {
  const room = rooms.get(id);
  if (!room) return null;
  const { passwordHash: _pw, ...rest } = room;
  return rest;
}

/** Return all rooms sorted by createdAt descending (newest first). */
export function getAllRoomsSummary() {
  const list = Array.from(rooms.values()).map((r) => {
    const { passwordHash: _pw, canvasState, mediaElements, ...summary } = r;
    return {
      ...summary,
      objectCount: Array.isArray(canvasState)
        ? canvasState.length
        : canvasState?.objects?.length || 0,
      mediaCount: mediaElements?.length || 0,
    };
  });

  return list.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Export all rooms full data (for admin JSON backup). */
export function exportAllRooms() {
  return Array.from(rooms.values());
}

/** Import rooms from backup array. */
export function importRooms(importedList) {
  if (!Array.isArray(importedList)) {
    throw new Error('Import data must be a JSON array of room objects.');
  }
  let count = 0;
  for (const r of importedList) {
    if (r && r.id) {
      rooms.set(r.id, r);
      count++;
    }
  }
  saveToDiskSync();
  if (mongoCollection) {
    const arr = Array.from(rooms.values());
    for (const r of arr) {
      mongoCollection.updateOne({ id: r.id }, { $set: r }, { upsert: true }).catch(() => {});
    }
  }
  return count;
}
