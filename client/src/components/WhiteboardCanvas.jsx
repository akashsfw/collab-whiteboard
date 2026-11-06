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
 *   - Image upload (via file selector, drag-and-drop, or clipboard paste)
 *   - Hyperlinks on objects
 *   - Undo / Redo history management
 *   - Delete selected objects
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

  // ── Undo / Redo History Stacks ───────────────────────────────────────────
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const isHistoryAction = useRef(false);
  const pendingSnapshot = useRef(null);

  // Helper to record a state snapshot before modifications
  const recordSnapshot = useCallback(() => {
    if (!fabricRef.current || isSyncing.current || isHistoryAction.current) return;
    pendingSnapshot.current = JSON.stringify(fabricRef.current.toJSON(['hyperlink']));
  }, []);

  const pushSnapshotToUndo = useCallback(() => {
    if (!pendingSnapshot.current || isSyncing.current || isHistoryAction.current) return;
    undoStack.current.push(pendingSnapshot.current);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = []; // reset redo on new action
    pendingSnapshot.current = null;
  }, []);

  // ── Helper: Broadcast object changes ─────────────────────────────────────
  const emitObjectAdded = useCallback((obj) => {
    if (isSyncing.current || !fabricRef.current) return;
    const socket = getSocket();
    socket.emit('canvas:object:added', { roomId, object: obj.toObject(['id', 'hyperlink']) });
    const json = fabricRef.current.toJSON(['hyperlink']);
    socket.emit('canvas:sync', { roomId, canvasJSON: json });
  }, [roomId]);

  // ── Helper: Insert an image from Data URL onto canvas (Fabric v6 async) ──
  const addImageFromDataURL = useCallback(async (dataUrl) => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    try {
      recordSnapshot();

      const img = await fabric.FabricImage.fromURL(dataUrl);

      // Fit nicely within view
      const maxDim = Math.min(380, canvas.width * 0.75);
      img.scaleToWidth(maxDim);

      // Center in current viewport
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const zoom = canvas.getZoom() || 1;
      const centerX = (-vpt[4] + canvas.width / 2) / zoom;
      const centerY = (-vpt[5] + canvas.height / 2) / zoom;

      img.set({
        left: Math.max(20, centerX - (img.getScaledWidth() / 2)),
        top: Math.max(20, centerY - (img.getScaledHeight() / 2)),
        cornerColor: '#7c6af7',
        cornerSize: 10,
        transparentCorners: false,
        selectable: isEditor,
        evented: isEditor,
      });

      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();

      pushSnapshotToUndo();
      emitObjectAdded(img);
    } catch (err) {
      console.error('Failed to load image onto canvas:', err);
    }
  }, [isEditor, emitObjectAdded, recordSnapshot, pushSnapshotToUndo]);

  // ── Undo Action ──────────────────────────────────────────────────────────
  const undo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || undoStack.current.length === 0 || !isEditor) return;

    isHistoryAction.current = true;
    const currentJson = JSON.stringify(canvas.toJSON(['hyperlink']));
    redoStack.current.push(currentJson);

    const prevJsonStr = undoStack.current.pop();
    const prevJson = JSON.parse(prevJsonStr);

    await canvas.loadFromJSON(prevJson);
    canvas.renderAll();
    isHistoryAction.current = false;

    const socket = getSocket();
    socket.emit('canvas:sync', { roomId, canvasJSON: prevJson });
  }, [roomId, isEditor]);

  // ── Redo Action ──────────────────────────────────────────────────────────
  const redo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || redoStack.current.length === 0 || !isEditor) return;

    isHistoryAction.current = true;
    const currentJson = JSON.stringify(canvas.toJSON(['hyperlink']));
    undoStack.current.push(currentJson);

    const nextJsonStr = redoStack.current.pop();
    const nextJson = JSON.parse(nextJsonStr);

    await canvas.loadFromJSON(nextJson);
    canvas.renderAll();
    isHistoryAction.current = false;

    const socket = getSocket();
    socket.emit('canvas:sync', { roomId, canvasJSON: nextJson });
  }, [roomId, isEditor]);

  // ── Delete Selected Objects ──────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditor) return;

    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects || activeObjects.length === 0) return;

    recordSnapshot();
    canvas.discardActiveObject();
    canvas.remove(...activeObjects);
    canvas.renderAll();

    pushSnapshotToUndo();

    const socket = getSocket();
    socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON(['hyperlink']) });
  }, [isEditor, roomId, recordSnapshot, pushSnapshotToUndo]);

  // ── Expose imperative canvas actions to parent/Toolbar ───────────────────
  useImperativeHandle(ref, () => ({
    getCanvas: () => fabricRef.current,

    addImageFromDataURL,
    undo,
    redo,
    deleteSelected,

    addShape(type) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      recordSnapshot();

      let shape;
      const opts = { left: 120, top: 120, fill: 'transparent', stroke: activeColor, strokeWidth: 2 };
      if (type === 'rect') shape = new fabric.Rect({ ...opts, width: 150, height: 100 });
      else if (type === 'circle') shape = new fabric.Ellipse({ ...opts, rx: 75, ry: 50 });
      canvas.add(shape);
      canvas.setActiveObject(shape);
      canvas.renderAll();

      pushSnapshotToUndo();
      emitObjectAdded(shape);
    },

    addText() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      recordSnapshot();

      const text = new fabric.IText('Double-click to edit', {
        left: 150, top: 150,
        fill: activeColor,
        fontSize: 20,
        fontFamily: 'Inter, sans-serif',
      });
      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.renderAll();

      pushSnapshotToUndo();
      emitObjectAdded(text);
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

      recordSnapshot();

      if (url.trim()) {
        activeObj.set({
          hyperlink: url.trim(),
          underline: true,
          hoverCursor: 'pointer',
        });
        if (activeObj.type === 'i-text') {
          activeObj.set({ fill: '#60a5fa' });
        }
      } else {
        activeObj.set({ hyperlink: undefined, underline: false });
      }
      canvas.renderAll();

      pushSnapshotToUndo();

      const socket = getSocket();
      socket.emit('canvas:object:modified', { roomId, object: activeObj.toObject(['id', 'hyperlink']) });
      socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON(['hyperlink']) });
    },

    clearCanvas() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      recordSnapshot();

      canvas.clear();
      canvas.backgroundColor = '#1e1e2e';
      canvas.renderAll();

      pushSnapshotToUndo();

      const socket = getSocket();
      socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON(['hyperlink']) });
    },
  }), [activeColor, addImageFromDataURL, undo, redo, deleteSelected, roomId, emitObjectAdded, recordSnapshot, pushSnapshotToUndo]);

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

    // Track starting a mouse action (stroke, selection, move) to snapshot state
    canvas.on('mouse:down', (opt) => {
      if (opt.e.altKey) {
        canvas._isDragging = true;
        canvas._lastPosX = opt.e.clientX;
        canvas._lastPosY = opt.e.clientY;
        return;
      }
      recordSnapshot();
    });

    // Pan on Alt+drag
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
    const handleDragOver = (e) => { e.preventDefault(); };
    const handleDrop = (e) => {
      e.preventDefault();
      if (!isEditor) return;
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => addImageFromDataURL(ev.target.result);
        reader.readAsDataURL(file);
      }
    };

    // Clipboard Paste (Ctrl+V) image support
    const handlePaste = (e) => {
      if (!isEditor) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          const reader = new FileReader();
          reader.onload = (ev) => addImageFromDataURL(ev.target.result);
          reader.readAsDataURL(blob);
          break;
        }
      }
    };

    // Keyboard Shortcuts: Delete, Backspace, Ctrl+Z (Undo), Ctrl+Y (Redo)
    const handleKeyDown = (e) => {
      if (!isEditor) return;
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const activeObj = canvas.getActiveObject();
      if (activeObj && activeObj.isEditing) return; // ignore when editing text

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      observer.disconnect();
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('drop', handleDrop);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditor, addImageFromDataURL, deleteSelected, undo, redo, recordSnapshot]);

  // ── Load initial canvas state from server ─────────────────────────────────
  useEffect(() => {
    if (!fabricRef.current || !initialCanvas) return;
    if (Array.isArray(initialCanvas) && initialCanvas.length === 0) return;
    isSyncing.current = true;
    fabricRef.current.loadFromJSON(
      Array.isArray(initialCanvas)
        ? { objects: initialCanvas }
        : initialCanvas
    ).then(() => {
      fabricRef.current.renderAll();
      isSyncing.current = false;
    });
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
        canvas.freeDrawingBrush.color = '#1e1e2e'; // paint over with canvas colour
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
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    function onObjectAdded({ target }) {
      if (!isEditor || isSyncing.current || isHistoryAction.current || !target) return;
      pushSnapshotToUndo();
      emitObjectAdded(target);
    }
    function onObjectModified({ target }) {
      if (!isEditor || isSyncing.current || isHistoryAction.current || !target) return;
      pushSnapshotToUndo();
      const socket = getSocket();
      socket.emit('canvas:object:modified', { roomId, object: target.toObject(['id', 'hyperlink']) });
      socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON(['hyperlink']) });
    }
    function onObjectRemoved({ target }) {
      if (!isEditor || isSyncing.current || isHistoryAction.current || !target) return;
      pushSnapshotToUndo();
      const socket = getSocket();
      socket.emit('canvas:object:removed', { roomId });
      socket.emit('canvas:sync', { roomId, canvasJSON: canvas.toJSON(['hyperlink']) });
    }

    function onMouseDown(opt) {
      const target = opt.target;
      if (target && target.hyperlink) {
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
    const handleSync = ({ canvasJSON }) => {
      isSyncing.current = true;
      canvas.loadFromJSON(canvasJSON).then(() => {
        canvas.renderAll();
        isSyncing.current = false;
        if (!isEditor) {
          canvas.getObjects().forEach((o) => {
            o.selectable = false;
            o.evented = !!o.hyperlink;
            if (o.hyperlink) o.hoverCursor = 'pointer';
          });
        }
      });
    };
    socket.on('canvas:sync', handleSync);

    return () => {
      canvas.off('object:added', onObjectAdded);
      canvas.off('object:modified', onObjectModified);
      canvas.off('object:removed', onObjectRemoved);
      canvas.off('mouse:down', onMouseDown);
      socket.off('canvas:sync', handleSync);
    };
  }, [roomId, isEditor, emitObjectAdded, pushSnapshotToUndo]);

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
