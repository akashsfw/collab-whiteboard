import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchRooms, createRoom } from '../lib/api.js';

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
          <span className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Collab<span className="text-accent">Board</span>
          </span>
          <span className="text-xs bg-white/5 border border-white/10 text-muted px-2.5 py-1 rounded-full font-mono">
            {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} active
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/admin')}
            className="text-xs sm:text-sm bg-purple-950/60 border border-purple-500/50 text-purple-300 hover:bg-purple-900/60 font-bold px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5"
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
              Create and join collaborative rooms. Everyone enters in Observer Mode by default and can easily switch to Editor or Admin mode inside the room.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="text-xs bg-surface border border-white/10 px-3 py-1 rounded-full text-muted">
                👁️ Observer by Default
              </span>
              <span className="text-xs bg-surface border border-white/10 px-3 py-1 rounded-full text-muted">
                ✏️ Password-protected Editor
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
              Set a room name and creator password. Anyone with this password can unlock Editor Mode.
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
                Click any room to open and view immediately in Observer Mode.
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
                    onClick={() => navigate(`/room/${room.id}`)}
                    className="bg-surface/90 border border-white/10 hover:border-accent/40 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all shadow-lg hover:shadow-xl group cursor-pointer"
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
                      <span className="text-accent group-hover:underline text-[11px] font-semibold">
                        Enter Room →
                      </span>
                    </div>

                    {/* Direct One-Click Button to Enter Room in Observer Mode */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/room/${room.id}`);
                      }}
                      className="w-full bg-accent/90 hover:bg-accent text-white font-semibold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span>👁️</span> Enter Room (Observer Mode)
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
