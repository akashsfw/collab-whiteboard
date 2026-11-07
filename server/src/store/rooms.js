import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.resolve(__dirname, '../../data/rooms.json');

/**
 * In-memory room store backed by local JSON file.
 *
 * Shape of each room entry:
 * {
 *   id: string,
 *   name: string,
 *   passwordHash: string,         // bcrypt hash
 *   isLocked: boolean,            // Admin permanent lock
 *   autoLockEnabled: boolean,     // Auto-lock for non-admins
 *   canvasState: object[],        // serialised Fabric.js JSON objects
 *   mediaElements: object[],      // YouTube iframes / image objects
 *   createdAt: string (ISO),
 * }
 */
const rooms = new Map();

// Load initial rooms from data file if present
function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        data.forEach((r) => rooms.set(r.id, r));
        console.log(`[store] Loaded ${rooms.size} rooms from disk.`);
      }
    }
  } catch (err) {
    console.error('[store] Error loading rooms from disk:', err.message);
  }
}

// Debounced save to disk to avoid blocking I/O on every stroke
let saveTimeout = null;
function saveToDisk() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const arr = Array.from(rooms.values());
      fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      console.error('[store] Error saving rooms to disk:', err.message);
    }
  }, 1000);
}

loadFromDisk();

export function getRoom(id) {
  return rooms.get(id) ?? null;
}

export function setRoom(id, data) {
  rooms.set(id, data);
  saveToDisk();
}

export function deleteRoom(id) {
  rooms.delete(id);
  saveToDisk();
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
