import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../lib/api.js';

export default function HomePage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (password.trim().length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    setLoading(true);
    try {
      const { roomId } = await createRoom(password.trim());
      navigate(`/room/${roomId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-canvas px-4">
      {/* Hero */}
      <div className="mb-8 sm:mb-10 text-center">
        <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mb-2 sm:mb-3">
          Collab<span className="text-accent">Board</span>
        </h1>
        <p className="text-muted text-sm sm:text-lg max-w-md px-2">
          A real-time collaborative whiteboard with YouTube embeds, image uploads,
          and password-protected editor access.
        </p>
      </div>

      {/* Create Room Card */}
      <div className="bg-surface border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-sm">
        <h2 className="text-xl font-semibold text-white mb-1">Create a Room</h2>
        <p className="text-muted text-sm mb-6">
          Anyone with the link can observe. Only those with your password can draw.
        </p>

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="pw">
              Editor Password
            </label>
            <input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 4 characters"
              className="w-full bg-canvas border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Creating…' : '✦ Create Room'}
          </button>
        </form>
      </div>

      <p className="mt-8 text-muted text-sm">
        Already have a room URL? Just paste it in the browser.
      </p>
    </div>
  );
}
