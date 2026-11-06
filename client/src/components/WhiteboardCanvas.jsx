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
 * Real-time collaborative canvas powered by Fabric.js v6.
 * Features:
 *   - Drawing tools (pen, eraser, shapes, text)
 *   - Image uploading & clipboard paste
 *   - Hyperlinks on objects
 *   - Undo / Redo history
 *   - Delete selected objects
 *   - Save Checkpoint (Flatten canvas into an un-undoable base image)
 *   - Touch support: 1-finger draw, 2-finger pinch-to-zoom & pan
 *   - Real-time Socket.io synchronization
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
  const fabricRef = useRef(null);   // Single persistent fabric.Canvas instance
  const isSyncing = useRef(false);  // Prevent broadcast echo loops

  // Mutable refs so callbacks always access the latest values without re-mounting
  const isEditorRef = useRef(isEditor);
  isEditorRef.current = isEditor;

  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  const activeColorRef = useRef(activeColor);
  activeColorRef.current = activeColor;

  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

  // ── Undo / Redo Stacks ───────────────────────────────────────────────────
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const isHistoryAction = useRef(false);
  const pendingSnapshot = useRef(null);

  const recordSnapshot = useCallback(() => {
    if (!fabricRef.current || isSyncing.current || isHistoryAction.current) return;
    pendingSnapshot.current = JSON.stringify(fabricRef.current.toJSON(['hyperlink', 'isCheckpoint']));
  }, []);

  const pushSnapshotToUndo = useCallback(() => {
    if (!pendingSnapshot.current || isSyncing.current || isHistoryAction.current) return;
    undoStack.current.push(pendingSnapshot.current);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    pendingSnapshot.current = null;
  }, []);

  // ── Helper: Broadcast object changes ─────────────────────────────────────
  const emitObjectAdded = useCallback((obj) => {
    if (isSyncing.current || !fabricRef.current) return;
    const socket = getSocket();
    socket.emit('canvas:object:added', {
      roomId,
      object: obj.toObject(['id', 'hyperlink', 'isCheckpoint']),
    });
    const json = fabricRef.current.toJSON(['hyperlink', 'isCheckpoint']);
    socket.emit('canvas:sync', { roomId, canvasJSON: json });
  }, [roomId]);

  // ── Helper: Insert an image from Data URL onto canvas ────────────────────
  const addImageFromDataURL = useCallback(async (dataUrl) => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditorRef.current) return;

    try {
      recordSnapshot();

      const img = await fabric.FabricImage.fromURL(dataUrl);
      const maxDim = Math.min(380, canvas.width * 0.75);
      img.scaleToWidth(maxDim);

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
        selectable: true,
        evented: true,
      });

      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();

      pushSnapshotToUndo();
      emitObjectAdded(img);
    } catch (err) {
      console.error('Failed to load image onto canvas:', err);
    }
  }, [emitObjectAdded, recordSnapshot, pushSnapshotToUndo]);

  // ── Undo Action ──────────────────────────────────────────────────────────
  const undo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || undoStack.current.length === 0 || !isEditorRef.current) return;

    isHistoryAction.current = true;
    const currentJson = JSON.stringify(canvas.toJSON(['hyperlink', 'isCheckpoint']));
    redoStack.current.push(currentJson);

    const prevJsonStr = undoStack.current.pop();
    const prevJson = JSON.parse(prevJsonStr);

    await canvas.loadFromJSON(prevJson);
    canvas.renderAll();
    isHistoryAction.current = false;

    const socket = getSocket();
    socket.emit('canvas:sync', { roomId, canvasJSON: prevJson });
  }, [roomId]);

  // ── Redo Action ──────────────────────────────────────────────────────────
  const redo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || redoStack.current.length === 0 || !isEditorRef.current) return;

    isHistoryAction.current = true;
    const currentJson = JSON.stringify(canvas.toJSON(['hyperlink', 'isCheckpoint']));
    undoStack.current.push(currentJson);

    const nextJsonStr = redoStack.current.pop();
    const nextJson = JSON.parse(nextJsonStr);

    await canvas.loadFromJSON(nextJson);
    canvas.renderAll();
    isHistoryAction.current = false;

    const socket = getSocket();
    socket.emit('canvas:sync', { roomId, canvasJSON: nextJson });
  }, [roomId]);

  // ── Delete Selected Objects ──────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditorRef.current) return;

    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects || activeObjects.length === 0) return;

    // Do not allow deleting permanent checkpoint base
    const validObjects = activeObjects.filter((o) => !o.isCheckpoint);
    if (validObjects.length === 0) return;

    recordSnapshot();
    canvas.discardActiveObject();
    canvas.remove(...validObjects);
    canvas.renderAll();

    pushSnapshotToUndo();

    const socket = getSocket();
    socket.emit('canvas:sync', {
      roomId,
      canvasJSON: canvas.toJSON(['hyperlink', 'isCheckpoint']),
    });
  }, [roomId, recordSnapshot, pushSnapshotToUndo]);

  // ── Save Checkpoint (Flatten canvas into an un-undoable base image) ───────
  const saveCheckpoint = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditorRef.current) return;

    const objects = canvas.getObjects();
    if (objects.length === 0) {
      alert('Canvas is currently empty. Draw or add elements before saving a checkpoint.');
      return;
    }

    const confirmed = window.confirm(
      'Save this canvas as a permanent checkpoint?\n\n' +
      '• All current drawings and texts will be flattened into a single background image.\n' +
      '• Previous actions will become locked and cannot be undone.\n' +
      '• New elements, images, and eraser marks can still be added on top.'
    );
    if (!confirmed) return;

    try {
      isSyncing.current = true;

      // Deselect active items to avoid rendering selection boxes
      canvas.discardActiveObject();

      // Temporarily reset zoom/pan to 1:1 to capture the full canvas content accurately
      const savedVpt = canvas.viewportTransform.slice();
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      canvas.renderAll();

      const dataUrl = canvas.toDataURL({
        format: 'png',
        multiplier: 1,
      });

      // Restore user's current viewport pan & zoom
      canvas.setViewportTransform(savedVpt);

      // Clear existing vector objects
      canvas.clear();
      canvas.backgroundColor = '#1e1e2e';

      // Load flattened image as non-interactive base
      const flatImg = await fabric.FabricImage.fromURL(dataUrl);
      flatImg.set({
        left: 0,
        top: 0,
        selectable: false,
        evented: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        isCheckpoint: true,
      });

      canvas.add(flatImg);
      canvas.sendObjectToBack(flatImg);
      canvas.renderAll();

      // Clear undo & redo stacks so previous actions cannot be undone
      undoStack.current = [];
      redoStack.current = [];

      isSyncing.current = false;

      // Broadcast the checkpoint to the server and all connected peers
      const json = canvas.toJSON(['hyperlink', 'isCheckpoint']);
      const socket = getSocket();
      socket.emit('canvas:sync', { roomId, canvasJSON: json });

      alert('✓ Checkpoint saved! The canvas is now locked into a flattened base.');
    } catch (err) {
      console.error('Failed to save checkpoint:', err);
      isSyncing.current = false;
    }
  }, [roomId]);

  // ── Expose imperative canvas actions to Toolbar ──────────────────────────
  useImperativeHandle(ref, () => ({
    getCanvas: () => fabricRef.current,
    addImageFromDataURL,
    undo,
    redo,
    deleteSelected,
    saveCheckpoint,

    addShape(type) {
      const canvas = fabricRef.current;
      if (!canvas || !isEditorRef.current) return;
      recordSnapshot();

      const color = activeColorRef.current;
      const opts = { left: 120, top: 120, fill: 'transparent', stroke: color, strokeWidth: 2 };
      const shape =
        type === 'rect'
          ? new fabric.Rect({ ...opts, width: 150, height: 100 })
          : new fabric.Ellipse({ ...opts, rx: 75, ry: 50 });

      canvas.add(shape);
      canvas.setActiveObject(shape);
      canvas.renderAll();

      pushSnapshotToUndo();
      emitObjectAdded(shape);
    },

    addText() {
      const canvas = fabricRef.current;
      if (!canvas || !isEditorRef.current) return;
      recordSnapshot();

      const text = new fabric.IText('Double-click to edit', {
        left: 150,
        top: 150,
        fill: activeColorRef.current,
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
      if (!canvas || !isEditorRef.current) return;
      const activeObj = canvas.getActiveObject();
      if (!activeObj || activeObj.isCheckpoint) {
        alert('Please select an editable object or text on the canvas first.');
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
      socket.emit('canvas:object:modified', {
        roomId,
        object: activeObj.toObject(['id', 'hyperlink', 'isCheckpoint']),
      });
      socket.emit('canvas:sync', {
        roomId,
        canvasJSON: canvas.toJSON(['hyperlink', 'isCheckpoint']),
      });
    },
  }), [addImageFromDataURL, undo, redo, deleteSelected, saveCheckpoint, emitObjectAdded, recordSnapshot, pushSnapshotToUndo, roomId]);

  // ── 1. Persistent Canvas Lifecycle (Mounts ONCE) ──────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    const canvas = new fabric.Canvas('whiteboard-canvas', {
      width: el.clientWidth,
      height: el.clientHeight,
      backgroundColor: '#1e1e2e',
      selection: isEditorRef.current,
      isDrawingMode: false,
    });
    fabricRef.current = canvas;

    // Responsive resize
    const observer = new ResizeObserver(() => {
      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      canvas.renderAll();
    });
    observer.observe(el);

    // Track mouse down
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
      onViewportChange?.({ x: vpt[4], y: vpt[5], zoom: canvas.getZoom() });
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
      const vpt = canvas.viewportTransform;
      onViewportChange?.({ x: vpt[4], y: vpt[5], zoom });
    });

    // ── Mobile 2-Finger Touch Pinch Zoom & Pan ─────────────────────────────
    let touchStartDist = 0;
    let touchStartZoom = 1;
    let touchStartCenter = null;
    let touchStartPan = null;
    let wasDrawingBeforeTouch = false;

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        wasDrawingBeforeTouch = canvas.isDrawingMode;
        canvas.isDrawingMode = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        touchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        touchStartZoom = canvas.getZoom();
        touchStartCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        const vpt = canvas.viewportTransform;
        touchStartPan = { x: vpt[4], y: vpt[5] };
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches.length === 2 && touchStartCenter && touchStartDist > 0) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const factor = dist / touchStartDist;
        const newZoom = Math.max(0.2, Math.min(10, touchStartZoom * factor));
        canvas.zoomToPoint(touchStartCenter, newZoom);

        const currentCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        const vpt = canvas.viewportTransform.slice();
        vpt[4] = touchStartPan.x + (currentCenter.x - touchStartCenter.x);
        vpt[5] = touchStartPan.y + (currentCenter.y - touchStartCenter.y);
        canvas.setViewportTransform(vpt);
        onViewportChange?.({ x: vpt[4], y: vpt[5], zoom: newZoom });
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length < 2) {
        touchStartCenter = null;
        touchStartDist = 0;
        if (wasDrawingBeforeTouch && isEditorRef.current) {
          canvas.isDrawingMode = true;
        }
      }
    };

    const upperEl = canvas.upperCanvasEl;
    if (upperEl) {
      upperEl.addEventListener('touchstart', handleTouchStart, { passive: true });
      upperEl.addEventListener('touchmove', handleTouchMove, { passive: false });
      upperEl.addEventListener('touchend', handleTouchEnd, { passive: true });
      upperEl.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    }

    // Drag-and-drop image upload
    const handleDragOver = (e) => { e.preventDefault(); };
    const handleDrop = (e) => {
      e.preventDefault();
      if (!isEditorRef.current) return;
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => addImageFromDataURL(ev.target.result);
        reader.readAsDataURL(file);
      }
    };

    // Clipboard Paste (Ctrl+V)
    const handlePaste = (e) => {
      if (!isEditorRef.current) return;
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

    // Keyboard Shortcuts
    const handleKeyDown = (e) => {
      if (!isEditorRef.current) return;
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const activeObj = canvas.getActiveObject();
      if (activeObj && activeObj.isEditing) return;

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
      if (upperEl) {
        upperEl.removeEventListener('touchstart', handleTouchStart);
        upperEl.removeEventListener('touchmove', handleTouchMove);
        upperEl.removeEventListener('touchend', handleTouchEnd);
        upperEl.removeEventListener('touchcancel', handleTouchEnd);
      }
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('drop', handleDrop);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.dispose(); // Only disposes on unmount!
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run ONCE on mount!

  // ── 2. Handle Role Transition (Observer -> Editor) Without Canvas Reset ────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.selection = isEditor;
    canvas.getObjects().forEach((o) => {
      if (o.isCheckpoint) {
        o.selectable = false;
        o.evented = false;
      } else {
        o.selectable = isEditor;
        o.evented = isEditor || !!o.hyperlink;
        if (!isEditor && o.hyperlink) {
          o.hoverCursor = 'pointer';
        }
      }
    });
    canvas.renderAll();
  }, [isEditor]);

  // ── 3. Load initial canvas state from server ──────────────────────────────
  useEffect(() => {
    if (!fabricRef.current || !initialCanvas) return;
    if (Array.isArray(initialCanvas) && initialCanvas.length === 0) return;
    isSyncing.current = true;
    fabricRef.current.loadFromJSON(
      Array.isArray(initialCanvas)
        ? { objects: initialCanvas }
        : initialCanvas
    ).then(() => {
      const canvas = fabricRef.current;
      if (canvas) {
        canvas.selection = isEditorRef.current;
        canvas.getObjects().forEach((o) => {
          if (o.isCheckpoint) {
            o.selectable = false;
            o.evented = false;
          } else {
            o.selectable = isEditorRef.current;
            o.evented = isEditorRef.current || !!o.hyperlink;
            if (!isEditorRef.current && o.hyperlink) o.hoverCursor = 'pointer';
          }
        });
        canvas.renderAll();
      }
      isSyncing.current = false;
    });
  }, [initialCanvas]);

  // ── 4. Tool mode switching (Pen, Eraser, Select) ──────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = false;
    canvas.selection = isEditor;

    if (!isEditor) {
      canvas.renderAll();
      return;
    }

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
        canvas.freeDrawingBrush.color = '#1e1e2e'; // Dark-out stroke
        canvas.freeDrawingBrush.width = brushSize * 4;
        break;
      case 'select':
      default:
        canvas.isDrawingMode = false;
        break;
    }
    canvas.renderAll();
  }, [activeTool, activeColor, brushSize, isEditor]);

  // ── 5. Socket real-time event listeners ───────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    function onObjectAdded({ target }) {
      if (!isEditorRef.current || isSyncing.current || isHistoryAction.current || !target) return;
      pushSnapshotToUndo();
      emitObjectAdded(target);
    }
    function onObjectModified({ target }) {
      if (!isEditorRef.current || isSyncing.current || isHistoryAction.current || !target) return;
      pushSnapshotToUndo();
      const socket = getSocket();
      socket.emit('canvas:object:modified', {
        roomId,
        object: target.toObject(['id', 'hyperlink', 'isCheckpoint']),
      });
      socket.emit('canvas:sync', {
        roomId,
        canvasJSON: canvas.toJSON(['hyperlink', 'isCheckpoint']),
      });
    }
    function onObjectRemoved({ target }) {
      if (!isEditorRef.current || isSyncing.current || isHistoryAction.current || !target) return;
      pushSnapshotToUndo();
      const socket = getSocket();
      socket.emit('canvas:object:removed', { roomId });
      socket.emit('canvas:sync', {
        roomId,
        canvasJSON: canvas.toJSON(['hyperlink', 'isCheckpoint']),
      });
    }

    function onMouseDown(opt) {
      const target = opt.target;
      if (target && target.hyperlink) {
        if (!isEditorRef.current || opt.e.ctrlKey || opt.e.metaKey) {
          window.open(target.hyperlink, '_blank', 'noopener,noreferrer');
        }
      }
    }

    canvas.on('object:added', onObjectAdded);
    canvas.on('object:modified', onObjectModified);
    canvas.on('object:removed', onObjectRemoved);
    canvas.on('mouse:down', onMouseDown);

    // Full canvas sync from peers or checkpoint broadcast
    const socket = getSocket();
    const handleSync = ({ canvasJSON }) => {
      isSyncing.current = true;
      canvas.loadFromJSON(canvasJSON).then(() => {
        canvas.selection = isEditorRef.current;
        canvas.getObjects().forEach((o) => {
          if (o.isCheckpoint) {
            o.selectable = false;
            o.evented = false;
          } else {
            o.selectable = isEditorRef.current;
            o.evented = isEditorRef.current || !!o.hyperlink;
            if (!isEditorRef.current && o.hyperlink) o.hoverCursor = 'pointer';
          }
        });
        canvas.renderAll();
        isSyncing.current = false;
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
  }, [roomId, emitObjectAdded, pushSnapshotToUndo]);

  // ── 6. Cursor Presence Broadcast ──────────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const handleMouseMove = ({ e }) => {
      const pt = canvas.getPointer(e);
      getSocket().emit('cursor:move', { x: pt.x, y: pt.y });
    };
    canvas.on('mouse:move', handleMouseMove);
    return () => {
      canvas.off('mouse:move', handleMouseMove);
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas id="whiteboard-canvas" />
    </div>
  );
});

export default WhiteboardCanvas;
