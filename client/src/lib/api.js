const BASE = import.meta.env.VITE_SERVER_URL || '';

/** GET /api/rooms — get all created rooms sorted by time */
export async function fetchRooms() {
  const res = await fetch(`${BASE}/api/rooms`, { credentials: 'include' });
  if (!res.ok) return [];
  return res.json();
}

/** POST /api/rooms — create room, returns { roomId, room } */
export async function createRoom({ name, password, autoLockEnabled }) {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password, autoLockEnabled }),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create room');
  }
  return res.json();
}

/** GET /api/rooms/:id — check room exists */
export async function fetchRoom(roomId) {
  const res = await fetch(`${BASE}/api/rooms/${roomId}`, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

/** POST /api/rooms/:id/verify — verify room password */
export async function verifyRoomPassword(roomId, password) {
  const res = await fetch(`${BASE}/api/rooms/${roomId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Incorrect room password');
  }
  return res.json();
}

/** POST /api/rooms/admin/verify — verify master admin passcode */
export async function verifyAdminKey(adminKey) {
  const res = await fetch(`${BASE}/api/rooms/admin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminKey }),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Invalid admin passcode');
  }
  return res.json();
}

/** POST /api/rooms/:id/lock — admin permanently locks/unlocks room */
export async function setRoomLock(roomId, adminKey, isLocked) {
  const res = await fetch(`${BASE}/api/rooms/${roomId}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminKey, isLocked }),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update lock status');
  }
  return res.json();
}

/** POST /api/rooms/:id/autolock — admin enables/disables auto-lock feature */
export async function setRoomAutoLock(roomId, adminKey, autoLockEnabled) {
  const res = await fetch(`${BASE}/api/rooms/${roomId}/autolock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminKey, autoLockEnabled }),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update auto-lock status');
  }
  return res.json();
}
