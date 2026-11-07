import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, verifyRoomPassword } from '../lib/api.js';

export default function HomePage() {
  const navigate = useNavigate();

  // Create room state
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomAutoLock, setNewRoomAutoLock] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Join room state
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState('');

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

  // ── Join Existing Room ───────────────────────────────────────────────────
  async function handleJoin(e) {
    e.preventDefault();
    setJoinError('');
    const id = joinRoomId.trim().toLowerCase();
    if (!id) {
      setJoinError('Please enter a Room ID.');
      return;
    }
    if (!joinPassword.trim()) {
      setJoinError('Please enter the room password.');
      return;
    }

    setJoinLoading(true);
    try {
      await verifyRoomPassword(id, joinPassword.trim());
      navigate(`/room/${id}`);
    } catch (err) {
      setJoinError(err.message || 'Incorrect room password or room does not exist.');
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-canvas text-[#e2e2f0] flex flex-col overflow-y-auto">
      {/* ── Top Navigation Bar ────────────────────────────────────────────── */}
      <header className="border-b border-white/10 bg-surface/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black text-white tracking-tight">
            Collab<span className="text-accent">Board</span>
          </span>
          <span className="text-xs bg-white/5 border border-white/10 text-muted px-2.5 py-1 rounded-full">
            Real-time Whiteboard
          </span>
        </div>

        <div>
          <button
            onClick={() => navigate('/admin')}
            className="text-xs sm:text-sm bg-surface border border-purple-500/50 text-purple-300 hover:bg-purple-950/60 hover:border-purple-400 font-bold px-4 py-2 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-purple-950/20"
          >
            <span>👑</span> Admin Access
          </button>
        </div>
      </header>

      {/* ── Main Container ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-10 pb-28 flex flex-col gap-10">
        {/* Hero Banner */}
        <div className="text-center max-w-2xl mx-auto flex flex-col gap-3">
          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            Infinite Collaborative <span className="text-accent">Whiteboard</span>.
          </h1>
          <p className="text-muted text-sm sm:text-base leading-relaxed">
            Create password-protected rooms, draw simultaneously, upload images,
            embed interactive YouTube players, and flatten checkpoints with full administrative control.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
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
              🔒 Admin Lock & Auto-Lock
            </span>
          </div>
        </div>

        {/* Action Cards: Create Room & Join Room */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {/* Card 1: Create a New Room */}
          <div className="bg-surface border border-white/10 rounded-2xl shadow-xl p-6 sm:p-7 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">✦</span>
                <h2 className="text-lg font-bold text-white">Create a New Room</h2>
              </div>
              <p className="text-muted text-xs mb-5">
                Start a fresh canvas. Anyone with the room link and password can join.
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

          {/* Card 2: Join an Existing Room by ID */}
          <div className="bg-surface border border-white/10 rounded-2xl shadow-xl p-6 sm:p-7 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🔑</span>
                <h2 className="text-lg font-bold text-white">Join an Existing Room</h2>
              </div>
              <p className="text-muted text-xs mb-5">
                Have a Room ID? Enter it with the room password to join immediately.
              </p>

              <form onSubmit={handleJoin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1" htmlFor="join-id">
                    Room ID <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="join-id"
                    type="text"
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value)}
                    placeholder="e.g. main-board or abcd-efgh-ijkl"
                    className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted mb-1" htmlFor="join-pw">
                    Room Access Password <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="join-pw"
                    type="password"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                {joinError && <p className="text-red-400 text-xs">{joinError}</p>}

                <button
                  type="submit"
                  disabled={joinLoading}
                  className="w-full bg-surface border border-white/20 hover:border-white/40 text-white font-semibold py-2.5 rounded-lg text-sm transition-all shadow-md mt-6"
                >
                  {joinLoading ? 'Verifying…' : 'Enter Room →'}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* ── Admin Portal Banner ────────────────────────────────────────── */}
        <div className="bg-purple-950/30 border border-purple-500/30 rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="text-3xl sm:text-4xl">👑</span>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Looking for all created rooms?
              </h2>
              <p className="text-xs text-purple-200/70 mt-0.5">
                Access to the complete directory of all rooms ever created is protected by the Master Admin password.
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate('/admin')}
            className="w-full sm:w-auto bg-purple-700 hover:bg-purple-600 text-white font-semibold px-5 py-2.5 rounded-xl text-xs sm:text-sm transition-colors shrink-0 shadow-lg shadow-purple-950/40"
          >
            Open Admin Access →
          </button>
        </div>
      </main>
    </div>
  );
}
