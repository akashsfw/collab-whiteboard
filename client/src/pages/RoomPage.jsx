import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchRoom, createRoom, verifyAdminKey } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import WhiteboardCanvas from '../components/WhiteboardCanvas.jsx';
import Toolbar from '../components/Toolbar.jsx';
import PasswordModal from '../components/PasswordModal.jsx';
import MediaOverlayLayer from '../components/MediaOverlayLayer.jsx';
import CursorLayer from '../components/CursorLayer.jsx';

function getStoredAdminKey() {
  return localStorage.getItem('adminKey') || sessionStorage.getItem('adminKey') || '';
}

function storeAdminKey(key) {
  if (key) {
    localStorage.setItem('adminKey', key);
    sessionStorage.setItem('adminKey', key);
  } else {
    localStorage.removeItem('adminKey');
    sessionStorage.removeItem('adminKey');
  }
}

export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [roomMeta, setRoomMeta] = useState(null);       // null = loading, false = not found
  const [role, setRole] = useState('observer');           // 'observer' | 'editor' | 'admin'
  const [isLocked, setIsLocked] = useState(false);       // Admin permanent lock
  const [autoLockEnabled, setAutoLockEnabled] = useState(false); // Auto-lock for all normal users
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordModalTab, setPasswordModalTab] = useState('user'); // 'user' | 'admin'
  const [authError, setAuthError] = useState('');
  const [copied, setCopied] = useState(false);

  // Claim/setup room state when roomMeta === false
  const [claimPassword, setClaimPassword] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claimLoading, setClaimLoading] = useState(false);

  // Shared state between Canvas and MediaOverlayLayer
  const [activeTool, setActiveTool] = useState('select');
  const [activeColor, setActiveColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(4);

  // Initial canvas data received on join
  const [initialCanvas, setInitialCanvas] = useState(null);
  const [mediaElements, setMediaElements] = useState([]);

  // Viewport state for overlay sync (pan/zoom from Fabric)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  const canvasRef = useRef(null);

  // ── 1. Verify room exists ──────────────────────────────────────────────────
  useEffect(() => {
    loadRoomData();
  }, [roomId]);

  function loadRoomData() {
    const adminKey = getStoredAdminKey();
    fetchRoom(roomId, adminKey).then((data) => {
      if (!data) {
        setRoomMeta(false);
      } else {
        setRoomMeta(data);
        setIsLocked(!!data.isLocked);
        setAutoLockEnabled(!!data.autoLockEnabled);
      }
    });
  }

  // ── 2. Connect socket and join room ───────────────────────────────────────
  useEffect(() => {
    if (!roomMeta) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const storedAdminKey = getStoredAdminKey();

    // Join room with optional admin key
    socket.emit('room:join', { roomId, adminKey: storedAdminKey });

    socket.on('room:joined', ({ role: r, isLocked: il, autoLockEnabled: al, canvasState, mediaElements: me }) => {
      setRole(r);
      setIsLocked(il);
      setAutoLockEnabled(al);
      setInitialCanvas(canvasState);
      setMediaElements(me || []);
    });

    socket.on('auth:result', ({ success, role: r, message, isLocked: il, autoLockEnabled: al }) => {
      if (success) {
        setRole(r);
        if (il !== undefined) setIsLocked(il);
        if (al !== undefined) setAutoLockEnabled(al);
        setShowPasswordModal(false);
        setAuthError('');
      } else {
        setAuthError(message || 'Incorrect password.');
      }
    });

    socket.on('room:status-updated', ({ isLocked: il, autoLockEnabled: al }) => {
      setIsLocked(il);
      setAutoLockEnabled(al);
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
      socket.off('room:status-updated');
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

  function handleAdminSubmit(adminKey) {
    setAuthError('');
    getSocket().emit('room:admin-auth', { roomId, adminKey });
    storeAdminKey(adminKey);
  }

  function handleAdminLogout() {
    storeAdminKey('');
    setRole('observer');
    getSocket().emit('room:join', { roomId, adminKey: '' });
  }

  function handleToggleLock() {
    getSocket().emit('room:toggle-lock', { roomId, isLocked: !isLocked });
  }

  function handleToggleAutoLock() {
    getSocket().emit('room:toggle-autolock', { roomId, autoLockEnabled: !autoLockEnabled });
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

  // Claim/initialize room handlers when room doesn't exist yet
  async function handleClaimRoom(e) {
    e.preventDefault();
    setClaimError('');
    if (claimPassword.trim().length < 4) {
      setClaimError('Password must be at least 4 characters.');
      return;
    }
    setClaimLoading(true);
    try {
      await createRoom({
        roomId,
        name: `Room ${roomId.slice(0, 4)}`,
        password: claimPassword.trim(),
        autoLockEnabled: false,
      });
      loadRoomData();
    } catch (err) {
      setClaimError(err.message || 'Failed to initialize room.');
    } finally {
      setClaimLoading(false);
    }
  }

  async function handleClaimAsAdmin(adminKey) {
    try {
      await verifyAdminKey(adminKey);
      storeAdminKey(adminKey);
      // Auto-provision room with admin key
      await fetchRoom(roomId, adminKey);
      loadRoomData();
    } catch (err) {
      alert(`Admin validation failed: ${err.message}`);
    }
  }

  if (roomMeta === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-muted text-lg">
        Loading room…
      </div>
    );
  }

  // ── Room Not Found / Setup Card ───────────────────────────────────────────
  if (roomMeta === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-canvas px-4 py-8">
        <div className="bg-surface border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-8 max-w-md w-full flex flex-col gap-5">
          <div className="text-center">
            <span className="text-4xl">🎨</span>
            <h2 className="text-xl font-bold text-white mt-2">Room Not Active</h2>
            <p className="text-muted text-xs mt-1">
              Room ID: <span className="text-accent font-mono font-bold">{roomId}</span>
            </p>
            <p className="text-muted text-xs mt-2">
              This room has not been initialized on the server yet. You can start it right now to draw or regain access.
            </p>
          </div>

          {/* Form to start room */}
          <form onSubmit={handleClaimRoom} className="space-y-3 border-t border-white/10 pt-4">
            <label className="block text-xs font-semibold text-muted">
              Set Password to Initialize this Room:
            </label>
            <input
              type="password"
              placeholder="Min. 4 characters"
              value={claimPassword}
              onChange={(e) => setClaimPassword(e.target.value)}
              className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {claimError && <p className="text-red-400 text-xs">{claimError}</p>}
            <button
              type="submit"
              disabled={claimLoading}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {claimLoading ? 'Initializing Room…' : '✦ Initialize & Enter Room'}
            </button>
          </form>

          {/* Admin one-click provision */}
          <div className="border-t border-white/10 pt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                const key = prompt('Enter Master Admin Passcode:');
                if (key) handleClaimAsAdmin(key.trim());
              }}
              className="w-full bg-purple-700 hover:bg-purple-600 text-white font-semibold py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <span>👑</span> Open / Initialize as Master Admin
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full border border-white/10 hover:border-white/20 text-muted hover:text-white py-2 rounded-lg text-xs transition-colors"
            >
              ← Back to All Rooms
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = role === 'admin';
  // Normal editors are blocked from editing if the room is locked or autolocked
  const isEditingAllowed = isAdmin || (role === 'editor' && !isLocked && !autoLockEnabled);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-canvas">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 bg-surface border-b border-white/10 z-20 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => navigate('/')}
            title="Back to All Rooms"
            className="text-white font-bold text-base sm:text-lg hover:text-accent transition-colors shrink-0"
          >
            ← Collab<span className="text-accent">Board</span>
          </button>
          <span className="hidden sm:inline text-muted text-xs font-mono bg-canvas px-2 py-1 rounded truncate max-w-[160px]">
            {roomMeta?.name || roomId}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 flex-wrap">
          {/* Status Badges */}
          {isLocked && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-950/80 text-red-300 border border-red-700">
              🔒 Locked
            </span>
          )}
          {autoLockEnabled && !isLocked && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700">
              ⏱️ Auto-Lock
            </span>
          )}

          {/* Role badge */}
          <span
            className={`text-[11px] sm:text-xs font-semibold px-2 sm:px-3 py-1 rounded-full shrink-0 ${
              isAdmin
                ? 'bg-purple-900/70 text-purple-200 border border-purple-500 font-bold'
                : isEditingAllowed
                ? 'bg-green-900/60 text-green-300 border border-green-700'
                : 'bg-yellow-900/60 text-yellow-300 border border-yellow-700'
            }`}
          >
            {isAdmin ? '👑 Admin' : isEditingAllowed ? '✏️ Editor' : '👁️ Observer'}
          </span>

          {/* Copy link */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            title="Copy Room Link"
            className="text-xs text-muted hover:text-white border border-white/10 px-2 sm:px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 shrink-0"
          >
            <span>{copied ? '✓' : '🔗'}</span>
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          {/* If NOT Admin: Show Admin Login & Password Unlock buttons */}
          {!isAdmin ? (
            <div className="flex items-center gap-1.5">
              {role !== 'editor' && !isLocked && !autoLockEnabled && (
                <button
                  onClick={() => { setPasswordModalTab('user'); setShowPasswordModal(true); setAuthError(''); }}
                  className="bg-accent hover:bg-accent-hover text-white text-xs font-medium px-2.5 py-1 rounded-lg transition-colors shrink-0"
                >
                  🔑 Edit
                </button>
              )}
              <button
                onClick={() => { setPasswordModalTab('admin'); setShowPasswordModal(true); setAuthError(''); }}
                className="bg-surface border border-purple-500/40 text-purple-300 hover:bg-purple-900/40 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 shrink-0"
              >
                <span>👑</span> Admin
              </button>
            </div>
          ) : (
            /* Admin controls in room header */
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleToggleLock}
                className={`text-xs px-2 py-1 rounded-lg font-medium border transition-colors ${
                  isLocked
                    ? 'bg-red-950/50 border-red-700 text-red-300'
                    : 'border-white/10 text-muted hover:text-white'
                }`}
                title="Admin permanent lock"
              >
                {isLocked ? '🔓 Unlock' : '🔒 Lock'}
              </button>
              <button
                onClick={handleToggleAutoLock}
                className={`text-xs px-2 py-1 rounded-lg font-medium border transition-colors ${
                  autoLockEnabled
                    ? 'bg-amber-950/50 border-amber-700 text-amber-300'
                    : 'border-white/10 text-muted hover:text-white'
                }`}
                title="Admin auto-lock for normal users"
              >
                ⏱️ AutoLock
              </button>
              <button
                onClick={handleAdminLogout}
                className="text-[11px] text-muted hover:text-white border border-white/10 px-2 py-1 rounded-lg transition-colors"
              >
                Exit Admin
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Lock Warning Banner for Non-Admins ────────────────────────────── */}
      {(isLocked || autoLockEnabled) && !isAdmin && (
        <div className="bg-amber-950/90 border-b border-amber-800/60 px-4 py-1.5 text-xs text-amber-200 text-center flex items-center justify-center gap-2 z-20">
          <span>🔒</span>
          <span>
            {isLocked
              ? 'This room has been permanently locked by the Administrator. Canvas editing is disabled.'
              : 'Auto-Lock is active: Canvas editing is currently locked for all users.'}
          </span>
        </div>
      )}

      {/* ── Main Canvas Area ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Toolbar (Visible if editor is allowed to edit) */}
        {isEditingAllowed && (
          <Toolbar
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            activeColor={activeColor}
            setActiveColor={setActiveColor}
            brushSize={brushSize}
            setBrushSize={setBrushSize}
            canvasRef={canvasRef}
            roomId={roomId}
            isAdmin={isAdmin}
            isLocked={isLocked}
            autoLockEnabled={autoLockEnabled}
            onToggleLock={handleToggleLock}
            onToggleAutoLock={handleToggleAutoLock}
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
            isEditor={isEditingAllowed}
            activeTool={activeTool}
            activeColor={activeColor}
            brushSize={brushSize}
            initialCanvas={initialCanvas}
            onViewportChange={(vp) => {
              setViewport(vp);
              if (isEditingAllowed) getSocket().emit('viewport:change', vp);
            }}
          />

          {/* YouTube / image overlays */}
          <MediaOverlayLayer
            elements={mediaElements}
            setElements={setMediaElements}
            viewport={viewport}
            isEditor={isEditingAllowed}
            isAdmin={isAdmin}
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
          initialTab={passwordModalTab}
          onSubmit={handlePasswordSubmit}
          onAdminSubmit={handleAdminSubmit}
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
