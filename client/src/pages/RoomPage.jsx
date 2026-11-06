import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchRoom } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import WhiteboardCanvas from '../components/WhiteboardCanvas.jsx';
import Toolbar from '../components/Toolbar.jsx';
import PasswordModal from '../components/PasswordModal.jsx';
import MediaOverlayLayer from '../components/MediaOverlayLayer.jsx';
import CursorLayer from '../components/CursorLayer.jsx';

export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [roomMeta, setRoomMeta] = useState(null);   // null = loading, false = not found
  const [role, setRole] = useState('observer');       // 'observer' | 'editor'
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [authError, setAuthError] = useState('');
  const [copied, setCopied] = useState(false);

  // Shared state between Canvas and MediaOverlayLayer
  const [activeTool, setActiveTool] = useState('select');
  const [activeColor, setActiveColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(4);

  // Initial canvas data received on join
  const [initialCanvas, setInitialCanvas] = useState(null);
  const [mediaElements, setMediaElements] = useState([]);

  // Viewport state for overlay sync (pan/zoom from Fabric)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  const canvasRef = useRef(null); // exposed from WhiteboardCanvas

  // ── 1. Verify room exists ──────────────────────────────────────────────────
  useEffect(() => {
    fetchRoom(roomId).then((data) => {
      if (!data) {
        setRoomMeta(false);
      } else {
        setRoomMeta(data);
      }
    });
  }, [roomId]);

  // ── 2. Connect socket and join room ───────────────────────────────────────
  useEffect(() => {
    if (!roomMeta) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    socket.emit('room:join', { roomId });

    socket.on('room:joined', ({ role: r, canvasState, mediaElements: me }) => {
      setRole(r);
      setInitialCanvas(canvasState);
      setMediaElements(me || []);
    });

    socket.on('auth:result', ({ success, role: r, message }) => {
      if (success) {
        setRole(r);
        setShowPasswordModal(false);
        setAuthError('');
      } else {
        setAuthError(message || 'Incorrect password.');
      }
    });

    // Media overlay events
    socket.on('media:add', ({ element }) => setMediaElements((prev) => [...prev, element]));
    socket.on('media:update', ({ element }) =>
      setMediaElements((prev) => prev.map((el) => (el.id === element.id ? { ...el, ...element } : el)))
    );
    socket.on('media:remove', ({ elementId }) =>
      setMediaElements((prev) => prev.filter((el) => el.id !== elementId))
    );

    // Viewport sync from peers
    socket.on('viewport:change', (vp) => setViewport(vp));

    return () => {
      socket.off('room:joined');
      socket.off('auth:result');
      socket.off('media:add');
      socket.off('media:update');
      socket.off('media:remove');
      socket.off('viewport:change');
    };
  }, [roomId, roomMeta]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handlePasswordSubmit(password) {
    setAuthError('');
    getSocket().emit('room:authenticate', { roomId, password });
  }

  function handleAddYoutube() {
    const url = prompt('Paste a YouTube URL:');
    if (!url) return;
    const videoId = extractYouTubeId(url);
    if (!videoId) { alert('Could not parse YouTube URL.'); return; }
    const element = {
      id: crypto.randomUUID(),
      type: 'youtube',
      videoId,
      x: 100, y: 100, width: 480, height: 270,
    };
    setMediaElements((prev) => [...prev, element]);
    getSocket().emit('media:add', { roomId, element });
  }

  if (roomMeta === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-muted text-lg">
        Loading room…
      </div>
    );
  }

  if (roomMeta === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-canvas gap-4">
        <p className="text-red-400 text-xl font-semibold">Room not found.</p>
        <button
          onClick={() => navigate('/')}
          className="bg-accent hover:bg-accent-hover text-white px-6 py-2 rounded-lg"
        >
          Back to Home
        </button>
      </div>
    );
  }

  const isEditor = role === 'editor';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-canvas">
      {/* ── Top Bar (Mobile-responsive) ─────────────────────────────────── */}
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 bg-surface border-b border-white/10 z-20 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-white font-bold text-base sm:text-lg shrink-0">
            Collab<span className="text-accent">Board</span>
          </span>
          <span className="hidden sm:inline text-muted text-xs font-mono bg-canvas px-2 py-1 rounded truncate max-w-[120px]">
            {roomId}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Role badge */}
          <span
            className={`text-[11px] sm:text-xs font-semibold px-2 sm:px-3 py-1 rounded-full shrink-0 ${
              isEditor
                ? 'bg-green-900/60 text-green-300 border border-green-700'
                : 'bg-yellow-900/60 text-yellow-300 border border-yellow-700'
            }`}
          >
            {isEditor ? '✏️ Editor' : '👁️ Observer'}
          </span>

          {/* Copy link */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            title="Copy Room Link"
            className="text-xs text-muted hover:text-white border border-white/10 px-2 sm:px-3 py-1 rounded-lg transition-colors flex items-center gap-1 shrink-0"
          >
            <span>{copied ? '✓' : '🔗'}</span>
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy Link'}</span>
          </button>

          {/* Enter editor mode */}
          {!isEditor && (
            <button
              onClick={() => setShowPasswordModal(true)}
              className="bg-accent hover:bg-accent-hover text-white text-xs sm:text-sm font-medium px-2.5 sm:px-4 py-1.5 rounded-lg transition-colors shrink-0"
            >
              🔑 <span className="hidden sm:inline">Enter Password to </span>Edit
            </button>
          )}
        </div>
      </header>

      {/* ── Main Area ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Toolbar (editor-only) */}
        {isEditor && (
          <Toolbar
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            activeColor={activeColor}
            setActiveColor={setActiveColor}
            brushSize={brushSize}
            setBrushSize={setBrushSize}
            canvasRef={canvasRef}
            roomId={roomId}
            onAddYoutube={handleAddYoutube}
          />
        )}

        {/* Canvas + Overlay wrapper with dynamic infinite dot grid */}
        <div
          className="relative flex-1 overflow-hidden"
          style={{
            backgroundColor: '#1e1e2e',
            backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.16) 1.2px, transparent 1.2px)',
            backgroundSize: `${Math.max(12, 28 * (viewport.zoom || 1))}px ${Math.max(12, 28 * (viewport.zoom || 1))}px`,
            backgroundPosition: `${viewport.x || 0}px ${viewport.y || 0}px`,
          }}
        >
          <WhiteboardCanvas
            ref={canvasRef}
            roomId={roomId}
            isEditor={isEditor}
            activeTool={activeTool}
            activeColor={activeColor}
            brushSize={brushSize}
            initialCanvas={initialCanvas}
            onViewportChange={(vp) => {
              setViewport(vp);
              if (isEditor) getSocket().emit('viewport:change', vp);
            }}
          />

          {/* YouTube / image overlays positioned relative to canvas */}
          <MediaOverlayLayer
            elements={mediaElements}
            setElements={setMediaElements}
            viewport={viewport}
            isEditor={isEditor}
            roomId={roomId}
          />

          {/* Live cursors */}
          <CursorLayer />

          {/* Infinite Viewport Controls (Zoom In, Zoom Out, Recenter) */}
          <div className="absolute bottom-16 md:bottom-4 right-3 md:right-4 z-20 flex items-center bg-surface/90 backdrop-blur-md border border-white/10 rounded-xl shadow-xl text-xs text-muted select-none">
            <button
              onClick={() => canvasRef.current?.zoomOut()}
              title="Zoom Out (−)"
              className="hover:text-white px-2.5 py-1.5 transition-colors font-bold text-sm"
            >
              −
            </button>
            <button
              onClick={() => canvasRef.current?.resetView()}
              title="Click to Recenter view to 100%"
              className="hover:text-white px-2 py-1.5 border-x border-white/10 font-mono text-[11px] transition-colors"
            >
              {Math.round((viewport.zoom || 1) * 100)}% ⊙
            </button>
            <button
              onClick={() => canvasRef.current?.zoomIn()}
              title="Zoom In (+)"
              className="hover:text-white px-2.5 py-1.5 transition-colors font-bold text-sm"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Password Modal */}
      {showPasswordModal && (
        <PasswordModal
          error={authError}
          onSubmit={handlePasswordSubmit}
          onClose={() => { setShowPasswordModal(false); setAuthError(''); }}
        />
      )}
    </div>
  );
}

// ── Helper ─────────────────────────────────────────────────────────────────────
function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
