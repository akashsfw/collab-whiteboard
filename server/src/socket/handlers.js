import bcrypt from 'bcryptjs';
import { getRoom, setRoom, roomExists } from '../store/rooms.js';

/**
 * Per-socket role map: socketId → { roomId, role: 'observer'|'editor' }
 * Stored in process memory — good enough for a single-node server.
 */
const socketRoles = new Map(); // socketId → { roomId, role }

/** True only when the socket has role === 'editor' in its current room. */
function isEditor(socket) {
  const entry = socketRoles.get(socket.id);
  return entry?.role === 'editor';
}

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[socket] connected  ${socket.id}`);

    // ── JOIN ROOM ────────────────────────────────────────────────────────────
    // Client emits: { roomId }
    // Server responds: { canvasState, mediaElements, role }
    socket.on('room:join', ({ roomId } = {}) => {
      if (!roomId || !roomExists(roomId)) {
        socket.emit('error', { message: 'Room not found.' });
        return;
      }

      socket.join(roomId);
      socketRoles.set(socket.id, { roomId, role: 'observer' });

      const room = getRoom(roomId);
      // Send current canvas snapshot to the newcomer only
      socket.emit('room:joined', {
        role: 'observer',
        canvasState: room.canvasState,
        mediaElements: room.mediaElements,
      });

      console.log(`[socket] ${socket.id} joined room ${roomId} as observer`);
    });

    // ── AUTHENTICATE (Upgrade to Editor) ─────────────────────────────────────
    // Client emits: { roomId, password }
    // Server responds: { success, role }
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

      const match = await bcrypt.compare(password ?? '', room.passwordHash);
      if (!match) {
        socket.emit('auth:result', { success: false, message: 'Incorrect password.' });
        return;
      }

      // Upgrade role
      socketRoles.set(socket.id, { roomId, role: 'editor' });
      socket.emit('auth:result', { success: true, role: 'editor' });
      console.log(`[socket] ${socket.id} upgraded to editor in room ${roomId}`);
    });

    // ── CANVAS: FULL STATE SYNC ──────────────────────────────────────────────
    // Editor emits a full Fabric.js JSON export so late-joiners get correct state.
    // Event: { roomId, canvasJSON }
    socket.on('canvas:sync', ({ roomId, canvasJSON } = {}) => {
      if (!isEditor(socket)) return; // silently drop from non-editors

      const room = getRoom(roomId);
      if (!room) return;

      room.canvasState = canvasJSON; // persist on server
      setRoom(roomId, room);

      // Broadcast to everyone else in the room
      socket.to(roomId).emit('canvas:sync', { canvasJSON });
    });

    // ── CANVAS: INCREMENTAL OBJECT ADD / MODIFY / DELETE ────────────────────
    // These are lightweight deltas so the server doesn't have to re-parse the whole canvas.
    ['canvas:object:added', 'canvas:object:modified', 'canvas:object:removed'].forEach(
      (event) => {
        socket.on(event, (payload) => {
          if (!isEditor(socket)) return;
          const { roomId } = socketRoles.get(socket.id) ?? {};
          if (!roomId) return;
          socket.to(roomId).emit(event, payload);
        });
      }
    );

    // ── CANVAS: FREE-DRAW PATH STREAMING ────────────────────────────────────
    // Real-time stroke preview while drawing (before mouseUp).
    socket.on('canvas:draw:path', (payload) => {
      if (!isEditor(socket)) return;
      const { roomId } = socketRoles.get(socket.id) ?? {};
      if (!roomId) return;
      socket.to(roomId).emit('canvas:draw:path', payload);
    });

    // ── MEDIA: YouTube / Image Overlay ───────────────────────────────────────
    // Payloads: { roomId, element: { id, type, url, x, y, width, height } }
    socket.on('media:add', (payload) => {
      if (!isEditor(socket)) return;
      const room = getRoom(payload?.roomId);
      if (!room) return;

      room.mediaElements.push(payload.element);
      setRoom(payload.roomId, room);

      socket.to(payload.roomId).emit('media:add', { element: payload.element });
    });

    socket.on('media:update', (payload) => {
      if (!isEditor(socket)) return;
      const room = getRoom(payload?.roomId);
      if (!room) return;

      room.mediaElements = room.mediaElements.map((el) =>
        el.id === payload.element.id ? { ...el, ...payload.element } : el
      );
      setRoom(payload.roomId, room);

      socket.to(payload.roomId).emit('media:update', { element: payload.element });
    });

    socket.on('media:remove', ({ roomId, elementId } = {}) => {
      if (!isEditor(socket)) return;
      const room = getRoom(roomId);
      if (!room) return;

      room.mediaElements = room.mediaElements.filter((el) => el.id !== elementId);
      setRoom(roomId, room);

      socket.to(roomId).emit('media:remove', { elementId });
    });

    // ── VIEWPORT SYNC (pan / zoom) ───────────────────────────────────────────
    // Optionally broadcast viewport to sync YouTube overlay positions.
    socket.on('viewport:change', (payload) => {
      if (!isEditor(socket)) return;
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
      console.log(`[socket] disconnected ${socket.id}`);
    });
  });
}
