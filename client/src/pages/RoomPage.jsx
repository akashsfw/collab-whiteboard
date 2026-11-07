import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchRoom, createRoom, verifyAdminKey, deleteRoomAdmin } from '../lib/api.js';
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

  // Lock Timer state
  const [timerSecondsLeft, setTimerSecondsLeft] = useState(null);
  const timerIntervalRef = useRef(null);
  const [showTimerMenu, setShowTimerMenu] = useState(false);

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

  // ── Lock Countdown Timer Logic ───────────────────────────────────────────
  useEffect(() => {
    if (timerSecondsLeft === null) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    if (timerSecondsLeft <= 0) {
      // Timer finished -> lock room automatically!
      clearInterval(timerIntervalRef.current);
      setTimerSecondsLeft(null);
      getSocket().emit('room:toggle-lock', { roomId, isLocked: true });
      setIsLocked(true);
      return;
    }

    timerIntervalRef.current = setInterval(() => {
      setTimerSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [timerSecondsLeft, roomId]);

  function startLockTimer(minutes) {
    setShowTimerMenu(false);
    setTimerSecondsLeft(minutes * 60);
  }

  function cancelLockTimer() {
    setShowTimerMenu(false);
    setTimerSecondsLeft(null);
  }

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

  function handleExportJSON() {
    const canvasJSON = canvasRef.current?.exportJSON() || initialCanvas;
    const data = {
      roomId,
      roomMeta,
      canvasState: canvasJSON,
      mediaElements,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collab-board-room-${roomId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportPNG() {
    const dataUrl = canvasRef.current?.exportPNG();
    if (!dataUrl) {
      alert('Unable to capture canvas image.');
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `whiteboard-${roomId}.png`;
    a.click();
  }

  async function handleDeleteThisRoom() {
    const confirmPrompt = `Are you sure you want to permanently delete "${roomMeta?.name || roomId}"?\nAll canvas objects and drawings will be destroyed.`;
    if (!window.confirm(confirmPrompt)) return;

    const adminKey = getStoredAdminKey();
    try {
      await deleteRoomAdmin(roomId, adminKey);
      navigate('/');
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
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
              This room is not currently active on the server. You can initialize it right now to draw or regain access.
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

  // Format countdown string mm:ss
  const formatTimer = (totalSeconds) => {
    if (totalSeconds === null) return '';
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-canvas">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 bg-surface border-b border-white/10 z-20 shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => navigate('/')}
            title="Back to All Rooms"
            className="text-white font-bold text-base sm:text-lg hover:text-accent transition-colors shrink-0"
          >
            ← Collab<span className="text-accent">Board</span>
          </button>
          <span className="hidden sm:inline text-muted text-xs font-mono bg-canvas px-2 py-1 rounded truncate max-w-[150px]">
            {roomMeta?.name || roomId}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
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
          {timerSecondsLeft !== null && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-950 text-purple-200 border border-purple-500 animate-pulse">
              ⏱️ Locks in {formatTimer(timerSecondsLeft)}
            </span>
          )}

          {/* Current Role badge */}
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

          {/* TWO OPTIONS ABOVE (Shown when NOT in Admin mode) */}
          {!isAdmin ? (
            <div className="flex items-center gap-1">
              {role !== 'editor' && !isLocked && !autoLockEnabled && (
                <button
                  onClick={() => { setPasswordModalTab('user'); setShowPasswordModal(true); setAuthError(''); }}
                  className="bg-accent hover:bg-accent-hover text-white text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors shrink-0 flex items-center gap-1"
                >
                  <span>✏️</span> Editor Mode
                </button>
              )}
              <button
                onClick={() => { setPasswordModalTab('admin'); setShowPasswordModal(true); setAuthError(''); }}
                className="bg-purple-900/70 hover:bg-purple-800 border border-purple-500/50 text-purple-200 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 shrink-0"
              >
                <span>👑</span> Admin Mode
              </button>
            </div>
          ) : (
            /* ALL ADMIN FEATURES (Shown when in Admin mode) */
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* 1. Permanent Lock Toggle */}
              <button
                onClick={handleToggleLock}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-colors flex items-center gap-1 ${
                  isLocked
                    ? 'bg-red-950/60 border-red-700 text-red-300'
                    : 'border-white/10 text-muted hover:text-white'
                }`}
                title="Lock room permanently so no further edits are allowed"
              >
                <span>{isLocked ? '🔓' : '🔒'}</span>
                <span>{isLocked ? 'Unlock Room' : 'Lock Room'}</span>
              </button>

              {/* 2. Lock Timer / Auto-Lock Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowTimerMenu((prev) => !prev)}
                  className={`text-xs px-2 py-1 rounded-lg font-medium border transition-colors flex items-center gap-1 ${
                    autoLockEnabled || timerSecondsLeft !== null
                      ? 'bg-amber-950/60 border-amber-700 text-amber-300'
                      : 'border-white/10 text-muted hover:text-white'
                  }`}
                  title="Configure Auto-Lock or Lock Timer"
                >
                  <span>⏱️</span>
                  <span>Timer</span>
                </button>

                {showTimerMenu && (
                  <div className="absolute right-0 top-8 bg-surface border border-white/10 rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1 w-44 text-xs">
                    <button
                      onClick={handleToggleAutoLock}
                      className="text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-muted hover:text-white transition-colors"
                    >
                      {autoLockEnabled ? 'Disable Auto-Lock' : 'Enable Auto-Lock'}
                    </button>
                    <div className="border-t border-white/5 my-0.5" />
                    <button
                      onClick={() => startLockTimer(5)}
                      className="text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-muted hover:text-white transition-colors"
                    >
                      Lock in 5 Minutes
                    </button>
                    <button
                      onClick={() => startLockTimer(15)}
                      className="text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-muted hover:text-white transition-colors"
                    >
                      Lock in 15 Minutes
                    </button>
                    <button
                      onClick={() => startLockTimer(30)}
                      className="text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-muted hover:text-white transition-colors"
                    >
                      Lock in 30 Minutes
                    </button>
                    {timerSecondsLeft !== null && (
                      <button
                        onClick={cancelLockTimer}
                        className="text-left px-2.5 py-1.5 rounded-lg text-red-400 hover:bg-red-950/40 transition-colors"
                      >
                        Cancel Timer
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 3. Export Options */}
              <div className="flex items-center gap-1">
                <button
                  onClick={handleExportJSON}
                  title="Export Room JSON data (canvas + media elements)"
                  className="text-xs bg-surface border border-white/10 text-muted hover:text-white px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <span>📥</span> JSON
                </button>
                <button
                  onClick={handleExportPNG}
                  title="Export canvas as PNG image"
                  className="text-xs bg-surface border border-white/10 text-muted hover:text-white px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <span>🖼️</span> PNG
                </button>
              </div>

              {/* 4. Delete Room */}
              <button
                onClick={handleDeleteThisRoom}
                title="Permanently delete this entire room"
                className="text-xs text-red-400 hover:text-red-300 border border-red-900/60 hover:border-red-700 bg-red-950/30 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
              >
                <span>🗑️</span>
              </button>

              {/* Exit Admin Mode */}
              <button
                onClick={handleAdminLogout}
                className="text-[11px] text-muted hover:text-white border border-white/10 px-2 py-1 rounded-lg transition-colors"
              >
                Exit
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

      {/* Password Modal with TWO OPTIONS ABOVE */}
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
