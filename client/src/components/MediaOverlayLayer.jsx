import { useRef, useCallback } from 'react';
import { getSocket } from '../lib/socket.js';

/**
 * MediaOverlayLayer
 *
 * Renders YouTube iframes and image URLs as absolutely-positioned DOM elements
 * that sit on top of the Fabric.js canvas. Their pixel positions are computed
 * by applying the current Fabric viewport transform (pan + zoom) to their
 * canvas-space coordinates so they stay perfectly in sync.
 *
 * Key formula:
 *   screenX = canvasX * zoom + panX
 *   screenY = canvasY * zoom + panY
 *   screenW = width  * zoom
 *   screenH = height * zoom
 */
export default function MediaOverlayLayer({
  elements,
  setElements,
  viewport,       // { x (panX), y (panY), zoom }
  isEditor,
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
          roomId={roomId}
          onChange={(updated) => {
            setElements((prev) =>
              prev.map((e) => (e.id === updated.id ? updated : e))
            );
            getSocket().emit('media:update', { roomId, element: updated });
          }}
          onRemove={(id) => {
            setElements((prev) => prev.filter((e) => e.id !== id));
            getSocket().emit('media:remove', { roomId, elementId: id });
          }}
        />
      ))}
    </div>
  );
}

// ── Individual Media Element ────────────────────────────────────────────────────
function MediaElement({ element, viewport, isEditor, onChange, onRemove }) {
  const { x: panX, y: panY, zoom } = viewport;
  const dragRef = useRef(null);

  // Convert canvas-space → screen-space
  const screenX = element.x * zoom + panX;
  const screenY = element.y * zoom + panY;
  const screenW = element.width * zoom;
  const screenH = element.height * zoom;

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
      if (!isEditor) return;
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
    [element, isEditor, onChange, zoom]
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
      {/* Header drag bar */}
      {isEditor && (
        <div
          onMouseDown={onMouseDown}
          className="absolute -top-6 left-0 right-0 h-6 bg-black/70 flex items-center justify-between px-2 rounded-t-lg cursor-move z-10 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <span className="text-white text-xs truncate">
            {element.type === 'youtube' ? `▶ youtube: ${element.videoId}` : '🖼 image'}
          </span>
          <button
            onClick={() => onRemove(element.id)}
            className="text-red-400 hover:text-red-300 text-xs font-bold ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Content */}
      {element.type === 'youtube' ? (
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
      ) : null}

      {/* Resize handle */}
      {isEditor && (
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 bg-accent rounded-tl cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}

      {/* Observer overlay — prevents click-jacking on iframes */}
      {!isEditor && (
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }} />
      )}
    </div>
  );
}
