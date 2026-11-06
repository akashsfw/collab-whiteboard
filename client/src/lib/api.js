const BASE = import.meta.env.VITE_SERVER_URL || '';

/** POST /api/rooms — create room, returns { roomId } */
export async function createRoom(password) {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create room');
  }
  return res.json(); // { roomId }
}

/** GET /api/rooms/:id — check room exists */
export async function fetchRoom(roomId) {
  const res = await fetch(`${BASE}/api/rooms/${roomId}`, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}
