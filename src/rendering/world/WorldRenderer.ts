import * as THREE from 'three';
import { AssetRegistry } from './AssetRegistry';
import { InstancePool } from './InstancePool';
import { RenderClock } from './RenderClock';
import { SpatialPicking, segmentDistance } from './SpatialPicking';
import type { CameraState } from './CameraState';
import type { GridPoint, PodId, RailEdgeId, WorldEntityId } from '../../domain';
import {
  OreKind,
  TerrainKind,
  hookupCell,
  occupiedCells,
  validateRailPath,
  type WorldEntity,
  type WorldRailNode,
  type WorldSnapshot,
  type WorldTransform,
} from '../../world';
import {
  footprintCentre,
  footprintSize,
  gridToWorld,
  quarterTurnRadians,
  worldToGrid,
} from './GridSpace';
import {
  railEdgeConnectionState,
  railCorners,
  railNodeDegrees,
} from '../../ui/worldRailVisual';

export interface GhostState {
  readonly kind: string;
  readonly transform: WorldTransform;
  readonly valid: boolean;
  readonly pending?: boolean;
  readonly reason?: string;
}

export interface WorldRendererOptions {
  readonly onSelect: (point: GridPoint) => void;
  readonly onSelectEntity: (entityId?: WorldEntityId) => void;
  readonly onHover: (point?: GridPoint) => void;
  readonly onReady?: () => void;
  readonly onAssetError?: (message: string) => void;
  readonly onCameraChange?: (camera: CameraState) => void;
}
export type QualityMode = 'low' | 'standard' | 'high' | 'auto';

interface PickInfo {
  readonly kind: 'entity' | 'rail' | 'pod';
  readonly id: string;
}

interface DrawnEntity {
  readonly group: THREE.Group;
  readonly signature: string;
}

interface DrawnRail {
  readonly group: THREE.Group;
  readonly signature: string;
}

interface DrawnOre {
  readonly mesh: THREE.InstancedMesh;
  readonly slot: number;
  readonly initialRemaining: number;
  readonly baseScale: number;
  readonly rotation: number;
}

interface WorldMaterials {
  ground: THREE.MeshStandardMaterial;
  groundEdge: THREE.MeshStandardMaterial;
  structure: THREE.MeshStandardMaterial;
  equipment: THREE.MeshStandardMaterial;
  foundation: THREE.MeshStandardMaterial;
  extraction: THREE.MeshStandardMaterial;
  service: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
  railTop: THREE.MeshStandardMaterial;
  pod: THREE.MeshStandardMaterial;
  cargo: THREE.MeshStandardMaterial;
  scaffold: THREE.MeshStandardMaterial;
  warning: THREE.MeshStandardMaterial;
  error: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  drillGhost: THREE.MeshStandardMaterial;
  ghostValid: THREE.MeshStandardMaterial;
  ghostInvalid: THREE.MeshStandardMaterial;
  ghostPending: THREE.MeshStandardMaterial;
}

const CHUNK_SIZE = 32;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const signature = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
const hashCell = (x: number, y: number) => {
  let value = Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
};
const makeOreClusterGeometry = (crystal: THREE.BufferGeometry) => {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const [x, z, scale] of [
    [-0.19, -0.08, 0.78],
    [0.16, -0.06, 0.94],
    [0, 0.19, 0.66],
  ] as const) {
    const part = crystal.index ? crystal.toNonIndexed() : crystal.clone();
    part.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, x * 2, 0.18)),
        new THREE.Vector3(scale, scale, scale),
      ),
    );
    positions.push(...(part.getAttribute('position').array as Float32Array));
    normals.push(...(part.getAttribute('normal').array as Float32Array));
    part.dispose();
  }
  crystal.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

export class WorldRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1800);
  readonly renderer: THREE.WebGLRenderer;
  readonly raycaster = new THREE.Raycaster();
  readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  readonly target = new THREE.Vector3();
  readonly terrainLayer = new THREE.Group();
  readonly oreLayer = new THREE.Group();
  readonly railLayer = new THREE.Group();
  readonly buildingLayer = new THREE.Group();
  readonly podLayer = new THREE.Group();
  readonly overlayLayer = new THREE.Group();
  readonly trafficLayer = new THREE.Group();
  private readonly statusInstances = new InstancePool();
  private statusSignature = '';
  private trafficSignature = '';
  readonly pickTargets: THREE.Object3D[] = [];
  private readonly spatialPicking = new SpatialPicking();
  private pickingDirty = true;
  readonly entityDraws = new Map<WorldEntityId, DrawnEntity>();
  readonly railDraws = new Map<RailEdgeId, DrawnRail>();
  private readonly junctionDraws = new Map<string, THREE.Group>();
  private junctionSignature = '';
  readonly podDraws = new Map<PodId, THREE.Group>();
  readonly oreDraws = new Map<number, DrawnOre>();
  readonly animatedFans = new Map<WorldEntityId, THREE.Object3D>();
  readonly animatedDrillHeads = new Map<WorldEntityId, THREE.Object3D>();
  readonly extractingDrills = new Set<WorldEntityId>();
  readonly runningEntities = new Set<WorldEntityId>();
  readonly materials: WorldMaterials;
  readonly assets = new AssetRegistry();
  private readonly renderClock = new RenderClock();
  private readonly buildingInstances = new InstancePool();
  private readonly railInstances = new InstancePool();
  private readonly podInstances = new InstancePool();
  private readonly hookupLayer = new THREE.Group();
  private readonly hookupInstances = new InstancePool();
  private readonly hookupDraws = new Map<string, THREE.Group>();
  private hookupSignature = '';
  private readonly galleryLayer = new THREE.Group();
  private assetsReady = false;
  private entityLods = new Map<string, number>();
  private lastLodUpdate = 0;
  private disposed = false;
  readonly geometry = {
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    smallRound: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    shaft: new THREE.CylinderGeometry(0.11, 0.11, 1, 8),
    rock: new THREE.DodecahedronGeometry(0.42, 0),
    crystal: new THREE.OctahedronGeometry(0.3, 0),
    cone: new THREE.ConeGeometry(0.32, 0.8, 6),
    oreCluster: makeOreClusterGeometry(new THREE.OctahedronGeometry(0.3, 0)),
  };
  snapshot: WorldSnapshot;
  ghost: GhostState | undefined;
  selected: GridPoint | undefined;
  selectedEntityId: WorldEntityId | undefined;
  railDraft: readonly GridPoint[] = [];
  railPreview: GridPoint | undefined;
  keyboardCursor: GridPoint | undefined;
  hoveredRailEdgeId: RailEdgeId | undefined;
  hoveredDismantleEntityId: WorldEntityId | undefined;
  selectedRailEdgeId: RailEdgeId | undefined;
  activeTool = 'select';
  showGrid = true;
  showOre = true;
  showLogistics = true;
  reducedMotion = false;
  private host: HTMLElement;
  private animationFrame = 0;
  private resizeObserver: ResizeObserver;
  private visible = true;
  private width = 0;
  private height = 0;
  private azimuth = Math.PI / 4;
  private elevation = (50 * Math.PI) / 180;
  private orbitElevation = this.elevation;
  private radius = 70;
  private previousSnapshotAt = 0;
  private worldId = '';
  private overlaySignature = '';
  private terrainSignature = '';
  private oreArray: Uint32Array | undefined;
  private gridLines: THREE.LineSegments | undefined;
  private ghostGroup = new THREE.Group();
  private selectionOutline = new THREE.LineSegments();
  private minimapCanvas: HTMLCanvasElement | undefined;
  private minimapContext: CanvasRenderingContext2D | undefined;
  private resizeMinimapPending = false;
  private lastMinimapDrawnAt = 0;
  private readySent = false;
  private lastDrawnAt = 0;
  private lastMetricsAt = 0;
  private mainPassStart: { calls: number; triangles: number } | undefined;
  private qualityMode: QualityMode = 'standard';
  private activeQuality: Exclude<QualityMode, 'auto'> = 'standard';
  private frameIntervals: number[] = [];
  private lastQualityCheck = 0;
  private lastQualityChange = 0;
  private readonly options: WorldRendererOptions;

  constructor(
    host: HTMLElement,
    snapshot: WorldSnapshot,
    options: WorldRendererOptions,
  ) {
    this.host = host;
    this.snapshot = snapshot;
    this.options = options;
    this.materials = {
      ground: this.material('#819778'),
      groundEdge: this.material('#586e60'),
      structure: this.material('#e8dec7'),
      equipment: this.material('#4c9690'),
      foundation: this.material('#3d4b50'),
      extraction: this.material('#c77b4a'),
      service: this.material('#d9b45f'),
      rock: this.material('#68746b'),
      iron: this.material('#b8754b'),
      copper: this.material('#7ab3a5'),
      rail: this.material('#3d4b50', 0.45),
      railTop: this.material('#bdc1ae', 0.55),
      pod: this.material('#33434a', 0.38),
      cargo: this.material('#d9b45f', 0.32),
      scaffold: this.material('#bd895d', 0.6),
      warning: this.material('#edb85f', 0.25),
      error: this.material('#dc7468', 0.25),
      dark: this.material('#29363a', 0.36),
      glass: this.material('#78a6a0', 0.27),
      drillGhost: new THREE.MeshStandardMaterial({
        color: '#d9b45f',
        wireframe: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
      ghostValid: new THREE.MeshStandardMaterial({
        color: '#75c59b',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
      ghostInvalid: new THREE.MeshStandardMaterial({
        color: '#dc7468',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
      ghostPending: new THREE.MeshStandardMaterial({
        color: '#d9b45f',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    };
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.info.autoReset = false;
    if (new URLSearchParams(location.search).has('world-metrics')) {
      const draw = this.renderer.renderBufferDirect.bind(this.renderer);
      this.renderer.renderBufferDirect = (...args) => {
        if (args[0] === this.camera && !this.mainPassStart)
          this.mainPassStart = {
            calls: this.renderer.info.render.calls,
            triangles: this.renderer.info.render.triangles,
          };
        draw(...args);
      };
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor('#c8d2c2', 1);
    this.renderer.domElement.setAttribute('role', 'application');
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Three dimensional factory world',
    );
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    host.append(this.renderer.domElement);

    this.scene.background = new THREE.Color('#c8d2c2');
    this.scene.fog = new THREE.Fog('#c8d2c2', 120, 330);
    this.scene.add(
      this.terrainLayer,
      this.oreLayer,
      this.railLayer,
      this.buildingLayer,
      this.podLayer,
      this.overlayLayer,
      this.trafficLayer,
    );
    this.scene.add(
      this.buildingInstances.root,
      this.railInstances.root,
      this.podInstances.root,
      this.statusInstances.root,
    );
    this.scene.add(this.hookupLayer, this.hookupInstances.root);
    this.raycaster.layers.enable(2);
    this.createLighting();
    this.scene.add(this.ghostGroup, this.selectionOutline);
    this.selectionOutline.visible = false;
    this.setHome();
    this.syncSnapshot(snapshot, true);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    void this.assets
      .load()
      .then(async () => {
        if (this.disposed) return;
        for (const drawn of this.entityDraws.values()) {
          this.removePickTargets(drawn.group);
          this.disposeDetached(drawn.group);
        }
        this.buildingLayer.clear();
        this.entityDraws.clear();
        this.animatedFans.clear();
        this.animatedDrillHeads.clear();
        for (const group of this.podDraws.values()) {
          this.removePickTargets(group);
          this.disposeDetached(group);
        }
        this.podLayer.clear();
        this.podDraws.clear();
        this.assetsReady = true;
        for (const child of [...this.terrainLayer.children])
          this.disposeDetached(child);
        this.terrainLayer.clear();
        this.buildTerrain(this.snapshot);
        this.rebuildOre(this.snapshot);
        for (const drawn of this.railDraws.values()) {
          this.removePickTargets(drawn.group);
          this.disposeDetached(drawn.group);
        }
        this.railLayer.clear();
        this.railDraws.clear();
        this.junctionDraws.clear();
        this.junctionSignature = '';
        this.reconcileRails(this.snapshot);
        this.reconcileEntities(this.snapshot);
        this.reconcileHookups(this.snapshot);
        this.reconcilePods(this.snapshot);
        this.overlaySignature = '';
        this.updateOverlays();
        await this.renderer.compileAsync(this.scene, this.camera);
        const previews = new THREE.Group();
        for (const material of [
          this.materials.ghostValid,
          this.materials.ghostInvalid,
          this.materials.ghostPending,
        ]) {
          const preview = new THREE.Mesh(this.geometry.unitBox, material);
          preview.receiveShadow = true;
          previews.add(preview);
        }
        await this.renderer.compileAsync(previews, this.camera, this.scene);
        if (!this.disposed)
          this.renderer.domElement.dataset.assetsReady = 'true';
      })
      .catch((error: unknown) => {
        if (!this.disposed)
          this.options.onAssetError?.(
            error instanceof Error
              ? error.message
              : 'World assets could not be loaded.',
          );
      });
  }

  private readMainPass() {
    return this.mainPassStart;
  }

  private material(color: string, metalness = 0.04) {
    return new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness: 0.84,
      flatShading: true,
    });
  }

  private createLighting() {
    this.scene.add(new THREE.HemisphereLight('#edf2dc', '#66725e', 1.5));
    const sun = new THREE.DirectionalLight('#fff0cd', 2.8);
    sun.position.set(-30, 48, -25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 150;
    sun.shadow.bias = -0.0001;
    sun.shadow.normalBias = 0.045;
    sun.target.position.copy(this.target);
    this.scene.add(sun, sun.target);
  }

  setSnapshot(snapshot: WorldSnapshot) {
    const worldChanged = snapshot.worldId !== this.worldId;
    this.snapshot = snapshot;
    this.syncSnapshot(snapshot, worldChanged);
    if (worldChanged) this.setHome();
  }

  private syncSnapshot(snapshot: WorldSnapshot, rebuildTerrain: boolean) {
    this.previousSnapshotAt = performance.now();
    this.renderClock.accept(snapshot, this.previousSnapshotAt);
    if (rebuildTerrain || snapshot.worldId !== this.worldId) {
      this.worldId = snapshot.worldId;
      this.clearWorld();
      this.buildTerrain(snapshot);
      this.rebuildOre(snapshot);
    } else {
      this.applyOreChanges(snapshot);
    }
    this.reconcileEntities(snapshot);
    this.reconcileRails(snapshot);
    this.reconcileHookups(snapshot);
    this.reconcilePods(snapshot);
    this.updateDynamicState(snapshot);
    this.updateOverlays();
    this.drawMinimap();
  }

  private clearWorld() {
    this.overlaySignature = '';
    this.trafficSignature = '';
    this.statusSignature = '';
    this.statusInstances.clear();
    for (const object of [...this.trafficLayer.children])
      this.disposeDetached(object);
    this.trafficLayer.clear();
    this.pickingDirty = true;
    this.buildingInstances.clear();
    this.railInstances.clear();
    this.podInstances.clear();
    this.hookupInstances.clear();
    for (const layer of [
      this.terrainLayer,
      this.oreLayer,
      this.railLayer,
      this.buildingLayer,
      this.podLayer,
      this.overlayLayer,
      this.hookupLayer,
    ]) {
      for (const child of [...layer.children]) this.disposeDetached(child);
      layer.clear();
    }
    this.entityDraws.clear();
    this.railDraws.clear();
    this.junctionDraws.clear();
    this.junctionSignature = '';
    this.hookupDraws.clear();
    this.hookupSignature = '';
    this.podDraws.clear();
    this.oreDraws.clear();
    this.animatedFans.clear();
    this.animatedDrillHeads.clear();
    this.extractingDrills.clear();
    this.runningEntities.clear();
    this.pickTargets.length = 0;
    this.oreArray = undefined;
    this.terrainSignature = '';
  }

  private buildTerrain(snapshot: WorldSnapshot) {
    const { width, height, terrain } = snapshot.grid;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.7, height),
      this.materials.groundEdge,
    );
    slab.position.set(width / 2, -0.38, height / 2);
    slab.receiveShadow = true;
    slab.userData.terrain = true;
    this.terrainLayer.add(slab);

    for (let cy = 0; cy < Math.ceil(height / CHUNK_SIZE); cy += 1) {
      for (let cx = 0; cx < Math.ceil(width / CHUNK_SIZE); cx += 1) {
        const x0 = cx * CHUNK_SIZE;
        const z0 = cy * CHUNK_SIZE;
        const chunkWidth = Math.min(CHUNK_SIZE, width - x0);
        const chunkDepth = Math.min(CHUNK_SIZE, height - z0);
        const group = new THREE.Group();
        group.position.set(x0 + chunkWidth / 2, 0, z0 + chunkDepth / 2);
        const base = new THREE.Mesh(
          new THREE.PlaneGeometry(chunkWidth, chunkDepth),
          this.materials.ground,
        );
        base.rotation.x = -Math.PI / 2;
        base.position.y = -0.012;
        base.receiveShadow = true;
        group.add(base);

        const obstacles: THREE.Matrix4[] = [];
        const plants: THREE.Matrix4[] = [];
        for (let y = z0; y < z0 + chunkDepth; y += 1)
          for (let x = x0; x < x0 + chunkWidth; x += 1) {
            if (terrain[y * width + x] === TerrainKind.OBSTACLE) {
              const h = hashCell(x, y);
              const scale = 0.55 + ((h >>> 8) % 35) / 100;
              const rock = new THREE.Matrix4().compose(
                new THREE.Vector3(
                  x - x0 - chunkWidth / 2 + 0.5,
                  this.assetsReady ? 0 : 0.24 * scale,
                  y - z0 - chunkDepth / 2 + 0.5,
                ),
                new THREE.Quaternion().setFromEuler(
                  new THREE.Euler(0, (h % 6) * 0.42, ((h >>> 5) % 3) * 0.06),
                ),
                new THREE.Vector3(
                  scale,
                  scale * (0.75 + (h % 19) / 100),
                  scale,
                ),
              );
              obstacles.push(rock);
            } else if (
              hashCell(x, y) % 173 === 0 &&
              snapshot.grid.occupancy[y * width + x] === 0 &&
              snapshot.grid.oreKinds[y * width + x] === OreKind.NONE
            ) {
              const h = hashCell(y, x);
              plants.push(
                new THREE.Matrix4().compose(
                  new THREE.Vector3(
                    x - x0 - chunkWidth / 2 + 0.5,
                    this.assetsReady ? 0 : 0.24,
                    y - z0 - chunkDepth / 2 + 0.5,
                  ),
                  new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(0, h % 7, 0),
                  ),
                  new THREE.Vector3(0.28, 0.42 + (h % 20) / 100, 0.28),
                ),
              );
            }
          }
        if (obstacles.length > 0) {
          const rocks = new THREE.InstancedMesh(
            (
              this.assets.models
                .get('terrain-rock:0')
                ?.getObjectByName('body') as THREE.Mesh | undefined
            )?.geometry ?? this.geometry.rock,
            (
              this.assets.models
                .get('terrain-rock:0')
                ?.getObjectByName('body') as THREE.Mesh | undefined
            )?.material ?? this.materials.rock,
            obstacles.length,
          );
          obstacles.forEach((matrix, index) =>
            rocks.setMatrixAt(index, matrix),
          );
          rocks.castShadow = true;
          rocks.receiveShadow = true;
          rocks.instanceMatrix.needsUpdate = true;
          rocks.computeBoundingSphere();
          group.add(rocks);
        }
        if (plants.length > 0) {
          const foliage = new THREE.InstancedMesh(
            (
              this.assets.models
                .get('terrain-tree:0')
                ?.getObjectByName('body') as THREE.Mesh | undefined
            )?.geometry ?? this.geometry.unitBox,
            (
              this.assets.models
                .get('terrain-tree:0')
                ?.getObjectByName('body') as THREE.Mesh | undefined
            )?.material ?? this.materials.equipment,
            plants.length,
          );
          plants.forEach((matrix, index) => foliage.setMatrixAt(index, matrix));
          foliage.castShadow = true;
          foliage.instanceMatrix.needsUpdate = true;
          foliage.computeBoundingSphere();
          group.add(foliage);
        }
        this.terrainLayer.add(group);
      }
    }
    this.terrainSignature = `${snapshot.worldId}:${width}:${height}`;
    this.oreArray = snapshot.grid.oreRemaining;
    this.rebuildGridLines();
  }

  private rebuildGridLines() {
    if (this.gridLines !== undefined) {
      this.terrainLayer.remove(this.gridLines);
      this.disposeDetached(this.gridLines);
    }
    const { width, height } = this.snapshot.grid;
    const positions: number[] = [];
    for (let cy = 0; cy < height; cy += CHUNK_SIZE)
      for (let cx = 0; cx < width; cx += CHUNK_SIZE) {
        for (let x = cx; x <= Math.min(width, cx + CHUNK_SIZE); x++)
          positions.push(
            x,
            0.025,
            cy,
            x,
            0.025,
            Math.min(height, cy + CHUNK_SIZE),
          );
        for (let z = cy; z <= Math.min(height, cy + CHUNK_SIZE); z++)
          positions.push(
            cx,
            0.025,
            z,
            Math.min(width, cx + CHUNK_SIZE),
            0.025,
            z,
          );
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.gridLines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: '#50664f',
        transparent: true,
        opacity: 0.24,
      }),
    );
    this.gridLines.visible = this.showGrid;
    this.terrainLayer.add(this.gridLines);
  }

  private rebuildOre(snapshot: WorldSnapshot) {
    for (const child of [...this.oreLayer.children])
      this.disposeDetached(child);
    this.oreLayer.clear();
    this.oreDraws.clear();
    const { width, oreKinds, oreRemaining } = snapshot.grid;
    const clusters = new Map<string, { kind: number; indices: number[] }>();
    for (let index = 0; index < oreKinds.length; index += 1) {
      const kind = oreKinds[index];
      if (
        kind === undefined ||
        kind === OreKind.NONE ||
        oreRemaining[index] === undefined ||
        oreRemaining[index] === 0
      )
        continue;
      const x = index % width;
      const y = Math.floor(index / width);
      const key = `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(y / CHUNK_SIZE)}:${kind}`;
      const chunk = clusters.get(key) ?? { kind, indices: [] };
      chunk.indices.push(index);
      clusters.set(key, chunk);
    }
    for (const { kind, indices } of clusters.values()) {
      const mesh = new THREE.InstancedMesh(
        (
          this.assets.models
            .get(kind === OreKind.IRON ? 'ore-iron:0' : 'ore-copper:0')
            ?.getObjectByName('body') as THREE.Mesh | undefined
        )?.geometry ?? this.geometry.oreCluster,
        (
          this.assets.models
            .get(kind === OreKind.IRON ? 'ore-iron:0' : 'ore-copper:0')
            ?.getObjectByName('body') as THREE.Mesh | undefined
        )?.material ??
          (kind === OreKind.IRON ? this.materials.iron : this.materials.copper),
        indices.length,
      );
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      indices.forEach((index, slot) => {
        const x = (index % width) + 0.5;
        const z = Math.floor(index / width) + 0.5;
        const h = hashCell(index, kind);
        const baseScale = 0.7 + ((h >>> 8) % 28) / 100;
        const rotation = (h % 8) * 0.3;
        const initialRemaining = oreRemaining[index] ?? 1;
        mesh.setMatrixAt(
          slot,
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, 0.15, z),
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(0, rotation, 0),
            ),
            new THREE.Vector3(baseScale, baseScale, baseScale),
          ),
        );
        this.oreDraws.set(index, {
          mesh,
          slot,
          initialRemaining,
          baseScale,
          rotation,
        });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.oreLayer.add(mesh);
    }
    this.oreArray = oreRemaining;
  }

  private applyOreChanges(snapshot: WorldSnapshot) {
    if (this.oreArray === snapshot.grid.oreRemaining) return;
    const { width } = snapshot.grid;
    if (snapshot.presentationOreChanges.length === 0) {
      this.rebuildOre(snapshot);
      return;
    }
    for (const change of snapshot.presentationOreChanges) {
      const index = change.index;
      const remaining = change.remaining;
      const existing = this.oreDraws.get(index);
      if (existing !== undefined) {
        const ratio =
          remaining === 0
            ? 0
            : Math.max(0.12, Math.sqrt(remaining / existing.initialRemaining));
        const scale = existing.baseScale * ratio;
        const x = (index % width) + 0.5;
        const z = Math.floor(index / width) + 0.5;
        existing.mesh.setMatrixAt(
          existing.slot,
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, 0.15 * ratio, z),
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(0, existing.rotation, 0),
            ),
            new THREE.Vector3(scale, scale, scale),
          ),
        );
        existing.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const mesh of new Set(
      [...this.oreDraws.values()].map((ore) => ore.mesh),
    ))
      mesh.computeBoundingSphere();
    this.oreArray = snapshot.grid.oreRemaining;
  }

  private addBox(
    group: THREE.Group,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    cast = true,
  ) {
    const mesh = new THREE.Mesh(this.geometry.unitBox, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  private createAuthoredBuilding(
    entity: WorldEntity,
    ghost: boolean,
    valid: boolean,
  ) {
    if (entity.kind === 'construction-site') return undefined;
    const { width, height: depth } = entity.transform.size;
    const lod = ghost ? 0 : (this.entityLods.get(entity.id) ?? 0);
    let model = this.assets.create(entity.kind, lod);
    if (!model) return undefined;
    if (entity.kind === 'factory' && (width !== 4 || depth !== 4)) {
      model = new THREE.Group();
      this.addBox(
        model,
        this.materials.foundation,
        0,
        0.12,
        0,
        width * 0.96,
        0.24,
        depth * 0.96,
      );
      this.addBox(
        model,
        this.materials.structure,
        0,
        0.9,
        0,
        width * 0.86,
        1.5,
        depth * 0.86,
      );
      this.addBox(
        model,
        this.materials.equipment,
        0,
        1.73,
        0,
        width * 0.94,
        0.16,
        depth * 0.94,
      );
      for (const [length, alongX] of [
        [width, true],
        [depth, false],
      ] as const) {
        const count =
          lod === 2
            ? 0
            : Math.max(
                1,
                Math.min(32, Math.ceil(length / (lod === 0 ? 2 : 6))),
              );
        for (let i = 0; i < count; i += 1)
          for (const side of [-1, 1]) {
            const bay = this.assets.create('factory-wall-bay', lod)!;
            const offset = ((i + 0.5) * length) / count - length / 2;
            bay.position.set(
              alongX ? offset : side * Math.min(width * 0.44, width / 2 - 0.12),
              0.25,
              alongX ? side * Math.min(depth * 0.44, depth / 2 - 0.12) : offset,
            );
            bay.rotation.y = alongX
              ? side > 0
                ? 0
                : Math.PI
              : (side * Math.PI) / 2;
            bay.scale.x = Math.min(1, (length / count) * 0.94);
            bay.traverse((object) => {
              if (object instanceof THREE.Mesh) object.castShadow = false;
            });
            model.add(bay);
          }
      }
      if (lod < 2 && width >= 1 && depth >= 1) {
        for (const x of [-1, 1])
          for (const z of [-1, 1]) {
            const corner = this.assets.create('factory-corner', lod)!;
            corner.position.set(
              x * (width * 0.43 - 0.1),
              0.25,
              z * (depth * 0.43 - 0.1),
            );
            corner.traverse((object) => {
              if (object instanceof THREE.Mesh) object.castShadow = false;
            });
            model.add(corner);
          }
      }
      if (lod === 0 && width >= 4 && depth >= 3) {
        const count = Math.min(8, Math.max(1, Math.floor(width / 5)));
        for (let i = 0; i < count; i++) {
          const bay = this.assets.create('factory-roof-bay', 0)!;
          bay.position.set(
            ((i + 0.5) * width) / count - width / 2,
            1.82,
            -depth * 0.15,
          );
          model.add(bay);
        }
      }
      // Fixed-size loading face and fan: never stretch mechanical details with the shell.
      this.addBox(
        model,
        this.materials.dark,
        0,
        0.78,
        depth * 0.45,
        Math.min(0.7, width * 0.6),
        1.2,
        0.035,
      );
      const socket = new THREE.Object3D();
      socket.name = 'socket_loading';
      socket.position.set(0, 0.35, depth * 0.45);
      model.add(socket);
      if (width >= 2 && depth >= 2 && lod === 0) {
        const fan = this.assets.create('factory')!.getObjectByName('fan')!;
        fan.position.set(0, 1.95, 0);
        model.add(fan);
      }
    }
    const root = new THREE.Group();
    root.position.set(...footprintCentre(entity.transform));
    root.rotation.y = quarterTurnRadians(entity.transform.rotation);
    root.add(model);
    const fan = model.getObjectByName('fan');
    if (fan) {
      fan.traverse((object) => {
        object.userData.dynamic = true;
      });
      root.userData.fan = fan;
    }
    const head = model.getObjectByName('drill_head');
    if (head) {
      head.userData.drillHead = true;
      head.traverse((object) => {
        object.userData.dynamic = true;
      });
    }
    if (entity.kind === 'drill' && entity.state === 'GHOST' && !ghost)
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.material = this.materials.drillGhost;
          object.castShadow = false;
        }
      });
    if (entity.kind === 'factory' && entity.state === 'DISMANTLING') {
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          this.addBox(
            model,
            this.materials.warning,
            x * width * 0.46,
            1.15,
            z * depth * 0.46,
            0.1,
            2.3,
            0.1,
            false,
          );
      for (const z of [-1, 1])
        this.addBox(
          model,
          this.materials.error,
          0,
          2.25,
          z * depth * 0.46,
          width * 0.94,
          0.1,
          0.1,
          false,
        );
    }
    if (ghost) {
      const material = this.ghost?.pending
        ? this.materials.ghostPending
        : valid
          ? this.materials.ghostValid
          : this.materials.ghostInvalid;
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.material = material;
          object.castShadow = false;
        }
      });
    } else {
      const bounds = new THREE.Box3().setFromObject(model);
      const height = Math.max(0.4, bounds.max.y);
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshBasicMaterial(),
      );
      proxy.position.y = height / 2;
      proxy.layers.set(2);
      proxy.userData.worldPick = {
        kind: 'entity',
        id: entity.id,
      } satisfies PickInfo;
      root.add(proxy);
      this.pickTargets.push(proxy);
    }
    return root;
  }

  private createBuildingModel(
    entity: WorldEntity,
    ghost = false,
    ghostValid = true,
  ) {
    const authored = this.assetsReady
      ? this.createAuthoredBuilding(entity, ghost, ghostValid)
      : undefined;
    if (authored) return authored;
    const root = new THREE.Group();
    root.position.set(...footprintCentre(entity.transform));
    root.rotation.y = quarterTurnRadians(entity.transform.rotation);
    const width = entity.transform.size.width;
    const depth = entity.transform.size.height;
    const height =
      entity.kind === 'drill' ? 2.1 : entity.kind === 'station' ? 1.9 : 3.2;
    const cx = 0;
    const cz = 0;
    const tint = ghost
      ? this.ghost?.pending
        ? this.materials.ghostPending
        : ghostValid
          ? this.materials.ghostValid
          : this.materials.ghostInvalid
      : undefined;
    const color = (normal: THREE.Material) => tint ?? normal;
    let fan: THREE.Object3D | undefined;

    this.addBox(
      root,
      color(this.materials.foundation),
      cx,
      0.16,
      cz,
      width * 0.96,
      0.32,
      depth * 0.96,
    );
    if (entity.kind === 'factory') {
      this.addBox(
        root,
        color(this.materials.structure),
        0,
        1.18,
        0,
        width * 0.84,
        1.8,
        depth * 0.84,
      );
      this.addBox(
        root,
        color(this.materials.equipment),
        0,
        2.17,
        0,
        width * 0.9,
        0.3,
        depth * 0.88,
      );
      this.addBox(
        root,
        color(this.materials.structure),
        0,
        2.45,
        0,
        width * 0.78,
        0.28,
        depth * 0.74,
      );
      const bayCount = Math.max(1, Math.min(64, Math.floor(width / 0.85)));
      for (let index = 0; index < bayCount; index += 1) {
        const offset =
          (index - (bayCount - 1) / 2) * Math.min(0.85, width / bayCount);
        this.addBox(
          root,
          color(this.materials.glass),
          offset,
          1.3,
          -depth * 0.425,
          Math.min(0.45, width / bayCount),
          0.62,
          0.045,
        );
      }
      this.addBox(
        root,
        color(this.materials.foundation),
        0,
        0.76,
        depth * 0.425,
        Math.min(1.4, width * 0.55),
        1.05,
        0.09,
      );
      const turbine = new THREE.Group();
      turbine.position.set(width * 0.23, 2.64, -depth * 0.18);
      const hub = new THREE.Mesh(
        this.geometry.smallRound,
        color(this.materials.foundation),
      );
      hub.rotation.x = Math.PI / 2;
      hub.scale.set(0.28, 0.1, 0.28);
      turbine.add(hub);
      for (let blade = 0; blade < 4; blade += 1) {
        const vane = this.addBox(
          turbine,
          color(this.materials.service),
          0,
          0.36,
          0,
          0.12,
          0.65,
          0.09,
          false,
        );
        vane.rotation.z = (blade * Math.PI) / 2;
      }
      root.add(turbine);
      fan = turbine;
      for (let side = -1; side <= 1; side += 2) {
        this.addBox(
          root,
          color(this.materials.dark),
          side * width * 0.32,
          2.76,
          depth * 0.18,
          0.16,
          0.12,
          0.95,
        );
        this.addBox(
          root,
          color(this.materials.dark),
          side * width * 0.32,
          2.76,
          depth * 0.18,
          0.95,
          0.12,
          0.16,
        );
      }
    } else if (entity.kind === 'mine') {
      this.addBox(
        root,
        color(this.materials.structure),
        0,
        0.9,
        0,
        width * 0.75,
        1.3,
        depth * 0.76,
      );
      this.addBox(
        root,
        color(this.materials.extraction),
        0,
        1.73,
        0,
        width * 0.85,
        0.32,
        depth * 0.82,
      );
      const tower = this.addBox(
        root,
        color(this.materials.extraction),
        -width * 0.18,
        2.4,
        -depth * 0.18,
        0.36,
        1.2,
        0.36,
      );
      this.addBox(
        root,
        color(this.materials.dark),
        -width * 0.18,
        3.0,
        -depth * 0.18,
        0.9,
        0.18,
        0.4,
      );
      this.addBox(
        root,
        color(this.materials.service),
        width * 0.24,
        2.25,
        depth * 0.18,
        0.55,
        0.55,
        0.55,
      );
      tower.castShadow = true;
    } else if (entity.kind === 'drill') {
      const drillMaterial =
        entity.state === 'EXHAUSTED'
          ? color(this.materials.dark)
          : color(this.materials.extraction);
      this.addBox(root, drillMaterial, 0, 0.24, 0, 0.88, 0.48, 0.88);
      for (const x of [-0.33, 0.33])
        this.addBox(root, drillMaterial, x, 1.12, 0, 0.1, 1.45, 0.12);
      this.addBox(
        root,
        color(this.materials.service),
        0,
        1.85,
        0,
        0.72,
        0.22,
        0.52,
      );
      const head = this.addBox(root, drillMaterial, 0, 1.55, 0, 0.4, 0.6, 0.48);
      head.userData.drillHead = true;
      this.addBox(
        root,
        color(this.materials.foundation),
        0,
        0.55,
        0,
        0.12,
        0.65,
        0.12,
      );
    } else if (entity.kind === 'station') {
      this.addBox(
        root,
        color(this.materials.foundation),
        0,
        0.34,
        0,
        width * 0.94,
        0.5,
        depth * 0.94,
      );
      this.addBox(
        root,
        color(this.materials.structure),
        0,
        0.67,
        0,
        width * 0.88,
        0.24,
        depth * 0.86,
      );
      for (const x of [-width * 0.34, width * 0.34])
        this.addBox(
          root,
          color(this.materials.equipment),
          x,
          1.22,
          0,
          0.13,
          1.15,
          depth * 0.7,
        );
      this.addBox(
        root,
        color(this.materials.service),
        0,
        1.86,
        0,
        width * 0.9,
        0.17,
        depth * 0.82,
      );
      this.addBox(
        root,
        color(this.materials.dark),
        0,
        1.55,
        depth * 0.4,
        0.32,
        0.45,
        0.12,
      );
    } else if (entity.kind === 'storage') {
      this.addBox(
        root,
        color(this.materials.structure),
        0,
        0.97,
        0,
        width * 0.82,
        1.55,
        depth * 0.78,
      );
      this.addBox(
        root,
        color(this.materials.equipment),
        0,
        1.87,
        0,
        width * 0.9,
        0.24,
        depth * 0.86,
      );
      this.addBox(
        root,
        color(this.materials.dark),
        0,
        0.9,
        depth * 0.4,
        width * 0.32,
        1.1,
        0.1,
      );
      for (let ix = -1; ix <= 1; ix += 1)
        for (let iz = -1; iz <= 1; iz += 1)
          this.addBox(
            root,
            color(
              (ix + iz) % 2 === 0
                ? this.materials.service
                : this.materials.foundation,
            ),
            ix * 0.58,
            0.55,
            iz * 0.55,
            0.38,
            0.52,
            0.38,
          );
    } else if (entity.kind === 'depot') {
      this.addBox(
        root,
        color(this.materials.structure),
        0,
        0.95,
        0,
        width * 0.8,
        1.5,
        depth * 0.76,
      );
      this.addBox(
        root,
        color(this.materials.service),
        0,
        1.82,
        0,
        width * 0.9,
        0.3,
        depth * 0.86,
      );
      for (let bay = -1; bay <= 1; bay += 1) {
        const door = this.addBox(
          root,
          color(this.materials.foundation),
          bay * 0.7,
          0.72,
          depth * 0.39,
          0.5,
          1.15,
          0.07,
        );
        door.userData.podBay = true;
      }
      this.addBox(
        root,
        color(this.materials.dark),
        0,
        2.15,
        -depth * 0.15,
        0.4,
        0.3,
        0.4,
      );
    } else {
      const kit = this.assetsReady
        ? this.assets.create(
            'construction',
            this.entityLods.get(entity.id) ?? 0,
          )
        : undefined;
      if (kit && width === 4 && depth === 4) root.add(kit);
      else {
        this.addBox(
          root,
          color(this.materials.foundation),
          0,
          0.08,
          0,
          width * 0.98,
          0.16,
          depth * 0.98,
        );
        if (kit) {
          const scale = Math.min(1, width / 4, depth / 4);
          kit.scale.setScalar(scale);
          kit.position.y = 0.16;
          root.add(kit);
        }
      }
      const delivered = new Map(
        entity.delivered.map((item) => [item.resourceId, item.quantity]),
      );
      const total = entity.required.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      const materialProgress =
        total === 0
          ? 0
          : entity.required.reduce(
              (sum, item) =>
                sum +
                Math.min(delivered.get(item.resourceId) ?? 0, item.quantity),
              0,
            ) / total;
      const moduleCount = Math.max(
        1,
        Math.min(12, Math.ceil(width * depth * materialProgress)),
      );
      const maxModules = Math.max(1, Math.floor(width * depth));
      for (let i = 0; i < moduleCount; i += 1) {
        const x = ((i % Math.ceil(width)) - (Math.ceil(width) - 1) / 2) * 0.85;
        const z =
          (Math.floor(i / Math.ceil(width)) - (Math.floor(depth) - 1) / 2) *
          0.85;
        this.addBox(
          root,
          color(this.materials.scaffold),
          x,
          0.9,
          z,
          0.45,
          1.3,
          0.45,
        );
      }
      const targetShape = Math.max(
        1,
        Math.min(maxModules, Math.ceil(width * depth)),
      );
      if (moduleCount < targetShape) {
        const frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(
            new THREE.BoxGeometry(width * 0.8, height, depth * 0.8),
          ),
          new THREE.LineBasicMaterial({
            color: entity.state === 'EVACUATING' ? '#dc7468' : '#d9b45f',
          }),
        );
        frame.position.y = height / 2;
        root.add(frame);
      }
    }

    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(0.1, width - 0.04),
        height,
        Math.max(0.1, depth - 0.04),
      ),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        colorWrite: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    proxy.layers.set(2);
    proxy.position.y = height / 2;
    proxy.userData.worldPick = {
      kind: 'entity',
      id: entity.id,
    } satisfies PickInfo;
    root.add(proxy);
    if (!ghost) this.pickTargets.push(proxy);
    root.userData.entityId = entity.id;
    root.userData.fan = fan;
    if (fan)
      fan.traverse((object) => {
        object.userData.dynamic = true;
      });
    root.traverse((object) => {
      if (object.userData.drillHead) object.userData.dynamic = true;
      if (ghost && object instanceof THREE.Mesh) object.castShadow = false;
    });
    return root;
  }

  private reconcileEntities(snapshot: WorldSnapshot) {
    let changed = false;
    const alive = new Set(snapshot.entities.map((entity) => entity.id));
    for (const [id, drawn] of this.entityDraws)
      if (!alive.has(id)) {
        changed = true;
        this.removePickTargets(drawn.group);
        this.disposeDetached(drawn.group);
        this.buildingLayer.remove(drawn.group);
        this.entityDraws.delete(id);
        this.animatedFans.delete(id);
        this.animatedDrillHeads.delete(id);
        this.runningEntities.delete(id);
      }
    for (const entity of snapshot.entities) {
      const nextSignature = signature([
        entity.kind,
        this.entityLods.get(entity.id) ?? 0,
        entity.transform,
        'state' in entity ? entity.state : null,
        entity.kind === 'construction-site'
          ? [entity.delivered, entity.required]
          : null,
      ]);
      const previous = this.entityDraws.get(entity.id);
      if (previous?.signature === nextSignature) continue;
      changed = true;
      if (previous !== undefined) {
        this.removePickTargets(previous.group);
        this.disposeDetached(previous.group);
        this.buildingLayer.remove(previous.group);
      }
      this.animatedFans.delete(entity.id);
      this.animatedDrillHeads.delete(entity.id);
      const group = this.createBuildingModel(entity);
      this.buildingLayer.add(group);
      this.entityDraws.set(entity.id, { group, signature: nextSignature });
      const fan = group.userData.fan as THREE.Object3D | undefined;
      if (fan !== undefined) this.animatedFans.set(entity.id, fan);
      let drillHead: THREE.Object3D | undefined;
      group.traverse((object) => {
        if (object.userData.drillHead === true) drillHead = object;
      });
      if (drillHead !== undefined)
        this.animatedDrillHeads.set(entity.id, drillHead);
    }
    if (changed) this.pickingDirty = true;
    if (changed)
      this.buildingInstances.rebuild(
        [...this.entityDraws].map(([id, drawn]) => ({
          id,
          group: drawn.group,
          chunk: `${Math.floor(drawn.group.position.x / 32)}:${Math.floor(drawn.group.position.z / 32)}`,
        })),
      );
  }

  private createHookupPart(
    id: 'hookup-marker' | 'hookup-crane',
    lod: number,
  ): THREE.Group {
    const model = this.assets.create(id, id === 'hookup-marker' ? 0 : lod);
    if (model) return model;
    const fallback = new THREE.Group();
    if (id === 'hookup-marker') {
      this.addBox(
        fallback,
        this.materials.foundation,
        0,
        0.02,
        0,
        0.98,
        0.04,
        0.98,
      );
      this.addBox(
        fallback,
        this.materials.service,
        0,
        0.05,
        0,
        0.86,
        0.03,
        0.86,
      );
    } else {
      this.addBox(
        fallback,
        this.materials.foundation,
        0,
        0.05,
        -0.42,
        0.7,
        0.1,
        0.16,
      );
      this.addBox(
        fallback,
        this.materials.equipment,
        0,
        1.15,
        -0.42,
        0.16,
        2.3,
        0.16,
      );
      this.addBox(
        fallback,
        this.materials.equipment,
        0,
        2.24,
        0,
        0.14,
        0.14,
        1,
      );
      this.addBox(
        fallback,
        this.materials.service,
        0.19,
        1.5,
        0,
        0.38,
        0.12,
        0.7,
      );
      this.addBox(
        fallback,
        this.materials.service,
        0,
        1.24,
        0,
        0.1,
        0.5,
        0.1,
        false,
      );
    }
    return fallback;
  }

  private reconcileHookups(snapshot: WorldSnapshot) {
    const nodes = new Map(snapshot.railNodes.map((node) => [node.id, node]));
    const hookups = new Map<
      string,
      { node: WorldRailNode; anchor: WorldEntity; crane: boolean }
    >();
    for (const entity of snapshot.entities) {
      if (entity.kind !== 'station' && entity.kind !== 'depot') continue;
      const node = nodes.get(entity.railNodeId);
      if (node === undefined) continue;
      const cell = hookupCell(entity.transform);
      const derived = node.position.x === cell.x && node.position.y === cell.y;
      const entry = hookups.get(node.id);
      if (entry === undefined) {
        hookups.set(node.id, { node, anchor: entity, crane: derived });
      } else if (derived && !entry.crane) {
        // Legacy saves can share one node; the crane faces its own building.
        entry.anchor = entity;
        entry.crane = true;
      }
    }
    const nextSignature = signature([
      ...hookups,
      [...this.entityLods],
      this.assetsReady,
    ]);
    if (nextSignature === this.hookupSignature) return;
    this.hookupSignature = nextSignature;
    for (const group of this.hookupDraws.values()) {
      this.disposeDetached(group);
      group.removeFromParent();
    }
    this.hookupDraws.clear();
    for (const [nodeId, { node, anchor, crane }] of hookups) {
      const lod = this.entityLods.get(anchor.id) ?? 0;
      const group = new THREE.Group();
      group.position.set(...gridToWorld(node.position));
      group.rotation.y = quarterTurnRadians(anchor.transform.rotation);
      group.add(this.createHookupPart('hookup-marker', lod));
      if (crane) group.add(this.createHookupPart('hookup-crane', lod));
      this.hookupLayer.add(group);
      this.hookupDraws.set(nodeId, group);
    }
    this.renderer.domElement.dataset.hookupDraws = JSON.stringify(
      [...hookups].map(([id, { node, anchor, crane }]) => ({
        nodeId: id,
        kind: anchor.kind,
        x: node.position.x,
        y: node.position.y,
        crane,
      })),
    );
    this.hookupInstances.rebuild(
      [...this.hookupDraws].map(([id, group]) => ({
        id,
        group,
        chunk: `${Math.floor(group.position.x / 32)}:${Math.floor(group.position.z / 32)}`,
      })),
    );
  }

  private createRailModel(
    edge: WorldSnapshot['railEdges'][number],
    snapshot: WorldSnapshot,
    corners: ReturnType<typeof railCorners>,
  ) {
    const group = new THREE.Group();
    const degrees = railNodeDegrees(snapshot.railEdges);
    const nodeMap = new Map(snapshot.railNodes.map((node) => [node.id, node]));
    const connected =
      railEdgeConnectionState(edge, nodeMap, degrees) === 'connected';
    const topMaterial = connected
      ? this.materials.railTop
      : this.materials.warning;
    for (let index = 1; index < edge.points.length; index += 1) {
      const a = edge.points[index - 1]!;
      const b = edge.points[index]!;
      const dx = b.x - a.x;
      const dz = b.y - a.y;
      const length = Math.abs(dx) + Math.abs(dz);
      if (length === 0) continue;
      const horizontal = dz === 0;
      const midX = (a.x + b.x) / 2;
      const midZ = (a.y + b.y) / 2;
      if (this.assetsReady) {
        const start = corners.has(a.x + ':' + a.y) ? 0.5 : 0;
        const end = length - (corners.has(b.x + ':' + b.y) ? 0.5 : 0);
        for (let step = start; step < end; step += 1) {
          const span = Math.min(1, end - step);
          const part = this.assets.create('rail-straight', 0)!;
          part.scale.z = span;
          part.position.set(
            a.x + (dx / length) * (step + span / 2),
            0,
            a.y + (dz / length) * (step + span / 2),
          );
          part.rotation.y = horizontal ? Math.PI / 2 : 0;
          part.traverse((object) => {
            if (object instanceof THREE.Mesh) object.castShadow = false;
          });
          group.add(part);
        }
      } else {
        const sleeper = this.addBox(
          group,
          this.materials.rail,
          midX,
          0.06,
          midZ,
          horizontal ? length : 0.23,
          0.12,
          horizontal ? 0.23 : length,
        );
        sleeper.castShadow = false;
        for (const side of [-0.22, 0.22]) {
          const rail = this.addBox(
            group,
            topMaterial,
            midX + (horizontal ? 0 : side),
            0.17,
            midZ + (horizontal ? side : 0),
            horizontal ? length : 0.075,
            0.1,
            horizontal ? 0.075 : length,
          );
          rail.castShadow = false;
        }
        const sleepers = Math.max(1, Math.floor(length * 1.5));
        for (
          let sleeperIndex = 0;
          sleeperIndex <= sleepers;
          sleeperIndex += 1
        ) {
          const ratio = sleeperIndex / sleepers;
          const x = a.x + dx * ratio;
          const z = a.y + dz * ratio;
          this.addBox(
            group,
            this.materials.foundation,
            x,
            0.13,
            z,
            horizontal ? 0.16 : 0.58,
            0.09,
            horizontal ? 0.58 : 0.16,
            false,
          );
        }
      }
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(
          horizontal ? length : 0.32,
          0.24,
          horizontal ? 0.32 : length,
        ),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          colorWrite: false,
          depthWrite: false,
        }),
      );
      proxy.layers.set(2);
      proxy.position.set(midX, 0.14, midZ);
      proxy.userData.worldPick = {
        kind: 'rail',
        id: edge.id,
      } satisfies PickInfo;
      group.add(proxy);
      this.pickTargets.push(proxy);
    }
    const end = edge.points.at(-1);
    const previous = edge.points.at(-2);
    if (end !== undefined && previous !== undefined) {
      const angle = Math.atan2(end.x - previous.x, end.y - previous.y);
      const arrow = this.assets.create(
        connected ? 'rail-arrow' : 'rail-endpoint',
        1,
      );
      if (arrow) {
        arrow.position.set(end.x, 0.2, end.y);
        arrow.rotation.y = angle;
        group.add(arrow);
      }
    }
    group.position.set(0.5, 0, 0.5);
    group.userData.edgeId = edge.id;
    return group;
  }

  private reconcileRails(snapshot: WorldSnapshot) {
    this.pickingDirty = true;
    let changed = false;
    const degrees = railNodeDegrees(snapshot.railEdges);
    const corners = railCorners(snapshot.railEdges);
    const nodesSignature = signature([
      snapshot.railNodes.map((node) => [node, degrees.get(node.id) ?? 0]),
      [...corners],
      this.assetsReady,
    ]);
    if (nodesSignature !== this.junctionSignature) {
      this.junctionSignature = nodesSignature;
      changed = true;
      for (const group of this.junctionDraws.values()) {
        this.disposeDetached(group);
        group.removeFromParent();
      }
      this.junctionDraws.clear();
      for (const [key, { point, angle }] of corners) {
        const corner = this.assets.create('rail-corner', 0);
        if (!corner) continue;
        corner.position.set(point.x + 0.5, 0, point.y + 0.5);
        corner.rotation.y = angle;
        corner.traverse((object) => {
          if (object instanceof THREE.Mesh) object.castShadow = false;
        });
        this.railLayer.add(corner);
        this.junctionDraws.set('corner:' + key, corner);
      }
      for (const node of snapshot.railNodes) {
        if (
          node.kind !== 'junction' &&
          !(node.kind === 'endpoint' && (degrees.get(node.id) ?? 0) >= 3)
        )
          continue;
        const group =
          this.assets.create('rail-junction', 0) ?? new THREE.Group();
        if (!group.children.length)
          this.addBox(
            group,
            this.materials.service,
            0,
            0.12,
            0,
            0.65,
            0.24,
            0.65,
            false,
          );
        group.position.set(node.position.x + 0.5, 0, node.position.y + 0.5);
        this.railLayer.add(group);
        this.junctionDraws.set(node.id, group);
      }
    }
    const alive = new Set(snapshot.railEdges.map((edge) => edge.id));
    for (const [id, drawn] of this.railDraws)
      if (!alive.has(id)) {
        changed = true;
        this.removePickTargets(drawn.group);
        this.disposeDetached(drawn.group);
        this.railLayer.remove(drawn.group);
        this.railDraws.delete(id);
      }
    const nodeMap = new Map(snapshot.railNodes.map((node) => [node.id, node]));
    for (const edge of snapshot.railEdges) {
      const nextSignature = signature([
        edge,
        edge.points.map((p) => corners.has(p.x + ':' + p.y)),
        railEdgeConnectionState(edge, nodeMap, degrees),
      ]);
      const previous = this.railDraws.get(edge.id);
      if (previous?.signature === nextSignature) continue;
      changed = true;
      if (previous !== undefined) {
        this.removePickTargets(previous.group);
        this.disposeDetached(previous.group);
        this.railLayer.remove(previous.group);
      }
      const group = this.createRailModel(edge, snapshot, corners);
      this.railLayer.add(group);
      this.railDraws.set(edge.id, { group, signature: nextSignature });
    }
    if (changed) {
      const entries = [...this.railDraws].map(([id, drawn]) => {
        const point = snapshot.railEdges.find((edge) => edge.id === id)
          ?.points[0];
        return {
          id: String(id),
          group: drawn.group,
          chunk:
            Math.floor((point?.x ?? 0) / 32) +
            ':' +
            Math.floor((point?.y ?? 0) / 32),
        };
      });
      entries.push(
        ...[...this.junctionDraws].map(([id, group]) => ({
          id,
          group,
          chunk:
            Math.floor(group.position.x / 32) +
            ':' +
            Math.floor(group.position.z / 32),
        })),
      );
      this.railInstances.rebuild(entries);
    }
  }

  private reconcilePods(snapshot: WorldSnapshot) {
    let changed = false;
    if (snapshot.pods.length !== this.podDraws.size) this.pickingDirty = true;
    const alive = new Set(snapshot.pods.map((pod) => pod.id));
    for (const [id, group] of this.podDraws)
      if (!alive.has(id)) {
        changed = true;
        this.removePickTargets(group);
        this.disposeDetached(group);
        this.podLayer.remove(group);
        this.podDraws.delete(id);
      }
    for (const pod of snapshot.pods) {
      if (this.podDraws.has(pod.id)) continue;
      changed = true;
      const group = new THREE.Group();
      const authoredPod = this.assets.create('pod');
      if (authoredPod) group.add(authoredPod);
      else this.addBox(group, this.materials.pod, 0, 0.25, 0, 0.75, 0.3, 0.92);
      this.addBox(
        group,
        this.materials.service,
        0,
        0.2,
        0.5,
        0.28,
        0.12,
        0.18,
        false,
      );
      const cargo =
        authoredPod?.getObjectByName('cargo') ??
        new THREE.Mesh(this.geometry.unitBox, this.materials.cargo);
      cargo.name = 'pod-cargo';
      if (!authoredPod) {
        cargo.position.set(0, 0.52, 0);
        cargo.scale.set(0.48, 0.34, 0.48);
        group.add(cargo);
      }
      const warning = new THREE.Mesh(this.geometry.cone, this.materials.error);
      warning.name = 'pod-warning';
      warning.position.set(0, 0.98, 0);
      group.add(warning);
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.15, 1.05),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          colorWrite: false,
          depthWrite: false,
        }),
      );
      proxy.layers.set(2);
      proxy.position.y = 0.52;
      proxy.userData.worldPick = { kind: 'pod', id: pod.id } satisfies PickInfo;
      group.add(proxy);
      this.pickTargets.push(proxy);
      group.userData.podId = pod.id;
      this.podLayer.add(group);
      this.podDraws.set(pod.id, group);
    }
    if (changed) {
      const nodes = new Map(
        snapshot.railNodes.map((node) => [node.id, node.position]),
      );
      this.podInstances.rebuild(
        [...this.podDraws].map(([id, group]) => {
          const pod = snapshot.pods.find((item) => item.id === id)!;
          const point = nodes.get(pod.nodeId);
          return {
            id,
            group,
            chunk: `${Math.floor((point?.x ?? 0) / 32)}:${Math.floor((point?.y ?? 0) / 32)}`,
          };
        }),
        true,
      );
    }
  }

  private updateDynamicState(snapshot: WorldSnapshot) {
    this.runningEntities.clear();
    this.extractingDrills.clear();
    for (const id of snapshot.drillExtractionIds) this.extractingDrills.add(id);
    for (const building of snapshot.buildings)
      if (building.kind === 'factory' && building.state === 'RUNNING')
        this.runningEntities.add(building.entityId);
    for (const pod of snapshot.pods) {
      const group = this.podDraws.get(pod.id);
      if (group === undefined) continue;
      const cargo = group.getObjectByName('pod-cargo');
      if (cargo !== undefined)
        cargo.traverse((part) => {
          part.userData.instanceVisible = pod.cargo !== undefined;
        });
      const warning = group.getObjectByName('pod-warning');
      if (warning !== undefined)
        warning.userData.instanceVisible =
          pod.state === 'DESTINATION_BLOCKED' ||
          pod.state === 'WAITING_BERTH' ||
          pod.state === 'GRIDLOCKED';
    }
    this.updateTraffic();
    this.updateStatusMarkers();
  }

  private updateStatusMarkers() {
    const next = signature([
      this.snapshot.paused,
      this.snapshot.buildings.map((building) =>
        building.kind === 'factory'
          ? [building.entityId, building.state]
          : null,
      ),
      this.snapshot.entities.map((entity) => [entity.id, entity.transform]),
    ]);
    if (next === this.statusSignature) return;
    this.statusSignature = next;
    const entities = new Map(
      this.snapshot.entities.map((entity) => [entity.id, entity]),
    );
    const entries: { id: string; chunk: string; group: THREE.Group }[] = [];
    for (const building of this.snapshot.buildings) {
      if (building.kind !== 'factory') continue;
      const entity = entities.get(building.entityId);
      if (!entity) continue;
      const group = new THREE.Group(),
        centre = footprintCentre(entity.transform);
      group.position.set(centre[0], 3.2, centre[2]);
      const state = this.snapshot.paused ? 'PAUSED' : building.state;
      const material =
        state === 'RUNNING'
          ? this.materials.equipment
          : state === 'INVALID' || state === 'MAINTENANCE'
            ? this.materials.error
            : this.materials.warning;
      if (state === 'WAITING_INPUT') {
        const triangle = new THREE.Mesh(this.geometry.cone, material);
        triangle.scale.set(0.6, 0.6, 0.6);
        group.add(triangle);
      } else if (state === 'PAUSED') {
        for (const x of [-0.12, 0.12])
          this.addBox(group, material, x, 0, 0, 0.1, 0.45, 0.16, false);
      } else if (state === 'INVALID' || state === 'MAINTENANCE') {
        for (const angle of [-Math.PI / 4, Math.PI / 4]) {
          const bar = this.addBox(
            group,
            material,
            0,
            0,
            0,
            0.12,
            0.55,
            0.16,
            false,
          );
          bar.rotation.z = angle;
        }
      } else
        this.addBox(
          group,
          material,
          0,
          0,
          0,
          state === 'RUNNING' ? 0.16 : 0.45,
          state === 'RUNNING' ? 0.16 : 0.45,
          0.18,
          false,
        );
      entries.push({
        id: building.entityId,
        group,
        chunk: Math.floor(centre[0] / 32) + ':' + Math.floor(centre[2] / 32),
      });
    }
    this.statusInstances.rebuild(entries);
  }

  private updateTraffic() {
    const next = signature([this.snapshot.railEdges, this.snapshot.railBlocks]);
    if (next === this.trafficSignature) return;
    this.trafficSignature = next;
    for (const object of [...this.trafficLayer.children])
      this.disposeDetached(object);
    this.trafficLayer.clear();
    const positions: number[] = [],
      colors: number[] = [];
    const blocks = new Map(
      this.snapshot.railBlocks.map((block) => [block.edgeId, block]),
    );
    const line = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      color: THREE.Color,
    ) => {
      positions.push(ax + 0.5, 0.32, az + 0.5, bx + 0.5, 0.32, bz + 0.5);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    };
    for (const edge of this.snapshot.railEdges) {
      const block = blocks.get(edge.id),
        color = new THREE.Color(
          block?.occupantId
            ? '#edb85f'
            : block?.reservedById
              ? '#e8dec7'
              : '#4c9690',
        );
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!,
          b = edge.points[i]!,
          length = Math.hypot(b.x - a.x, b.y - a.y);
        if (!length) continue;
        const dx = (b.x - a.x) / length,
          dz = (b.y - a.y) / length,
          x = (a.x + b.x) / 2,
          z = (a.y + b.y) / 2;
        if (block?.occupantId || block?.reservedById)
          line(a.x, a.y, b.x, b.y, color);
        line(
          x - dx * 0.28 - dz * 0.18,
          z - dz * 0.28 + dx * 0.18,
          x + dx * 0.28,
          z + dz * 0.28,
          color,
        );
        line(
          x - dx * 0.28 + dz * 0.18,
          z - dz * 0.28 - dx * 0.18,
          x + dx * 0.28,
          z + dz * 0.28,
          color,
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.trafficLayer.add(
      new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ vertexColors: true }),
      ),
    );
    this.trafficLayer.visible = this.showLogistics;
  }

  private renderFrame = (now: number) => {
    if (!this.visible || this.width === 0 || this.height === 0) {
      this.animationFrame = 0;
      return;
    }
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    if (now - this.lastDrawnAt < 15.5) return;
    const frameInterval = this.lastDrawnAt === 0 ? 16 : now - this.lastDrawnAt;
    this.lastDrawnAt = now;
    this.frameIntervals.push(frameInterval);
    if (this.frameIntervals.length > 120) this.frameIntervals.shift();
    this.considerAutomaticQuality(now);
    if (this.assetsReady && now - this.lastLodUpdate > 300) {
      this.lastLodUpdate = now;
      let changed = false;
      for (const entity of this.snapshot.entities) {
        const centre = footprintCentre(entity.transform);
        const distance = this.camera.position.distanceTo(
          new THREE.Vector3(...centre),
        );
        const pixels =
          (Math.max(entity.transform.size.width, entity.transform.size.height) *
            this.height) /
          (2 * Math.tan((this.camera.fov * Math.PI) / 360) * distance);
        const previous = this.entityLods.get(entity.id) ?? 0;
        const next =
          entity.id === this.selectedEntityId
            ? 0
            : pixels < (previous === 2 ? 30 : 22)
              ? 2
              : pixels < (previous === 0 ? 65 : 80)
                ? 1
                : 0;
        if (next !== previous) {
          this.entityLods.set(entity.id, next);
          changed = true;
        }
      }
      if (changed) this.reconcileEntities(this.snapshot);
      if (changed) this.reconcileHookups(this.snapshot);
    }
    const running = !this.snapshot.paused;
    this.renderer.domElement.dataset.catchingUp = String(
      this.renderClock.catchingUp,
    );
    for (const pod of this.snapshot.pods) {
      const group = this.podDraws.get(pod.id);
      const sample = this.renderClock.sample(pod, now);
      if (!group || !sample) continue;
      group.position.set(sample.x + 0.5, 0, sample.y + 0.5);
      group.rotation.y = sample.angle;
      const cargo = group.getObjectByName('pod-cargo');
      if (cargo)
        cargo.traverse((part) => {
          part.userData.instanceVisible = sample.pod.cargo !== undefined;
        });
      const warning = group.getObjectByName('pod-warning');
      if (warning)
        warning.userData.instanceVisible = [
          'DESTINATION_BLOCKED',
          'WAITING_BERTH',
          'GRIDLOCKED',
          'WAITING_BLOCK',
        ].includes(sample.pod.state);
    }
    if (!this.reducedMotion && running)
      for (const [id, fan] of this.animatedFans)
        if (this.runningEntities.has(id))
          fan.rotation.y =
            (Number(this.renderClock.time(now) % 6_000_000n) / 6_000_000) *
            Math.PI *
            2;
    if (!this.reducedMotion && running)
      for (const [id, head] of this.animatedDrillHeads)
        if (this.extractingDrills.has(id)) {
          head.userData.restY ??= head.position.y;
          head.position.y =
            (head.userData.restY as number) + Math.sin(now * 0.012) * 0.08;
        }
    this.podLayer.updateMatrixWorld(true);
    this.podInstances.update();
    this.mainPassStart = undefined;
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.dataset.firstFrame = 'true';
    if (
      new URLSearchParams(location.search).has('world-metrics') &&
      now - this.lastMetricsAt > 1000
    ) {
      this.lastMetricsAt = now;
      const buffers = new Set<ArrayBufferLike>();
      let sceneObjects = 0;
      this.scene.traverse((object) => {
        sceneObjects += 1;
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.LineSegments
        ) {
          if (object.visible) {
            for (const attribute of Object.values(
              object.geometry.attributes,
            ) as THREE.BufferAttribute[])
              buffers.add(attribute.array.buffer);
            if (object.geometry.index)
              buffers.add(object.geometry.index.array.buffer);
          }
          if (object instanceof THREE.InstancedMesh)
            buffers.add(object.instanceMatrix.array.buffer);
        }
      });
      const sun = this.scene.children.find(
        (child) => child instanceof THREE.DirectionalLight,
      );
      const shadowBytes = sun?.shadow.map
        ? sun.shadow.map.width * sun.shadow.map.height * 8
        : 0;
      const framebufferBytes =
        this.renderer.domElement.width * this.renderer.domElement.height * 12;
      this.renderer.domElement.dataset.worldStats = JSON.stringify({
        ready: this.readySent,
        sceneObjects,
        mainCalls:
          this.renderer.info.render.calls - (this.readMainPass()?.calls ?? 0),
        mainTriangles:
          this.renderer.info.render.triangles -
          (this.readMainPass()?.triangles ?? 0),
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        estimatedGpuBytes:
          [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0) +
          shadowBytes +
          framebufferBytes,
        quality: this.activeQuality,
        logicalTime: this.snapshot.logicalTime.toString(),
        pods: this.snapshot.pods.length,
        entities: this.snapshot.entities.length,
      });
    }
    if (
      !this.readySent &&
      this.renderer.domElement.dataset.assetsReady === 'true'
    ) {
      this.renderer.domElement.dataset.rendererReady = 'true';
      this.readySent = true;
      this.options.onReady?.();
    }
    if (this.resizeMinimapPending) this.drawMinimap();
  };

  setHome() {
    const spawn = this.snapshot.generation.spawn;
    this.target.set(spawn.x, 0, spawn.y);
    this.radius = 32;
    this.azimuth = Math.PI / 4;
    this.elevation = (50 * Math.PI) / 180;
    this.orbitElevation = this.elevation;
    this.updateCamera();
  }
  showAsset(id: string, lod: number, rotation: number) {
    for (const layer of [
      this.terrainLayer,
      this.oreLayer,
      this.buildingLayer,
      this.railLayer,
      this.podLayer,
      this.buildingInstances.root,
      this.railInstances.root,
      this.podInstances.root,
      this.trafficLayer,
    ])
      layer.visible = false;
    for (const child of [...this.galleryLayer.children])
      this.disposeDetached(child);
    this.galleryLayer.clear();
    this.scene.add(this.galleryLayer);
    const model = this.assets.create(id, lod);
    if (!model) return;
    model.rotation.y = (-rotation * Math.PI) / 2;
    this.galleryLayer.add(model);
    const asset = this.assets.manifest?.assets.find((entry) => entry.id === id);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      this.materials.ground,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    ground.receiveShadow = true;
    this.galleryLayer.add(ground);
    if (asset) {
      const footprint = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(asset.footprint[0], 0.025, asset.footprint[1]),
        ),
        new THREE.LineBasicMaterial({ color: '#f3f0e7' }),
      );
      footprint.rotation.y = model.rotation.y;
      footprint.position.y = 0.02;
      this.galleryLayer.add(footprint);
    }
    model.traverse((object) => {
      if (
        object.name.startsWith('socket_') ||
        object.name.startsWith('anchor_')
      ) {
        const marker = new THREE.Mesh(
          this.geometry.smallRound,
          this.materials.error,
        );
        object.getWorldPosition(marker.position);
        marker.scale.set(0.12, 0.12, 0.12);
        this.galleryLayer.add(marker);
      }
    });
    this.target.set(0, 0, 0);
    this.radius = 12;
    this.updateCamera();
  }

  getCameraState(): CameraState {
    return {
      x: this.target.x,
      z: this.target.z,
      distance: this.radius,
      azimuth: this.azimuth,
      elevation: this.elevation,
      orbitElevation: this.orbitElevation,
      preset: this.elevation > 1.5 ? 'top' : 'orbit',
    };
  }

  restoreCamera(camera: CameraState) {
    this.target.set(
      clamp(camera.x, 0, this.snapshot.grid.width),
      0,
      clamp(camera.z, 0, this.snapshot.grid.height),
    );
    this.radius = clamp(camera.distance, 4, 1200);
    this.azimuth = camera.azimuth % (Math.PI * 2);
    this.orbitElevation = clamp(
      camera.orbitElevation,
      (35 * Math.PI) / 180,
      (75 * Math.PI) / 180,
    );
    this.elevation =
      camera.preset === 'top'
        ? (89 * Math.PI) / 180
        : clamp(camera.elevation, (35 * Math.PI) / 180, (75 * Math.PI) / 180);
    this.updateCamera();
  }

  setTopView() {
    if (this.elevation > (88 * Math.PI) / 180)
      this.elevation = this.orbitElevation;
    else {
      this.orbitElevation = this.elevation;
      this.elevation = (89 * Math.PI) / 180;
    }
    this.updateCamera();
  }

  rotateCamera(quarterTurns: number) {
    this.azimuth += quarterTurns * (Math.PI / 2);
    this.updateCamera();
  }

  zoom(factor: number) {
    this.radius = clamp(this.radius * factor, 4, 1200);
    this.updateCamera();
  }

  setQuality(mode: QualityMode) {
    this.qualityMode = mode;
    if (mode !== 'auto') this.applyQuality(mode);
    else this.lastQualityCheck = performance.now();
  }

  private applyQuality(level: Exclude<QualityMode, 'auto'>) {
    this.activeQuality = level;
    const pixelRatio = level === 'low' ? 1 : level === 'standard' ? 1.5 : 2;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, pixelRatio),
    );
    this.renderer.shadowMap.enabled = level !== 'low';
    const sun = this.scene.children.find(
      (child) => child instanceof THREE.DirectionalLight,
    ) as THREE.DirectionalLight | undefined;
    const shadowResolution = level === 'high' ? 2048 : 1024;
    sun?.shadow.mapSize.set(shadowResolution, shadowResolution);
    sun?.shadow.map?.dispose();
    this.renderer.shadowMap.needsUpdate = true;
    if (this.width > 0 && this.height > 0)
      this.renderer.setSize(this.width, this.height, false);
  }

  private considerAutomaticQuality(now: number) {
    if (
      this.qualityMode !== 'auto' ||
      now - this.lastQualityCheck < 3_000 ||
      now - this.lastQualityChange < 8_000
    )
      return;
    this.lastQualityCheck = now;
    if (this.frameIntervals.length < 30) return;
    const ordered = [...this.frameIntervals].sort((a, b) => a - b);
    const p95 = ordered[Math.floor(ordered.length * 0.95)] ?? 16;
    const levels: readonly Exclude<QualityMode, 'auto'>[] = [
      'low',
      'standard',
      'high',
    ];
    const index = levels.indexOf(this.activeQuality);
    if (p95 > 35 && index > 0) {
      this.applyQuality(levels[index - 1]!);
      this.lastQualityChange = now;
    } else if (p95 < 16.7 && index < levels.length - 1) {
      this.applyQuality(levels[index + 1]!);
      this.lastQualityChange = now;
    }
  }

  focus(point: GridPoint) {
    this.target.set(point.x + 0.5, 0, point.y + 0.5);
    this.updateCamera();
  }

  /** Keep keyboard construction inside the usable central viewport. */
  ensureVisible(point: GridPoint) {
    this.camera.updateMatrixWorld();
    const projected = new THREE.Vector3(
      point.x + 0.5,
      0,
      point.y + 0.5,
    ).project(this.camera);
    if (
      Math.abs(projected.x) > 0.55 ||
      Math.abs(projected.y) > 0.45 ||
      projected.z > 1
    )
      this.focus(point);
  }

  panPixels(dx: number, dy: number) {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const right = new THREE.Vector3()
      .crossVectors(direction, this.camera.up)
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, direction).normalize();
    const worldPerPixel =
      (2 *
        this.radius *
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) /
      this.height;
    this.target.addScaledVector(right, -dx * worldPerPixel);
    this.target.addScaledVector(up, dy * worldPerPixel);
    this.target.y = 0;
    this.updateCamera();
  }

  orbitPixels(dx: number, dy: number) {
    this.azimuth -= dx * 0.006;
    this.elevation = clamp(
      this.elevation + dy * 0.006,
      ((this.elevation > (88 * Math.PI) / 180 ? 88 : 35) * Math.PI) / 180,
      ((this.elevation > (88 * Math.PI) / 180 ? 89 : 75) * Math.PI) / 180,
    );
    if (this.elevation <= (75 * Math.PI) / 180)
      this.orbitElevation = this.elevation;
    this.updateCamera();
  }

  zoomAt(clientX: number, clientY: number, factor: number) {
    const before = this.groundPoint(clientX, clientY);
    this.zoom(factor);
    const after = this.groundPoint(clientX, clientY);
    if (before !== undefined && after !== undefined) {
      this.target.x += before.x - after.x;
      this.target.z += before.z - after.z;
      this.updateCamera();
    }
  }

  private updateCamera() {
    this.target.x = clamp(this.target.x, 0, this.snapshot.grid.width);
    this.target.z = clamp(this.target.z, 0, this.snapshot.grid.height);
    const horizontal = Math.cos(this.elevation) * this.radius;
    this.camera.position.set(
      this.target.x + horizontal * Math.sin(this.azimuth),
      this.target.y + Math.sin(this.elevation) * this.radius,
      this.target.z + horizontal * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
    const sunTarget = this.scene.children.find(
      (child) => child instanceof THREE.DirectionalLight,
    )?.target;
    if (sunTarget !== undefined) sunTarget.position.copy(this.target);
    const sun = this.scene.children.find(
      (child) => child instanceof THREE.DirectionalLight,
    );
    if (sun instanceof THREE.DirectionalLight) {
      sun.position.copy(this.target).add(new THREE.Vector3(-30, 48, -25));
      const extent = clamp(this.radius * 0.7, 24, 48);
      Object.assign(sun.shadow.camera, {
        left: -extent,
        right: extent,
        top: extent,
        bottom: -extent,
      });
      sun.shadow.camera.updateProjectionMatrix();
    }
    this.resizeMinimapPending = true;
    this.options.onCameraChange?.(this.getCameraState());
  }

  groundPoint(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, point)
      ? point
      : undefined;
  }

  pick(clientX: number, clientY: number): PickInfo | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.pickingDirty) {
      this.spatialPicking.rebuild(this.pickTargets);
      this.pickingDirty = false;
    }
    const tolerance =
      (12 * this.radius * Math.tan((this.camera.fov * Math.PI) / 360)) /
      rect.height;
    const candidates = this.spatialPicking.candidates(
      this.raycaster.ray,
      tolerance,
    );
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    if (hit) return hit.object.userData.worldPick as PickInfo;
    let closest = 6;
    let selected: PickInfo | undefined;
    for (const object of candidates) {
      if (object.userData.worldPick?.kind !== 'rail') continue;
      const box = new THREE.Box3().setFromObject(object),
        a = box.getCenter(new THREE.Vector3()),
        b = a.clone();
      if (box.max.x - box.min.x > box.max.z - box.min.z) {
        a.x = box.min.x;
        b.x = box.max.x;
      } else {
        a.z = box.min.z;
        b.z = box.max.z;
      }
      a.project(this.camera);
      b.project(this.camera);
      const distance = segmentDistance(
        clientX - rect.left,
        clientY - rect.top,
        ((a.x + 1) * rect.width) / 2,
        ((1 - a.y) * rect.height) / 2,
        ((b.x + 1) * rect.width) / 2,
        ((1 - b.y) * rect.height) / 2,
      );
      if (distance <= closest) {
        closest = distance;
        selected = object.userData.worldPick as PickInfo;
      }
    }
    return selected;
  }

  pointAt(clientX: number, clientY: number): GridPoint | undefined {
    const point = this.groundPoint(clientX, clientY);
    if (point === undefined) return undefined;
    const grid = worldToGrid(point.x, point.z);
    return grid.x >= 0 &&
      grid.y >= 0 &&
      grid.x < this.snapshot.grid.width &&
      grid.y < this.snapshot.grid.height
      ? grid
      : undefined;
  }

  setOverlays(showGrid: boolean, showOre: boolean, showLogistics: boolean) {
    this.showGrid = showGrid;
    this.showOre = showOre;
    this.showLogistics = showLogistics;
    this.trafficLayer.visible = showLogistics;
    if (this.gridLines !== undefined) this.gridLines.visible = showGrid;
    this.oreLayer.visible = showOre;
    this.updateOverlays();
    this.drawMinimap(true);
  }

  setTransient(args: {
    readonly ghost?: GhostState;
    readonly selected?: GridPoint;
    readonly selectedEntityId?: WorldEntityId;
    readonly railDraft: readonly GridPoint[];
    readonly railPreview?: GridPoint;
    readonly keyboardCursor?: GridPoint;
    readonly hoveredRailEdgeId?: RailEdgeId;
    readonly hoveredDismantleEntityId?: WorldEntityId;
    readonly selectedRailEdgeId?: RailEdgeId;
    readonly activeTool: string;
  }) {
    this.ghost = args.ghost;
    this.selected = args.selected;
    this.selectedEntityId = args.selectedEntityId;
    this.railDraft = args.railDraft;
    this.railPreview = args.railPreview;
    this.keyboardCursor = args.keyboardCursor;
    this.hoveredRailEdgeId = args.hoveredRailEdgeId;
    this.hoveredDismantleEntityId = args.hoveredDismantleEntityId;
    this.selectedRailEdgeId = args.selectedRailEdgeId;
    this.activeTool = args.activeTool;
    this.updateOverlays();
  }

  private updateOverlays() {
    const railClearance = validateRailPath(
      this.snapshot.grid,
      this.railPreview ? [...this.railDraft, this.railPreview] : this.railDraft,
    );
    const nextSignature = signature([
      railClearance,
      this.ghost,
      this.selected,
      this.selectedEntityId,
      this.railDraft,
      this.railPreview,
      this.keyboardCursor,
      this.hoveredRailEdgeId,
      this.hoveredDismantleEntityId,
      this.selectedRailEdgeId,
      this.activeTool,
      this.snapshot.entities.find(
        (entity) => entity.id === this.selectedEntityId,
      )?.transform,
      this.snapshot.railEdges.find(
        (edge) =>
          edge.id === (this.hoveredRailEdgeId ?? this.selectedRailEdgeId),
      )?.points,
    ]);
    if (nextSignature === this.overlaySignature) return;
    this.overlaySignature = nextSignature;
    for (const child of [...this.overlayLayer.children])
      this.disposeDetached(child);
    this.overlayLayer.clear();
    for (const child of [...this.ghostGroup.children])
      this.disposeDetached(child);
    this.ghostGroup.clear();
    delete this.renderer.domElement.dataset.hookupGhost;
    delete this.renderer.domElement.dataset.hookupSelected;
    if (this.ghost !== undefined) {
      if (this.ghost.kind === 'junction') {
        const marker = new THREE.Mesh(
          this.geometry.smallRound,
          this.ghost.valid ? this.materials.equipment : this.materials.error,
        );
        marker.position.set(
          this.ghost.transform.position.x + 0.5,
          0.3,
          this.ghost.transform.position.y + 0.5,
        );
        marker.scale.set(0.72, 0.55, 0.72);
        marker.material = this.ghost.pending
          ? this.materials.ghostPending
          : this.ghost.valid
            ? this.materials.ghostValid
            : this.materials.ghostInvalid;
        this.ghostGroup.add(marker);
      } else {
        const fakeEntity = {
          id: 'ghost',
          kind: this.ghost.kind,
          transform: this.ghost.transform,
          createdAt: 0n,
          state: 'GHOST',
        } as unknown as WorldEntity;
        this.ghostGroup.add(
          this.createBuildingModel(fakeEntity, true, this.ghost.valid),
        );
      }
      if (this.ghost.kind === 'station' || this.ghost.kind === 'depot') {
        const cell = hookupCell(this.ghost.transform);
        const hookup = new THREE.Group();
        hookup.position.set(cell.x + 0.5, 0, cell.y + 0.5);
        hookup.rotation.y = quarterTurnRadians(this.ghost.transform.rotation);
        hookup.add(this.createHookupPart('hookup-marker', 0));
        hookup.add(this.createHookupPart('hookup-crane', 0));
        this.ghostGroup.add(hookup);
        const accent = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.05, 1)),
          new THREE.LineBasicMaterial({
            color: this.ghost.valid ? '#d9b45f' : '#dc7468',
            depthWrite: false,
          }),
        );
        accent.position.set(cell.x + 0.5, 0.05, cell.y + 0.5);
        this.overlayLayer.add(accent);
        this.renderer.domElement.dataset.hookupGhost = `${cell.x},${cell.y},${this.ghost.valid ? 'valid' : 'invalid'}`;
      }
      const cells =
        this.ghost.kind === 'junction'
          ? []
          : occupiedCells(this.ghost.transform);
      const positions: number[] = [];
      for (const { x, y } of cells) {
        for (const [ax, az, bx, bz] of [
          [0.01, 0.01, 0.99, 0.01],
          [0.99, 0.01, 0.99, 0.99],
          [0.99, 0.99, 0.01, 0.99],
          [0.01, 0.99, 0.01, 0.01],
        ])
          positions.push(x + ax!, 0.035, y + az!, x + bx!, 0.035, y + bz!);
      }
      if (positions.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(positions, 3),
        );
        this.overlayLayer.add(
          new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({
              color: this.ghost.pending
                ? '#d9b45f'
                : this.ghost.valid
                  ? '#91dcb7'
                  : '#e87e72',
              depthWrite: false,
            }),
          ),
        );
      }
    }

    if (this.selectedEntityId !== undefined) {
      const entity = this.snapshot.entities.find(
        (item) => item.id === this.selectedEntityId,
      );
      if (entity !== undefined) {
        const [width, depth] = footprintSize(entity.transform);
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(
            new THREE.BoxGeometry(width + 0.1, 0.06, depth + 0.1),
          ),
          new THREE.LineBasicMaterial({
            color: '#f3f0e7',
            transparent: true,
            opacity: 0.95,
          }),
        );
        const centre = footprintCentre(entity.transform);
        outline.position.set(centre[0], 0.045, centre[2]);
        this.overlayLayer.add(outline);
        if (entity.kind === 'station' || entity.kind === 'depot') {
          const node = this.snapshot.railNodes.find(
            (item) => item.id === entity.railNodeId,
          );
          const cell = node?.position ?? hookupCell(entity.transform);
          const highlight = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.07, 1)),
            new THREE.LineBasicMaterial({
              color: '#d9b45f',
              transparent: true,
              opacity: 0.95,
              depthWrite: false,
            }),
          );
          highlight.position.set(cell.x + 0.5, 0.055, cell.y + 0.5);
          this.overlayLayer.add(highlight);
          this.renderer.domElement.dataset.hookupSelected = `${cell.x},${cell.y}`;
        }
      }
    } else if (this.selected !== undefined) {
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.045, 1)),
        new THREE.LineBasicMaterial({ color: '#f3f0e7' }),
      );
      border.position.set(this.selected.x + 0.5, 0.04, this.selected.y + 0.5);
      this.overlayLayer.add(border);
    }
    if (this.keyboardCursor !== undefined) {
      const cursor = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.07, 1)),
        new THREE.LineBasicMaterial({ color: '#f3d17b', linewidth: 2 }),
      );
      cursor.position.set(
        this.keyboardCursor.x + 0.5,
        0.055,
        this.keyboardCursor.y + 0.5,
      );
      this.overlayLayer.add(cursor);
    }
    if (this.railDraft.length > 0) {
      for (const point of this.railDraft)
        this.addBox(
          this.overlayLayer,
          railClearance.valid ? this.materials.service : this.materials.error,
          point.x + 0.5,
          0.12,
          point.y + 0.5,
          0.24,
          0.18,
          0.24,
          false,
        );
      for (let i = 1; i < this.railDraft.length; i += 1) {
        const a = this.railDraft[i - 1]!;
        const b = this.railDraft[i]!;
        const horizontal = a.y === b.y;
        const line = this.addBox(
          this.overlayLayer,
          railClearance.valid ? this.materials.service : this.materials.error,
          (a.x + b.x + 1) / 2,
          0.1,
          (a.y + b.y + 1) / 2,
          horizontal ? Math.abs(b.x - a.x) + 1 : 0.12,
          0.09,
          horizontal ? 0.12 : Math.abs(b.y - a.y) + 1,
          false,
        );
        line.userData.preview = true;
      }
      const endpoint = this.railDraft.at(-1);
      if (
        endpoint !== undefined &&
        this.railPreview !== undefined &&
        (endpoint.x !== this.railPreview.x || endpoint.y !== this.railPreview.y)
      ) {
        const horizontal = endpoint.y === this.railPreview.y;
        this.addBox(
          this.overlayLayer,
          railClearance.valid ? this.materials.warning : this.materials.error,
          (endpoint.x + this.railPreview.x + 1) / 2,
          0.12,
          (endpoint.y + this.railPreview.y + 1) / 2,
          horizontal ? Math.abs(this.railPreview.x - endpoint.x) + 1 : 0.13,
          0.09,
          horizontal ? 0.13 : Math.abs(this.railPreview.y - endpoint.y) + 1,
          false,
        );
        this.addBox(
          this.overlayLayer,
          railClearance.valid ? this.materials.service : this.materials.error,
          this.railPreview.x + 0.5,
          0.17,
          this.railPreview.y + 0.5,
          0.34,
          0.13,
          0.34,
          false,
        );
      }
    }
    const focusEdge = this.hoveredRailEdgeId ?? this.selectedRailEdgeId;
    if (focusEdge !== undefined) {
      const edge = this.snapshot.railEdges.find(
        (candidate) => candidate.id === focusEdge,
      );
      if (edge !== undefined) {
        for (let i = 1; i < edge.points.length; i += 1) {
          const a = edge.points[i - 1]!;
          const b = edge.points[i]!;
          const horizontal = a.y === b.y;
          const highlight = this.addBox(
            this.overlayLayer,
            this.hoveredRailEdgeId === focusEdge
              ? this.materials.error
              : this.materials.structure,
            (a.x + b.x + 1) / 2,
            0.32,
            (a.y + b.y + 1) / 2,
            horizontal ? Math.abs(b.x - a.x) + 1 : 0.22,
            0.12,
            horizontal ? 0.22 : Math.abs(b.y - a.y) + 1,
            false,
          );
          highlight.material = highlight.material.clone();
          const material = highlight.material as THREE.MeshStandardMaterial;
          material.transparent = true;
          material.opacity = 0.65;
        }
      }
    }
    if (this.hoveredDismantleEntityId !== undefined) {
      const entity = this.snapshot.entities.find(
        (item) => item.id === this.hoveredDismantleEntityId,
      );
      if (entity !== undefined) {
        const [width, depth] = footprintSize(entity.transform);
        const centre = footprintCentre(entity.transform);
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(
            new THREE.BoxGeometry(width + 0.1, 0.08, depth + 0.1),
          ),
          new THREE.LineBasicMaterial({ color: '#dc7468' }),
        );
        line.position.set(centre[0], 0.06, centre[2]);
        this.overlayLayer.add(line);
      }
    }
  }

  setMinimap(canvas: HTMLCanvasElement | undefined) {
    this.minimapCanvas = canvas;
    this.minimapContext = canvas?.getContext('2d') ?? undefined;
    this.drawMinimap(true);
  }

  private drawMinimap(force = false) {
    if (this.minimapCanvas === undefined || this.minimapContext === undefined)
      return;
    const now = performance.now();
    if (!force && now - this.lastMinimapDrawnAt < 250) {
      this.resizeMinimapPending = true;
      return;
    }
    this.lastMinimapDrawnAt = now;
    this.resizeMinimapPending = false;
    const canvas = this.minimapCanvas;
    const width = canvas.width;
    const height = canvas.height;
    const context = this.minimapContext;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#819778';
    context.fillRect(0, 0, width, height);
    const sx = width / this.snapshot.grid.width;
    const sy = height / this.snapshot.grid.height;
    for (let index = 0; index < this.snapshot.grid.terrain.length; index += 1)
      if (this.snapshot.grid.terrain[index] === TerrainKind.OBSTACLE) {
        context.fillStyle = '#68746b';
        context.fillRect(
          (index % this.snapshot.grid.width) * sx,
          Math.floor(index / this.snapshot.grid.width) * sy,
          Math.max(1, sx),
          Math.max(1, sy),
        );
      }
    if (this.showOre)
      for (
        let index = 0;
        index < this.snapshot.grid.oreKinds.length;
        index += 1
      )
        if (
          this.snapshot.grid.oreKinds[index] !== OreKind.NONE &&
          this.snapshot.grid.oreRemaining[index] !== 0
        ) {
          context.fillStyle =
            this.snapshot.grid.oreKinds[index] === OreKind.IRON
              ? '#b8754b'
              : '#7ab3a5';
          context.fillRect(
            (index % this.snapshot.grid.width) * sx,
            Math.floor(index / this.snapshot.grid.width) * sy,
            Math.max(1, sx * 1.8),
            Math.max(1, sy * 1.8),
          );
        }
    context.fillStyle = '#263338';
    for (const entity of this.snapshot.entities) {
      const centre = footprintCentre(entity.transform);
      context.fillRect(centre[0] * sx - 1, centre[2] * sy - 1, 3, 3);
    }
    const corners = [
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 0, -1),
      new THREE.Vector3(1, 0, 1),
      new THREE.Vector3(-1, 0, 1),
    ].map((point) => {
      point.unproject(this.camera);
      const direction = point.sub(this.camera.position).normalize();
      const distance = -this.camera.position.y / direction.y;
      return this.camera.position.clone().addScaledVector(direction, distance);
    });
    context.strokeStyle = '#f3f0e7';
    context.lineWidth = 1.2;
    context.beginPath();
    corners.forEach((point, index) => {
      const x = point.x * sx;
      const y = point.z * sy;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.stroke();
  }

  focusMinimap(clientX: number, clientY: number) {
    const canvas = this.minimapCanvas;
    if (canvas === undefined) return;
    const rect = canvas.getBoundingClientRect();
    const x =
      clamp((clientX - rect.left) / rect.width, 0, 1) *
      this.snapshot.grid.width;
    const z =
      clamp((clientY - rect.top) / rect.height, 0, 1) *
      this.snapshot.grid.height;
    this.target.set(x, 0, z);
    this.updateCamera();
    this.drawMinimap(true);
  }

  private resize = () => {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.width = width;
    this.height = height;
    if (width <= 0 || height <= 0) {
      if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
      return;
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.animationFrame === 0 && this.visible)
      this.animationFrame = requestAnimationFrame(this.renderFrame);
    this.drawMinimap(true);
  };

  private onVisibilityChange = () => {
    this.visible = document.visibilityState !== 'hidden';
    if (!this.visible && this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    } else if (
      this.visible &&
      this.width > 0 &&
      this.height > 0 &&
      this.animationFrame === 0
    )
      this.animationFrame = requestAnimationFrame(this.renderFrame);
  };

  dispose() {
    this.disposed = true;
    this.buildingInstances.clear();
    this.railInstances.clear();
    this.hookupInstances.clear();
    if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    for (const material of Object.values(this.materials)) material.dispose();
    for (const geometry of Object.values(this.geometry)) geometry.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (
          object.geometry !== this.geometry.unitBox &&
          object.geometry !== this.geometry.smallRound &&
          object.geometry !== this.geometry.shaft &&
          object.geometry !== this.geometry.rock &&
          object.geometry !== this.geometry.crystal &&
          object.geometry !== this.geometry.cone
        )
          object.geometry.dispose();
        if (Array.isArray(object.material))
          object.material.forEach((material) => material.dispose());
        else if (
          !Object.values(this.materials).includes(
            object.material as THREE.MeshStandardMaterial,
          )
        )
          object.material.dispose();
      }
      if (object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        if (Array.isArray(object.material))
          object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      }
    });
    this.podInstances.clear();
    this.statusInstances.clear();
    this.assets.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private removePickTargets(group: THREE.Object3D) {
    const members = new Set<THREE.Object3D>();
    group.traverse((object) => members.add(object));
    for (let index = this.pickTargets.length - 1; index >= 0; index -= 1)
      if (members.has(this.pickTargets[index]!))
        this.pickTargets.splice(index, 1);
  }

  private disposeDetached(root: THREE.Object3D) {
    root.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        const sharedGeometry = Object.values(this.geometry).includes(
          object.geometry as never,
        );
        if (!sharedGeometry && !this.assets.geometries.has(object.geometry))
          object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials)
          if (
            !this.assets.materials.has(material) &&
            !Object.values(this.materials).includes(
              material as THREE.MeshStandardMaterial,
            )
          )
            material.dispose();
      }
    });
  }
}
