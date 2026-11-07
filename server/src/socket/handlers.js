import bcrypt from 'bcryptjs';
import { getRoom, setRoom, roomExists } from '../store/rooms.js';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin2026';

/**
 * Per-socket role map: socketId → { roomId, role: 'observer'|'editor'|'admin' }
 */
const socketRoles = new Map();

/** True only if socket has role === 'admin' */
function isAdmin(socket) {
  const entry = socketRoles.get(socket.id);
  return entry?.role === 'admin';
}

/**
 * True if socket is permitted to make modifications:
 * - Admin can ALWAYS edit.
 * - Editor can edit ONLY IF room is NOT locked and NOT autolocked.
 * - Observer can NEVER edit.
 */
function canEdit(socket) {
  const entry = socketRoles.get(socket.id);
  if (!entry) return false;
  if (entry.role === 'admin') return true;
  if (entry.role !== 'editor') return false;

  const room = getRoom(entry.roomId);
  if (!room) return false;
  if (room.isLocked || room.autoLockEnabled) return false;

  return true;
}

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    // ── JOIN ROOM ────────────────────────────────────────────────────────────
    socket.on('room:join', async ({ roomId, adminKey } = {}) => {
      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required.' });
        return;
      }

      const isValidAdmin = !!(adminKey && adminKey.trim() === ADMIN_SECRET);

      // Auto-provision room if admin joins a missing room ID
      if (!roomExists(roomId)) {
        if (isValidAdmin) {
          const defaultHash = await bcrypt.hash('1234', 10);
          setRoom(roomId, {
            id: roomId,
            name: `Room ${roomId.slice(0, 4)}`,
            passwordHash: defaultHash,
            isLocked: false,
            autoLockEnabled: false,
            canvasState: [],
            mediaElements: [],
            createdAt: new Date().toISOString(),
          });
          console.log(`[socket] Admin auto-provisioned room ${roomId}`);
        } else {
          socket.emit('error', { message: 'Room not found.' });
          return;
        }
      }

      socket.join(roomId);
      const room = getRoom(roomId);
      const role = isValidAdmin ? 'admin' : 'observer';

      socketRoles.set(socket.id, { roomId, role });

      socket.emit('room:joined', {
        role,
        roomName: room.name || `Room ${roomId.slice(0, 4)}`,
        isLocked: !!room.isLocked,
        autoLockEnabled: !!room.autoLockEnabled,
        canvasState: room.canvasState,
        mediaElements: room.mediaElements,
      });

      console.log(`[socket] ${socket.id} joined room ${roomId} as ${role}`);
    });

    // ── AUTHENTICATE AS NORMAL EDITOR ────────────────────────────────────────
    socket.on('room:authenticate', async ({ roomId, password } = {}) => {
      const entry = socketRoles.get(socket.id);
      if (!entry || entry.roomId !== roomId) {
        socket.emit('auth:result', { success: false, message: 'Join the room first.' });
        return;
      }

      const room = getRoom(roomId);
      if (!room) {
        socket.emit('auth:result', { success: false, message: 'Room not found.' });
        return;
      }

      // Check room lock status
      if (room.isLocked || room.autoLockEnabled) {
        socket.emit('auth:result', {
          success: false,
          message: 'This room is currently locked by the administrator.',
          isLocked: room.isLocked,
          autoLockEnabled: room.autoLockEnabled,
        });
        return;
      }

      const match = await bcrypt.compare(password ?? '', room.passwordHash);
      if (!match) {
        socket.emit('auth:result', { success: false, message: 'Incorrect room password.' });
        return;
      }

      socketRoles.set(socket.id, { roomId, role: 'editor' });
      socket.emit('auth:result', {
        success: true,
        role: 'editor',
        isLocked: room.isLocked,
        autoLockEnabled: room.autoLockEnabled,
      });
      console.log(`[socket] ${socket.id} authenticated as editor in room ${roomId}`);
    });

    // ── AUTHENTICATE AS MASTER ADMIN ─────────────────────────────────────────
    socket.on('room:admin-auth', ({ roomId, adminKey } = {}) => {
      const entry = socketRoles.get(socket.id);
      if (!entry || entry.roomId !== roomId) {
        socket.emit('auth:result', { success: false, message: 'Join the room first.' });
        return;
      }

      const room = getRoom(roomId);
      if (!room) {
        socket.emit('auth:result', { success: false, message: 'Room not found.' });
        return;
      }

      if (!adminKey || adminKey.trim() !== ADMIN_SECRET) {
        socket.emit('auth:result', { success: false, message: 'Invalid admin passcode.' });
        return;
      }

      socketRoles.set(socket.id, { roomId, role: 'admin' });
      socket.emit('auth:result', {
        success: true,
        role: 'admin',
        isLocked: room.isLocked,
        autoLockEnabled: room.autoLockEnabled,
      });
      console.log(`[socket] ${socket.id} elevated to ADMIN in room ${roomId}`);
    });

    // ── ADMIN: TOGGLE ROOM LOCK ──────────────────────────────────────────────
    socket.on('room:toggle-lock', ({ roomId, isLocked } = {}) => {
      if (!isAdmin(socket)) return;
      const room = getRoom(roomId);
      if (!room) return;

      room.isLocked = !!isLocked;
      setRoom(roomId, room);

      io.to(roomId).emit('room:status-updated', {
        isLocked: room.isLocked,
        autoLockEnabled: room.autoLockEnabled,
      });
      console.log(`[socket] Room ${roomId} lock toggled to ${room.isLocked} by admin`);
    });

    // ── ADMIN: TOGGLE AUTO-LOCK ──────────────────────────────────────────────
    socket.on('room:toggle-autolock', ({ roomId, autoLockEnabled } = {}) => {
      if (!isAdmin(socket)) return;
      const room = getRoom(roomId);
      if (!room) return;

      room.autoLockEnabled = !!autoLockEnabled;
      setRoom(roomId, room);

      io.to(roomId).emit('room:status-updated', {
        isLocked: room.isLocked,
        autoLockEnabled: room.autoLockEnabled,
      });
      console.log(`[socket] Room ${roomId} autolock toggled to ${room.autoLockEnabled} by admin`);
    });

    // ── CANVAS: FULL STATE SYNC (Checkpoints, Undo/Redo) ────────────────────
    socket.on('canvas:sync', ({ roomId, canvasJSON } = {}) => {
      if (!canEdit(socket)) return;

      const room = getRoom(roomId);
      if (!room) return;

      room.canvasState = canvasJSON;
      setRoom(roomId, room);

      socket.to(roomId).emit('canvas:sync', { canvasJSON });
    });

    // ── CANVAS: INCREMENTAL OBJECT ADD ───────────────────────────────────────
    socket.on('canvas:object:added', (payload) => {
      if (!canEdit(socket)) return;
      const { roomId } = socketRoles.get(socket.id) ?? {};
      if (!roomId || !payload?.object) return;

      const room = getRoom(roomId);
      if (room) {
        if (!room.canvasState || typeof room.canvasState !== 'object') {
          room.canvasState = { objects: [] };
        }
        if (Array.isArray(room.canvasState)) {
          room.canvasState = { objects: room.canvasState };
        }
        if (!Array.isArray(room.canvasState.objects)) {
          room.canvasState.objects = [];
        }

        const existingIdx = room.canvasState.objects.findIndex((o) => o?.id && o.id === payload.object.id);
        if (existingIdx >= 0) {
          room.canvasState.objects[existingIdx] = payload.object;
        } else {
          room.canvasState.objects.push(payload.object);
        }
        setRoom(roomId, room);
      }

      socket.to(roomId).emit('canvas:object:added', payload);
    });

    // ── CANVAS: INCREMENTAL OBJECT MODIFIED ──────────────────────────────────
    socket.on('canvas:object:modified', (payload) => {
      if (!canEdit(socket)) return;
      const { roomId } = socketRoles.get(socket.id) ?? {};
      if (!roomId || !payload?.object?.id) return;

      const room = getRoom(roomId);
      if (room && room.canvasState?.objects) {
        const idx = room.canvasState.objects.findIndex((o) => o?.id === payload.object.id);
        if (idx >= 0) {
          room.canvasState.objects[idx] = payload.object;
          setRoom(roomId, room);
        }
      }

      socket.to(roomId).emit('canvas:object:modified', payload);
    });

    // ── CANVAS: INCREMENTAL OBJECT REMOVAL ───────────────────────────────────
    socket.on('canvas:object:removed', (payload) => {
      if (!isAdmin(socket)) return;
      const { roomId } = socketRoles.get(socket.id) ?? {};
      if (!roomId) return;

      const room = getRoom(roomId);
      if (room && payload?.objectId && room.canvasState?.objects) {
        room.canvasState.objects = room.canvasState.objects.filter((o) => o?.id !== payload.objectId);
        setRoom(roomId, room);
      }

      socket.to(roomId).emit('canvas:object:removed', payload);
    });

    // ── MEDIA: YouTube / Image Overlay ───────────────────────────────────────
    socket.on('media:add', (payload) => {
      if (!canEdit(socket)) return;
      const room = getRoom(payload?.roomId);
      if (!room) return;

      room.mediaElements.push(payload.element);
      setRoom(payload.roomId, room);

      socket.to(payload.roomId).emit('media:add', { element: payload.element });
    });

    socket.on('media:update', (payload) => {
      if (!canEdit(socket)) return;
      const room = getRoom(payload?.roomId);
      if (!room) return;

      room.mediaElements = room.mediaElements.map((el) =>
        el.id === payload.element.id ? { ...el, ...payload.element } : el
      );
      setRoom(payload.roomId, room);

      socket.to(payload.roomId).emit('media:update', { element: payload.element });
    });

    // Media removal: only admin can completely remove media overlays
    socket.on('media:remove', ({ roomId, elementId } = {}) => {
      if (!isAdmin(socket)) return;
      const room = getRoom(roomId);
      if (!room) return;

      room.mediaElements = room.mediaElements.filter((el) => el.id !== elementId);
      setRoom(roomId, room);

      socket.to(roomId).emit('media:remove', { elementId });
    });

    // ── VIEWPORT SYNC (pan / zoom) ───────────────────────────────────────────
    socket.on('viewport:change', (payload) => {
      if (!canEdit(socket)) return;
      const { roomId } = socketRoles.get(socket.id) ?? {};
      if (!roomId) return;
      socket.to(roomId).emit('viewport:change', payload);
    });

    // ── CURSOR PRESENCE ──────────────────────────────────────────────────────
    socket.on('cursor:move', ({ x, y } = {}) => {
      const { roomId } = socketRoles.get(socket.id) ?? {};
      if (!roomId) return;
      socket.to(roomId).emit('cursor:move', { socketId: socket.id, x, y });
    });

    // ── DISCONNECT ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const entry = socketRoles.get(socket.id);
      if (entry?.roomId) {
        io.to(entry.roomId).emit('peer:left', { socketId: socket.id });
      }
      socketRoles.delete(socket.id);
    });
  });
}
