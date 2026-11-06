import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket.js';

const CURSOR_COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#4ade80',
  '#60a5fa', '#c084fc', '#f472b6', '#a3e635',
];

/**
 * CursorLayer
 * Shows coloured cursors for each connected peer.
 * Cursors fade out 2 s after the last movement.
 */
export default function CursorLayer() {
  const [cursors, setCursors] = useState({});

  useEffect(() => {
    const socket = getSocket();
    const timers = {};

    socket.on('cursor:move', ({ socketId, x, y }) => {
      setCursors((prev) => ({
        ...prev,
        [socketId]: { x, y, color: pickColor(socketId), opacity: 1 },
      }));

      // Fade out after 2 s of inactivity
      clearTimeout(timers[socketId]);
      timers[socketId] = setTimeout(() => {
        setCursors((prev) => ({
          ...prev,
          [socketId]: { ...prev[socketId], opacity: 0 },
        }));
      }, 2000);
    });

    socket.on('peer:left', ({ socketId }) => {
      setCursors((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    });

    return () => {
      socket.off('cursor:move');
      socket.off('peer:left');
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Object.entries(cursors).map(([id, { x, y, color, opacity }]) => (
        <div
          key={id}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            transform: 'translate(-2px, -2px)',
            opacity,
            transition: 'opacity 0.5s, left 0.05s linear, top 0.05s linear',
            pointerEvents: 'none',
          }}
        >
          {/* SVG cursor arrow */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill={color}>
            <path d="M2 2 L18 10 L10 12 L8 18 Z" stroke="black" strokeWidth="1" />
          </svg>
          <span
            style={{ background: color }}
            className="absolute top-5 left-3 text-black text-[10px] font-bold px-1 rounded whitespace-nowrap"
          >
            {id.slice(0, 6)}
          </span>
        </div>
      ))}
    </div>
  );
}

function pickColor(socketId) {
  let hash = 0;
  for (const ch of socketId) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}
