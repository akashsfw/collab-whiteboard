import { useState } from 'react';

/**
 * PasswordModal
 * Presented to users inside a room who want to unlock Editor Mode or Admin Mode.
 * Has the two options above (Editor Mode vs Admin Mode).
 */
export default function PasswordModal({
  error,
  onSubmit,
  onAdminSubmit,
  onClose,
  initialTab = 'user',
}) {
  const [tab, setTab] = useState(initialTab === 'admin' ? 'admin' : 'user'); // 'user' | 'admin'
  const [password, setPassword] = useState('');
  const [adminKey, setAdminKey] = useState('');

  function handleUserSubmit(e) {
    e.preventDefault();
    if (password.trim() && onSubmit) onSubmit(password.trim());
  }

  function handleAdminSubmit(e) {
    e.preventDefault();
    if (adminKey.trim() && onAdminSubmit) onAdminSubmit(adminKey.trim());
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal */}
      <div className="bg-surface border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-7 w-full max-w-sm">
        {/* TWO OPTIONS ABOVE: Tab Selector */}
        <div className="grid grid-cols-2 p-1 bg-canvas rounded-xl mb-5 border border-white/10">
          <button
            type="button"
            onClick={() => setTab('user')}
            className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'user'
                ? 'bg-accent text-white shadow-md'
                : 'text-muted hover:text-white'
            }`}
          >
            <span>✏️</span> Editor Mode
          </button>
          <button
            type="button"
            onClick={() => setTab('admin')}
            className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'admin'
                ? 'bg-purple-700 text-white shadow-md'
                : 'text-muted hover:text-purple-300'
            }`}
          >
            <span>👑</span> Admin Mode
          </button>
        </div>

        {tab === 'user' ? (
          <div>
            <h2 className="text-lg font-bold text-white mb-1">Enter Room Password</h2>
            <p className="text-muted text-xs mb-4">
              Enter the room password set by the creator to unlock drawing tools and editor mode.
            </p>

            <form onSubmit={handleUserSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter creator password"
                  className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="submit"
                  className="flex-1 bg-accent hover:bg-accent-hover text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                >
                  Unlock as Editor
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 border border-white/10 text-muted hover:text-white py-2 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-1.5">
              <span>👑</span> Master Admin Access
            </h2>
            <p className="text-muted text-xs mb-4">
              Enter the master admin password to unlock management and editing privileges.
            </p>

            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  autoFocus
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="submit"
                  className="flex-1 bg-purple-700 hover:bg-purple-600 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                >
                  Authorize Admin
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 border border-white/10 text-muted hover:text-white py-2 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
