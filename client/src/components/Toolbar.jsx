import { useRef, useState } from 'react';
import { compressImage } from '../lib/imageCompressor.js';

const TOOLS = [
  { id: 'select', icon: '↖', label: 'Select & Move' },
  { id: 'hand',   icon: '✋', label: 'Hand (Pan Canvas)' },
  { id: 'pen',    icon: '✏️', label: 'Pen' },
  { id: 'eraser', icon: '🧹', label: 'Eraser' },
  { id: 'rect',   icon: '▭', label: 'Rectangle' },
  { id: 'circle', icon: '◯', label: 'Circle' },
  { id: 'text',   icon: 'T', label: 'Text' },
];

const COLORS = [
  '#ffffff', '#f87171', '#fb923c', '#fbbf24',
  '#4ade80', '#60a5fa', '#c084fc', '#f472b6',
];

export default function Toolbar({
  activeTool, setActiveTool,
  activeColor, setActiveColor,
  brushSize, setBrushSize,
  canvasRef,
  roomId,
  isAdmin,
  isLocked,
  autoLockEnabled,
  onToggleLock,
  onToggleAutoLock,
  onAddYoutube,
}) {
  const fileInputRef = useRef(null);
  const [showMobileColors, setShowMobileColors] = useState(false);
  const [mobileCollapsed, setMobileCollapsed] = useState(false);

  function handleToolClick(toolId) {
    if (toolId === 'rect' || toolId === 'circle') {
      canvasRef.current?.addShape(toolId);
      setActiveTool('select');
    } else if (toolId === 'text') {
      canvasRef.current?.addText();
      setActiveTool('select');
    } else {
      setActiveTool(toolId);
    }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressedDataUrl = await compressImage(file, 1200, 0.82);
      canvasRef.current?.addImageFromDataURL(compressedDataUrl);
    } catch (err) {
      console.error('Image upload failed:', err);
    } finally {
      e.target.value = '';
    }
  }

  function handleSaveCheckpoint() {
    canvasRef.current?.saveCheckpoint();
  }

  return (
    <>
      {/* ── DESKTOP SIDEBAR (>= md) ────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col items-center gap-2.5 w-16 bg-surface border-r border-white/10 py-3 z-20 shrink-0 overflow-y-auto">
        {TOOLS.map((t) => (
          <ToolBtn
            key={t.id}
            icon={t.icon}
            label={t.label}
            active={activeTool === t.id}
            onClick={() => handleToolClick(t.id)}
          />
        ))}

        <Divider />

        {/* Color palette */}
        <div className="flex flex-col gap-1.5 items-center">
          {COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => setActiveColor(c)}
              style={{ backgroundColor: c }}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${
                activeColor === c
                  ? 'border-accent scale-125'
                  : 'border-transparent hover:scale-110'
              }`}
            />
          ))}
          <label title="Custom colour" className="cursor-pointer">
            <span className="text-lg">🎨</span>
            <input
              type="color"
              className="hidden"
              value={activeColor}
              onChange={(e) => setActiveColor(e.target.value)}
            />
          </label>
        </div>

        <Divider />

        {/* Brush size */}
        <div className="flex flex-col items-center gap-1 w-12">
          <span className="text-muted text-[10px]">Size</span>
          <input
            type="range"
            min={1}
            max={40}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-10 accent-accent"
          />
          <span className="text-muted text-[10px]">{brushSize}px</span>
        </div>

        <Divider />

        {/* Media / Rich Tools */}
        <ToolBtn
          icon="🖼"
          label="Upload Image"
          onClick={() => fileInputRef.current?.click()}
        />
        <ToolBtn icon="▶" label="Embed YouTube" onClick={onAddYoutube} />
        <ToolBtn
          icon="🔗"
          label="Add Link to Selection"
          onClick={() => canvasRef.current?.addHyperlinkToSelected()}
        />

        <Divider />

        {/* Undo & Redo */}
        <ToolBtn
          icon="↩"
          label="Undo (Ctrl+Z)"
          onClick={() => canvasRef.current?.undo()}
        />
        <ToolBtn
          icon="↪"
          label="Redo (Ctrl+Y)"
          onClick={() => canvasRef.current?.redo()}
        />

        {/* Hide / Unhide Selected Object (Replaces destructive deletion) */}
        <ToolBtn
          icon="👁️‍🗨️"
          label="Hide / Unhide Selected"
          onClick={() => canvasRef.current?.toggleHideSelected()}
        />

        {/* Admin only: Delete selected if admin wishes */}
        {isAdmin && (
          <ToolBtn
            icon="🗑️"
            label="Admin: Delete Selected"
            onClick={() => canvasRef.current?.deleteSelected()}
            danger
          />
        )}

        <Divider />

        {/* Save Checkpoint (Flatten) */}
        <ToolBtn
          icon="💾"
          label="Save Checkpoint (Flatten)"
          onClick={handleSaveCheckpoint}
        />

        {/* Admin Lock Toggles */}
        {isAdmin && (
          <>
            <Divider />
            <ToolBtn
              icon={isLocked ? '🔒' : '🔓'}
              label={isLocked ? 'Room is Locked (Click to Unlock)' : 'Lock Room Permanently'}
              active={isLocked}
              onClick={onToggleLock}
            />
            <ToolBtn
              icon="⏱️"
              label={autoLockEnabled ? 'Auto-Lock is ON (Click to Disable)' : 'Enable Auto-Lock for Users'}
              active={autoLockEnabled}
              onClick={onToggleAutoLock}
            />
          </>
        )}
      </aside>

      {/* ── MOBILE FLOATING BOTTOM BAR (< md) ──────────────────────────────── */}
      <div className="md:hidden fixed bottom-3 left-2 right-2 z-30 flex flex-col items-center gap-2 pointer-events-none">
        {/* Mobile Color & Brush Popover */}
        {showMobileColors && !mobileCollapsed && (
          <div className="pointer-events-auto bg-surface/95 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl flex flex-col gap-2 w-full max-w-sm animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted font-medium">Palette & Brush</span>
              <button
                onClick={() => setShowMobileColors(false)}
                className="text-xs text-muted hover:text-white px-2 py-0.5"
              >
                ✕
              </button>
            </div>
            {/* Color circles */}
            <div className="flex items-center justify-between gap-1 overflow-x-auto py-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { setActiveColor(c); setShowMobileColors(false); }}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full border-2 shrink-0 ${
                    activeColor === c ? 'border-accent scale-110' : 'border-transparent'
                  }`}
                />
              ))}
              <label className="cursor-pointer shrink-0 ml-1">
                <span className="text-xl">🎨</span>
                <input
                  type="color"
                  className="hidden"
                  value={activeColor}
                  onChange={(e) => setActiveColor(e.target.value)}
                />
              </label>
            </div>
            {/* Brush slider */}
            <div className="flex items-center gap-3 pt-1 border-t border-white/10">
              <span className="text-xs text-muted shrink-0">Size: {brushSize}px</span>
              <input
                type="range"
                min={1}
                max={40}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
            </div>
          </div>
        )}

        {/* Floating action row */}
        <div className="pointer-events-auto bg-surface/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-1 flex items-center justify-between max-w-full overflow-hidden">
          {/* Collapse/Expand Toggle */}
          <button
            onClick={() => setMobileCollapsed((prev) => !prev)}
            title={mobileCollapsed ? 'Show Toolbar' : 'Hide Toolbar'}
            className="w-8 h-10 flex items-center justify-center text-muted hover:text-white shrink-0 border-r border-white/10 mr-1"
          >
            {mobileCollapsed ? '▲' : '▼'}
          </button>

          {!mobileCollapsed && (
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 px-1">
              {TOOLS.map((t) => (
                <ToolBtn
                  key={t.id}
                  icon={t.icon}
                  label={t.label}
                  active={activeTool === t.id}
                  onClick={() => handleToolClick(t.id)}
                />
              ))}

              {/* Color popover trigger */}
              <button
                onClick={() => setShowMobileColors((prev) => !prev)}
                title="Color & Size"
                className="w-10 h-10 rounded-xl flex items-center justify-center relative shrink-0"
              >
                <span
                  style={{ backgroundColor: activeColor }}
                  className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                />
              </button>

              <ToolBtn
                icon="🖼"
                label="Image"
                onClick={() => fileInputRef.current?.click()}
              />
              <ToolBtn icon="▶" label="YouTube" onClick={onAddYoutube} />
              <ToolBtn
                icon="🔗"
                label="Link"
                onClick={() => canvasRef.current?.addHyperlinkToSelected()}
              />
              <ToolBtn
                icon="↩"
                label="Undo"
                onClick={() => canvasRef.current?.undo()}
              />
              <ToolBtn
                icon="↪"
                label="Redo"
                onClick={() => canvasRef.current?.redo()}
              />
              <ToolBtn
                icon="👁️‍🗨️"
                label="Hide"
                onClick={() => canvasRef.current?.toggleHideSelected()}
              />
              {isAdmin && (
                <ToolBtn
                  icon="🗑️"
                  label="Delete"
                  onClick={() => canvasRef.current?.deleteSelected()}
                  danger
                />
              )}
              <ToolBtn
                icon="💾"
                label="Save"
                onClick={handleSaveCheckpoint}
              />
              {isAdmin && (
                <>
                  <ToolBtn
                    icon={isLocked ? '🔒' : '🔓'}
                    label="Lock"
                    active={isLocked}
                    onClick={onToggleLock}
                  />
                  <ToolBtn
                    icon="⏱️"
                    label="AutoLock"
                    active={autoLockEnabled}
                    onClick={onToggleAutoLock}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hidden File Input for Image Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />
    </>
  );
}

function ToolBtn({ icon, label, active, onClick, danger }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`w-10 h-10 rounded-xl flex items-center justify-center text-base shrink-0 transition-all active:scale-95
        ${active
          ? 'bg-accent text-white shadow-lg shadow-accent/40'
          : danger
          ? 'text-red-400 hover:bg-red-900/40 active:bg-red-900/60'
          : 'text-muted hover:bg-white/10 hover:text-white'
        }`}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <div className="w-8 border-t border-white/10 my-1 shrink-0" />;
}
