import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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
 * 1) Supabase PostgreSQL database (preferred when SUPABASE_URL & SUPABASE_KEY are provided)
 * 2) Local JSON file (server/data/rooms.json) as local cache & offline fallback
 */
const rooms = new Map();

// ── Supabase Configuration ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[store] Supabase client initialized.');
  } catch (err) {
    console.error('[store] Error initializing Supabase client:', err.message);
  }
}

function rowToRoom(row) {
  return {
    id: row.id,
    name: row.name || `Room ${row.id.slice(0, 4)}`,
    passwordHash: row.password_hash,
    isLocked: !!row.is_locked,
    autoLockEnabled: !!row.auto_lock_enabled,
    canvasState: row.canvas_state || [],
    mediaElements: row.media_elements || [],
    createdAt: row.created_at || new Date().toISOString(),
  };
}

function roomToRow(r) {
  return {
    id: r.id,
    name: r.name || `Room ${r.id.slice(0, 4)}`,
    password_hash: r.passwordHash,
    is_locked: !!r.isLocked,
    auto_lock_enabled: !!r.autoLockEnabled,
    canvas_state: r.canvasState || [],
    media_elements: r.mediaElements || [],
    created_at: r.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function initSupabase() {
  if (!supabase) {
    console.log('[store] No SUPABASE_URL set, running with local file persistence.');
    return;
  }

  try {
    console.log('[store] Connecting to Supabase PostgreSQL...');
    const { data, error } = await supabase.from('rooms').select('*');

    if (error) {
      console.error('[store] Supabase query error:', error.message);
      return;
    }

    if (Array.isArray(data) && data.length > 0) {
      data.forEach((row) => {
        const roomObj = rowToRoom(row);
        rooms.set(roomObj.id, roomObj);
      });
      console.log(`[store] Successfully loaded ${data.length} room(s) from Supabase.`);
      saveToDiskSync();
    } else if (rooms.size > 0) {
      // If Supabase table is empty but we have local rooms, auto-migrate them to Supabase!
      console.log(`[store] Supabase is empty. Migrating ${rooms.size} local room(s) to Supabase...`);
      for (const r of rooms.values()) {
        const row = roomToRow(r);
        await supabase.from('rooms').upsert(row, { onConflict: 'id' });
      }
      console.log('[store] Migration to Supabase complete.');
    }
  } catch (err) {
    console.error('[store] Failed to sync with Supabase:', err.message);
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
        console.log(`[store] Loaded ${rooms.size} room(s) from local cache.`);
      }
    }
  } catch (err) {
    console.error('[store] Error loading rooms from disk:', err.message);
  }

  // Ensure default seed room exists if completely empty
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
function triggerSave(targetRoomId = null) {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveToDiskSync();

    // Sync to Supabase in background
    if (supabase) {
      if (targetRoomId && rooms.has(targetRoomId)) {
        const row = roomToRow(rooms.get(targetRoomId));
        supabase
          .from('rooms')
          .upsert(row, { onConflict: 'id' })
          .then(({ error }) => {
            if (error) console.error(`[store] Supabase upsert error for room ${targetRoomId}:`, error.message);
          });
      } else {
        // Upsert all rooms
        const rows = Array.from(rooms.values()).map(roomToRow);
        supabase
          .from('rooms')
          .upsert(rows, { onConflict: 'id' })
          .then(({ error }) => {
            if (error) console.error('[store] Supabase bulk upsert error:', error.message);
          });
      }
    }
  }, 1000);
}

// Ensure pending saves flush before process exits
process.on('SIGTERM', () => {
  console.log('[store] SIGTERM received. Flushing rooms to disk...');
  saveToDiskSync();
});
process.on('SIGINT', () => {
  console.log('[store] SIGINT received. Flushing rooms to disk...');
  saveToDiskSync();
});

// Boot: load from local cache first, then sync with Supabase
loadFromDisk();
initSupabase().catch(() => {});

// ── Exported Room Store Methods ─────────────────────────────────────────────
export function getRoom(id) {
  return rooms.get(id) ?? null;
}

export function setRoom(id, data) {
  rooms.set(id, data);
  triggerSave(id);
}

export function deleteRoom(id) {
  rooms.delete(id);
  triggerSave();
  if (supabase) {
    supabase
      .from('rooms')
      .delete()
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.error(`[store] Supabase delete error for room ${id}:`, error.message);
      });
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

  if (supabase) {
    const rows = Array.from(rooms.values()).map(roomToRow);
    supabase
      .from('rooms')
      .upsert(rows, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) console.error('[store] Supabase import upsert error:', error.message);
      });
  }

  return count;
}
