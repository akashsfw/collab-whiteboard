import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import * as fabric from 'fabric';
import { getSocket } from '../lib/socket.js';

/**
 * WhiteboardCanvas
 *
 * Wraps a Fabric.js canvas and wires up:
 *   - Drawing tools (pen, eraser, shapes, text)
 *   - Image upload (via file or drag-drop)
 *   - Socket.io real-time sync (bi-directional)
 *   - Viewport (pan/zoom) reporting for media overlay sync
 */
const WhiteboardCanvas = forwardRef(function WhiteboardCanvas(
  {
    roomId,
    isEditor,
    activeTool,
    activeColor,
    brushSize,
    initialCanvas,
    onViewportChange,
  },
  ref
) {
  const containerRef = useRef(null);
  const fabricRef = useRef(null);   // fabric.Canvas instance
  const isSyncing = useRef(false);  // prevent echo loops

  // ── Expose canvas ref to parent ──────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getCanvas: () => fabricRef.current,
    addImageFromDataURL: (dataUrl) => {
      fabric.Image.fromURL(dataUrl, (img) => {
        img.scaleToWidth(300);
        fabricRef.current.add(img);
        fabricRef.current.setActiveObject(img);
        fabricRef.current.renderAll();
        emitObjectAdded(img);
      });
    },
  }));

  // ── Initialise Fabric canvas ─────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    const canvas = new fabric.Canvas('whiteboard-canvas', {
      width: el.clientWidth,
      height: el.clientHeight,
      backgroundColor: '#1e1e2e',
      selection: isEditor,
      isDrawingMode: false,
    });
    fabricRef.current = canvas;

    // Responsive resize
    const observer = new ResizeObserver(() => {
      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      canvas.renderAll();
    });
    observer.observe(el);

    // Pan on middle-mouse or Alt+drag
    canvas.on('mouse:down', (opt) => {
      if (!opt.e.altKey) return;
      canvas._isDragging = true;
      canvas._lastPosX = opt.e.clientX;
      canvas._lastPosY = opt.e.clientY;
    });
    canvas.on('mouse:move', (opt) => {
      if (!canvas._isDragging) return;
      const vpt = canvas.viewportTransform.slice();
      vpt[4] += opt.e.clientX - canvas._lastPosX;
      vpt[5] += opt.e.clientY - canvas._lastPosY;
      canvas.setViewportTransform(vpt);
      canvas._lastPosX = opt.e.clientX;
      canvas._lastPosY = opt.e.clientY;
      reportViewport(canvas);
    });
    canvas.on('mouse:up', () => { canvas._isDragging = false; });

    // Scroll-to-zoom
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.max(0.2, Math.min(10, zoom));
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
      reportViewport(canvas);
    });

    // Drag-and-drop image upload
    el.addEventListener('dragover', (e) => { e.preventDefault(); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!isEditor) return;
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) readAndAddImage(file, canvas);
    });

    return () => {
      observer.disconnect();
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // ── Load initial canvas state from server ─────────────────────────────────
  useEffect(() => {
    if (!fabricRef.current || !initialCanvas) return;
    if (Array.isArray(initialCanvas) && initialCanvas.length === 0) return;
    isSyncing.current = true;
    fabricRef.current.loadFromJSON(
      Array.isArray(initialCanvas)
        ? { objects: initialCanvas }
        : initialCanvas,
      () => {
        fabricRef.current.renderAll();
        isSyncing.current = false;
      }
    );
  }, [initialCanvas]);

  // ── Tool mode switching ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = false;
    canvas.selection = isEditor;
    canvas.getObjects().forEach((o) => { o.selectable = isEditor; o.evented = isEditor; });

    if (!isEditor) { canvas.renderAll(); return; }

    switch (activeTool) {
      case 'pen':
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.color = activeColor;
        canvas.freeDrawingBrush.width = brushSize;
        break;
      case 'eraser':
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.color = '#1e1e2e'; // paint over with bg colour
        canvas.freeDrawingBrush.width = brushSize * 4;
        break;
      case 'select':
      default:
        canvas.isDrawingMode = false;
        break;
    }
    canvas.renderAll();
  }, [activeTool, activeColor, brushSize, isEditor]);

  // ── Socket event wiring ───────────────────────────────────────────────────
  const emitObjectAdded = useCallback((obj) => {
    if (isSyncing.current) return;
    const socket = getSocket();
    socket.emit('canvas:object:added', { roomId, object: obj.toObject(['id', 'hyperlink']) });
    // Also do a full sync so server state is accurate
    const json = fabricRef.current.toJSON(['hyperlink']);
    socket.emit('canvas:sync', { roomId, canvasJSON: json });
  }, [roomId]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    function onObjectAdded({ target }) {
      if (!isEditor || isSyncing.current || !target) return;
      emitObjectAdded(target);
    }
    function onObjectModified({ target }) {
      if (!isEditor || isSyncing.current || !target) return;
      const socket = getSocket();
      socket.emit('canvas:object:modified', { roomId, object: target.toObject(['id', 'hyperlink']) });
      socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON(['hyperlink']) });
    }
    function onObjectRemoved({ target }) {
      if (!isEditor || isSyncing.current || !target) return;
      const socket = getSocket();
      socket.emit('canvas:object:removed', { roomId });
      socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON(['hyperlink']) });
    }

    // Click handler for clickable hyperlinks
    function onMouseDown(opt) {
      const target = opt.target;
      if (target && target.hyperlink) {
        // If observer, direct click opens link. If editor, ctrl/cmd click opens link or if not in drawing mode
        if (!isEditor || opt.e.ctrlKey || opt.e.metaKey) {
          window.open(target.hyperlink, '_blank', 'noopener,noreferrer');
        }
      }
    }

    canvas.on('object:added', onObjectAdded);
    canvas.on('object:modified', onObjectModified);
    canvas.on('object:removed', onObjectRemoved);
    canvas.on('mouse:down', onMouseDown);

    // Receive full canvas sync from peers
    const socket = getSocket();
    socket.on('canvas:sync', ({ canvasJSON }) => {
      isSyncing.current = true;
      canvas.loadFromJSON(canvasJSON, () => {
        canvas.renderAll();
        isSyncing.current = false;
        // Keep objects non-interactive for observers but allow click for hyperlinks
        if (!isEditor) {
          canvas.getObjects().forEach((o) => {
            o.selectable = false;
            o.evented = !!o.hyperlink; // allow clicking if has hyperlink
            if (o.hyperlink) o.hoverCursor = 'pointer';
          });
        }
      });
    });

    return () => {
      canvas.off('object:added', onObjectAdded);
      canvas.off('object:modified', onObjectModified);
      canvas.off('object:removed', onObjectRemoved);
      canvas.off('mouse:down', onMouseDown);
      socket.off('canvas:sync');
    };
  }, [roomId, isEditor, emitObjectAdded]);

  // ── Shape insertion & Hyperlinks (called from Toolbar via canvasRef) ────
  useImperativeHandle(ref, () => ({
    getCanvas: () => fabricRef.current,

    addShape(type) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      let shape;
      const opts = { left: 120, top: 120, fill: 'transparent', stroke: activeColor, strokeWidth: 2 };
      if (type === 'rect') shape = new fabric.Rect({ ...opts, width: 150, height: 100 });
      else if (type === 'circle') shape = new fabric.Ellipse({ ...opts, rx: 75, ry: 50 });
      canvas.add(shape);
      canvas.setActiveObject(shape);
      canvas.renderAll();
    },

    addText() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const text = new fabric.IText('Double-click to edit', {
        left: 150, top: 150,
        fill: activeColor,
        fontSize: 20,
        fontFamily: 'Inter, sans-serif',
      });
      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.renderAll();
    },

    addHyperlinkToSelected() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const activeObj = canvas.getActiveObject();
      if (!activeObj) {
        alert('Please select an object or text on the canvas first.');
        return;
      }
      const existing = activeObj.hyperlink || 'https://';
      const url = prompt('Enter website URL for this object:', existing);
      if (url === null) return;
      if (url.trim()) {
        activeObj.set({
          hyperlink: url.trim(),
          underline: true,
          hoverCursor: 'pointer',
        });
        if (activeObj.type === 'i-text') {
          activeObj.set({ fill: '#60a5fa' }); // blue link colour
        }
      } else {
        activeObj.set({ hyperlink: undefined, underline: false });
      }
      canvas.renderAll();
      const socket = getSocket();
      socket.emit('canvas:object:modified', { roomId, object: activeObj.toObject(['id', 'hyperlink']) });
      socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON(['hyperlink']) });
    },

    addImageFromDataURL(dataUrl) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      fabric.Image.fromURL(dataUrl, (img) => {
        img.scaleToWidth(300);
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
        emitObjectAdded(img);
      });
    },

    clearCanvas() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.clear();
      canvas.backgroundColor = '#1e1e2e';
      canvas.renderAll();
      const socket = getSocket();
      socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON() });
    },
  }), [activeColor, roomId, emitObjectAdded]);

  // ── Cursor broadcast ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.on('mouse:move', ({ e }) => {
      const pt = canvas.getPointer(e);
      getSocket().emit('cursor:move', { x: pt.x, y: pt.y });
    });
  }, []);

  // ── Viewport reporting helper ─────────────────────────────────────────────
  function reportViewport(canvas) {
    const vpt = canvas.viewportTransform;
    onViewportChange?.({ x: vpt[4], y: vpt[5], zoom: canvas.getZoom() });
  }

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas id="whiteboard-canvas" />
    </div>
  );
});

export default WhiteboardCanvas;

// ── Utilities ──────────────────────────────────────────────────────────────────
function readAndAddImage(file, canvas) {
  const reader = new FileReader();
  reader.onload = (e) => {
    fabric.Image.fromURL(e.target.result, (img) => {
      img.scaleToWidth(Math.min(300, canvas.width * 0.4));
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    });
  };
  reader.readAsDataURL(file);
}
