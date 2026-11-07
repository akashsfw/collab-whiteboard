import { useRef, useCallback, useState } from 'react';
import { getSocket } from '../lib/socket.js';

/**
 * MediaOverlayLayer
 *
 * Renders YouTube iframes and images as absolutely-positioned DOM overlays.
 * Positions are synchronized with Fabric.js viewport (pan & zoom).
 *
 * Protection rules:
 * - Normal users CANNOT delete media overlays.
 * - Users can minimize/hide overlays.
 * - Only Admins have permanent removal rights (✕).
 */
export default function MediaOverlayLayer({
  elements,
  setElements,
  viewport,
  isEditor,
  isAdmin,
  roomId,
}) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {elements.map((el) => (
        <MediaElement
          key={el.id}
          element={el}
          viewport={viewport}
          isEditor={isEditor}
          isAdmin={isAdmin}
          roomId={roomId}
          onChange={(updated) => {
            setElements((prev) =>
              prev.map((e) => (e.id === updated.id ? updated : e))
            );
            getSocket().emit('media:update', { roomId, element: updated });
          }}
          onRemove={(id) => {
            if (!isAdmin) return; // Only Admin can delete media
            setElements((prev) => prev.filter((e) => e.id !== id));
            getSocket().emit('media:remove', { roomId, elementId: id });
          }}
        />
      ))}
    </div>
  );
}

function MediaElement({ element, viewport, isEditor, isAdmin, onChange, onRemove }) {
  const { x: panX, y: panY, zoom } = viewport;
  const dragRef = useRef(null);
  const [isMinimized, setIsMinimized] = useState(!!element.hidden);

  const screenX = element.x * zoom + panX;
  const screenY = element.y * zoom + panY;
  const screenW = (isMinimized ? 200 : element.width) * zoom;
  const screenH = (isMinimized ? 32 : element.height) * zoom;

  // ── Drag to reposition ──────────────────────────────────────────────────
  const onMouseDown = useCallback(
    (e) => {
      if (!isEditor) return;
      e.preventDefault();
      e.stopPropagation();
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startCanvasX = element.x;
      const startCanvasY = element.y;

      function onMove(ev) {
        const dx = (ev.clientX - startMouseX) / zoom;
        const dy = (ev.clientY - startMouseY) / zoom;
        onChange({ ...element, x: startCanvasX + dx, y: startCanvasY + dy });
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [element, isEditor, onChange, zoom]
  );

  // ── Resize handle ───────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback(
    (e) => {
      if (!isEditor || isMinimized) return;
      e.preventDefault();
      e.stopPropagation();
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startW = element.width;
      const startH = element.height;

      function onMove(ev) {
        const dw = (ev.clientX - startMouseX) / zoom;
        const dh = (ev.clientY - startMouseY) / zoom;
        onChange({
          ...element,
          width: Math.max(160, startW + dw),
          height: Math.max(90, startH + dh),
        });
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [element, isEditor, isMinimized, onChange, zoom]
  );

  return (
    <div
      ref={dragRef}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        width: screenW,
        height: screenH,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
      className="group"
    >
      {/* Header drag & action bar */}
      {isEditor && (
        <div
          onMouseDown={onMouseDown}
          className="absolute -top-7 left-0 right-0 h-7 bg-surface/95 backdrop-blur-md border border-white/10 flex items-center justify-between px-2 rounded-t-lg cursor-move z-10 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
        >
          <span className="text-white text-xs truncate max-w-[140px]">
            {element.type === 'youtube' ? `▶ ${element.videoId}` : '🖼 Image'}
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            {/* Minimize / Hide toggle */}
            <button
              onClick={() => setIsMinimized((prev) => !prev)}
              title={isMinimized ? 'Expand' : 'Minimize'}
              className="text-muted hover:text-white text-xs px-1"
            >
              {isMinimized ? '◻' : '—'}
            </button>
            {/* Delete button: ONLY visible to Admin */}
            {isAdmin && (
              <button
                onClick={() => onRemove(element.id)}
                title="Admin Delete"
                className="text-red-400 hover:text-red-300 text-xs font-bold px-1"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {!isMinimized ? (
        element.type === 'youtube' ? (
          <iframe
            src={`https://www.youtube.com/embed/${element.videoId}?rel=0`}
            title="YouTube video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 4 }}
          />
        ) : element.type === 'image' ? (
          <img
            src={element.url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            draggable={false}
          />
        ) : null
      ) : (
        <div className="w-full h-full bg-surface border border-white/10 rounded flex items-center justify-between px-2 text-xs text-muted">
          <span>{element.type === 'youtube' ? '▶ YouTube (minimized)' : '🖼 Image (minimized)'}</span>
          <button
            onClick={() => setIsMinimized(false)}
            className="text-accent text-[11px] underline"
          >
            Show
          </button>
        </div>
      )}

      {/* Resize handle (Editor only) */}
      {isEditor && !isMinimized && (
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 bg-accent rounded-tl cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}

      {!isEditor && (
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }} />
      )}
    </div>
  );
}
