import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import * as fabric from 'fabric';
import { getSocket } from '../lib/socket.js';
import { compressImage } from '../lib/imageCompressor.js';

/**
 * Helper to safely extract clientX and clientY from mouse, pointer, or touch events.
 * Crucial for mobile: standard TouchEvent has clientX in e.touches[0] or e.changedTouches[0].
 */
function getPointerPos(e) {
  if (!e) return { x: 0, y: 0 };
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX ?? 0, y: e.touches[0].clientY ?? 0 };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX ?? 0, y: e.changedTouches[0].clientY ?? 0 };
  }
  return { x: e.clientX ?? 0, y: e.clientY ?? 0 };
}

/**
 * WhiteboardCanvas
 *
 * Real-time collaborative infinite canvas powered by Fabric.js v6.
 * Mobile & Multi-image hardened:
 *   - Auto-compresses camera & upload photos to max 1200px (prevents WebGL/Canvas memory crashes)
 *   - Safe touch coordinate extraction (eliminates NaN viewport corruption)
 *   - Smooth 2-finger pinch-to-zoom and pan
 *   - Incremental socket object sync (never reloads/wipes canvas during active drawing)
 *   - Immovable checkpoints, infinite pan, undo/redo, responsive resize.
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
  const spacePressed = useRef(false);
  const hasLoadedInitial = useRef(false);

  // Mutable refs for up-to-date values without re-mounting
  const isEditorRef = useRef(isEditor);
  isEditorRef.current = isEditor;

  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  const activeColorRef = useRef(activeColor);
  activeColorRef.current = activeColor;

  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

  // ── Undo / Redo Stacks (Capped at 20 to protect mobile RAM) ───────────────
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const isHistoryAction = useRef(false);
  const pendingSnapshot = useRef(null);

  const recordSnapshot = useCallback(() => {
    if (!fabricRef.current || isSyncing.current || isHistoryAction.current) return;
    try {
      pendingSnapshot.current = JSON.stringify(fabricRef.current.toJSON(['id', 'hyperlink', 'isCheckpoint']));
    } catch {
      pendingSnapshot.current = null;
    }
  }, []);

  const pushSnapshotToUndo = useCallback(() => {
    if (!pendingSnapshot.current || isSyncing.current || isHistoryAction.current) return;
    undoStack.current.push(pendingSnapshot.current);
    if (undoStack.current.length > 20) undoStack.current.shift();
    redoStack.current = [];
    pendingSnapshot.current = null;
  }, []);

  // ── Helper: Broadcast incremental object additions ────────────────────────
  const emitObjectAdded = useCallback((obj) => {
    if (isSyncing.current || !fabricRef.current || !obj) return;
    if (!obj.id) obj.id = crypto.randomUUID();
    const socket = getSocket();
    socket.emit('canvas:object:added', {
      roomId,
      object: obj.toObject(['id', 'hyperlink', 'isCheckpoint']),
    });
  }, [roomId]);

  // Ensure checkpoint base images always stay at the bottom and are unselectable
  const enforceCheckpointLock = useCallback((canvas) => {
    if (!canvas) return;
    canvas.getObjects().forEach((o) => {
      if (o.isCheckpoint) {
        o.selectable = false;
        o.evented = false;
        o.hoverCursor = 'default';
        o.moveCursor = 'default';
        o.lockMovementX = true;
        o.lockMovementY = true;
        o.hasControls = false;
        o.hasBorders = false;
        canvas.sendObjectToBack(o);
      }
    });
  }, []);

  // ── Helper: Insert an image onto canvas with auto-compression ─────────────
  const addImageFromDataURL = useCallback(async (rawSource) => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditorRef.current) return;

    try {
      recordSnapshot();

      // Compress and resize image to prevent mobile GPU canvas crashes
      const dataUrl = await compressImage(rawSource, 1200, 0.82);

      const img = await fabric.FabricImage.fromURL(dataUrl);
      const maxDim = Math.min(360, (canvas.width || 400) * 0.75);
      img.scaleToWidth(maxDim);

      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const zoom = canvas.getZoom() || 1;
      const centerX = (-vpt[4] + canvas.width / 2) / zoom;
      const centerY = (-vpt[5] + canvas.height / 2) / zoom;

      img.set({
        id: crypto.randomUUID(),
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
      enforceCheckpointLock(canvas);
      canvas.renderAll();

      pushSnapshotToUndo();
      emitObjectAdded(img);
    } catch (err) {
      console.error('Failed to load image onto canvas:', err);
    }
  }, [emitObjectAdded, recordSnapshot, pushSnapshotToUndo, enforceCheckpointLock]);

  // ── Undo Action ──────────────────────────────────────────────────────────
  const undo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || undoStack.current.length === 0 || !isEditorRef.current) return;

    isHistoryAction.current = true;
    const currentJson = JSON.stringify(canvas.toJSON(['id', 'hyperlink', 'isCheckpoint']));
    redoStack.current.push(currentJson);

    const prevJsonStr = undoStack.current.pop();
    const prevJson = JSON.parse(prevJsonStr);

    await canvas.loadFromJSON(prevJson);
    enforceCheckpointLock(canvas);
    canvas.renderAll();
    isHistoryAction.current = false;

    const socket = getSocket();
    socket.emit('canvas:sync', { roomId, canvasJSON: prevJson });
  }, [roomId, enforceCheckpointLock]);

  // ── Redo Action ──────────────────────────────────────────────────────────
  const redo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || redoStack.current.length === 0 || !isEditorRef.current) return;

    isHistoryAction.current = true;
    const currentJson = JSON.stringify(canvas.toJSON(['id', 'hyperlink', 'isCheckpoint']));
    undoStack.current.push(currentJson);

    const nextJsonStr = redoStack.current.pop();
    const nextJson = JSON.parse(nextJsonStr);

    await canvas.loadFromJSON(nextJson);
    enforceCheckpointLock(canvas);
    canvas.renderAll();
    isHistoryAction.current = false;

    const socket = getSocket();
    socket.emit('canvas:sync', { roomId, canvasJSON: nextJson });
  }, [roomId, enforceCheckpointLock]);

  // ── Delete Selected Objects ──────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditorRef.current) return;

    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects || activeObjects.length === 0) return;

    const validObjects = activeObjects.filter((o) => !o.isCheckpoint);
    if (validObjects.length === 0) return;

    recordSnapshot();
    canvas.discardActiveObject();
    canvas.remove(...validObjects);
    enforceCheckpointLock(canvas);
    canvas.renderAll();
    pushSnapshotToUndo();

    const socket = getSocket();
    validObjects.forEach((obj) => {
      socket.emit('canvas:object:removed', { roomId, objectId: obj.id });
    });
  }, [roomId, recordSnapshot, pushSnapshotToUndo, enforceCheckpointLock]);

  // ── Hide / Unhide Selected Objects ───────────────────────────────────────
  const toggleHideSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditorRef.current) return;

    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects || activeObjects.length === 0) return;

    const validObjects = activeObjects.filter((o) => !o.isCheckpoint);
    if (validObjects.length === 0) return;

    recordSnapshot();
    validObjects.forEach((obj) => {
      const isHidden = obj.opacity === 0;
      obj.set({ opacity: isHidden ? 1 : 0 });
    });

    canvas.renderAll();
    pushSnapshotToUndo();

    const socket = getSocket();
    validObjects.forEach((obj) => {
      socket.emit('canvas:object:modified', {
        roomId,
        object: obj.toObject(['id', 'hyperlink', 'isCheckpoint', 'opacity']),
      });
    });
  }, [roomId, recordSnapshot, pushSnapshotToUndo]);

  // ── Save Checkpoint (Flatten canvas into an immovable background image) ──
  const saveCheckpoint = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditorRef.current) return;

    const nonCheckpointObjs = canvas.getObjects().filter((o) => !o.isCheckpoint);
    if (nonCheckpointObjs.length === 0) {
      alert('No new edits to save. Draw or add something over the canvas first.');
      return;
    }

    const confirmed = window.confirm(
      'Save this canvas as a permanent checkpoint?\n\n' +
      '• All current drawings and texts will be flattened into a single locked, immovable background image.\n' +
      '• Once saved, new edits will write OVER the flattened image.\n' +
      '• Previous actions will become locked and cannot be undone.'
    );
    if (!confirmed) return;

    try {
      isSyncing.current = true;
      canvas.discardActiveObject();

      const allObjects = canvas.getObjects();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      allObjects.forEach((o) => {
        const br = o.getBoundingRect(true);
        if (br.left < minX) minX = br.left;
        if (br.top < minY) minY = br.top;
        if (br.left + br.width > maxX) maxX = br.left + br.width;
        if (br.top + br.height > maxY) maxY = br.top + br.height;
      });

      const pad = 40;
      minX = Math.floor(minX - pad);
      minY = Math.floor(minY - pad);
      const width = Math.min(4000, Math.max(100, Math.ceil(maxX - minX + pad * 2)));
      const height = Math.min(4000, Math.max(100, Math.ceil(maxY - minY + pad * 2)));

      const savedVpt = canvas.viewportTransform.slice();
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      canvas.renderAll();

      const rawDataUrl = canvas.toDataURL({
        format: 'png',
        left: minX,
        top: minY,
        width: width,
        height: height,
        multiplier: 1,
      });

      canvas.setViewportTransform(savedVpt);

      // Compress checkpoint image to keep data under 300KB
      const dataUrl = await compressImage(rawDataUrl, 1600, 0.85);

      // Create new flat image BEFORE wiping canvas to avoid losing content
      const flatImg = await fabric.FabricImage.fromURL(dataUrl);
      flatImg.set({
        id: crypto.randomUUID(),
        left: minX,
        top: minY,
        selectable: false,
        evented: false,
        hoverCursor: 'default',
        moveCursor: 'default',
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        hasControls: false,
        hasBorders: false,
        isCheckpoint: true,
      });

      // Clear existing objects only after flatImg is confirmed loaded
      canvas.clear();
      canvas.add(flatImg);
      canvas.renderAll();

      // Clear undo history since past actions are flattened
      undoStack.current = [];
      redoStack.current = [];
      isSyncing.current = false;

      // Broadcast full checkpoint state
      const socket = getSocket();
      socket.emit('canvas:sync', {
        roomId,
        canvasJSON: canvas.toJSON(['id', 'hyperlink', 'isCheckpoint']),
      });

      alert('✓ Canvas checkpoint saved! Everything is flattened into an immovable base.');
    } catch (err) {
      console.error('Error saving checkpoint:', err);
      isSyncing.current = false;
      alert(`Could not save checkpoint: ${err.message}`);
    }
  }, [roomId]);

  // ── Zoom In / Zoom Out / Reset View Helpers ──────────────────────────────
  const zoomIn = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const center = { x: canvas.width / 2, y: canvas.height / 2 };
    let zoom = Math.min(10, (canvas.getZoom() || 1) * 1.25);
    canvas.zoomToPoint(center, zoom);
    const vpt = canvas.viewportTransform;
    onViewportChange?.({ x: vpt[4], y: vpt[5], zoom });
  }, [onViewportChange]);

  const zoomOut = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const center = { x: canvas.width / 2, y: canvas.height / 2 };
    let zoom = Math.max(0.1, (canvas.getZoom() || 1) * 0.8);
    canvas.zoomToPoint(center, zoom);
    const vpt = canvas.viewportTransform;
    onViewportChange?.({ x: vpt[4], y: vpt[5], zoom });
  }, [onViewportChange]);

  const resetView = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.renderAll();
    onViewportChange?.({ x: 0, y: 0, zoom: 1 });
  }, [onViewportChange]);

  // ── Expose imperative canvas actions to parent / Toolbar ─────────────────
  useImperativeHandle(ref, () => ({
    getCanvas: () => fabricRef.current,
    addImageFromDataURL,
    undo,
    redo,
    deleteSelected,
    toggleHideSelected,
    saveCheckpoint,
    zoomIn,
    zoomOut,
    resetView,
    exportPNG: () => fabricRef.current?.toDataURL({ format: 'png', multiplier: 1 }),
    exportJSON: () => fabricRef.current?.toJSON(['id', 'hyperlink', 'isCheckpoint']),

    addShape(type) {
      const canvas = fabricRef.current;
      if (!canvas || !isEditorRef.current) return;
      recordSnapshot();

      const color = activeColorRef.current;
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const zoom = canvas.getZoom() || 1;
      const spawnX = (-vpt[4] + canvas.width / 2) / zoom - 75;
      const spawnY = (-vpt[5] + canvas.height / 2) / zoom - 50;

      const opts = {
        id: crypto.randomUUID(),
        left: spawnX,
        top: spawnY,
        fill: 'transparent',
        stroke: color,
        strokeWidth: 2,
      };
      const shape =
        type === 'rect'
          ? new fabric.Rect({ ...opts, width: 150, height: 100 })
          : new fabric.Ellipse({ ...opts, rx: 75, ry: 50 });

      canvas.add(shape);
      canvas.setActiveObject(shape);
      enforceCheckpointLock(canvas);
      canvas.renderAll();

      pushSnapshotToUndo();
      emitObjectAdded(shape);
    },

    addText() {
      const canvas = fabricRef.current;
      if (!canvas || !isEditorRef.current) return;
      recordSnapshot();

      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const zoom = canvas.getZoom() || 1;
      const spawnX = (-vpt[4] + canvas.width / 2) / zoom - 80;
      const spawnY = (-vpt[5] + canvas.height / 2) / zoom - 20;

      const text = new fabric.IText('Type here...', {
        id: crypto.randomUUID(),
        left: spawnX,
        top: spawnY,
        fill: activeColorRef.current,
        fontSize: 22,
        fontFamily: 'sans-serif',
      });

      canvas.add(text);
      canvas.setActiveObject(text);
      enforceCheckpointLock(canvas);
      canvas.renderAll();

      pushSnapshotToUndo();
      emitObjectAdded(text);
    },

    setHyperlink(url) {
      const canvas = fabricRef.current;
      if (!canvas || !isEditorRef.current) return;
      const activeObj = canvas.getActiveObject();
      if (!activeObj || activeObj.isCheckpoint) return;
      recordSnapshot();
      activeObj.set({ hyperlink: url ? url.trim() : null });
      canvas.renderAll();
      pushSnapshotToUndo();

      const socket = getSocket();
      socket.emit('canvas:object:modified', {
        roomId,
        object: activeObj.toObject(['id', 'hyperlink', 'isCheckpoint']),
      });
    },
  }), [addImageFromDataURL, undo, redo, deleteSelected, saveCheckpoint, zoomIn, zoomOut, resetView, emitObjectAdded, recordSnapshot, pushSnapshotToUndo, roomId, enforceCheckpointLock]);

  // ── 1. Persistent Canvas Lifecycle (Mounts ONCE) ──────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    const canvas = new fabric.Canvas('whiteboard-canvas', {
      width: el.clientWidth,
      height: el.clientHeight,
      backgroundColor: 'transparent',
      selection: isEditorRef.current,
      isDrawingMode: false,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // Responsive resize
    const observer = new ResizeObserver(() => {
      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      canvas.renderAll();
    });
    observer.observe(el);

    // Mouse / Touch Down (Support Pan with Hand tool, Space, Alt, or Middle Mouse)
    canvas.on('mouse:down', (opt) => {
      const isPanTrigger =
        activeToolRef.current === 'hand' ||
        opt.e?.altKey ||
        opt.e?.button === 1 ||
        spacePressed.current;

      const pos = getPointerPos(opt.e);

      if (isPanTrigger) {
        canvas._isDragging = true;
        canvas._lastPosX = pos.x;
        canvas._lastPosY = pos.y;
        canvas.defaultCursor = 'grabbing';
        canvas.renderAll();
        return;
      }

      // Deselect if someone clicks on an immovable checkpoint
      if (opt.target && opt.target.isCheckpoint) {
        canvas.discardActiveObject();
      }

      recordSnapshot();
    });

    // Mouse / Touch Move (Smooth Pan with zero NaN risk)
    canvas.on('mouse:move', (opt) => {
      if (!canvas._isDragging) return;
      const pos = getPointerPos(opt.e);
      const dx = pos.x - (canvas._lastPosX ?? pos.x);
      const dy = pos.y - (canvas._lastPosY ?? pos.y);

      if (!isNaN(dx) && !isNaN(dy) && isFinite(dx) && isFinite(dy)) {
        const vpt = (canvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
        vpt[4] += dx;
        vpt[5] += dy;

        // Guard against any NaN coordinates
        if (!isNaN(vpt[4]) && !isNaN(vpt[5]) && isFinite(vpt[4]) && isFinite(vpt[5])) {
          canvas.setViewportTransform(vpt);
          onViewportChange?.({ x: vpt[4], y: vpt[5], zoom: canvas.getZoom() || 1 });
        }
      }

      canvas._lastPosX = pos.x;
      canvas._lastPosY = pos.y;
    });

    canvas.on('mouse:up', () => {
      canvas._isDragging = false;
      canvas.defaultCursor = activeToolRef.current === 'hand' || spacePressed.current ? 'grab' : 'default';
      canvas.renderAll();
    });

    // Scroll-to-zoom (Zoom range: 0.1 to 10)
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e?.deltaY || 0;
      let zoom = canvas.getZoom() || 1;
      zoom *= 0.999 ** delta;
      zoom = Math.max(0.1, Math.min(10, zoom));
      if (!isNaN(zoom)) {
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
        const vpt = canvas.viewportTransform;
        onViewportChange?.({ x: vpt[4], y: vpt[5], zoom });
      }
    });

    // ── Mobile 2-Finger Touch Pinch Zoom & Smooth Delta Pan ─────────────────
    let lastTouchCenter = null;
    let lastTouchDist = 0;
    let wasDrawingBeforeTouch = false;

    const handleTouchStart = (e) => {
      if (e.touches && e.touches.length === 2) {
        wasDrawingBeforeTouch = canvas.isDrawingMode;
        canvas.isDrawingMode = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        lastTouchCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches && e.touches.length === 2 && lastTouchCenter && lastTouchDist > 0) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const currentCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };

        // 1. Delta Zoom around current pinch center
        if (currentDist > 10 && lastTouchDist > 10) {
          const zoomFactor = currentDist / lastTouchDist;
          let newZoom = (canvas.getZoom() || 1) * zoomFactor;
          newZoom = Math.max(0.1, Math.min(10, newZoom));
          if (!isNaN(newZoom)) {
            canvas.zoomToPoint(currentCenter, newZoom);
          }
        }

        // 2. Delta Pan
        const dx = currentCenter.x - lastTouchCenter.x;
        const dy = currentCenter.y - lastTouchCenter.y;
        if (!isNaN(dx) && !isNaN(dy) && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
          canvas.relativePan({ x: dx, y: dy });
        }

        lastTouchDist = currentDist;
        lastTouchCenter = currentCenter;

        const vpt = canvas.viewportTransform;
        if (vpt && !isNaN(vpt[4]) && !isNaN(vpt[5])) {
          onViewportChange?.({ x: vpt[4], y: vpt[5], zoom: canvas.getZoom() || 1 });
        }
      }
    };

    const handleTouchEnd = (e) => {
      if (!e.touches || e.touches.length < 2) {
        lastTouchCenter = null;
        lastTouchDist = 0;
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

    // Drag-and-drop Image Upload
    const handleDragOver = (e) => { e.preventDefault(); };
    const handleDrop = async (e) => {
      e.preventDefault();
      if (!isEditorRef.current) return;
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        const compressed = await compressImage(file, 1200, 0.82);
        addImageFromDataURL(compressed);
      }
    };

    // Clipboard Paste (Ctrl+V)
    const handlePaste = async (e) => {
      if (!isEditorRef.current) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const compressed = await compressImage(blob, 1200, 0.82);
            addImageFromDataURL(compressed);
          }
          break;
        }
      }
    };

    // Keyboard Shortcuts & Space-to-Pan
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const activeObj = canvas.getActiveObject();
      if (activeObj && activeObj.isEditing) return;

      if (e.code === 'Space' && !spacePressed.current) {
        spacePressed.current = true;
        canvas.defaultCursor = 'grab';
        canvas.renderAll();
      }

      if (!isEditorRef.current) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        toggleHideSelected();
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

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        spacePressed.current = false;
        canvas.defaultCursor = activeToolRef.current === 'hand' ? 'grab' : 'default';
        canvas.renderAll();
      }
    };

    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

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
      window.removeEventListener('keyup', handleKeyUp);
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Handle Role Transition (Observer -> Editor) ─────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.selection = isEditor && activeTool !== 'hand';
    canvas.getObjects().forEach((o) => {
      if (o.isCheckpoint) {
        o.selectable = false;
        o.evented = false;
        o.hoverCursor = 'default';
        o.moveCursor = 'default';
      } else {
        o.selectable = isEditor;
        o.evented = isEditor || !!o.hyperlink;
        if (!isEditor && o.hyperlink) {
          o.hoverCursor = 'pointer';
        }
      }
    });
    canvas.renderAll();
  }, [isEditor, activeTool]);

  // ── 3. Load initial canvas state on mount (runs ONCE) ─────────────────────
  useEffect(() => {
    if (!fabricRef.current || !initialCanvas || hasLoadedInitial.current) return;
    if (Array.isArray(initialCanvas) && initialCanvas.length === 0) return;

    hasLoadedInitial.current = true;
    isSyncing.current = true;
    fabricRef.current.loadFromJSON(
      Array.isArray(initialCanvas)
        ? { objects: initialCanvas }
        : initialCanvas
    ).then(() => {
      const canvas = fabricRef.current;
      if (canvas) {
        canvas.selection = isEditorRef.current && activeToolRef.current !== 'hand';
        enforceCheckpointLock(canvas);
        canvas.renderAll();
      }
      isSyncing.current = false;
    }).catch((err) => {
      console.error('Error loading initial canvas:', err);
      isSyncing.current = false;
    });
  }, [initialCanvas, enforceCheckpointLock]);

  // ── 4. Tool mode switching (Select, Hand, Pen, Eraser) ────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = false;
    canvas.selection = isEditor && activeTool !== 'hand';

    if (activeTool === 'hand') {
      canvas.defaultCursor = 'grab';
      canvas.hoverCursor = 'grab';
      canvas.discardActiveObject();
      canvas.renderAll();
      return;
    } else {
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
    }

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
        canvas.freeDrawingBrush.color = '#1e1e2e'; // Dark canvas-matching stroke
        canvas.freeDrawingBrush.width = brushSize * 4;
        break;
      case 'select':
      default:
        canvas.isDrawingMode = false;
        break;
    }
    canvas.renderAll();
  }, [activeTool, activeColor, brushSize, isEditor]);

  // ── 5. Socket real-time event listeners (Incremental & Resilient) ─────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Local object added: attach ID and broadcast incrementally
    function onObjectAdded({ target }) {
      if (!isEditorRef.current || isSyncing.current || isHistoryAction.current || !target) return;
      if (!target.id) target.id = crypto.randomUUID();
      enforceCheckpointLock(canvas);
      pushSnapshotToUndo();
      emitObjectAdded(target);
    }

    function onObjectModified({ target }) {
      if (!isEditorRef.current || isSyncing.current || isHistoryAction.current || !target) return;
      enforceCheckpointLock(canvas);
      pushSnapshotToUndo();
      if (!target.id) target.id = crypto.randomUUID();
      const socket = getSocket();
      socket.emit('canvas:object:modified', {
        roomId,
        object: target.toObject(['id', 'hyperlink', 'isCheckpoint']),
      });
    }

    function onMouseDown(opt) {
      const target = opt.target;
      if (target && target.hyperlink && !target.isCheckpoint) {
        if (!isEditorRef.current || opt.e.ctrlKey || opt.e.metaKey) {
          window.open(target.hyperlink, '_blank', 'noopener,noreferrer');
        }
      }
    }

    canvas.on('object:added', onObjectAdded);
    canvas.on('object:modified', onObjectModified);
    canvas.on('mouse:down', onMouseDown);

    // ── Incremental Object Add from Peer (Never wipes canvas!) ─────────────
    const socket = getSocket();

    const handleRemoteObjectAdded = async ({ object: objData }) => {
      if (!canvas || !objData) return;
      // Prevent duplicate insertion
      if (objData.id && canvas.getObjects().some((o) => o.id === objData.id)) {
        return;
      }

      isSyncing.current = true;
      try {
        const enlivened = await fabric.util.enlivenObjects([objData]);
        if (enlivened && enlivened[0]) {
          const obj = enlivened[0];
          obj.selectable = isEditorRef.current && activeToolRef.current !== 'hand';
          canvas.add(obj);
          enforceCheckpointLock(canvas);
          canvas.renderAll();
        }
      } catch (err) {
        console.error('Error adding remote object:', err);
      } finally {
        isSyncing.current = false;
      }
    };

    // Incremental Object Modified from Peer
    const handleRemoteObjectModified = ({ object: objData }) => {
      if (!canvas || !objData?.id) return;
      const target = canvas.getObjects().find((o) => o.id === objData.id);
      if (target) {
        isSyncing.current = true;
        target.set(objData);
        target.setCoords();
        canvas.renderAll();
        isSyncing.current = false;
      }
    };

    // Incremental Object Removed from Peer
    const handleRemoteObjectRemoved = ({ objectId }) => {
      if (!canvas) return;
      isSyncing.current = true;
      if (objectId) {
        const target = canvas.getObjects().find((o) => o.id === objectId);
        if (target && !target.isCheckpoint) {
          canvas.remove(target);
          canvas.renderAll();
        }
      }
      isSyncing.current = false;
    };

    // Full canvas sync (Only for Checkpoint flattening and Undo/Redo)
    const handleSync = async ({ canvasJSON }) => {
      if (!canvas || !canvasJSON) return;
      isSyncing.current = true;
      try {
        await canvas.loadFromJSON(canvasJSON);
        canvas.selection = isEditorRef.current && activeToolRef.current !== 'hand';
        enforceCheckpointLock(canvas);
        canvas.renderAll();
      } catch (err) {
        console.error('Canvas sync error:', err);
      } finally {
        isSyncing.current = false;
      }
    };

    socket.on('canvas:object:added', handleRemoteObjectAdded);
    socket.on('canvas:object:modified', handleRemoteObjectModified);
    socket.on('canvas:object:removed', handleRemoteObjectRemoved);
    socket.on('canvas:sync', handleSync);

    return () => {
      canvas.off('object:added', onObjectAdded);
      canvas.off('object:modified', onObjectModified);
      canvas.off('mouse:down', onMouseDown);
      socket.off('canvas:object:added', handleRemoteObjectAdded);
      socket.off('canvas:object:modified', handleRemoteObjectModified);
      socket.off('canvas:object:removed', handleRemoteObjectRemoved);
      socket.off('canvas:sync', handleSync);
    };
  }, [roomId, emitObjectAdded, pushSnapshotToUndo, enforceCheckpointLock]);

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
