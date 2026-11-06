import express from 'express';
import bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';
import { getRoom, setRoom, roomExists, getRoomSummary } from '../store/rooms.js';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

export const roomRouter = express.Router();

/**
 * POST /api/rooms
 * Body: { password: string }
 * Creates a new room, returns { roomId }
 */
roomRouter.post('/', async (req, res) => {
  const { password } = req.body;

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

  setRoom(roomId, {
    id: roomId,
    passwordHash,
    canvasState: [],      // serialised Fabric.js JSON objects
    mediaElements: [],    // YouTube / image overlay records
    createdAt: new Date(),
  });

  return res.status(201).json({ roomId });
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
