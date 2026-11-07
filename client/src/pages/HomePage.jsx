import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchRooms,
  createRoom,
  verifyRoomPassword,
  verifyAdminKey,
} from '../lib/api.js';

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

  // Rooms list & loading
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create room state
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomAutoLock, setNewRoomAutoLock] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Modal for entering a room: Two Options Above (Editor Mode vs Admin Mode)
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [entryMode, setEntryMode] = useState('editor'); // 'editor' | 'admin'
  const [roomPassword, setRoomPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [entryError, setEntryError] = useState('');
  const [entryLoading, setEntryLoading] = useState(false);

  // ── Load rooms on mount ───────────────────────────────────────────────────
  useEffect(() => {
    loadRooms();
  }, []);

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
      setCreateError(err.message || 'Failed to create room.');
    } finally {
      setCreateLoading(false);
    }
  }

  // ── Enter Room (Editor Mode or Admin Mode) ─────────────────────────────────
  async function handleEnterRoom(e) {
    e.preventDefault();
    if (!selectedRoom) return;
    setEntryError('');
    setEntryLoading(true);

    try {
      if (entryMode === 'editor') {
        // Editor Mode: creator's room password
        if (!roomPassword.trim()) {
          setEntryError('Please enter the room password.');
          setEntryLoading(false);
          return;
        }
        await verifyRoomPassword(selectedRoom.id, roomPassword.trim());
        navigate(`/room/${selectedRoom.id}`);
      } else {
        // Admin Mode: fixed master password
        if (!adminPassword.trim()) {
          setEntryError('Please enter the admin password.');
          setEntryLoading(false);
          return;
        }
        await verifyAdminKey(adminPassword.trim());
        storeAdminKey(adminPassword.trim());
        navigate(`/room/${selectedRoom.id}`);
      }
    } catch (err) {
      setEntryError(err.message || 'Incorrect password.');
    } finally {
      setEntryLoading(false);
    }
  }

  function handleOpenRoomModal(room, defaultMode = 'editor') {
    setSelectedRoom(room);
    setEntryMode(defaultMode);
    setRoomPassword('');
    setAdminPassword('');
    setEntryError('');
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

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/admin')}
            className="text-xs sm:text-sm bg-purple-950/60 border border-purple-500/50 text-purple-300 hover:bg-purple-900/60 font-bold px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5"
          >
            <span>👑</span> Master Admin Portal
          </button>
        </div>
      </header>

      {/* ── Main Container ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 pb-28 flex flex-col gap-8">
        {/* Hero & Create Room Form */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Hero Description */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
              Real-time collaboration with <span className="text-accent">infinite freedom</span>.
            </h1>
            <p className="text-muted text-base sm:text-lg leading-relaxed">
              Create and join collaborative rooms. Draw together, upload images,
              embed interactive YouTube players, and flatten checkpoints with full Editor and Admin controls.
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
                🔒 Admin Lock & Timer
              </span>
            </div>
          </div>

          {/* Right Create Room Form */}
          <div className="lg:col-span-5 bg-surface border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-7">
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <span>✦</span> Create a New Room
            </h2>
            <p className="text-muted text-xs mb-5">
              Set a room name and creator password. Anyone with this password enters as an Editor.
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
                  Editor Room Password <span className="text-red-400">*</span>
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

        {/* ── All Created Rooms Directory Section ───────────────────────────── */}
        <section className="flex flex-col gap-4 pt-4 border-t border-white/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>📁</span> All Created Rooms
              </h2>
              <p className="text-xs text-muted">
                Common list of all rooms ever created, chronologically ordered.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search rooms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-surface border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-muted/50 focus:outline-none focus:ring-1 focus:ring-accent w-48 sm:w-60"
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
            <div className="text-center py-16 bg-surface/40 border border-white/5 rounded-2xl flex flex-col items-center gap-2">
              <span className="text-3xl">🎨</span>
              <p className="text-white font-medium text-sm">No rooms found</p>
              <p className="text-muted text-xs">
                {searchQuery ? 'Try a different search term.' : 'Create the first room above to get started!'}
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
                    <div className="flex items-center gap-3 text-xs text-muted border-t border-white/5 pt-3">
                      <span>🎨 {room.objectCount || 0} items</span>
                      {room.mediaCount > 0 && <span>▶ {room.mediaCount} video(s)</span>}
                    </div>

                    {/* Actions: Direct two-button choices or enter button */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                      <button
                        onClick={() => handleOpenRoomModal(room, 'editor')}
                        className="bg-accent hover:bg-accent-hover text-white font-semibold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
                      >
                        <span>✏️</span> Editor Mode
                      </button>
                      <button
                        onClick={() => handleOpenRoomModal(room, 'admin')}
                        className="bg-purple-900/60 hover:bg-purple-800/80 border border-purple-500/40 text-purple-200 font-semibold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
                      >
                        <span>👑</span> Admin Mode
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── Room Entry Modal: Two Options Above (Editor Mode vs Admin Mode) ─── */}
      {selectedRoom && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedRoom(null); }}
        >
          <div className="bg-surface border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-7 w-full max-w-sm">
            {/* Modal Room Title */}
            <div className="mb-4">
              <h3 className="text-base font-bold text-white truncate">
                {selectedRoom.name || selectedRoom.id}
              </h3>
              <p className="text-muted text-xs font-mono">ID: {selectedRoom.id}</p>
            </div>

            {/* TWO OPTIONS ABOVE: Tab Selector */}
            <div className="grid grid-cols-2 p-1 bg-canvas rounded-xl mb-5 border border-white/10">
              <button
                type="button"
                onClick={() => { setEntryMode('editor'); setEntryError(''); }}
                className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  entryMode === 'editor'
                    ? 'bg-accent text-white shadow-md'
                    : 'text-muted hover:text-white'
                }`}
              >
                <span>✏️</span> Editor Mode
              </button>
              <button
                type="button"
                onClick={() => { setEntryMode('admin'); setEntryError(''); }}
                className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  entryMode === 'admin'
                    ? 'bg-purple-700 text-white shadow-md'
                    : 'text-muted hover:text-purple-300'
                }`}
              >
                <span>👑</span> Admin Mode
              </button>
            </div>

            {/* Form for selected mode */}
            <form onSubmit={handleEnterRoom} className="space-y-4">
              {entryMode === 'editor' ? (
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1" htmlFor="creator-pw">
                    Room Creator Password
                  </label>
                  <input
                    id="creator-pw"
                    type="password"
                    autoFocus
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value)}
                    placeholder="Enter password set by creator"
                    className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <p className="text-[11px] text-muted mt-1.5">
                    For normal users who know the password created for this room.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1" htmlFor="fixed-admin-pw">
                    Master Admin Password
                  </label>
                  <input
                    id="fixed-admin-pw"
                    type="password"
                    autoFocus
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <p className="text-[11px] text-purple-300/80 mt-1.5">
                    Requires master admin privileges. Grants full rights to lock, edit, and delete.
                  </p>
                </div>
              )}

              {entryError && <p className="text-red-400 text-xs">{entryError}</p>}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="submit"
                  disabled={entryLoading}
                  className={`flex-1 font-semibold py-2 rounded-lg text-sm transition-colors text-white ${
                    entryMode === 'editor'
                      ? 'bg-accent hover:bg-accent-hover'
                      : 'bg-purple-700 hover:bg-purple-600'
                  }`}
                >
                  {entryLoading
                    ? 'Verifying…'
                    : entryMode === 'editor'
                    ? 'Enter as Editor'
                    : 'Enter as Admin'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRoom(null)}
                  className="px-4 border border-white/10 text-muted hover:text-white py-2 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>

              {/* Observer option */}
              <div className="text-center pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => navigate(`/room/${selectedRoom.id}`)}
                  className="text-xs text-muted hover:text-white transition-colors"
                >
                  Just want to view? Enter in Read-Only Observer Mode →
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
