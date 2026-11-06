import { useState } from 'react';

/**
 * PasswordModal
 * Presented to observers who click "Enter Password to Edit".
 */
export default function PasswordModal({ error, onSubmit, onClose }) {
  const [password, setPassword] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (password.trim()) onSubmit(password.trim());
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal */}
      <div className="bg-surface border border-white/10 rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <h2 className="text-xl font-semibold text-white mb-1">Enter Editor Password</h2>
        <p className="text-muted text-sm mb-6">
          Enter the room password to unlock drawing tools and canvas editing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Room password"
            className="w-full bg-canvas border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              className="flex-1 bg-accent hover:bg-accent-hover text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              Unlock Editor
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-white/10 text-muted hover:text-white py-2.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
