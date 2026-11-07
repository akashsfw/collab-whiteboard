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
  const [role, setRole] = useState('observer');           // 'observer' | 'editor' | 'admin' (Observer by default)
  const [isLocked, setIsLocked] = useState(false);       // Admin permanent lock
  const [autoLockEnabled, setAutoLockEnabled] = useState(false); // Auto-lock for all normal users
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordModalTab, setPasswordModalTab] = useState('user'); // 'user' | 'admin'
  const [authError, setAuthError] = useState('');
  const [copied, setCopied] = useState(false);

  // Dropdown menus
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const modeMenuRef = useRef(null);
  const adminMenuRef = useRef(null);

  // Lock Timer state
  const [timerSecondsLeft, setTimerSecondsLeft] = useState(null);
  const timerIntervalRef = useRef(null);

  // Claim/setup room state when roomMeta === false
  const [claimPassword, setClaimPassword] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claimLoading, setClaimLoading] = useState(false);

  // Shared state between Canvas and MediaOverlayLayer
  const [activeTool, setActiveTool] = useState('hand');
  const [activeColor, setActiveColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(4);

  // Initial canvas data received on join
  const [initialCanvas, setInitialCanvas] = useState(null);
  const [mediaElements, setMediaElements] = useState([]);

  // Viewport state for overlay sync (pan/zoom from Fabric)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  const canvasRef = useRef(null);

  // ── Click outside listeners for dropdown menus ───────────────────────────
  useEffect(() => {
    function handleClickOutside(e) {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target)) {
        setShowModeMenu(false);
      }
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target)) {
        setShowAdminMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // ── 1. Verify room exists ──────────────────────────────────────────────────
  useEffect(() => {
    loadRoomData();
  }, [roomId]);

  function loadRoomData() {
    fetchRoom(roomId).then((data) => {
      if (!data) {
        setRoomMeta(false);
      } else {
        setRoomMeta(data);
        setIsLocked(!!data.isLocked);
        setAutoLockEnabled(!!data.autoLockEnabled);
      }
    });
  }

  // ── 2. Connect socket and join room (Always as Observer by default) ────────
  useEffect(() => {
    if (!roomMeta) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    // Default to Observer mode whenever entering the room
    setRole('observer');
    setActiveTool('hand');

    socket.emit('room:join', { roomId, adminKey: '' });

    socket.on('room:joined', ({ isLocked: il, autoLockEnabled: al, canvasState, mediaElements: me }) => {
      setRole('observer');
      setActiveTool('hand');
      setIsLocked(il);
      setAutoLockEnabled(al);
      setInitialCanvas(canvasState);
      setMediaElements(me || []);
    });

    socket.on('auth:result', ({ success, role: r, message, isLocked: il, autoLockEnabled: al }) => {
      if (success) {
        setRole(r);
        if (r === 'editor' || r === 'admin') {
          setActiveTool('pen');
        }
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
      // Timer finished -> lock room automatically
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
    setTimerSecondsLeft(minutes * 60);
  }

  function cancelLockTimer() {
    setTimerSecondsLeft(null);
  }

  // ── Mode Switcher Logic ──────────────────────────────────────────────────
  function handleSelectMode(targetMode) {
    setShowModeMenu(false);
    if (targetMode === role) return;

    if (targetMode === 'observer') {
      storeAdminKey('');
      setRole('observer');
      setActiveTool('hand');
      getSocket().emit('room:join', { roomId, adminKey: '' });
      return;
    }

    if (targetMode === 'editor') {
      if (isLocked) {
        alert('This room has been permanently locked by the administrator.');
        return;
      }
      if (autoLockEnabled) {
        alert('Auto-Lock is active: Canvas editing is locked for normal users.');
        return;
      }
      setPasswordModalTab('user');
      setAuthError('');
      setShowPasswordModal(true);
      return;
    }

    if (targetMode === 'admin') {
      setPasswordModalTab('admin');
      setAuthError('');
      setShowPasswordModal(true);
      return;
    }
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
  const isEditingAllowed = isAdmin || (role === 'editor' && !isLocked && !autoLockEnabled);

  // Format countdown string mm:ss
  const formatTimer = (totalSeconds) => {
    if (totalSeconds === null) return '';
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen h-[100dvh] overflow-hidden bg-canvas">
      {/* ── Top Bar (Mobile-Hardened, No Overlaps) ─────────────────────────── */}
      <header className="h-14 px-3 sm:px-4 bg-surface border-b border-white/10 z-30 flex items-center justify-between flex-nowrap shrink-0 relative select-none">
        {/* Left: Logo & Room Name */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
          <button
            onClick={() => navigate('/')}
            title="Back to All Rooms"
            className="text-white font-bold text-sm sm:text-base hover:text-accent transition-colors shrink-0 whitespace-nowrap"
          >
            ← Collab<span className="text-accent">Board</span>
          </button>
          <span className="hidden sm:inline-block text-muted text-xs font-mono bg-canvas px-2 py-0.5 rounded truncate max-w-[120px] md:max-w-[180px]">
            {roomMeta?.name || roomId}
          </span>
        </div>

        {/* Right: Status Badges, Copy Link, Admin Tools, and 3-Mode Dropdown */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-nowrap">
          {/* Status Badges */}
          {isLocked && (
            <span
              title="Room is locked by administrator"
              className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-950/80 text-red-300 border border-red-700 whitespace-nowrap shrink-0"
            >
              <span className="hidden sm:inline">🔒 Locked</span>
              <span className="sm:hidden">🔒</span>
            </span>
          )}

          {autoLockEnabled && !isLocked && (
            <span
              title="Auto-Lock active for normal users"
              className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700 whitespace-nowrap shrink-0"
            >
              <span className="hidden sm:inline">⏱️ Auto-Lock</span>
              <span className="sm:hidden">⏱️</span>
            </span>
          )}

          {timerSecondsLeft !== null && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-950 text-purple-200 border border-purple-500 whitespace-nowrap animate-pulse shrink-0">
              ⏱️ {formatTimer(timerSecondsLeft)}
            </span>
          )}

          {/* Copy Link */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            title="Copy Room Link"
            className="text-xs text-muted hover:text-white border border-white/10 px-2 py-1.5 rounded-xl transition-colors flex items-center gap-1 shrink-0"
          >
            <span>{copied ? '✓' : '🔗'}</span>
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
          </button>

          {/* Admin Tools Menu Button (Only visible in Admin Mode) */}
          {isAdmin && (
            <div className="relative" ref={adminMenuRef}>
              <button
                onClick={() => {
                  setShowAdminMenu((prev) => !prev);
                  setShowModeMenu(false);
                }}
                title="Admin Management Tools"
                className="text-xs font-semibold px-2 sm:px-2.5 py-1.5 rounded-xl bg-purple-950/70 border border-purple-500/60 text-purple-200 hover:bg-purple-900/80 transition-all flex items-center gap-1 shrink-0"
              >
                <span>⚙️</span>
                <span className="hidden sm:inline">Controls</span>
                <span className="text-[10px] opacity-70">▾</span>
              </button>

              {showAdminMenu && (
                <div className="absolute right-0 top-11 bg-surface/98 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-2 z-50 flex flex-col gap-1 w-52 text-xs animate-in fade-in select-none">
                  <div className="px-2 py-1 text-[10px] font-bold text-purple-300 uppercase tracking-wider">
                    Admin Tools
                  </div>

                  {/* Toggle Permanent Lock */}
                  <button
                    onClick={() => { handleToggleLock(); setShowAdminMenu(false); }}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-xl transition-colors text-left ${
                      isLocked ? 'bg-red-950/60 text-red-200 hover:bg-red-900/60' : 'hover:bg-white/5 text-muted hover:text-white'
                    }`}
                  >
                    <span>{isLocked ? '🔓' : '🔒'}</span>
                    <span>{isLocked ? 'Unlock Room' : 'Lock Room (Permanent)'}</span>
                  </button>

                  {/* Toggle AutoLock */}
                  <button
                    onClick={() => { handleToggleAutoLock(); setShowAdminMenu(false); }}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-xl transition-colors text-left ${
                      autoLockEnabled ? 'bg-amber-950/60 text-amber-200 hover:bg-amber-900/60' : 'hover:bg-white/5 text-muted hover:text-white'
                    }`}
                  >
                    <span>⏱️</span>
                    <span>{autoLockEnabled ? 'Disable Auto-Lock' : 'Enable Auto-Lock'}</span>
                  </button>

                  {/* Timed Locks */}
                  <div className="border-t border-white/10 my-0.5" />
                  <div className="px-2 py-0.5 text-[10px] font-semibold text-muted/60">
                    Timed Auto-Lock:
                  </div>
                  <button
                    onClick={() => { startLockTimer(5); setShowAdminMenu(false); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/5 text-muted hover:text-white transition-colors text-left"
                  >
                    <span>⏱️</span> Lock in 5 minutes
                  </button>
                  <button
                    onClick={() => { startLockTimer(15); setShowAdminMenu(false); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/5 text-muted hover:text-white transition-colors text-left"
                  >
                    <span>⏱️</span> Lock in 15 minutes
                  </button>
                  <button
                    onClick={() => { startLockTimer(30); setShowAdminMenu(false); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/5 text-muted hover:text-white transition-colors text-left"
                  >
                    <span>⏱️</span> Lock in 30 minutes
                  </button>
                  {timerSecondsLeft !== null && (
                    <button
                      onClick={() => { cancelLockTimer(); setShowAdminMenu(false); }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-red-400 hover:bg-red-950/40 transition-colors text-left"
                    >
                      <span>❌</span> Cancel Active Timer
                    </button>
                  )}

                  {/* Export Options */}
                  <div className="border-t border-white/10 my-0.5" />
                  <button
                    onClick={() => { handleExportPNG(); setShowAdminMenu(false); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/5 text-muted hover:text-white transition-colors text-left"
                  >
                    <span>🖼️</span> Export as PNG Image
                  </button>
                  <button
                    onClick={() => { handleExportJSON(); setShowAdminMenu(false); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/5 text-muted hover:text-white transition-colors text-left"
                  >
                    <span>📥</span> Export Room Data (JSON)
                  </button>

                  {/* Delete Room */}
                  <div className="border-t border-white/10 my-0.5" />
                  <button
                    onClick={() => { handleDeleteThisRoom(); setShowAdminMenu(false); }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-red-400 hover:bg-red-950/50 hover:text-red-300 transition-colors text-left font-semibold"
                  >
                    <span>🗑️</span> Delete Room
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── 3-MODE DROPDOWN SWITCHER ────────────────────────────────────── */}
          <div className="relative" ref={modeMenuRef}>
            <button
              onClick={() => {
                setShowModeMenu((prev) => !prev);
                setShowAdminMenu(false);
              }}
              title="Click to switch mode (Observer, Editor, Admin)"
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-xl border flex items-center gap-1.5 transition-all shadow-sm ${
                isAdmin
                  ? 'bg-purple-950/80 border-purple-500/70 text-purple-200 hover:bg-purple-900/80'
                  : isEditingAllowed
                  ? 'bg-green-950/70 border-green-600/70 text-green-300 hover:bg-green-900/70'
                  : 'bg-white/5 border-white/10 text-muted hover:text-white hover:border-white/20'
              }`}
            >
              <span>{isAdmin ? '👑' : isEditingAllowed ? '✏️' : '👁️'}</span>
              <span className="font-medium">
                {isAdmin ? 'Admin' : isEditingAllowed ? 'Editor' : 'Observer'}
              </span>
              <span className="text-[10px] opacity-70">▾</span>
            </button>

            {showModeMenu && (
              <div className="absolute right-0 top-11 bg-surface/98 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-1.5 z-50 flex flex-col gap-1 w-56 text-xs animate-in fade-in select-none">
                <div className="px-2 py-1 text-[10px] font-bold text-muted/70 uppercase tracking-wider">
                  Select Room Mode
                </div>

                {/* 1. Observer Mode */}
                <button
                  onClick={() => handleSelectMode('observer')}
                  className={`flex items-start justify-between p-2 rounded-xl text-left transition-colors ${
                    role === 'observer'
                      ? 'bg-white/10 text-white font-semibold'
                      : 'hover:bg-white/5 text-muted hover:text-white'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm mt-0.5">👁️</span>
                    <div>
                      <div className="font-semibold text-white">Observer Mode</div>
                      <div className="text-[11px] text-muted">View only (Default)</div>
                    </div>
                  </div>
                  {role === 'observer' && <span className="text-green-400 font-bold text-xs mt-0.5">✓</span>}
                </button>

                {/* 2. Editor Mode */}
                <button
                  onClick={() => handleSelectMode('editor')}
                  className={`flex items-start justify-between p-2 rounded-xl text-left transition-colors ${
                    role === 'editor'
                      ? 'bg-green-950/60 text-green-200 border border-green-700/50 font-semibold'
                      : 'hover:bg-white/5 text-muted hover:text-white'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm mt-0.5">✏️</span>
                    <div>
                      <div className="font-semibold text-white">Editor Mode</div>
                      <div className="text-[11px] text-muted">
                        {isLocked
                          ? 'Locked by Admin'
                          : autoLockEnabled
                          ? 'Auto-Locked'
                          : 'Draw & write (Password)'}
                      </div>
                    </div>
                  </div>
                  {role === 'editor' && <span className="text-green-400 font-bold text-xs mt-0.5">✓</span>}
                </button>

                {/* 3. Admin Mode */}
                <button
                  onClick={() => handleSelectMode('admin')}
                  className={`flex items-start justify-between p-2 rounded-xl text-left transition-colors ${
                    role === 'admin'
                      ? 'bg-purple-950/70 text-purple-200 border border-purple-600/50 font-semibold'
                      : 'hover:bg-white/5 text-muted hover:text-white'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm mt-0.5">👑</span>
                    <div>
                      <div className="font-semibold text-white">Admin Mode</div>
                      <div className="text-[11px] text-muted">Manage, lock & export</div>
                    </div>
                  </div>
                  {role === 'admin' && <span className="text-purple-300 font-bold text-xs mt-0.5">✓</span>}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Lock Warning Banner for Non-Admins ────────────────────────────── */}
      {(isLocked || autoLockEnabled) && !isAdmin && (
        <div className="bg-amber-950/90 border-b border-amber-800/60 px-4 py-1.5 text-xs text-amber-200 text-center flex items-center justify-center gap-2 z-20 shrink-0">
          <span>🔒</span>
          <span>
            {isLocked
              ? 'This room has been permanently locked by the Administrator. Canvas editing is disabled.'
              : 'Auto-Lock is active: Canvas editing is currently locked for all users.'}
          </span>
        </div>
      )}

      {/* ── Main Canvas Area ────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden relative">
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
          className="relative flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden"
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

      {/* Password Modal for switching to Editor or Admin */}
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
