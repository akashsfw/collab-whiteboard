/**
 * In-memory room store.
 *
 * Shape of each room entry:
 * {
 *   id: string,
 *   passwordHash: string,         // bcrypt hash
 *   canvasState: object[],        // array of serialised Fabric.js objects
 *   mediaElements: object[],      // YouTube iframes / image objects
 *   createdAt: Date,
 * }
 */
const rooms = new Map();

export function getRoom(id) {
  return rooms.get(id) ?? null;
}

export function setRoom(id, data) {
  rooms.set(id, data);
}

export function deleteRoom(id) {
  rooms.delete(id);
}

export function roomExists(id) {
  return rooms.has(id);
}

/** Return a lightweight summary (no password hash). */
export function getRoomSummary(id) {
  const room = rooms.get(id);
  if (!room) return null;
  const { passwordHash: _pw, ...rest } = room;
  return rest;
}
