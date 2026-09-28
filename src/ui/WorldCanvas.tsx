import { useEffect, useMemo, useRef, useState } from 'react';
import type { GridPoint, RailEdgeId, WorldEntityId } from '../domain';
import {
  occupiedCells,
  validateRailPath,
  type WorldSnapshot,
  type WorldTool,
  type WorldTransform,
} from '../world';
import { WorldRenderer } from '../rendering/world/WorldRenderer';
import type { QualityMode } from '../rendering/world/WorldRenderer';
import { readCamera, type CameraState } from '../rendering/world/CameraState';

interface Ghost {
  readonly kind: WorldTool;
  readonly transform: WorldTransform;
  readonly valid: boolean;
  readonly pending?: boolean;
}

interface Props {
  readonly snapshot: WorldSnapshot;
  readonly settingsOpen?: boolean;
  readonly interactionBlocked?: boolean;
  readonly cameraFocus?: GridPoint;
  readonly selected?: GridPoint;
  readonly selectedEntityId?: WorldEntityId;
  readonly ghost?: Ghost;
  readonly railDraft: readonly GridPoint[];
  readonly activeTool: WorldTool;
  readonly onCommitRail: () => void;
  readonly onCancel: () => void;
  readonly hoveredRailEdgeId?: RailEdgeId;
  readonly hoveredDismantleEntityId?: WorldEntityId;
  readonly selectedRailEdgeId?: RailEdgeId;
  readonly onSelect: (point: GridPoint) => void;
  readonly onSelectEntity: (entityId?: WorldEntityId) => void;
  readonly onSelectRailEdge: (edgeId?: RailEdgeId) => void;
  readonly onSelectPod: (podId?: string) => void;
  readonly onHover: (point?: GridPoint) => void;
}

interface PointerTrack {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly cameraGesture: boolean;
  readonly startX: number;
  readonly startY: number;
  lastX: number;
  lastY: number;
  dragged: boolean;
  readonly startPoint?: GridPoint;
}
interface PickInfo {
  readonly kind: 'entity' | 'rail' | 'pod';
  readonly id: string;
}

const UI_PREFERENCE_KEY = 'factory-world-ui-v1';
interface UiPreferences {
  readonly showGrid: boolean;
  readonly showOre: boolean;
  readonly showLogistics: boolean;
  readonly showMinimap: boolean;
  readonly quality: QualityMode;
  readonly reducedMotion: boolean;
}
const loadPreferences = (): UiPreferences => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(UI_PREFERENCE_KEY) ?? 'null',
    ) as Partial<UiPreferences> | null;
    return {
      showGrid: typeof parsed?.showGrid === 'boolean' ? parsed.showGrid : true,
      showOre: typeof parsed?.showOre === 'boolean' ? parsed.showOre : true,
      showLogistics:
        typeof parsed?.showLogistics === 'boolean'
          ? parsed.showLogistics
          : true,
      showMinimap:
        typeof parsed?.showMinimap === 'boolean' ? parsed.showMinimap : true,
      quality: ['low', 'standard', 'high', 'auto'].includes(
        parsed?.quality ?? '',
      )
        ? parsed!.quality!
        : 'standard',
      reducedMotion:
        (typeof parsed?.reducedMotion === 'boolean'
          ? parsed.reducedMotion
          : undefined) ??
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  } catch {
    return {
      showGrid: true,
      showOre: true,
      showLogistics: true,
      showMinimap: true,
      quality: 'standard',
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches,
    };
  }
};

export const WorldCanvas = ({
  snapshot,
  settingsOpen = false,
  interactionBlocked = false,
  cameraFocus,
  selected,
  selectedEntityId,
  ghost,
  railDraft,
  activeTool,
  onCommitRail,
  onCancel,
  hoveredRailEdgeId,
  hoveredDismantleEntityId,
  selectedRailEdgeId,
  onSelect,
  onSelectEntity,
  onSelectRailEdge,
  onSelectPod,
  onHover,
}: Props) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WorldRenderer | undefined>(undefined);
  const keyboardModeRef = useRef(false);
  const latestRef = useRef({
    snapshot,
    onSelect,
    onSelectEntity,
    onSelectRailEdge,
    onSelectPod,
    onHover,
    activeTool,
    railDraft,
  });
  const [preferences, setPreferences] = useState(loadPreferences);
  const [renderError, setRenderError] = useState<string>();
  const [assetError, setAssetError] = useState<string>();
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const [touchPoint, setTouchPoint] = useState<GridPoint>();
  const [touchPick, setTouchPick] = useState<PickInfo>();
  const [pointerGrid, setPointerGrid] = useState<GridPoint>();
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [cursor, setCursor] = useState<GridPoint>(snapshot.generation.spawn);
  const cursorRef = useRef(cursor);
  const [spaceDown, setSpaceDown] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const track = useRef<PointerTrack | undefined>(undefined);
  const pinch = useRef<
    { distance: number; midX: number; midY: number } | undefined
  >(undefined);

  useEffect(() => {
    latestRef.current = {
      snapshot,
      onSelect,
      onSelectEntity,
      onSelectRailEdge,
      onSelectPod,
      onHover,
      activeTool,
      railDraft,
    };
    keyboardModeRef.current = keyboardMode;
    cursorRef.current = cursor;
  }, [
    activeTool,
    cursor,
    keyboardMode,
    onHover,
    onSelect,
    onSelectEntity,
    onSelectPod,
    onSelectRailEdge,
    railDraft,
    snapshot,
  ]);

  useEffect(() => {
    track.current = undefined;
    pointers.current.clear();
    pinch.current = undefined;
  }, [activeTool, interactionBlocked]);

  const [gestureContext, setGestureContext] = useState({
    tool: activeTool,
    blocked: interactionBlocked,
  });
  if (
    gestureContext.tool !== activeTool ||
    gestureContext.blocked !== interactionBlocked
  ) {
    setGestureContext({ tool: activeTool, blocked: interactionBlocked });
    setTouchPoint(undefined);
    setTouchPick(undefined);
    setPointerGrid(undefined);
  }

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    let renderer: WorldRenderer;
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    let cameraState = readCamera(snapshot.worldId);
    const saveCamera = () => {
      if (cameraState) {
        try {
          localStorage.setItem(
            `factory-world-camera-v1:${snapshot.worldId}`,
            JSON.stringify(cameraState),
          );
        } catch {
          /* camera preferences are optional */
        }
      }
    };
    // React effect cleanup never runs during navigation; flush the latest
    // camera on pagehide so a reload inside the debounce window persists it.
    window.addEventListener('pagehide', saveCamera);
    const onCameraChange = (state: CameraState) => {
      cameraState = state;
      clearTimeout(cameraTimer);
      cameraTimer = setTimeout(saveCamera, 200);
    };
    const restoredCamera = cameraState;
    try {
      renderer = new WorldRenderer(host, snapshot, {
        onSelect: (point) => latestRef.current.onSelect(point),
        onSelectEntity: (id) => latestRef.current.onSelectEntity(id),
        onHover: (point) => latestRef.current.onHover(point),
        onReady: () => {
          setRenderError(undefined);
          setAssetError(undefined);
        },
        onAssetError: setAssetError,
        onCameraChange,
      });
      if (restoredCamera) renderer.restoreCamera(restoredCamera);
      rendererRef.current = renderer;
      renderer.setOverlays(
        preferences.showGrid,
        preferences.showOre,
        preferences.showLogistics,
      );
      renderer.setQuality(preferences.quality);
      renderer.reducedMotion = preferences.reducedMotion;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'WebGL 2 is unavailable.';
      const errorFrame = requestAnimationFrame(() =>
        setRenderError(errorMessage),
      );
      return () => cancelAnimationFrame(errorFrame);
    }
    const canvas = renderer.renderer.domElement;
    let spaceHeld = false;
    const getPoint = (event: PointerEvent) =>
      renderer.pointAt(event.clientX, event.clientY);
    let previousHover: GridPoint | undefined;
    const updateHover = (event: PointerEvent) => {
      const point = getPoint(event);
      if (previousHover?.x === point?.x && previousHover?.y === point?.y)
        return;
      previousHover = point;
      setPointerGrid(point);
      latestRef.current.onHover(point);
      if (keyboardModeRef.current && point !== undefined) setCursor(point);
    };
    const beginPinch = () => {
      const contacts = [...pointers.current.values()];
      if (contacts.length < 2) return;
      track.current = undefined;
      setTouchPoint(undefined);
      setTouchPick(undefined);
      const [a, b] = contacts;
      pinch.current = {
        distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        midX: (a!.x + b!.x) / 2,
        midY: (a!.y + b!.y) / 2,
      };
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button === 2)
        event.preventDefault();
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (pointers.current.size > 1) {
        beginPinch();
        return;
      }
      const startPoint = getPoint(event);
      track.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        button: event.button,
        cameraGesture: event.button !== 0 || spaceHeld,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        dragged: false,
        ...(startPoint === undefined ? {} : { startPoint }),
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    };
    const pointerMove = (event: PointerEvent) => {
      if (pointers.current.has(event.pointerId))
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
      if (pointers.current.size >= 2) {
        const contacts = [...pointers.current.values()];
        const [a, b] = contacts;
        const previous = pinch.current;
        if (a !== undefined && b !== undefined && previous !== undefined) {
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          renderer.panPixels(midX - previous.midX, midY - previous.midY);
          if (distance > 1 && previous.distance > 1)
            renderer.zoomAt(midX, midY, previous.distance / distance);
          pinch.current = { distance, midX, midY };
        }
        return;
      }
      updateHover(event);
      const active = track.current;
      if (active === undefined || active.pointerId !== event.pointerId) return;
      const dx = event.clientX - active.lastX;
      const dy = event.clientY - active.lastY;
      const distance =
        Math.abs(event.clientX - active.startX) +
        Math.abs(event.clientY - active.startY);
      if (distance >= 5) active.dragged = true;
      if (active.pointerType !== 'touch' && active.dragged) {
        if (active.button === 2) renderer.orbitPixels(dx, dy);
        else if (active.button === 1 || (active.button === 0 && spaceHeld))
          renderer.panPixels(dx, dy);
        else if (
          active.button === 0 &&
          latestRef.current.activeTool === 'rail'
        ) {
          // The endpoint preview follows the pointer; committing remains on release.
        }
      }
      active.lastX = event.clientX;
      active.lastY = event.clientY;
    };
    const pointerUp = (event: PointerEvent) => {
      const active = track.current;
      pointers.current.delete(event.pointerId);
      if (pointers.current.size < 2) pinch.current = undefined;
      if (active === undefined || active.pointerId !== event.pointerId) return;
      track.current = undefined;
      const rect = canvas.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX >= rect.right ||
        event.clientY < rect.top ||
        event.clientY >= rect.bottom ||
        active.cameraGesture
      )
        return;
      const point = getPoint(event);
      if (active.pointerType === 'touch') {
        if (
          !active.dragged &&
          pointers.current.size === 0 &&
          point !== undefined
        ) {
          setTouchPoint(point);
          setTouchPick(renderer.pick(event.clientX, event.clientY));
          setCursor(point);
        }
        return;
      }
      if (active.button !== 0 || point === undefined) return;
      if (active.dragged) {
        if (latestRef.current.activeTool === 'rail') {
          if (
            latestRef.current.railDraft.length === 0 &&
            active.startPoint !== undefined
          )
            latestRef.current.onSelect(active.startPoint);
          latestRef.current.onSelect(point);
        }
        return;
      }
      const pick = renderer.pick(event.clientX, event.clientY);
      if (latestRef.current.activeTool === 'select') {
        if (pick?.kind === 'entity')
          latestRef.current.onSelectEntity(pick.id as WorldEntityId);
        else latestRef.current.onSelectEntity(undefined);
        if (pick?.kind === 'rail')
          latestRef.current.onSelectRailEdge(pick.id as RailEdgeId);
        else latestRef.current.onSelectRailEdge(undefined);
        if (pick?.kind === 'pod') latestRef.current.onSelectPod(pick.id);
        else latestRef.current.onSelectPod(undefined);
      }
      if (latestRef.current.activeTool !== 'select' || !pick)
        latestRef.current.onSelect(point);
    };
    const pointerCancel = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId);
      track.current = undefined;
      pinch.current = undefined;
      setTouchPoint(undefined);
      setTouchPick(undefined);
      setPointerGrid(undefined);
      latestRef.current.onHover(undefined);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      renderer.zoomAt(
        event.clientX,
        event.clientY,
        Math.exp(event.deltaY * 0.001),
      );
    };
    const contextMenu = (event: MouseEvent) => event.preventDefault();
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.repeat && ['q', 'e', 'enter'].includes(event.key.toLowerCase()))
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        spaceHeld = true;
        setSpaceDown(true);
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.key === 'Home') {
        event.preventDefault();
        renderer.setHome();
      } else if (event.key.toLowerCase() === 'q') {
        event.preventDefault();
        renderer.rotateCamera(-1);
      } else if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        renderer.rotateCamera(1);
      } else if (event.key === 'Escape') {
        setKeyboardMode(false);
        latestRef.current.onHover(undefined);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        renderer.zoom(0.82);
      } else if (event.key === '-') {
        event.preventDefault();
        renderer.zoom(1.22);
      } else if (event.key.startsWith('Arrow') && keyboardModeRef.current) {
        event.preventDefault();
        setCursor((current) => ({
          x: Math.max(
            0,
            Math.min(
              snapshot.grid.width - 1,
              current.x +
                (event.key === 'ArrowLeft'
                  ? -1
                  : event.key === 'ArrowRight'
                    ? 1
                    : 0),
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              snapshot.grid.height - 1,
              current.y +
                (event.key === 'ArrowUp'
                  ? -1
                  : event.key === 'ArrowDown'
                    ? 1
                    : 0),
            ),
          ),
        }));
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const amount = event.shiftKey ? 80 : 36;
        renderer.panPixels(
          event.key === 'ArrowLeft'
            ? -amount
            : event.key === 'ArrowRight'
              ? amount
              : 0,
          event.key === 'ArrowUp'
            ? -amount
            : event.key === 'ArrowDown'
              ? amount
              : 0,
        );
      } else if (keyboardModeRef.current && event.key === 'Enter') {
        event.preventDefault();
        latestRef.current.onSelect(cursorRef.current);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        spaceHeld = false;
        setSpaceDown(false);
      }
    };
    const blur = () => {
      track.current = undefined;
      pointers.current.clear();
      pinch.current = undefined;
      setTouchPoint(undefined);
      setTouchPick(undefined);
      setPointerGrid(undefined);
      spaceHeld = false;
      setSpaceDown(false);
    };
    const lostCapture = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId);
      track.current = undefined;
      if (pointers.current.size < 2) pinch.current = undefined;
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      setRenderError(
        'The graphics context was lost. The world session is still running.',
      );
    };
    const contextRestored = () => {
      setRenderError('Rebuilding the 3D view from the accepted world state…');
      setRendererGeneration((value) => value + 1);
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerCancel);
    canvas.addEventListener('lostpointercapture', lostCapture);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', contextMenu);
    canvas.addEventListener('keydown', keyDown);
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('lostpointercapture', lostCapture);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', contextMenu);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      rendererRef.current = undefined;
      window.removeEventListener('pagehide', saveCamera);
      clearTimeout(cameraTimer);
      saveCamera();
      renderer.dispose();
    };
    // The renderer is a single lifetime owner; callbacks read through latestRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererGeneration]);

  useEffect(() => {
    if (keyboardMode) {
      rendererRef.current?.ensureVisible(cursor);
      latestRef.current.onHover(cursor);
    }
  }, [keyboardMode, cursor]);

  useEffect(() => {
    if (cameraFocus !== undefined) rendererRef.current?.focus(cameraFocus);
  }, [cameraFocus]);

  useEffect(() => {
    rendererRef.current?.setSnapshot(snapshot);
  }, [snapshot]);
  const previewPoint = keyboardMode ? cursor : pointerGrid;
  const lastRailPoint = railDraft.at(-1);
  const railPreview = useMemo(() => {
    if (activeTool !== 'rail' || !lastRailPoint || !previewPoint)
      return undefined;
    return Math.abs(previewPoint.x - lastRailPoint.x) >=
      Math.abs(previewPoint.y - lastRailPoint.y)
      ? { x: previewPoint.x, y: lastRailPoint.y }
      : { x: lastRailPoint.x, y: previewPoint.y };
  }, [activeTool, lastRailPoint, previewPoint]);
  const railFeedback =
    activeTool === 'rail' && railDraft.length > 0
      ? validateRailPath(
          snapshot.grid,
          railPreview ? [...railDraft, railPreview] : railDraft,
        )
      : undefined;
  useEffect(() => {
    rendererRef.current?.setTransient({
      ...(ghost === undefined ? {} : { ghost }),
      ...(selected === undefined ? {} : { selected }),
      ...(selectedEntityId === undefined ? {} : { selectedEntityId }),
      railDraft,
      ...(railPreview === undefined ? {} : { railPreview }),
      ...(keyboardMode ? { keyboardCursor: cursor } : {}),
      ...(hoveredRailEdgeId === undefined ? {} : { hoveredRailEdgeId }),
      ...(hoveredDismantleEntityId === undefined
        ? {}
        : { hoveredDismantleEntityId }),
      ...(selectedRailEdgeId === undefined ? {} : { selectedRailEdgeId }),
      activeTool,
    });
  }, [
    activeTool,
    cursor,
    ghost,
    hoveredDismantleEntityId,
    hoveredRailEdgeId,
    keyboardMode,
    pointerGrid,
    railDraft,
    railPreview,
    selected,
    selectedEntityId,
    selectedRailEdgeId,
  ]);
  useEffect(() => {
    rendererRef.current?.setOverlays(
      preferences.showGrid,
      preferences.showOre,
      preferences.showLogistics,
    );
    rendererRef.current?.setQuality(preferences.quality);
    if (rendererRef.current)
      rendererRef.current.reducedMotion = preferences.reducedMotion;
    try {
      localStorage.setItem(UI_PREFERENCE_KEY, JSON.stringify(preferences));
    } catch {
      /* keep in-memory preferences */
    }
  }, [preferences]);
  useEffect(() => {
    const canvas =
      hostRef.current?.parentElement?.querySelector<HTMLCanvasElement>(
        '.world-minimap-canvas',
      ) ?? undefined;
    rendererRef.current?.setMinimap(canvas);
    return () => rendererRef.current?.setMinimap(undefined);
  }, [preferences.showMinimap, renderError]);

  const confirmTouch = () => {
    if (touchPoint === undefined) return;
    if (activeTool === 'select') {
      if (touchPick?.kind === 'entity')
        onSelectEntity(touchPick.id as WorldEntityId);
      else if (touchPick?.kind === 'rail')
        onSelectRailEdge(touchPick.id as RailEdgeId);
      else if (touchPick?.kind === 'pod') onSelectPod(touchPick.id);
      else {
        const entity = snapshot.entities.find((candidate) =>
          occupiedCells(candidate.transform).some(
            (cell) => cell.x === touchPoint.x && cell.y === touchPoint.y,
          ),
        );
        onSelectEntity(entity?.id);
        onSelectRailEdge(undefined);
        onSelectPod(undefined);
      }
    }
    if (activeTool !== 'select' || !touchPick) onSelect(touchPoint);
    setTouchPoint(undefined);
    setTouchPick(undefined);
  };
  const togglePreference = (key: keyof UiPreferences) =>
    setPreferences((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className={`world-viewport${spaceDown ? ' is-panning' : ''}`}>
      <div className="world-three-host" ref={hostRef} />
      <span className="world-catchup-indicator">
        Synchronising traffic display…
      </span>
      {assetError !== undefined && (
        <div className="world-asset-error" role="alert">
          <span>
            Some models are unavailable. Correct-footprint fallbacks are shown.{' '}
            {assetError}
          </span>
          <button onClick={() => setRendererGeneration((value) => value + 1)}>
            Retry models
          </button>
        </div>
      )}
      {renderError !== undefined && (
        <div className="world-webgl-fallback" role="alert">
          <strong>3D world view unavailable</strong>
          <span>{renderError}</span>
          <p>
            World controls, buildings, diagnostics, and saving remain available
            in the inspector.
          </p>
          <button onClick={() => setRendererGeneration((value) => value + 1)}>
            Retry 3D view
          </button>
        </div>
      )}
      <div
        className="world-view-controls"
        aria-label="Camera controls"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Rotate camera left"
          onClick={() => rendererRef.current?.rotateCamera(-1)}
        >
          ↶
        </button>
        <button
          aria-label="Rotate camera right"
          onClick={() => rendererRef.current?.rotateCamera(1)}
        >
          ↷
        </button>
        <button
          aria-label="Toggle top view"
          onClick={() => rendererRef.current?.setTopView()}
        >
          Top
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => rendererRef.current?.zoom(0.8)}
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => rendererRef.current?.zoom(1.25)}
        >
          −
        </button>
        <button
          aria-label="Home camera"
          onClick={() => rendererRef.current?.setHome()}
        >
          ⌂
        </button>
      </div>
      <div
        className="world-overlay-controls"
        aria-label="World overlays"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          aria-pressed={preferences.showGrid}
          onClick={() => togglePreference('showGrid')}
        >
          Grid
        </button>
        <button
          aria-pressed={preferences.showOre}
          onClick={() => togglePreference('showOre')}
        >
          Ore
        </button>
        <button
          aria-pressed={preferences.showLogistics}
          onClick={() => togglePreference('showLogistics')}
        >
          Traffic
        </button>
      </div>
      {settingsOpen && (
        <div
          className="world-render-settings"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <label>
            Graphics quality
            <select
              value={preferences.quality}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  quality: event.target.value as QualityMode,
                }))
              }
            >
              <option value="low">Low · 1×</option>
              <option value="standard">Standard · 1.5×</option>
              <option value="high">High · 2×</option>
              <option value="auto">Automatic</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  reducedMotion: event.target.checked,
                }))
              }
            />{' '}
            Reduced motion
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferences.showMinimap}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  showMinimap: event.target.checked,
                }))
              }
            />{' '}
            Show minimap
          </label>
        </div>
      )}
      {preferences.showMinimap && (
        <div
          className="world-minimap"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <canvas
            className="world-minimap-canvas"
            width={180}
            height={126}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                rendererRef.current?.setHome();
              }
            }}
            aria-label="Minimap. Click to focus camera."
            onClick={(event) =>
              rendererRef.current?.focusMinimap(event.clientX, event.clientY)
            }
          />
          <span>World map</span>
        </div>
      )}
      {railFeedback?.reason &&
        railDraft.length > 0 &&
        !railFeedback.reason.includes('two distinct') && (
          <div className="world-placement-feedback" role="status">
            {railFeedback.reason}
          </div>
        )}
      {keyboardMode && (
        <div className="world-keyboard-cursor" aria-live="polite">
          Cursor {cursor.x}, {cursor.y}
          <button onClick={() => onSelect(cursor)}>
            {activeTool === 'rail' && railDraft.length > 1
              ? 'Add rail point'
              : 'Confirm step'}
          </button>
          {activeTool === 'rail' && railDraft.length > 1 && (
            <button onClick={onCommitRail}>Finish rail</button>
          )}
          <button
            onClick={() => {
              setKeyboardMode(false);
              onCancel();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {touchPoint !== undefined && (
        <div
          className="world-touch-confirm"
          role="group"
          aria-label="Confirm touch action"
        >
          <span>
            Tile {touchPoint.x}, {touchPoint.y}
          </span>
          <button onClick={confirmTouch}>Confirm</button>
          {activeTool === 'rail' && railDraft.length > 1 && (
            <button onClick={onCommitRail}>Finish rail</button>
          )}
          <button
            onClick={() => {
              setTouchPoint(undefined);
              setTouchPick(undefined);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      <button
        className="world-keyboard-toggle"
        aria-pressed={keyboardMode}
        onClick={() => {
          setKeyboardMode((current) => !current);
          rendererRef.current?.renderer.domElement.focus({
            preventScroll: true,
          });
        }}
      >
        Keyboard placement
      </button>
      <span className="sr-only" aria-live="polite">
        {renderError === undefined
          ? ''
          : '3D view unavailable. Use the accessible entity list.'}
      </span>
    </div>
  );
};
