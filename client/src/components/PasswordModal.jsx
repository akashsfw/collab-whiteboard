import { useState } from 'react';

/**
 * PasswordModal
 * Presented to users who click "Enter Password to Edit" or "👑 Admin Login".
 * Supports both standard room passwords and master admin passcode elevation.
 */
export default function PasswordModal({
  error,
  onSubmit,
  onAdminSubmit,
  onClose,
  initialTab = 'user',
}) {
  const [tab, setTab] = useState(initialTab); // 'user' | 'admin'
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
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal */}
      <div className="bg-surface border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-7 w-full max-w-sm">
        {/* Tab Switcher */}
        <div className="flex border-b border-white/10 mb-5">
          <button
            type="button"
            onClick={() => setTab('user')}
            className={`flex-1 pb-2.5 text-xs font-bold transition-colors border-b-2 ${
              tab === 'user'
                ? 'border-accent text-white'
                : 'border-transparent text-muted hover:text-white'
            }`}
          >
            🔑 Room Password
          </button>
          <button
            type="button"
            onClick={() => setTab('admin')}
            className={`flex-1 pb-2.5 text-xs font-bold transition-colors border-b-2 ${
              tab === 'admin'
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-muted hover:text-purple-300'
            }`}
          >
            👑 Master Admin
          </button>
        </div>

        {tab === 'user' ? (
          <div>
            <h2 className="text-lg font-bold text-white mb-1">Enter Room Password</h2>
            <p className="text-muted text-xs mb-4">
              Enter this room's password to unlock drawing tools and editor mode.
            </p>

            <form onSubmit={handleUserSubmit} className="space-y-4">
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter room password"
                className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
              />

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="submit"
                  className="flex-1 bg-accent hover:bg-accent-hover text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                >
                  Unlock Editor
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
              Enter your master admin passcode to gain full management and editing access.
            </p>

            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <input
                type="password"
                autoFocus
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Enter master passcode (e.g. admin2026)"
                className="w-full bg-canvas border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />

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
