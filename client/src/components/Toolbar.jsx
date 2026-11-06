import { useRef } from 'react';

const TOOLS = [
  { id: 'select', icon: '↖', label: 'Select' },
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
  onAddYoutube,
}) {
  const fileInputRef = useRef(null);

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

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => canvasRef.current?.addImageFromDataURL(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleClear() {
    if (window.confirm('Clear the entire canvas? This cannot be undone.')) {
      canvasRef.current?.clearCanvas();
    }
  }

  return (
    <aside className="flex flex-col items-center gap-3 w-16 bg-surface border-r border-white/10 py-4 z-10 shrink-0 overflow-y-auto">
      {/* Drawing tools */}
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
        {/* Custom colour picker */}
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
          style={{ writingMode: 'horizontal-tb' }}
        />
        <span className="text-muted text-[10px]">{brushSize}px</span>
      </div>

      <Divider />

      {/* Image upload */}
      <ToolBtn
        icon="🖼"
        label="Upload Image"
        onClick={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />

      {/* YouTube embed */}
      <ToolBtn icon="▶" label="Embed YouTube" onClick={onAddYoutube} />

      {/* Add Hyperlink to Selected Object */}
      <ToolBtn
        icon="🔗"
        label="Add Link to Selection"
        onClick={() => canvasRef.current?.addHyperlinkToSelected()}
      />

      <Divider />

      {/* Clear */}
      <ToolBtn icon="🗑" label="Clear Canvas" onClick={handleClear} danger />
    </aside>
  );
}

function ToolBtn({ icon, label, active, onClick, danger }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all
        ${active
          ? 'bg-accent text-white shadow-lg shadow-accent/40'
          : danger
          ? 'text-red-400 hover:bg-red-900/40'
          : 'text-muted hover:bg-white/10 hover:text-white'
        }`}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <div className="w-8 border-t border-white/10 my-1" />;
}
