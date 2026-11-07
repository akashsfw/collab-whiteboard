import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchRooms,
  createRoom,
  verifyAdminKey,
  setRoomLock,
  setRoomAutoLock,
  exportRoomsBackup,
  importRoomsBackup,
  deleteRoomAdmin,
} from '../lib/api.js';

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

export default function AdminPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Authentication State
  const [adminKey, setAdminKey] = useState(() => getStoredAdminKey());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Rooms Data
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);

  // Quick Room Creation
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomAutoLock, setNewRoomAutoLock] = useState(false);
  const [createError, setCreateError] = useState('');

  // ── Verify Admin Session on mount ──────────────────────────────────────────
  useEffect(() => {
    if (adminKey) {
      verifyAdminKey(adminKey)
        .then(() => {
          setIsAuthenticated(true);
          loadRooms();
        })
        .catch(() => {
          storeAdminKey('');
          setAdminKey('');
          setIsAuthenticated(false);
        });
    }
  }, [adminKey]);

  async function loadRooms() {
    setLoadingRooms(true);
    try {
      const data = await fetchRooms();
      setRooms(Array.isArray(data) ? data : []);
    } catch {
      setRooms([]);
    } finally {
      setLoadingRooms(false);
    }
  }

  // ── Admin Login Submission ────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    setAuthError('');
    if (!passwordInput.trim()) return;

    setAuthLoading(true);
    try {
      await verifyAdminKey(passwordInput.trim());
      const key = passwordInput.trim();
      storeAdminKey(key);
      setAdminKey(key);
      setIsAuthenticated(true);
      setPasswordInput('');
      await loadRooms();
    } catch (err) {
      setAuthError(err.message || 'Invalid admin passcode.');
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    storeAdminKey('');
    setAdminKey('');
    setIsAuthenticated(false);
    setRooms([]);
  }

  // ── Lock & Auto-Lock Toggles ──────────────────────────────────────────────
  async function handleToggleLock(roomId, currentLocked) {
    try {
      await setRoomLock(roomId, adminKey, !currentLocked);
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, isLocked: !currentLocked } : r))
      );
    } catch (err) {
      alert(`Error toggling lock: ${err.message}`);
    }
  }

  async function handleToggleAutoLock(roomId, currentAutoLock) {
    try {
      await setRoomAutoLock(roomId, adminKey, !currentAutoLock);
      setRooms((prev) =>
        prev.map((r) =>
          r.id === roomId ? { ...r, autoLockEnabled: !currentAutoLock } : r
        )
      );
    } catch (err) {
      alert(`Error toggling auto-lock: ${err.message}`);
    }
  }

  // ── Delete Room ───────────────────────────────────────────────────────────
  async function handleDeleteRoom(roomId, roomName) {
    const confirmMsg = `Are you sure you want to permanently delete "${roomName || roomId}"?\nAll canvas drawings and media in this room will be destroyed.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteRoomAdmin(roomId, adminKey);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch (err) {
      alert(err.message);
    }
  }

  // ── Backup Export / Import ────────────────────────────────────────────────
  async function handleExportBackup() {
    if (!adminKey) return;
    setBackupLoading(true);
    try {
      const data = await exportRoomsBackup(adminKey);
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `collab-board-all-rooms-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setBackupLoading(false);
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file || !adminKey) return;
    setBackupLoading(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const roomsList = Array.isArray(parsed) ? parsed : parsed.rooms;
      if (!Array.isArray(roomsList)) {
        throw new Error('Invalid backup file. Must contain a rooms array.');
      }
      const res = await importRoomsBackup(adminKey, roomsList);
      alert(`Successfully restored ${res.count} room(s) from backup!`);
      await loadRooms();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setBackupLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ── Create Room as Admin ──────────────────────────────────────────────────
  async function handleCreateRoom(e) {
    e.preventDefault();
    setCreateError('');
    if (newRoomPassword.trim().length < 4) {
      setCreateError('Password must be at least 4 characters.');
      return;
    }
    try {
      const { roomId } = await createRoom({
        name: newRoomName.trim() || undefined,
        password: newRoomPassword.trim(),
        autoLockEnabled: newRoomAutoLock,
      });
      setShowCreateModal(false);
      setNewRoomName('');
      setNewRoomPassword('');
      setNewRoomAutoLock(false);
      await loadRooms();
      navigate(`/room/${roomId}`);
    } catch (err) {
      setCreateError(err.message);
    }
  }

  // Filtered rooms by search query
  const filteredRooms = rooms.filter((r) => {
    const q = searchQuery.toLowerCase();
    return (
      r.name?.toLowerCase().includes(q) ||
      r.id?.toLowerCase().includes(q)
    );
  });

  const lockedCount = rooms.filter((r) => r.isLocked).length;
  const autoLockCount = rooms.filter((r) => r.autoLockEnabled && !r.isLocked).length;

  // ── 1. LOCKED GATE SCREEN: Requires Admin Password ────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-canvas text-[#e2e2f0] flex flex-col items-center justify-center p-4">
        <div className="bg-surface border border-purple-500/30 rounded-2xl shadow-2xl p-7 sm:p-9 w-full max-w-md flex flex-col gap-5">
          <div className="text-center flex flex-col items-center gap-2">
            <span className="text-4xl">👑</span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Admin Access Required
            </h1>
            <p className="text-muted text-xs leading-relaxed max-w-sm">
              The directory of all created rooms, locking controls, and management tools are protected. Enter the master admin password to proceed.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1" htmlFor="admin-pass">
                Master Admin Passcode
              </label>
              <input
                id="admin-pass"
                type="password"
                autoFocus
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter admin passcode"
                className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {authError && <p className="text-red-400 text-xs">{authError}</p>}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors shadow-lg shadow-purple-900/30"
            >
              {authLoading ? 'Verifying Passcode…' : 'Unlock Admin Access'}
            </button>
          </form>

          <div className="border-t border-white/10 pt-3 text-center">
            <button
              onClick={() => navigate('/')}
              className="text-xs text-muted hover:text-white transition-colors"
            >
              ← Back to Homepage
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 2. UNLOCKED ADMIN CONTROL CENTER: Full Rooms List & Actions ───────────
  return (
    <div className="min-h-screen w-full bg-canvas text-[#e2e2f0] flex flex-col overflow-y-auto">
      {/* ── Top Bar ───────────────────────────────────────────────────────── */}
      <header className="border-b border-white/10 bg-surface/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-white font-black text-xl hover:text-accent transition-colors flex items-center gap-1.5"
          >
            ← Collab<span className="text-accent">Board</span>
          </button>
          <span className="text-xs bg-purple-950/90 border border-purple-600 text-purple-300 px-3 py-1 rounded-full font-bold flex items-center gap-1 shadow-sm">
            <span>👑</span> Admin Control Center
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Export / Import Backup */}
          <button
            onClick={handleExportBackup}
            disabled={backupLoading}
            title="Download full JSON backup of all rooms"
            className="text-xs bg-surface border border-purple-500/30 text-purple-200 hover:bg-purple-900/40 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            <span>📥</span> Export Backup
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={backupLoading}
            title="Restore rooms from a JSON backup file"
            className="text-xs bg-surface border border-purple-500/30 text-purple-200 hover:bg-purple-900/40 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            <span>📤</span> Import Backup
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
          />

          {/* Lock / Exit Admin */}
          <button
            onClick={handleLogout}
            title="Lock admin access and return"
            className="text-xs text-red-300 bg-red-950/40 border border-red-800/60 hover:bg-red-900/50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            <span>🔒</span> Lock Admin
          </button>
        </div>
      </header>

      {/* ── Main Admin Content ────────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 pb-28 flex flex-col gap-6">
        {/* Title, Quick Stats & Action Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
              <span>👑</span> Master Rooms Directory
            </h1>
            <p className="text-xs sm:text-sm text-muted mt-1">
              All rooms ever created on the whiteboard. With admin password unlocked, you can enter any room, modify elements, or lock rooms permanently.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-accent hover:bg-accent-hover text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all shadow-md shadow-accent/20 flex items-center gap-1.5"
            >
              <span>✦</span> Create New Room
            </button>
          </div>
        </div>

        {/* Quick Stats Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-surface border border-white/10 rounded-xl p-3.5 flex flex-col">
            <span className="text-xs text-muted">Total Rooms</span>
            <span className="text-2xl font-black text-white">{rooms.length}</span>
          </div>
          <div className="bg-surface border border-white/10 rounded-xl p-3.5 flex flex-col">
            <span className="text-xs text-muted">Locked Rooms</span>
            <span className="text-2xl font-black text-red-400">{lockedCount}</span>
          </div>
          <div className="bg-surface border border-white/10 rounded-xl p-3.5 flex flex-col">
            <span className="text-xs text-muted">Auto-Lock Active</span>
            <span className="text-2xl font-black text-amber-400">{autoLockCount}</span>
          </div>
          <div className="bg-surface border border-white/10 rounded-xl p-3.5 flex flex-col">
            <span className="text-xs text-muted">Open Rooms</span>
            <span className="text-2xl font-black text-green-400">
              {rooms.length - lockedCount - autoLockCount}
            </span>
          </div>
        </div>

        {/* Search & Refresh Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <div className="text-xs text-muted font-medium">
            Showing {filteredRooms.length} of {rooms.length} created room(s)
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search by room name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-surface border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-muted/50 focus:outline-none focus:ring-1 focus:ring-purple-500 w-full sm:w-64"
            />
            <button
              onClick={loadRooms}
              title="Refresh rooms list"
              className="text-xs border border-white/10 hover:border-white/30 px-2.5 py-1.5 rounded-lg text-muted hover:text-white transition-colors shrink-0"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Rooms Grid */}
        {loadingRooms ? (
          <div className="text-center py-20 text-muted text-sm">
            Loading rooms directory…
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="text-center py-20 bg-surface/40 border border-white/5 rounded-2xl flex flex-col items-center gap-3">
            <span className="text-4xl">🎨</span>
            <p className="text-white font-semibold text-base">No rooms found</p>
            <p className="text-muted text-xs max-w-sm">
              {searchQuery
                ? 'No rooms matched your search filter.'
                : 'No rooms have been created yet. Click Create New Room above to get started.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRooms.map((room) => {
              const formattedDate = new Date(room.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={room.id}
                  className="bg-surface/90 border border-white/10 hover:border-purple-500/30 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all shadow-lg hover:shadow-xl group"
                >
                  {/* Card Header */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-bold text-white text-base group-hover:text-purple-300 transition-colors truncate">
                        {room.name || `Room ${room.id.slice(0, 4)}`}
                      </h2>
                      {/* Lock Badges */}
                      <div className="flex items-center gap-1 shrink-0">
                        {room.isLocked && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-950/80 text-red-300 border border-red-700">
                            🔒 Locked
                          </span>
                        )}
                        {room.autoLockEnabled && !room.isLocked && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700">
                            ⏱️ Auto-Lock
                          </span>
                        )}
                        {!room.isLocked && !room.autoLockEnabled && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-950/60 text-green-300 border border-green-800">
                            🔓 Open
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted font-mono">
                      <span>{room.id}</span>
                      <span>•</span>
                      <span>{formattedDate}</span>
                    </div>
                  </div>

                  {/* Metadata Stats & Delete */}
                  <div className="flex items-center justify-between text-xs text-muted border-t border-white/5 pt-3">
                    <div className="flex items-center gap-3">
                      <span>🎨 {room.objectCount || 0} items</span>
                      {room.mediaCount > 0 && <span>▶ {room.mediaCount} video(s)</span>}
                    </div>
                    <button
                      onClick={() => handleDeleteRoom(room.id, room.name)}
                      title="Permanently delete this room"
                      className="text-[11px] text-red-400 hover:text-red-300 hover:underline transition-colors"
                    >
                      🗑️ Delete Room
                    </button>
                  </div>

                  {/* Admin Actions */}
                  <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                    {/* Enter Room as Admin */}
                    <button
                      onClick={() => navigate(`/room/${room.id}`)}
                      className="w-full bg-purple-700 hover:bg-purple-600 text-white font-semibold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <span>👑</span> Enter Room as Admin (Edit & Draw)
                    </button>

                    {/* Lock / Auto-Lock Controls */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleToggleLock(room.id, room.isLocked)}
                        className={`text-xs py-1.5 px-2 rounded-lg font-medium border transition-colors ${
                          room.isLocked
                            ? 'bg-red-950/50 border-red-700 text-red-300 hover:bg-red-900/60'
                            : 'border-white/10 text-muted hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {room.isLocked ? '🔓 Unlock' : '🔒 Lock Room'}
                      </button>
                      <button
                        onClick={() => handleToggleAutoLock(room.id, room.autoLockEnabled)}
                        className={`text-xs py-1.5 px-2 rounded-lg font-medium border transition-colors ${
                          room.autoLockEnabled
                            ? 'bg-amber-950/50 border-amber-700 text-amber-300 hover:bg-amber-900/60'
                            : 'border-white/10 text-muted hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {room.autoLockEnabled ? '⏱️ AutoLock: ON' : '⏱️ AutoLock: OFF'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Create Room Modal ─────────────────────────────────────────────── */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div className="bg-surface border border-purple-500/30 rounded-2xl shadow-2xl p-6 sm:p-7 w-full max-w-sm">
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <span>✦</span> Create Room as Admin
            </h2>
            <p className="text-muted text-xs mb-4">
              Create a new room with custom name, password, and lock preferences.
            </p>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  Room Name (Optional)
                </label>
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="e.g. Master Design Sprint"
                  className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  User Room Password <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={newRoomPassword}
                  onChange={(e) => setNewRoomPassword(e.target.value)}
                  placeholder="Min. 4 characters"
                  className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  id="admin-create-autolock"
                  type="checkbox"
                  checked={newRoomAutoLock}
                  onChange={(e) => setNewRoomAutoLock(e.target.checked)}
                  className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
                />
                <label htmlFor="admin-create-autolock" className="text-xs text-muted cursor-pointer select-none">
                  Enable <strong className="text-white">Auto-Lock</strong> initially
                </label>
              </div>

              {createError && <p className="text-red-400 text-xs">{createError}</p>}

              <div className="flex gap-2.5 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-purple-700 hover:bg-purple-600 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                >
                  Create & Enter
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 border border-white/10 text-muted hover:text-white py-2 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
