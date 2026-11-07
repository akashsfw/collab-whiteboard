import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { roomRouter } from './routes/rooms.js';
import { registerSocketHandlers } from './socket/handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../../client/dist');

const app = express();
const httpServer = createServer(app);

// ── Middleware ────────────────────────────────────────────────────────────────
// Allow all origins in production/tunnel, or specific CLIENT_ORIGIN if set
const corsOrigin = process.env.CLIENT_ORIGIN || true;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '20mb' })); // allow base64 image uploads

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
  maxHttpBufferSize: 20e6, // 20 MB for image payloads
});

app.set('io', io);
registerSocketHandlers(io);

// ── REST Routes ───────────────────────────────────────────────────────────────
app.use('/api/rooms', roomRouter);

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── Serve Production Client if built ──────────────────────────────────────────
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀  Whiteboard server listening on http://localhost:${PORT}`);
});
