import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { roomRouter } from './routes/rooms.js';
import { registerSocketHandlers } from './socket/handlers.js';

const app = express();
const httpServer = createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '20mb' })); // allow base64 image uploads

// ── REST Routes ───────────────────────────────────────────────────────────────
app.use('/api/rooms', roomRouter);

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
  maxHttpBufferSize: 20e6, // 20 MB for image payloads
});

registerSocketHandlers(io);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`🚀  Whiteboard server listening on http://localhost:${PORT}`);
});
