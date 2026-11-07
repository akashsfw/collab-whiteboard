import express from 'express';
import bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';
import {
  getRoom,
  setRoom,
  deleteRoom,
  roomExists,
  getRoomSummary,
  getAllRoomsSummary,
  exportAllRooms,
  importRooms,
} from '../store/rooms.js';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin2026';

export const roomRouter = express.Router();

/**
 * GET /api/rooms
 * Returns all created rooms sorted by creation time (most recent first)
 */
roomRouter.get('/', (_req, res) => {
  const rooms = getAllRoomsSummary();
  return res.json(rooms);
});

/**
 * POST /api/rooms
 * Body: { name?: string, password: string, autoLockEnabled?: boolean }
 * Creates a new room, returns { roomId }
 */
roomRouter.post('/', async (req, res) => {
  const { name, password, autoLockEnabled } = req.body;

  if (!password || typeof password !== 'string' || password.trim().length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }

  // Generate a collision-safe room ID (3 segments for readability)
  let roomId;
  do {
    const raw = nanoid();
    roomId = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  } while (roomExists(roomId));

  const passwordHash = await bcrypt.hash(password.trim(), 12);

  const roomData = {
    id: roomId,
    name: name?.trim() || `Room ${roomId.slice(0, 4)}`,
    passwordHash,
    isLocked: false,
    autoLockEnabled: !!autoLockEnabled,
    canvasState: [],
    mediaElements: [],
    createdAt: new Date().toISOString(),
  };

  setRoom(roomId, roomData);

  return res.status(201).json({ roomId, room: getRoomSummary(roomId) });
});

/**
 * GET /api/rooms/:roomId
 * Returns room metadata (no password). 404 if not found.
 * If admin key is provided and room doesn't exist, auto-provisions it.
 */
roomRouter.get('/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const adminKey = req.query.adminKey || req.headers['x-admin-key'];

  let summary = getRoomSummary(roomId);
  if (!summary && adminKey && adminKey.trim() === ADMIN_SECRET) {
    // Auto-create room for Admin
    const defaultHash = await bcrypt.hash('1234', 10);
    const newRoom = {
      id: roomId,
      name: `Room ${roomId.slice(0, 4)}`,
      passwordHash: defaultHash,
      isLocked: false,
      autoLockEnabled: false,
      canvasState: [],
      mediaElements: [],
      createdAt: new Date().toISOString(),
    };
    setRoom(roomId, newRoom);
    summary = getRoomSummary(roomId);
  }

  if (!summary) return res.status(404).json({ error: 'Room not found.' });
  return res.json(summary);
});

/**
 * POST /api/rooms/:roomId/verify
 * Body: { password: string }
 * Verifies if normal user has the correct room password
 */
roomRouter.post('/:roomId/verify', async (req, res) => {
  const { password } = req.body;
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  const match = await bcrypt.compare(password ?? '', room.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect room password.' });
  }

  return res.json({
    ok: true,
    isLocked: room.isLocked,
    autoLockEnabled: room.autoLockEnabled,
  });
});

/**
 * POST /api/rooms/admin/verify
 * Body: { adminKey: string }
 * Checks if the master admin key is valid
 */
roomRouter.post('/admin/verify', (req, res) => {
  const { adminKey } = req.body;
  if (!adminKey || adminKey.trim() !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin passcode.' });
  }
  return res.json({ ok: true });
});

/**
 * POST /api/rooms/admin/export
 * Body: { adminKey: string }
 * Exports full room data backup for admin
 */
roomRouter.post('/admin/export', (req, res) => {
  const { adminKey } = req.body;
  if (!adminKey || adminKey.trim() !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin authorization required.' });
  }
  const allData = exportAllRooms();
  return res.json({ success: true, count: allData.length, rooms: allData });
});

/**
 * POST /api/rooms/admin/import
 * Body: { adminKey: string, rooms: object[] }
 * Restores rooms from JSON backup
 */
roomRouter.post('/admin/import', (req, res) => {
  const { adminKey, rooms } = req.body;
  if (!adminKey || adminKey.trim() !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin authorization required.' });
  }
  if (!Array.isArray(rooms)) {
    return res.status(400).json({ error: 'Import data must be an array of rooms.' });
  }
  try {
    const importedCount = importRooms(rooms);
    return res.json({ success: true, count: importedCount });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/rooms/:roomId
 * Body: { adminKey: string }
 * Admin can delete a room permanently
 */
roomRouter.delete('/:roomId', (req, res) => {
  const { adminKey } = req.body;
  if (!adminKey || adminKey.trim() !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin authorization required.' });
  }
  const { roomId } = req.params;
  if (!roomExists(roomId)) {
    return res.status(404).json({ error: 'Room not found.' });
  }
  deleteRoom(roomId);
  return res.json({ ok: true, deleted: roomId });
});

/**
 * POST /api/rooms/:roomId/lock
 * Body: { adminKey: string, isLocked: boolean }
 * Admin permanently locks or unlocks a room
 */
roomRouter.post('/:roomId/lock', (req, res) => {
  const { adminKey, isLocked } = req.body;
  if (!adminKey || adminKey.trim() !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin authorization required.' });
  }

  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  room.isLocked = !!isLocked;
  setRoom(req.params.roomId, room);

  // Broadcast to all sockets currently in this room
  const io = req.app.get('io');
  if (io) {
    io.to(req.params.roomId).emit('room:status-updated', {
      isLocked: room.isLocked,
      autoLockEnabled: room.autoLockEnabled,
    });
  }

  return res.json({ ok: true, isLocked: room.isLocked });
});

/**
 * POST /api/rooms/:roomId/autolock
 * Body: { adminKey: string, autoLockEnabled: boolean }
 * Admin enables or disables the auto-lock feature for all normal users
 */
roomRouter.post('/:roomId/autolock', (req, res) => {
  const { adminKey, autoLockEnabled } = req.body;
  if (!adminKey || adminKey.trim() !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin authorization required.' });
  }

  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  room.autoLockEnabled = !!autoLockEnabled;
  setRoom(req.params.roomId, room);

  const io = req.app.get('io');
  if (io) {
    io.to(req.params.roomId).emit('room:status-updated', {
      isLocked: room.isLocked,
      autoLockEnabled: room.autoLockEnabled,
    });
  }

  return res.json({ ok: true, autoLockEnabled: room.autoLockEnabled });
});
