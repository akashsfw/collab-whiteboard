import express from 'express';
import bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';
import {
  getRoom,
  setRoom,
  roomExists,
  getRoomSummary,
  getAllRoomsSummary,
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
 */
roomRouter.get('/:roomId', (req, res) => {
  const summary = getRoomSummary(req.params.roomId);
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
