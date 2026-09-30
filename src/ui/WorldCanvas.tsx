import { useEffect, useRef, useState } from 'react';
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
import {
  worldProfiler,
  type WorldProfilerSnapshot,
} from '../profiling/worldProfiler';

interface Ghost {
  readonly kind: WorldTool;
  readonly transform: WorldTransform;
  readonly valid: boolean;
  readonly pending?: boolean;
}

interface Props {
  // Keep large typed arrays out of React's development performance-track props.
  // React serializes enumerable props when DevTools profiling is active.
  readonly getSnapshot: () => WorldSnapshot;
  readonly settingsOpen?: boolean;
  readonly interactionBlocked?: boolean;
  readonly cameraFocus?: GridPoint;
  readonly selected?: GridPoint;
  readonly selectedEntityId?: WorldEntityId;
  readonly ghost?: Ghost;
  readonly activeTool: WorldTool;
  readonly onPlaceRail: (points: readonly GridPoint[]) => void;
  readonly hoveredRailEdgeId?: RailEdgeId;
  readonly hoveredDismantleEntityId?: WorldEntityId;
  readonly selectedRailEdgeId?: RailEdgeId;
  readonly onSelect: (point: GridPoint) => void;
  readonly onSelectEntity: (entityId?: WorldEntityId) => void;
  readonly onSelectRailEdge: (edgeId?: RailEdgeId) => void;
  readonly onSelectPod: (podId?: string) => void;
  readonly onHover: (point?: GridPoint) => void;
  readonly onDismantleSelection: (selection: {
    readonly entityIds: readonly WorldEntityId[];
    readonly railEdgeIds: readonly RailEdgeId[];
  }) => void;
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

interface RailGesture {
  readonly start: GridPoint;
  readonly end: GridPoint;
}

interface DismantleRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const railEndPoint = (start: GridPoint, point: GridPoint): GridPoint =>
  Math.abs(point.x - start.x) >= Math.abs(point.y - start.y)
    ? { x: point.x, y: start.y }
    : { x: start.x, y: point.y };

const UI_PREFERENCE_KEY = 'factory-world-ui-v1';

const formatMilliseconds = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${value.toFixed(1)} ms`;

const formatCount = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : Math.round(value).toLocaleString();

const formatMegabytes = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;

const formatRatePerMinute = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString()}/min`;

const formatMegabytesPerMinute = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${value > 0 ? '+' : ''}${(value / (1024 * 1024)).toFixed(1)} MB/min`;

const formatFps = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(1);

const ProfilerMetric = ({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) => (
  <div className="world-profiler-metric">
    <span>{label}</span>
    <b>{value}</b>
  </div>
);

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'input, select, textarea, [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
};

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
  getSnapshot,
  settingsOpen = false,
  interactionBlocked = false,
  cameraFocus,
  selected,
  selectedEntityId,
  ghost,
  activeTool,
  onPlaceRail,
  hoveredRailEdgeId,
  hoveredDismantleEntityId,
  selectedRailEdgeId,
  onSelect,
  onSelectEntity,
  onSelectRailEdge,
  onSelectPod,
  onHover,
  onDismantleSelection,
}: Props) => {
  const snapshot = getSnapshot();
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
    onPlaceRail,
    onDismantleSelection,
    activeTool,
  });
  const [preferences, setPreferences] = useState(loadPreferences);
  const [renderError, setRenderError] = useState<string>();
  const [profilerVisible, setProfilerVisible] = useState(false);
  const [profilerSnapshot, setProfilerSnapshot] =
    useState<WorldProfilerSnapshot>();
  const [assetError, setAssetError] = useState<string>();
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const [touchPoint, setTouchPoint] = useState<GridPoint>();
  const [touchPick, setTouchPick] = useState<PickInfo>();
  const [pointerGrid, setPointerGrid] = useState<GridPoint>();
  const [railGesture, setRailGesture] = useState<RailGesture>();
  const [dismantleRect, setDismantleRect] = useState<DismantleRect>();
  const [dismantleSelectionIds, setDismantleSelectionIds] = useState<
    readonly WorldEntityId[]
  >([]);
  const [dismantleRailEdgeIds, setDismantleRailEdgeIds] = useState<
    readonly RailEdgeId[]
  >([]);
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
    const onProfilerShortcut = (event: KeyboardEvent) => {
      if (
        event.code !== 'F3' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target)
      )
        return;
      event.preventDefault();
      setProfilerVisible((visible) => !visible);
    };
    window.addEventListener('keydown', onProfilerShortcut);
    return () => window.removeEventListener('keydown', onProfilerShortcut);
  }, []);

  useEffect(() => {
    worldProfiler.setEnabled(profilerVisible);
    if (!profilerVisible) return () => worldProfiler.setEnabled(false);

    const refresh = () => setProfilerSnapshot(worldProfiler.snapshot());
    let observer: PerformanceObserver | undefined;
    if (typeof PerformanceObserver !== 'undefined')
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            worldProfiler.recordLongTask(entry.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
      } catch {
        observer = undefined;
      }
    const initialRefresh = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 500);
    let expectedProbeAt = performance.now() + 100;
    const eventLoopProbe = window.setInterval(() => {
      const now = performance.now();
      worldProfiler.recordEventLoopDelay(Math.max(0, now - expectedProbeAt));
      expectedProbeAt = now + 100;
    }, 100);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      window.clearInterval(eventLoopProbe);
      observer?.disconnect();
      worldProfiler.setEnabled(false);
    };
  }, [profilerVisible]);

  useEffect(() => {
    rendererRef.current?.setProfiling(profilerVisible);
  }, [profilerVisible, rendererGeneration]);

  useEffect(() => {
    latestRef.current = {
      snapshot,
      onSelect,
      onSelectEntity,
      onSelectRailEdge,
      onSelectPod,
      onHover,
      onPlaceRail,
      onDismantleSelection,
      activeTool,
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
    onPlaceRail,
    onDismantleSelection,
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
    setRailGesture(undefined);
    setTouchPoint(undefined);
    setTouchPick(undefined);
    setPointerGrid(undefined);
    setDismantleRect(undefined);
    setDismantleSelectionIds([]);
    setDismantleRailEdgeIds([]);
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
      if (worldProfiler.enabled) renderer.setProfiling(true);
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
      return () => {
        cancelAnimationFrame(errorFrame);
        window.removeEventListener('pagehide', saveCamera);
        clearTimeout(cameraTimer);
      };
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
    const dismantleSelectionInRect = (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
    ) => {
      const profileStart = worldProfiler.enabled
        ? performance.now()
        : undefined;
      const entitiesById = new Map(
        latestRef.current.snapshot.entities.map((entity) => [
          entity.id,
          entity,
        ]),
      );
      const entityIds = renderer
        .entitiesInScreenRect(startX, startY, endX, endY)
        .filter((id) => {
          const entity = entitiesById.get(id);
          const dismantling =
            entity?.kind === 'factory'
              ? entity.state === 'DISMANTLING'
              : (entity?.kind === 'mine' ||
                  entity?.kind === 'storage' ||
                  entity?.kind === 'depot') &&
                entity.dismantling === true;
          return (
            entity !== undefined &&
            entity.kind !== 'construction-site' &&
            !dismantling
          );
        });
      const railEdgeIds = renderer.railEdgesInScreenRect(
        startX,
        startY,
        endX,
        endY,
      );
      if (profileStart !== undefined)
        worldProfiler.recordDismantleSelection(
          performance.now() - profileStart,
        );
      return { entityIds, railEdgeIds };
    };
    const clampedToCanvas = (x: number, y: number) => {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: Math.max(bounds.left, Math.min(bounds.right, x)),
        y: Math.max(bounds.top, Math.min(bounds.bottom, y)),
      };
    };
    const beginPinch = () => {
      const contacts = [...pointers.current.values()];
      if (contacts.length < 2) return;
      track.current = undefined;
      setRailGesture(undefined);
      setDismantleRect(undefined);
      setDismantleSelectionIds([]);
      setDismantleRailEdgeIds([]);
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
      if (
        event.pointerType === 'touch' &&
        latestRef.current.activeTool === 'dismantle'
      )
        return;
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
      const point = getPoint(event);
      if (
        distance >= 5 ||
        (latestRef.current.activeTool === 'rail' &&
          active.startPoint !== undefined &&
          point !== undefined &&
          (active.startPoint.x !== point.x || active.startPoint.y !== point.y))
      )
        active.dragged = true;
      if (
        active.dragged &&
        active.button === 0 &&
        !active.cameraGesture &&
        !spaceHeld &&
        active.pointerType !== 'touch' &&
        latestRef.current.activeTool === 'dismantle'
      ) {
        const end = clampedToCanvas(event.clientX, event.clientY);
        const bounds = canvas.getBoundingClientRect();
        setDismantleRect({
          left: Math.min(active.startX, end.x) - bounds.left,
          top: Math.min(active.startY, end.y) - bounds.top,
          width: Math.abs(end.x - active.startX),
          height: Math.abs(end.y - active.startY),
        });
        const selection = dismantleSelectionInRect(
          active.startX,
          active.startY,
          end.x,
          end.y,
        );
        setDismantleSelectionIds(selection.entityIds);
        setDismantleRailEdgeIds(selection.railEdgeIds);
      }
      if (
        active.dragged &&
        active.button === 0 &&
        !active.cameraGesture &&
        !spaceHeld &&
        latestRef.current.activeTool === 'rail' &&
        active.startPoint !== undefined
      ) {
        const start = active.startPoint;
        if (point !== undefined) {
          const end = railEndPoint(start, point);
          if (end.x === start.x && end.y === start.y) setRailGesture(undefined);
          else
            setRailGesture((current) =>
              current?.start.x === start.x &&
              current.start.y === start.y &&
              current.end.x === end.x &&
              current.end.y === end.y
                ? current
                : { start, end },
            );
        } else setRailGesture(undefined);
      }
      if (active.pointerType !== 'touch' && active.dragged) {
        if (active.button === 2) renderer.orbitPixels(dx, dy);
        else if (active.button === 1 || (active.button === 0 && spaceHeld))
          renderer.panPixels(dx, dy);
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
      setRailGesture(undefined);
      const pointDistance =
        Math.abs(event.clientX - active.startX) +
        Math.abs(event.clientY - active.startY);
      if (latestRef.current.activeTool === 'dismantle') {
        setDismantleRect(undefined);
        setDismantleSelectionIds([]);
        setDismantleRailEdgeIds([]);
        if (
          active.button === 0 &&
          active.pointerType !== 'touch' &&
          !active.cameraGesture &&
          !spaceHeld &&
          (active.dragged || pointDistance >= 5)
        ) {
          const end = clampedToCanvas(event.clientX, event.clientY);
          const selection = dismantleSelectionInRect(
            active.startX,
            active.startY,
            end.x,
            end.y,
          );
          if (
            selection.entityIds.length > 0 ||
            selection.railEdgeIds.length > 0
          )
            latestRef.current.onDismantleSelection({
              entityIds: selection.entityIds,
              railEdgeIds: selection.railEdgeIds,
            });
        }
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX >= rect.right ||
        event.clientY < rect.top ||
        event.clientY >= rect.bottom ||
        active.cameraGesture ||
        (active.button === 0 && spaceHeld)
      )
        return;
      const point = getPoint(event);
      const dragged =
        active.dragged ||
        (latestRef.current.activeTool === 'rail' &&
          active.startPoint !== undefined &&
          point !== undefined &&
          (active.startPoint.x !== point.x || active.startPoint.y !== point.y));
      if (active.pointerType === 'touch') {
        if (
          dragged &&
          latestRef.current.activeTool === 'rail' &&
          active.startPoint !== undefined &&
          point !== undefined
        ) {
          const end = railEndPoint(active.startPoint, point);
          if (end.x !== active.startPoint.x || end.y !== active.startPoint.y)
            latestRef.current.onPlaceRail([active.startPoint, end]);
          return;
        }
        if (
          !dragged &&
          pointers.current.size === 0 &&
          point !== undefined &&
          latestRef.current.activeTool !== 'rail'
        ) {
          setTouchPoint(point);
          setTouchPick(renderer.pick(event.clientX, event.clientY));
          setCursor(point);
        }
        return;
      }
      if (active.button !== 0 || point === undefined) return;
      if (dragged) {
        if (
          latestRef.current.activeTool === 'rail' &&
          active.startPoint !== undefined
        ) {
          const end = railEndPoint(active.startPoint, point);
          if (end.x !== active.startPoint.x || end.y !== active.startPoint.y)
            latestRef.current.onPlaceRail([active.startPoint, end]);
        }
        return;
      }
      if (latestRef.current.activeTool === 'rail') return;
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
      setRailGesture(undefined);
      setDismantleRect(undefined);
      setDismantleSelectionIds([]);
      setDismantleRailEdgeIds([]);
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
        if (latestRef.current.activeTool === 'dismantle') {
          track.current = undefined;
          setDismantleRect(undefined);
          setDismantleSelectionIds([]);
          setDismantleRailEdgeIds([]);
        }
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
        if (latestRef.current.activeTool !== 'rail')
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
      setRailGesture(undefined);
      setDismantleRect(undefined);
      setDismantleSelectionIds([]);
      setDismantleRailEdgeIds([]);
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
      setRailGesture(undefined);
      setDismantleRect(undefined);
      setDismantleSelectionIds([]);
      setDismantleRailEdgeIds([]);
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
  }, [keyboardMode, cursor, activeTool, rendererGeneration]);

  useEffect(() => {
    if (cameraFocus !== undefined) rendererRef.current?.focus(cameraFocus);
  }, [cameraFocus]);

  useEffect(() => {
    rendererRef.current?.setSnapshot(snapshot);
  }, [snapshot]);
  const railFeedback = railGesture
    ? validateRailPath(snapshot.grid, [railGesture.start, railGesture.end])
    : undefined;
  useEffect(() => {
    rendererRef.current?.setTransient({
      ...(ghost === undefined ? {} : { ghost }),
      ...(selected === undefined ? {} : { selected }),
      ...(selectedEntityId === undefined ? {} : { selectedEntityId }),
      ...(railGesture === undefined ? {} : { railGesture }),
      ...(keyboardMode ? { keyboardCursor: cursor } : {}),
      ...(hoveredRailEdgeId === undefined ? {} : { hoveredRailEdgeId }),
      ...(hoveredDismantleEntityId === undefined
        ? {}
        : { hoveredDismantleEntityId }),
      dismantleSelectionIds,
      dismantleRailEdgeIds,
      ...(selectedRailEdgeId === undefined ? {} : { selectedRailEdgeId }),
      activeTool,
    });
  }, [
    activeTool,
    cursor,
    dismantleSelectionIds,
    dismantleRailEdgeIds,
    ghost,
    hoveredDismantleEntityId,
    hoveredRailEdgeId,
    keyboardMode,
    pointerGrid,
    railGesture,
    rendererGeneration,
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
  }, [
    preferences.showGrid,
    preferences.showLogistics,
    preferences.showOre,
    rendererGeneration,
  ]);
  useEffect(() => {
    rendererRef.current?.setQuality(preferences.quality);
  }, [preferences.quality, rendererGeneration]);
  useEffect(() => {
    if (rendererRef.current)
      rendererRef.current.reducedMotion = preferences.reducedMotion;
  }, [preferences.reducedMotion, rendererGeneration]);
  useEffect(() => {
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
  }, [preferences.showMinimap, renderError, rendererGeneration]);

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
      {profilerVisible && profilerSnapshot !== undefined && (
        <section
          className="world-profiler"
          aria-label="World performance profiler"
          role="region"
        >
          <header className="world-profiler-header">
            <strong>Performances — fenêtre 5 s</strong>
            <span>F3 — fermer</span>
            <button
              type="button"
              aria-label="Close performance profiler"
              onClick={() => setProfilerVisible(false)}
            >
              ×
            </button>
          </header>
          <div className="world-profiler-grid">
            <div className="world-profiler-group">
              <h3>Frame</h3>
              <ProfilerMetric
                label="FPS"
                value={formatFps(profilerSnapshot.fps)}
              />
              <ProfilerMetric
                label="Frame p95"
                value={formatMilliseconds(profilerSnapshot.frameP95Ms)}
              />
              <ProfilerMetric
                label="Frame p99 / max"
                value={`${formatMilliseconds(profilerSnapshot.frameP99Ms)} / ${formatMilliseconds(profilerSnapshot.frameMaxMs)}`}
              />
              <ProfilerMetric
                label="Frames > 4,17 ms (240 FPS)"
                value={
                  profilerSnapshot.framesOver240BudgetPercent === null
                    ? '—'
                    : `${profilerSnapshot.framesOver240BudgetPercent.toFixed(1)} %`
                }
              />
              <ProfilerMetric
                label="Retard thread principal p95"
                value={formatMilliseconds(profilerSnapshot.eventLoopDelayP95Ms)}
              />
              {profilerSnapshot.uiRenderP95Ms !== null && (
                <ProfilerMetric
                  label="React rendu p95"
                  value={formatMilliseconds(profilerSnapshot.uiRenderP95Ms)}
                />
              )}
              <ProfilerMetric
                label="Animation CPU p95"
                value={formatMilliseconds(profilerSnapshot.updateP95Ms)}
              />
              <ProfilerMetric
                label="WebGL CPU submit p95"
                value={formatMilliseconds(profilerSnapshot.webglSubmitP95Ms)}
              />
              <ProfilerMetric
                label="GPU p95"
                value={formatMilliseconds(profilerSnapshot.gpuP95Ms)}
              />
              <ProfilerMetric
                label="Snapshot sync p95"
                value={formatMilliseconds(profilerSnapshot.snapshotSyncP95Ms)}
              />
              <ProfilerMetric
                label="Dismantle selection p95"
                value={formatMilliseconds(
                  profilerSnapshot.dismantleSelectionP95Ms,
                )}
              />
            </div>
            <div className="world-profiler-group">
              <h3>Worker</h3>
              <ProfilerMetric
                label="Aller-retour p95"
                value={formatMilliseconds(profilerSnapshot.workerRpcP95Ms)}
              />
              <ProfilerMetric
                label="Calcul worker p95"
                value={formatMilliseconds(
                  profilerSnapshot.workerProcessingP95Ms,
                )}
              />
              <ProfilerMetric
                label="Transport / attente p95"
                value={formatMilliseconds(profilerSnapshot.workerWaitP95Ms)}
              />
              <ProfilerMetric
                label="File client p95"
                value={formatMilliseconds(profilerSnapshot.workerQueueP95Ms)}
              />
              <ProfilerMetric
                label="Delta p95"
                value={formatMilliseconds(profilerSnapshot.workerDeltaP95Ms)}
              />
              <ProfilerMetric
                label="Apply delta p95"
                value={formatMilliseconds(profilerSnapshot.deltaApplyP95Ms)}
              />
              <ProfilerMetric
                label="Envoi client p95"
                value={formatMilliseconds(profilerSnapshot.postMessageP95Ms)}
              />
              <ProfilerMetric
                label="Envoi worker précédent p95"
                value={formatMilliseconds(
                  profilerSnapshot.previousWorkerPostMessageP95Ms,
                )}
              />
            </div>
            <div className="world-profiler-group">
              <h3>Rendu</h3>
              <ProfilerMetric
                label="Calls main / total"
                value={`${formatCount(profilerSnapshot.mainCalls)} / ${formatCount(profilerSnapshot.calls)}`}
              />
              <ProfilerMetric
                label="Triangles main / total"
                value={`${formatCount(profilerSnapshot.mainTriangles)} / ${formatCount(profilerSnapshot.triangles)}`}
              />
              <ProfilerMetric
                label="Qualité"
                value={profilerSnapshot.quality}
              />
            </div>
            <div className="world-profiler-group">
              <h3>Scène</h3>
              <ProfilerMetric
                label="Entités"
                value={formatCount(profilerSnapshot.entities)}
              />
              <ProfilerMetric
                label="Rails"
                value={formatCount(profilerSnapshot.rails)}
              />
              <ProfilerMetric
                label="Pods"
                value={formatCount(profilerSnapshot.pods)}
              />
              <ProfilerMetric
                label="Missions actives"
                value={formatCount(profilerSnapshot.missions)}
              />
              <ProfilerMetric
                label="Variation missions"
                value={formatRatePerMinute(
                  profilerSnapshot.missionChangePerMinute,
                )}
              />
              <ProfilerMetric
                label="Objets scène"
                value={formatCount(profilerSnapshot.sceneObjects)}
              />
            </div>
            <div className="world-profiler-group">
              <h3>Mémoire</h3>
              <ProfilerMetric
                label="Géométries"
                value={formatCount(profilerSnapshot.geometries)}
              />
              <ProfilerMetric
                label="Textures"
                value={formatCount(profilerSnapshot.textures)}
              />
              <ProfilerMetric
                label="Buffers GPU estimés"
                value={formatMegabytes(
                  profilerSnapshot.estimatedGpuBufferBytes,
                )}
              />
              <ProfilerMetric
                label="JS heap utilisé / limite"
                value={`${formatMegabytes(profilerSnapshot.jsHeapUsedBytes)} / ${formatMegabytes(profilerSnapshot.jsHeapLimitBytes)}`}
              />
              <ProfilerMetric
                label="Variation JS heap"
                value={formatMegabytesPerMinute(
                  profilerSnapshot.jsHeapChangePerMinuteBytes,
                )}
              />
            </div>
            <div className="world-profiler-group">
              <h3>Long tasks</h3>
              <ProfilerMetric
                label="Nombre sur 5 s / session"
                value={`${formatCount(profilerSnapshot.recentLongTasks)} / ${formatCount(profilerSnapshot.longTasks)}`}
              />
              <ProfilerMetric
                label="Max sur 5 s"
                value={formatMilliseconds(profilerSnapshot.maxLongTaskMs)}
              />
            </div>
          </div>
          <p className="world-profiler-note">
            Mesures sur les 5 dernières secondes (
            {profilerSnapshot.frameSamples} frames), plafonnées à 4 096
            échantillons par mesure. 240 FPS = 4,17 ms ; les FPS dépendent aussi
            de la fréquence de l’écran. Transport / attente = aller-retour moins
            calcul worker, par requête ; comprend sérialisation et attente des
            threads. Retard du thread principal : sonde timer 100 ms. Les p95 ne
            s’additionnent pas. GPU : timer queries requis ; buffers estimés,
            heap selon navigateur.
          </p>
        </section>
      )}
      {dismantleRect !== undefined && (
        <div
          className="world-dismantle-selection"
          aria-hidden="true"
          style={{
            left: dismantleRect.left,
            top: dismantleRect.top,
            width: dismantleRect.width,
            height: dismantleRect.height,
          }}
        />
      )}
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
        <button
          aria-label="Toggle performance profiler (F3)"
          aria-pressed={profilerVisible}
          title="Toggle performance profiler (F3)"
          onClick={() => setProfilerVisible((visible) => !visible)}
        >
          Perf
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
      {railFeedback?.valid === false && railFeedback.reason && (
        <div className="world-placement-feedback is-invalid" role="status">
          {railFeedback.reason}
        </div>
      )}
      {keyboardMode && (
        <div className="world-keyboard-cursor" aria-live="polite">
          {activeTool === 'rail' ? (
            <span>Place rails with a mouse or one-finger drag.</span>
          ) : (
            <>
              Cursor {cursor.x}, {cursor.y}
              <button onClick={() => onSelect(cursor)}>Confirm step</button>
              <button onClick={() => setKeyboardMode(false)}>Close</button>
            </>
          )}
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
