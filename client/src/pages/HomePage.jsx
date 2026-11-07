import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchRooms,
  createRoom,
  verifyRoomPassword,
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

export default function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Rooms list & loading
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create room form state
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomAutoLock, setNewRoomAutoLock] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Admin access state
  const [adminKey, setAdminKey] = useState(() => getStoredAdminKey());
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminInputKey, setAdminInputKey] = useState('');
  const [adminError, setAdminError] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);

  // Normal user room password entry modal
  const [selectedRoomForJoin, setSelectedRoomForJoin] = useState(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  // ── Load rooms on mount & verify existing admin session ───────────────────
  useEffect(() => {
    loadRooms();
    if (adminKey) {
      verifyAdminKey(adminKey)
        .then(() => setIsAdmin(true))
        .catch(() => {
          storeAdminKey('');
          setAdminKey('');
          setIsAdmin(false);
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

  // ── Create Room ──────────────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault();
    setCreateError('');
    if (newRoomPassword.trim().length < 4) {
      setCreateError('Password must be at least 4 characters.');
      return;
    }

    setCreateLoading(true);
    try {
      const { roomId } = await createRoom({
        name: newRoomName.trim() || undefined,
        password: newRoomPassword.trim(),
        autoLockEnabled: newRoomAutoLock,
      });
      navigate(`/room/${roomId}`);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  }

  // ── Admin Login ──────────────────────────────────────────────────────────
  async function handleAdminLogin(e) {
    e.preventDefault();
    setAdminError('');
    try {
      await verifyAdminKey(adminInputKey.trim());
      const key = adminInputKey.trim();
      storeAdminKey(key);
      setAdminKey(key);
      setIsAdmin(true);
      setShowAdminModal(false);
      setAdminInputKey('');
      await loadRooms();
    } catch (err) {
      setAdminError(err.message || 'Invalid admin passcode.');
    }
  }

  function handleAdminLogout() {
    storeAdminKey('');
    setAdminKey('');
    setIsAdmin(false);
  }

  // ── Admin Backup & Restore ───────────────────────────────────────────────
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
      a.download = `collab-board-rooms-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

  // ── Admin Delete Room ────────────────────────────────────────────────────
  async function handleDeleteRoom(roomId, roomName) {
    if (!adminKey) return;
    const confirmMsg = `Are you sure you want to permanently delete "${roomName || roomId}"?\nAll canvas objects and media in this room will be removed.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteRoomAdmin(roomId, adminKey);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch (err) {
      alert(err.message);
    }
  }

  // ── Admin Lock & Auto-Lock Toggles ────────────────────────────────────────
  async function handleToggleLock(roomId, currentLocked) {
    try {
      await setRoomLock(roomId, adminKey, !currentLocked);
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, isLocked: !currentLocked } : r))
      );
    } catch (err) {
      alert(err.message);
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
      alert(err.message);
    }
  }

  // ── Normal User Room Join ────────────────────────────────────────────────
  async function handleUserJoin(e) {
    e.preventDefault();
    if (!selectedRoomForJoin) return;
    setJoinError('');
    setJoinLoading(true);

    try {
      await verifyRoomPassword(selectedRoomForJoin.id, joinPassword.trim());
      navigate(`/room/${selectedRoomForJoin.id}`);
    } catch (err) {
      setJoinError(err.message || 'Incorrect password.');
    } finally {
      setJoinLoading(false);
    }
  }

  // Filtered rooms
  const filteredRooms = rooms.filter((r) => {
    const q = searchQuery.toLowerCase();
    return (
      r.name?.toLowerCase().includes(q) ||
      r.id?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen w-full bg-canvas text-[#e2e2f0] flex flex-col overflow-y-auto">
      {/* ── Top Navigation Bar ────────────────────────────────────────────── */}
      <header className="border-b border-white/10 bg-surface/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black text-white tracking-tight">
            Collab<span className="text-accent">Board</span>
          </span>
          <span className="text-xs bg-white/5 border border-white/10 text-muted px-2.5 py-1 rounded-full font-mono">
            {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} active
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {isAdmin ? (
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-xs bg-purple-950/80 text-purple-300 border border-purple-600 px-3 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-sm">
                <span>👑</span> Admin Mode Active
              </span>

              {/* Export Backup Button */}
              <button
                onClick={handleExportBackup}
                disabled={backupLoading}
                title="Download full JSON backup of all rooms and drawings"
                className="text-xs bg-surface border border-purple-500/30 text-purple-200 hover:bg-purple-900/40 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
              >
                <span>📥</span> Export Backup
              </button>

              {/* Import Backup Button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={backupLoading}
                title="Restore rooms from a previously exported JSON backup"
                className="text-xs bg-surface border border-purple-500/30 text-purple-200 hover:bg-purple-900/40 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
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

              <button
                onClick={handleAdminLogout}
                className="text-xs text-muted hover:text-white border border-white/10 hover:border-white/30 px-2.5 py-1 rounded-lg transition-colors"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setShowAdminModal(true); setAdminError(''); }}
              className="text-xs bg-surface border border-purple-500/40 text-purple-300 hover:bg-purple-950/50 hover:border-purple-400 font-semibold px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
            >
              <span>👑</span> Admin Access
            </button>
          )}
        </div>
      </header>

      {/* ── Main Container ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 pb-28 flex flex-col gap-8">
        {/* Hero & Create Room Card */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Hero Description */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
              Real-time collaboration with <span className="text-accent">infinite freedom</span>.
            </h1>
            <p className="text-muted text-base sm:text-lg leading-relaxed">
              Create and browse persistent collaborative whiteboards. Draw, upload images,
              embed interactive YouTube players, and lock canvases securely with administrator control.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="text-xs bg-surface border border-white/10 px-3 py-1 rounded-full text-muted">
                🛡️ Password Protected
              </span>
              <span className="text-xs bg-surface border border-white/10 px-3 py-1 rounded-full text-muted">
                ♾️ Infinite Canvas & Pan
              </span>
              <span className="text-xs bg-surface border border-white/10 px-3 py-1 rounded-full text-muted">
                💾 Checkpoint Flattening
              </span>
              <span className="text-xs bg-surface border border-white/10 px-3 py-1 rounded-full text-muted">
                🔒 Admin Lockout & Auto-Lock
              </span>
              <span className="text-xs bg-surface border border-white/10 px-3 py-1 rounded-full text-muted">
                📦 Persistent Backup
              </span>
            </div>
          </div>

          {/* Right Create Room Form */}
          <div className="lg:col-span-5 bg-surface border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-7">
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <span>✦</span> Create a New Room
            </h2>
            <p className="text-muted text-xs mb-5">
              Set a room name and access password. You can also enforce auto-lock from the start.
            </p>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1" htmlFor="room-name">
                  Room Name / Topic (Optional)
                </label>
                <input
                  id="room-name"
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="e.g. Design Sprint, Math 101"
                  className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1" htmlFor="room-pw">
                  Room Access Password <span className="text-red-400">*</span>
                </label>
                <input
                  id="room-pw"
                  type="password"
                  value={newRoomPassword}
                  onChange={(e) => setNewRoomPassword(e.target.value)}
                  placeholder="Min. 4 characters"
                  className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                  autoComplete="new-password"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  id="autolock-check"
                  type="checkbox"
                  checked={newRoomAutoLock}
                  onChange={(e) => setNewRoomAutoLock(e.target.checked)}
                  className="w-4 h-4 accent-accent rounded cursor-pointer"
                />
                <label htmlFor="autolock-check" className="text-xs text-muted cursor-pointer select-none">
                  Enable <strong className="text-white">Auto-Lock</strong> (locks canvas editing for users until admin allows)
                </label>
              </div>

              {createError && <p className="text-red-400 text-xs">{createError}</p>}

              <button
                type="submit"
                disabled={createLoading}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-all shadow-lg shadow-accent/30 mt-2"
              >
                {createLoading ? 'Creating Room…' : '✦ Create Room & Enter'}
              </button>
            </form>
          </div>
        </div>

        {/* ── Rooms Directory Section ────────────────────────────────────────── */}
        <section className="flex flex-col gap-4 pt-4 border-t border-white/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>📁</span> All Created Rooms
              </h2>
              <p className="text-xs text-muted">
                Chronologically sorted by creation time (most recent first). All rooms stay permanently intact.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search rooms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-surface border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-muted/50 focus:outline-none focus:ring-1 focus:ring-accent w-44 sm:w-56"
              />
              <button
                onClick={loadRooms}
                title="Refresh rooms list"
                className="text-xs border border-white/10 hover:border-white/30 px-2.5 py-1.5 rounded-lg text-muted hover:text-white transition-colors"
              >
                ↻
              </button>
            </div>
          </div>

          {/* Rooms Grid */}
          {loadingRooms ? (
            <div className="text-center py-16 text-muted text-sm">
              Loading rooms directory…
            </div>
          ) : filteredRooms.length === 0 ? (
            <div className="text-center py-16 bg-surface/40 border border-white/5 rounded-2xl flex flex-col items-center gap-3">
              <span className="text-3xl">🎨</span>
              <p className="text-white font-medium text-sm">No rooms found</p>
              <p className="text-muted text-xs max-w-sm">
                {searchQuery
                  ? 'No room matched your search term.'
                  : 'Create a room using the form above to get started, or restore from an existing backup.'}
              </p>
              <button
                onClick={loadRooms}
                className="text-xs bg-surface border border-white/10 hover:border-white/30 text-white px-4 py-1.5 rounded-lg transition-colors mt-1"
              >
                ↻ Refresh Directory
              </button>
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
                    className="bg-surface/90 border border-white/10 hover:border-white/20 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all shadow-lg hover:shadow-xl group"
                  >
                    {/* Header */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-white text-base group-hover:text-accent transition-colors truncate">
                          {room.name || `Room ${room.id.slice(0, 4)}`}
                        </h3>
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

                    {/* Meta stats */}
                    <div className="flex items-center justify-between text-xs text-muted border-t border-white/5 pt-3">
                      <div className="flex items-center gap-3">
                        <span>🎨 {room.objectCount || 0} items</span>
                        {room.mediaCount > 0 && <span>▶ {room.mediaCount} video(s)</span>}
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteRoom(room.id, room.name)}
                          title="Admin: Permanently delete this room"
                          className="text-[11px] text-red-400 hover:text-red-300 hover:underline transition-colors"
                        >
                          🗑️ Delete Room
                        </button>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 pt-1">
                      {isAdmin ? (
                        /* Admin Controls for each room */
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => navigate(`/room/${room.id}`)}
                            className="w-full bg-purple-700 hover:bg-purple-600 text-white font-semibold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                          >
                            <span>👑</span> Enter Room as Admin
                          </button>
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
                      ) : (
                        /* Normal user access button */
                        <button
                          onClick={() => {
                            setSelectedRoomForJoin(room);
                            setJoinPassword('');
                            setJoinError('');
                          }}
                          className="w-full bg-accent hover:bg-accent-hover text-white font-semibold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                        >
                          <span>🔑</span> Enter Room (Password Required)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── Admin Passcode Modal ────────────────────────────────────────────── */}
      {showAdminModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdminModal(false); }}
        >
          <div className="bg-surface border border-purple-500/30 rounded-2xl shadow-2xl p-7 w-full max-w-sm">
            <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <span>👑</span> Master Admin Access
            </h3>
            <p className="text-muted text-xs mb-5">
              Enter your master admin passcode to manage, lock, or auto-lock any room without passwords.
            </p>

            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  Master Admin Passcode
                </label>
                <input
                  type="password"
                  autoFocus
                  value={adminInputKey}
                  onChange={(e) => setAdminInputKey(e.target.value)}
                  placeholder="Enter passcode"
                  className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {adminError && <p className="text-red-400 text-xs">{adminError}</p>}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="submit"
                  className="flex-1 bg-purple-700 hover:bg-purple-600 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                >
                  Authorize Admin
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdminModal(false)}
                  className="px-4 border border-white/10 text-muted hover:text-white py-2 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Normal User Room Password Modal ─────────────────────────────────── */}
      {selectedRoomForJoin && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedRoomForJoin(null); }}
        >
          <div className="bg-surface border border-white/10 rounded-2xl shadow-2xl p-7 w-full max-w-sm">
            <h3 className="text-lg font-bold text-white mb-1">
              Enter Room Password
            </h3>
            <p className="text-muted text-xs mb-5">
              Room: <strong className="text-white">{selectedRoomForJoin.name}</strong> ({selectedRoomForJoin.id})
            </p>

            <form onSubmit={handleUserJoin} className="space-y-4">
              <div>
                <input
                  type="password"
                  autoFocus
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  placeholder="Enter room password"
                  className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {joinError && <p className="text-red-400 text-xs">{joinError}</p>}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="submit"
                  disabled={joinLoading}
                  className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                >
                  {joinLoading ? 'Verifying…' : 'Enter Room'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRoomForJoin(null)}
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
