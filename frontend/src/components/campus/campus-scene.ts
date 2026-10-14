/**
 * The campus world renderer (WORLD → LIFE → INTERACTION, following the World
 * Prompt Pack's structure and the WareTrack reference; see
 * docs/erp-operations/REFERENCE-ANALYSIS.md).
 *
 * Plain Three.js in a class so React only mounts, feeds and disposes it.
 * Everything drawn comes from the facility records the API sent for this
 * viewer — restricted spaces are already removed or masked server-side.
 * Movement of people, cars and the bus is ANONYMOUS and ILLUSTRATIVE: it never
 * represents a tracked person, and the UI says so.
 *
 * Look: a bright, clean model-railway campus — white walls, coloured roofs,
 * glazed window rows, a road loop with lane markings, lawns and paths — with
 * map pins over the places where something is happening right now.
 *
 * Performance: shared geometries and materials per build, instanced trees,
 * people, desks, chairs and cars; shadows, people and furniture reduced in
 * low-power mode; pixel ratio capped; the loop paused when the tab is hidden;
 * a refresh of what is happening recolours in place instead of rebuilding;
 * full disposal on unmount.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CampusNodeDto } from '@/lib/ops-types';

export type Level = { kind: 'campus' } | { kind: 'building'; buildingId: string; floorNo: number | null };
export interface SceneOptions {
  lowPower: boolean;
  reducedMotion: boolean;
  night: boolean;
  onSelect: (id: string | null) => void;
  onHover?: (id: string | null) => void;
}

/** What a room's colour means. Kept in one place for the legend. */
export const STATE_COLORS: Record<string, string> = {
  FREE: '#8FD3A6',
  SCHEDULED_CLASS: '#4F86E8',
  EXAM: '#E0527A',
  BOOKED: '#9B7BE6',
  EVENT: '#F2B33D',
  UNDER_MAINTENANCE: '#F07F3C',
  CLOSED: '#B4B9C2',
  RESTRICTED: '#5D6470',
  OTHER: '#DDE3EC',
};

export function stateOf(n: CampusNodeDto): string {
  if (n.restricted && n.name === 'Restricted area') return 'RESTRICTED';
  if (n.status === 'UNDER_MAINTENANCE') return 'UNDER_MAINTENANCE';
  if (n.status === 'CLOSED') return 'CLOSED';
  const s = n.now?.[0]?.type;
  if (s === 'EXAM' || s === 'SCHEDULED_CLASS' || s === 'BOOKED' || s === 'EVENT') return s;
  if (n.now) return 'FREE';
  return 'OTHER';
}

const GROUND_KINDS = new Set(['GROUND', 'COURT', 'PARKING', 'TRANSPORT_BAY']);
const ROOF_PALETTE = ['#3D7BE0', '#2BA39A', '#5A67D8', '#E0803D', '#D2455E', '#3C9BD6', '#7A5BD8'];
const FLOOR_H = 4;
const INTERIOR_FLOOR_GAP = 7;

type Pin = { obj: THREE.Group; baseY: number; phase: number };

export class CampusScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pickables: THREE.Object3D[] = [];
  private nodeById = new Map<string, CampusNodeDto>();
  private meshById = new Map<string, THREE.Object3D>();
  private stateMeshes = new Map<string, THREE.Mesh>();
  private world = new THREE.Group();
  private ring: THREE.Mesh;
  /** Inside a building the selection is an outline of the room, not a ring over its neighbours. */
  private outline: THREE.LineSegments | null = null;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private raf = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private people: { body: THREE.InstancedMesh; head: THREE.InstancedMesh; paths: THREE.Vector3[][]; t: Float32Array; speed: Float32Array; lane: Float32Array; count: number } | null = null;
  private bus: { mesh: THREE.Group; path: THREE.CurvePath<THREE.Vector3>; t: number; stopAt: number; wait: number } | null = null;
  private cars: { mesh: THREE.InstancedMesh; t: Float32Array; path: THREE.CurvePath<THREE.Vector3>; count: number } | null = null;
  private pins: Pin[] = [];
  private occupants: THREE.Group | null = null;
  private occDisposables: Array<{ dispose: () => void }> = [];
  private seated: { head: THREE.InstancedMesh; base: Float32Array; count: number; y: number } | null = null;
  private teachers: Array<{ obj: THREE.Object3D; x: number; z: number; span: number; depth: number; phase: number }> = [];
  private beams: THREE.Group | null = null;
  private beamDisposables: Array<{ dispose: () => void }> = [];
  private spotIds: string[] = [];
  private glide: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  private disposables: Array<{ dispose: () => void }> = [];
  /** Geometry and materials of the current build; freed on every rebuild. */
  private buildDisposables: Array<{ dispose: () => void }> = [];
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private frames = 0;
  private fpsWindowStart = performance.now();
  public fps = 0;
  private visible = true;
  private level: Level = { kind: 'campus' };
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private structureKey = '';
  private onVisibility = () => { this.visible = document.visibilityState === 'visible'; if (this.visible) this.clock.getDelta(); };

  constructor(private container: HTMLElement, private opts: SceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !opts.lowPower, powerPreference: opts.lowPower ? 'low-power' : 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1 : 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !opts.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Campus 3D view. Use the search, the building buttons or the list for keyboard navigation; plus and minus zoom, H returns home.');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(34, container.clientWidth / container.clientHeight, 1, 2400);
    this.camera.position.set(170, 175, 215);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Strategy-game controls: drag pans, right-drag rotates, wheel/pinch zooms.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.screenSpacePanning = false;
    this.controls.enableDamping = !opts.reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.minDistance = 22;
    this.controls.maxDistance = 560;
    this.controls.listenToKeyEvents(this.renderer.domElement);

    this.hemi = new THREE.HemisphereLight(0xf4f8ff, 0xd8dccf, 1.05);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.1);
    this.sun.position.set(-140, 240, 110);
    this.sun.castShadow = !opts.lowPower;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const s = 200;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 700 });
    this.scene.add(this.hemi, this.sun, this.world);

    const ringGeo = new THREE.RingGeometry(1, 1.18, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2f6fe4, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.disposables.push(ringGeo, ringMat);

    this.applyLighting(opts.night);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loop();
  }

  // ── WORLD ─────────────────────────────────────────────────────────────

  /**
   * New data from the server. When only what is happening changed (the usual
   * minute's refresh), rooms are recoloured and pins moved in place; the world
   * is rebuilt only when buildings or rooms were added, moved or removed.
   */
  setData(nodes: CampusNodeDto[]) {
    this.nodeById = new Map(nodes.map((n) => [n.id, n]));
    const key = nodes.map((n) => `${n.id}:${n.parentId}:${n.layout?.x}:${n.layout?.z}:${n.layout?.w}:${n.layout?.d}:${n.layout?.h}`).sort().join('|');
    if (key === this.structureKey && this.world.children.length) { this.refreshStates(); return; }
    this.structureKey = key;
    this.rebuild();
  }

  private material(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}, cache = true) {
    const k = cache ? `${color}|${JSON.stringify(opts)}` : '';
    if (cache && this.matCache.has(k)) return this.matCache.get(k)!;
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04, ...opts });
    this.buildDisposables.push(m);
    if (cache) this.matCache.set(k, m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.buildDisposables.push(g);
    return g;
  }

  private box(w: number, h: number, d: number) {
    return this.geo(new THREE.BoxGeometry(w, h, d));
  }

  private add(mesh: THREE.Object3D, { shadow = true, receive = true } = {}) {
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = shadow && !this.opts.lowPower; o.receiveShadow = receive; }
    });
    this.world.add(mesh);
    return mesh;
  }

  private clearWorld() {
    this.pickables = [];
    this.meshById.clear();
    this.stateMeshes.clear();
    this.pins = [];
    while (this.world.children.length) this.world.remove(this.world.children[0]);
    for (const extra of [this.people?.body, this.people?.head, this.bus?.mesh, this.cars?.mesh]) if (extra) this.scene.remove(extra);
    this.people = null; this.bus = null; this.cars = null;
    for (const d of this.buildDisposables) d.dispose();
    this.buildDisposables = [];
    this.matCache.clear();
  }

  private bounds() {
    const campus = [...this.nodeById.values()].find((n) => n.kind === 'CAMPUS');
    return { W: campus?.layout?.w ?? 240, D: campus?.layout?.d ?? 180 };
  }

  private rebuild() {
    this.clearWorld();
    const nodes = [...this.nodeById.values()];
    const { W, D } = this.bounds();
    this.buildGround(W, D);

    nodes.filter((n) => n.kind !== 'CAMPUS' && n.kind !== 'FLOOR').forEach((n, i) => {
      const L = n.layout ?? { x: 0, z: 0, w: 10, d: 10, h: 4 };
      if (GROUND_KINDS.has(n.kind)) { this.buildOpenSpace(n, L); return; }
      if (n.kind === 'GATE') { this.buildGate(n, L); return; }
      if (n.kind === 'BUILDING') {
        if (this.level.kind === 'building' && this.level.buildingId === n.id) return;
        this.buildBuilding(n, L, i, this.level.kind === 'building');
      }
    });

    if (this.level.kind === 'building') this.buildInterior(this.level.buildingId, this.level.floorNo);
    this.addTrees(W, D);
    this.addLife(W, D);
    this.refreshPins();
    this.refreshOccupants();
    this.refreshBeams();
    this.highlight(this.selectedId);
  }

  private buildGround(W: number, D: number) {
    const night = this.opts.night;
    const base = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(W + 220, D + 220)), this.material(night ? '#2A3140' : '#E9EDF2'));
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.05;
    this.add(base, { shadow: false });
    // The campus plot: a lawn inside a kerb.
    const lawn = new THREE.Mesh(this.box(W + 18, 0.3, D + 18), this.material(night ? '#3B4A3C' : '#D7E8CB'));
    lawn.position.y = 0.15;
    this.add(lawn, { shadow: false });
    const kerbMat = this.material(night ? '#596273' : '#FFFFFF');
    for (const [x, z, w, d] of [[0, -(D + 18) / 2, W + 20, 1], [0, (D + 18) / 2, W + 20, 1], [-(W + 18) / 2, 0, 1, D + 20], [(W + 18) / 2, 0, 1, D + 20]]) {
      const k = new THREE.Mesh(this.box(w, 0.7, d), kerbMat);
      k.position.set(x, 0.35, z);
      this.add(k, { shadow: false });
    }
    // Road loop outside the plot, with dashed centre lines and kerbs.
    const roadMat = this.material(night ? '#3A4252' : '#C9D0DA', { roughness: 0.9 });
    const lineMat = this.material(night ? '#9AA4B5' : '#FFFFFF', { roughness: 0.5 });
    const R = 13;
    const rw = W + 18 + 2 * R + 4;
    const rd = D + 18 + 2 * R + 4;
    for (const [x, z, w, d] of [[0, -rd / 2 + R / 2, rw, R], [0, rd / 2 - R / 2, rw, R], [-rw / 2 + R / 2, 0, R, rd], [rw / 2 - R / 2, 0, R, rd]]) {
      const road = new THREE.Mesh(this.box(w, 0.12, d), roadMat);
      road.position.set(x, 0.06, z);
      this.add(road, { shadow: false });
    }
    const dash = this.box(4, 0.05, 0.45);
    const dashV = this.box(0.45, 0.05, 4);
    const dashes = new THREE.InstancedMesh(dash, lineMat, 400);
    const dashesV = new THREE.InstancedMesh(dashV, lineMat, 400);
    let a = 0; let b = 0;
    const m = new THREE.Matrix4();
    for (let x = -rw / 2 + 8; x < rw / 2 - 8; x += 9) {
      for (const z of [-rd / 2 + R / 2, rd / 2 - R / 2]) { m.makeTranslation(x, 0.16, z); dashes.setMatrixAt(a++, m); }
    }
    for (let z = -rd / 2 + 8; z < rd / 2 - 8; z += 9) {
      for (const x of [-rw / 2 + R / 2, rw / 2 - R / 2]) { m.makeTranslation(x, 0.16, z); dashesV.setMatrixAt(b++, m); }
    }
    dashes.count = a; dashesV.count = b;
    this.world.add(dashes, dashesV);
    // A footpath cross between the blocks.
    const pathMat = this.material(night ? '#5B6372' : '#F6F7F9', { roughness: 0.85 });
    for (const [x, z, w, d] of [[0, 0, W * 0.92, 7], [0, 0, 7, D * 0.92], [-W * 0.38, 0, 5, D * 0.8], [W * 0.3, 0, 5, D * 0.6]]) {
      const p = new THREE.Mesh(this.box(w, 0.1, d), pathMat);
      p.position.set(x, 0.36, z);
      this.add(p, { shadow: false });
    }
  }

  private pick(obj: THREE.Object3D, id: string) {
    obj.traverse((o) => { o.userData.id = id; });
    this.pickables.push(obj);
    this.meshById.set(id, obj);
  }

  private buildOpenSpace(n: CampusNodeDto, L: CampusNodeDto['layout']) {
    const g = new THREE.Group();
    const color = n.kind === 'GROUND' ? '#86C27A' : n.kind === 'COURT' ? '#E07B4F' : '#B8C0CC';
    const slab = new THREE.Mesh(this.box(L.w, 0.4, L.d), this.material(color, { roughness: 0.95 }));
    slab.position.set(L.x, 0.4, L.z);
    g.add(slab);
    const white = this.material('#FFFFFF');
    if (n.kind === 'GROUND') {
      // Running track around the field, a centre line and two goals.
      const shape = new THREE.Shape();
      const rx = L.w * 0.46; const rz = L.d * 0.42;
      shape.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
      const hole = new THREE.Path();
      hole.absellipse(0, 0, rx - 3.2, rz - 3.2, 0, Math.PI * 2, true, 0);
      shape.holes.push(hole);
      const track = new THREE.Mesh(this.geo(new THREE.ShapeGeometry(shape, 64)), this.material('#D9744E', { roughness: 0.95 }));
      track.rotation.x = -Math.PI / 2;
      track.position.set(L.x, 0.62, L.z);
      g.add(track);
      const line = new THREE.Mesh(this.box(0.35, 0.05, rz * 1.6), white);
      line.position.set(L.x, 0.63, L.z);
      g.add(line);
      for (const side of [-1, 1]) {
        const goal = new THREE.Group();
        const post = this.box(0.35, 2.4, 0.35);
        const bar = this.box(0.35, 0.35, 6.5);
        const p1 = new THREE.Mesh(post, white); p1.position.set(0, 1.2, -3.1);
        const p2 = new THREE.Mesh(post, white); p2.position.set(0, 1.2, 3.1);
        const cb = new THREE.Mesh(bar, white); cb.position.set(0, 2.4, 0);
        goal.add(p1, p2, cb);
        goal.position.set(L.x + side * (rx - 6), 0.6, L.z);
        g.add(goal);
      }
    } else if (n.kind === 'COURT') {
      const lines = new THREE.Mesh(this.box(L.w - 2, 0.05, 0.3), white);
      lines.position.set(L.x, 0.62, L.z);
      g.add(lines);
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(this.box(0.3, 3.2, 0.3), this.material('#59606B'));
        pole.position.set(L.x + side * (L.w / 2 - 1.2), 2.2, L.z);
        const board = new THREE.Mesh(this.box(0.2, 1.4, 2.2), white);
        board.position.set(L.x + side * (L.w / 2 - 1.6), 3.6, L.z);
        g.add(pole, board);
      }
    } else if (n.kind === 'PARKING' || n.kind === 'TRANSPORT_BAY') {
      const bays = Math.max(2, Math.floor(L.d / 5.5));
      const stripe = this.box(L.w * 0.5, 0.05, 0.25);
      for (let i = 0; i <= bays; i++) {
        const s = new THREE.Mesh(stripe, white);
        s.position.set(L.x - L.w * 0.15, 0.62, L.z - L.d / 2 + (i * L.d) / bays);
        g.add(s);
      }
      if (n.kind === 'PARKING' && !this.opts.lowPower) this.addParkedCars(L, bays);
    }
    this.add(g, { shadow: false });
    this.pick(slab, n.id);
    this.stateMeshes.set(n.id, slab);
  }

  private addParkedCars(L: CampusNodeDto['layout'], bays: number) {
    const count = Math.min(bays - 1, 8);
    const body = this.box(2.4, 1.1, 4.4);
    const palette = ['#E15554', '#3D7BE0', '#F2F2F2', '#2BA39A', '#E9B44C', '#4E5A6B'];
    for (let i = 0; i < count; i++) {
      const car = new THREE.Group();
      const b = new THREE.Mesh(body, this.material(palette[i % palette.length], { roughness: 0.35, metalness: 0.2 }));
      b.position.y = 0.95;
      const cab = new THREE.Mesh(this.box(2.1, 0.8, 2.3), this.material('#AFC6E6', { roughness: 0.15, metalness: 0.3 }));
      cab.position.set(0, 1.85, -0.2);
      car.add(b, cab);
      car.rotation.y = Math.PI / 2;
      car.position.set(L.x - L.w * 0.15, 0.4, L.z - L.d / 2 + ((i + 0.5) * L.d) / bays);
      this.add(car);
    }
  }

  private buildGate(n: CampusNodeDto, L: CampusNodeDto['layout']) {
    const g = new THREE.Group();
    const stone = this.material('#E8E2D6');
    const accent = this.material('#2F6FE4');
    const h = Math.max(L.h || 4, 4);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(this.box(1.6, h, 1.6), stone);
      pillar.position.set(L.x + side * (L.w / 2), h / 2, L.z);
      g.add(pillar);
    }
    const arch = new THREE.Mesh(this.box(L.w + 1.6, 1.1, 1.8), accent);
    arch.position.set(L.x, h + 0.55, L.z);
    g.add(arch);
    this.add(g);
    this.pick(g, n.id);
  }

  /** A building from the outside: walls, a glazed row per floor, an entrance and a coloured roof. */
  private buildBuilding(n: CampusNodeDto, L: CampusNodeDto['layout'], index: number, ghost: boolean) {
    const g = new THREE.Group();
    const floors = Math.max(1, Math.round((L.h || FLOOR_H) / FLOOR_H));
    const h = floors * FLOOR_H;
    const night = this.opts.night;
    const wall = this.material(night ? '#C9CED8' : '#FAFBFD', ghost ? { transparent: true, opacity: 0.35 } : {});
    const roofColor = ROOF_PALETTE[index % ROOF_PALETTE.length];
    const roof = this.material(roofColor, { roughness: 0.45, ...(ghost ? { transparent: true, opacity: 0.35 } : {}) });
    const trim = this.material(night ? '#9AA3B3' : '#DCE2EA');
    const glass = this.material(night ? '#FFD98A' : '#9CC3F0', {
      roughness: 0.12, metalness: 0.35,
      emissive: new THREE.Color(night ? '#F2B850' : '#000000'), emissiveIntensity: night ? 0.9 : 0,
      ...(ghost ? { transparent: true, opacity: 0.35 } : {}),
    });

    const body = new THREE.Mesh(this.box(L.w, h, L.d), wall);
    body.position.set(L.x, h / 2 + 0.3, L.z);
    g.add(body);
    // Plinth and a band between floors.
    const plinth = new THREE.Mesh(this.box(L.w + 0.8, 0.6, L.d + 0.8), trim);
    plinth.position.set(L.x, 0.6, L.z);
    g.add(plinth);
    for (let f = 1; f < floors; f++) {
      const band = new THREE.Mesh(this.box(L.w + 0.4, 0.35, L.d + 0.4), trim);
      band.position.set(L.x, f * FLOOR_H + 0.3, L.z);
      g.add(band);
    }
    // Window panes on all four sides, one row per floor (instanced per side).
    if (!ghost) {
      const paneW = 2.2; const paneH = 1.8;
      const along = (len: number) => Math.max(1, Math.floor((len - 3) / 3.6));
      const sides: Array<{ len: number; place: (i: number, n: number, f: number) => [number, number, number]; rotY: number }> = [
        { len: L.w, place: (i, nn, f) => [L.x - L.w / 2 + 1.8 + (i + 0.5) * ((L.w - 3.6) / nn), f * FLOOR_H + 2.4, L.z + L.d / 2 + 0.06], rotY: 0 },
        { len: L.w, place: (i, nn, f) => [L.x - L.w / 2 + 1.8 + (i + 0.5) * ((L.w - 3.6) / nn), f * FLOOR_H + 2.4, L.z - L.d / 2 - 0.06], rotY: 0 },
        { len: L.d, place: (i, nn, f) => [L.x + L.w / 2 + 0.06, f * FLOOR_H + 2.4, L.z - L.d / 2 + 1.8 + (i + 0.5) * ((L.d - 3.6) / nn)], rotY: Math.PI / 2 },
        { len: L.d, place: (i, nn, f) => [L.x - L.w / 2 - 0.06, f * FLOOR_H + 2.4, L.z - L.d / 2 + 1.8 + (i + 0.5) * ((L.d - 3.6) / nn)], rotY: Math.PI / 2 },
      ];
      const pane = this.box(paneW, paneH, 0.12);
      const total = sides.reduce((s, side) => s + along(side.len) * floors, 0);
      const panes = new THREE.InstancedMesh(pane, glass, total);
      const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);
      let k = 0;
      for (const side of sides) {
        const nn = along(side.len);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side.rotY);
        for (let f = 0; f < floors; f++) for (let i = 0; i < nn; i++) {
          const [x, y, z] = side.place(i, nn, f);
          mtx.compose(new THREE.Vector3(x, y, z), q, one);
          panes.setMatrixAt(k++, mtx);
        }
      }
      g.add(panes);
      // Entrance: a canopy and a door on the side facing the centre of the campus.
      const facing = L.z > 0 ? -1 : 1;
      const door = new THREE.Mesh(this.box(3.2, 2.8, 0.2), this.material('#33435C', { roughness: 0.3 }));
      door.position.set(L.x, 1.7, L.z + facing * (L.d / 2 + 0.12));
      const canopy = new THREE.Mesh(this.box(6, 0.35, 2.4), roof);
      canopy.position.set(L.x, 3.4, L.z + facing * (L.d / 2 + 1.2));
      g.add(door, canopy);
    }
    // Roof with a parapet and a couple of rooftop units.
    const roofSlab = new THREE.Mesh(this.box(L.w + 0.6, 0.7, L.d + 0.6), roof);
    roofSlab.position.set(L.x, h + 0.65, L.z);
    g.add(roofSlab);
    if (!ghost) {
      const parapet = this.material(night ? '#B7BFCC' : '#FFFFFF');
      for (const [x, z, w, d] of [[L.x, L.z - L.d / 2, L.w + 0.6, 0.5], [L.x, L.z + L.d / 2, L.w + 0.6, 0.5], [L.x - L.w / 2, L.z, 0.5, L.d + 0.6], [L.x + L.w / 2, L.z, 0.5, L.d + 0.6]]) {
        const p = new THREE.Mesh(this.box(w, 0.8, d), parapet);
        p.position.set(x, h + 1.3, z);
        g.add(p);
      }
      const unit = this.box(2.4, 1.2, 2.4);
      for (const off of [-0.25, 0.22]) {
        const u = new THREE.Mesh(unit, this.material('#C7CDD6', { metalness: 0.4, roughness: 0.4 }));
        u.position.set(L.x + off * L.w, h + 1.6, L.z + off * L.d * 0.6);
        g.add(u);
      }
    }
    this.add(g);
    this.pick(g, n.id);
  }

  /** Inside a building: the chosen floor's rooms, furnished and coloured by what is happening, other floors as ghosts. */
  private buildInterior(buildingId: string, floorNo: number | null) {
    const b = this.nodeById.get(buildingId);
    if (!b) return;
    const L = b.layout;
    const floors = [...this.nodeById.values()].filter((n) => n.parentId === buildingId && n.kind === 'FLOOR').sort((a, c) => (a.floorNo ?? 0) - (c.floorNo ?? 0));
    const chosen = floorNo ?? floors[0]?.floorNo ?? 0;
    const y0 = 0.4;
    // Ghost shell so the building is still readable.
    const shell = new THREE.Mesh(this.box(L.w + 1, floors.length * INTERIOR_FLOOR_GAP + 1, L.d + 1), this.material('#BFD3F2', { transparent: true, opacity: 0.08, depthWrite: false }));
    shell.position.set(L.x, (floors.length * INTERIOR_FLOOR_GAP) / 2, L.z);
    this.world.add(shell);

    floors.forEach((f) => {
      const y = y0 + (f.floorNo ?? 0) * INTERIOR_FLOOR_GAP;
      const isOn = (f.floorNo ?? 0) === chosen;
      const slab = new THREE.Mesh(this.box(L.w + 1.4, 0.5, L.d + 1.4), this.material(isOn ? '#F4F6FA' : '#DDE5F2', isOn ? {} : { transparent: true, opacity: 0.3 }, isOn));
      slab.position.set(L.x, y, L.z);
      this.add(slab, { shadow: false });
      slab.userData.id = f.id;
      this.pickables.push(slab);
      if (!isOn) return;
      const rooms = [...this.nodeById.values()].filter((n) => n.parentId === f.id);
      const wallMat = this.material('#FFFFFF');
      for (const r of rooms) {
        const RL = r.layout;
        const w = Math.max(RL.w, 2); const d = Math.max(RL.d, 2);
        // Floor tile in the state colour, low walls so the inside shows.
        const tile = new THREE.Mesh(this.box(w - 0.4, 0.12, d - 0.4), this.material(STATE_COLORS[stateOf(r)] ?? STATE_COLORS.OTHER, { roughness: 0.8 }, false));
        tile.position.set(RL.x, y + 0.32, RL.z);
        this.add(tile, { shadow: false });
        this.pick(tile, r.id);
        this.stateMeshes.set(r.id, tile);
        const wh = 1.6;
        for (const [x, z, ww, dd] of [[RL.x, RL.z - d / 2, w, 0.3], [RL.x, RL.z + d / 2, w, 0.3], [RL.x - w / 2, RL.z, 0.3, d], [RL.x + w / 2, RL.z, 0.3, d]]) {
          const wallM = new THREE.Mesh(this.box(ww, wh, dd), wallMat);
          wallM.position.set(x, y + 0.25 + wh / 2, z);
          this.add(wallM);
        }
        if (!this.opts.lowPower) this.furnish(r, RL, y + 0.38, w, d);
      }
    });
  }

  /** Illustrative furniture by kind of room: rows of desks and chairs, lab benches, shelves, tables. */
  private furnish(r: CampusNodeDto, RL: CampusNodeDto['layout'], y: number, w: number, d: number) {
    const wood = this.material('#C9A27A', { roughness: 0.7 });
    const seat = this.material('#3F6FD8', { roughness: 0.6 });
    const dark = this.material('#2B3240', { roughness: 0.5 });
    const place = (geoW: number, geoH: number, geoD: number, mat: THREE.Material, spots: Array<[number, number, number?]>) => {
      if (!spots.length) return;
      const inst = new THREE.InstancedMesh(this.box(geoW, geoH, geoD), mat, spots.length);
      const m = new THREE.Matrix4();
      spots.forEach(([x, z, rot = 0], i) => { m.makeRotationY(rot); m.setPosition(x, y + geoH / 2, z); inst.setMatrixAt(i, m); });
      inst.castShadow = true;
      this.world.add(inst);
    };
    if (['CLASSROOM', 'LECTURE_HALL'].includes(r.kind)) {
      const cols = Math.max(2, Math.min(5, Math.floor((w - 3) / 2.6)));
      const rows = Math.max(2, Math.min(5, Math.floor((d - 5) / 2.4)));
      const desks: Array<[number, number]> = []; const chairs: Array<[number, number]> = [];
      for (let rI = 0; rI < rows; rI++) for (let c = 0; c < cols; c++) {
        const x = RL.x - (w - 3) / 2 + (c + 0.5) * ((w - 3) / cols);
        const z = RL.z - d / 2 + 4 + rI * ((d - 5) / rows);
        desks.push([x, z]); chairs.push([x, z + 0.95]);
      }
      place(1.6, 0.8, 0.8, wood, desks);
      place(0.8, 0.9, 0.7, seat, chairs);
      place(Math.min(w - 2, 6), 1.4, 0.15, dark, [[RL.x, RL.z - d / 2 + 0.6]]); // board
      place(1.8, 0.85, 0.9, wood, [[RL.x + w / 4, RL.z - d / 2 + 2]]); // teacher's desk
    } else if (r.kind === 'LAB') {
      const benches: Array<[number, number]> = [];
      for (let i = 0; i < 3; i++) benches.push([RL.x, RL.z - d / 2 + 3 + i * ((d - 5) / 2.4)]);
      place(Math.max(2, w - 4), 0.95, 1.4, this.material('#E9EEF5', { roughness: 0.3 }), benches);
      place(Math.max(2, w - 4), 0.1, 1.5, dark, benches.map(([x, z]) => [x, z]));
    } else if (r.kind === 'LIBRARY') {
      const shelves: Array<[number, number]> = [];
      for (let i = 0; i < Math.max(2, Math.floor((w - 4) / 3)); i++) shelves.push([RL.x - w / 2 + 2.5 + i * 3, RL.z - d / 4]);
      place(0.7, 2.2, Math.max(2, d / 3), this.material('#8C5A3C'), shelves.map(([x, z]) => [x, z]));
      place(4, 0.8, 2, wood, [[RL.x, RL.z + d / 4]]);
    } else if (['STAFF_ROOM', 'OFFICE', 'CANTEEN', 'AUDITORIUM'].includes(r.kind)) {
      const tables: Array<[number, number]> = [];
      const n = r.kind === 'CANTEEN' ? 6 : r.kind === 'AUDITORIUM' ? 0 : 2;
      for (let i = 0; i < n; i++) tables.push([RL.x - w / 3 + (i % 3) * (w / 3), RL.z - d / 4 + Math.floor(i / 3) * (d / 2.5)]);
      place(3, 0.8, 1.6, wood, tables);
      if (r.kind === 'AUDITORIUM') {
        const seats: Array<[number, number]> = [];
        for (let rI = 0; rI < 6; rI++) for (let c = 0; c < 8; c++) seats.push([RL.x - w / 2 + 3 + c * ((w - 6) / 7), RL.z - d / 2 + 6 + rI * ((d - 9) / 6)]);
        place(1.1, 0.9, 0.9, this.material('#C8424F'), seats);
        place(w - 4, 0.9, 3, wood, [[RL.x, RL.z - d / 2 + 2]]); // stage
      }
    }
  }

  /** Where students sit (or stand, at a lab bench) in a room. Matches the furniture laid out above. */
  private seatSpots(r: CampusNodeDto, RL: CampusNodeDto['layout'], w: number, d: number): Array<[number, number]> {
    const spots: Array<[number, number]> = [];
    if (['CLASSROOM', 'LECTURE_HALL'].includes(r.kind)) {
      const cols = Math.max(2, Math.min(5, Math.floor((w - 3) / 2.6)));
      const rows = Math.max(2, Math.min(5, Math.floor((d - 5) / 2.4)));
      for (let rI = 0; rI < rows; rI++) for (let c = 0; c < cols; c++) {
        spots.push([RL.x - (w - 3) / 2 + (c + 0.5) * ((w - 3) / cols), RL.z - d / 2 + 4 + rI * ((d - 5) / rows) + 0.95]);
      }
    } else if (r.kind === 'LAB') {
      const len = Math.max(2, w - 4);
      for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) spots.push([RL.x - len / 2 + (k + 0.5) * (len / 4), RL.z - d / 2 + 3 + i * ((d - 5) / 2.4) + 1.3]);
    }
    return spots;
  }

  /**
   * Figures in the rooms of the open floor. The share of seats filled follows
   * the class's attendance register (present out of enrolled), so a room looks
   * as full as the register says; a teacher stands at the board while a lesson
   * is timetabled, and walks the aisle during an exam. They are figures, not
   * people: nobody is located or tracked, and a class whose register has not
   * been taken shows empty seats rather than a guess.
   */
  private refreshOccupants() {
    if (this.occupants) { this.world.remove(this.occupants); this.occupants = null; }
    for (const d of this.occDisposables) d.dispose();
    this.occDisposables = []; this.teachers = []; this.seated = null;
    if (this.level.kind !== 'building' || this.opts.lowPower) return;
    const lvl = this.level;
    const nodes = [...this.nodeById.values()];
    const floors = nodes.filter((n) => n.parentId === lvl.buildingId && n.kind === 'FLOOR').sort((a, c) => (a.floorNo ?? 0) - (c.floorNo ?? 0));
    const floor = floors.find((f) => (f.floorNo ?? 0) === (lvl.floorNo ?? floors[0]?.floorNo ?? 0));
    if (!floor) return;
    const own = <T extends { dispose: () => void }>(x: T) => { this.occDisposables.push(x); return x; };
    const y = 0.4 + (floor.floorNo ?? 0) * INTERIOR_FLOOR_GAP + 0.38;
    const group = new THREE.Group();
    const skin = own(new THREE.MeshStandardMaterial({ color: '#F0CDAE', roughness: 0.7 }));
    const teacherMat = own(new THREE.MeshStandardMaterial({ color: '#D2455E', roughness: 0.6 }));
    const tBody = own(new THREE.CapsuleGeometry(0.34, 1.0, 4, 10));
    const tHead = own(new THREE.SphereGeometry(0.32, 12, 10));
    const sit: Array<[number, number]> = [];
    for (const room of nodes.filter((n) => n.parentId === floor.id)) {
      const RL = room.layout;
      const w = Math.max(RL.w, 2); const d = Math.max(RL.d, 2);
      const state = stateOf(room);
      const live = room.live;
      const spots = this.seatSpots(room, RL, w, d);
      if (spots.length && live && live.present !== null && live.enrolled > 0 && (room.lesson || live.homeRoom || state === 'EXAM')) {
        const filled = Math.min(spots.length, Math.max(live.present > 0 ? 1 : 0, Math.round(spots.length * (live.present / live.enrolled))));
        // Empty seats are spread through the room rather than bunched at the back.
        const gaps = spots.length - filled;
        const empty = new Set<number>();
        for (let k = 0; k < gaps; k++) empty.add(Math.floor(((k + 0.5) * spots.length) / gaps));
        spots.forEach((spot, i) => { if (!empty.has(i)) sit.push(spot); });
      }
      if (room.lesson || state === 'EXAM') {
        const exam = state === 'EXAM';
        const g = new THREE.Group();
        const body = new THREE.Mesh(tBody, teacherMat); body.position.y = 1.05;
        const head = new THREE.Mesh(tHead, skin); head.position.y = 2.1;
        g.add(body, head);
        const x = exam ? RL.x - w / 2 + 0.9 : RL.x;
        const z = RL.z - d / 2 + 1.6;
        g.position.set(x, y, z);
        g.traverse((o) => { o.castShadow = true; });
        group.add(g);
        this.teachers.push({ obj: g, x, z, span: exam ? 0 : Math.max(0.5, Math.min(w - 3, 5) / 2), depth: exam ? Math.max(0, d - 4) : 0, phase: this.teachers.length * 1.7 });
      }
    }
    if (sit.length) {
      const body = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.6, 0.85, 0.5)), own(new THREE.MeshStandardMaterial({ color: '#F6F8FC', roughness: 0.7 })), sit.length);
      const head = new THREE.InstancedMesh(own(new THREE.SphereGeometry(0.28, 10, 8)), skin, sit.length);
      const m = new THREE.Matrix4();
      const base = new Float32Array(sit.length * 2);
      sit.forEach(([x, z], i) => {
        m.makeTranslation(x, y + 1.3, z); body.setMatrixAt(i, m);
        m.makeTranslation(x, y + 2.0, z - 0.05); head.setMatrixAt(i, m);
        base[i * 2] = x; base[i * 2 + 1] = z;
      });
      body.castShadow = true;
      group.add(body, head);
      this.seated = { head, base, count: sit.length, y: y + 2.0 };
    }
    this.world.add(group);
    this.occupants = group;
  }

  /** Marks the buildings, rooms and open spaces a department works in with a soft beam, so it can be found at a glance. */
  spotlight(ids: string[]) {
    this.spotIds = ids;
    this.refreshBeams();
  }

  private refreshBeams() {
    if (this.beams) { this.world.remove(this.beams); this.beams = null; }
    for (const d of this.beamDisposables) d.dispose();
    this.beamDisposables = [];
    if (!this.spotIds.length) return;
    const own = <T extends { dispose: () => void }>(x: T) => { this.beamDisposables.push(x); return x; };
    const beamMat = own(new THREE.MeshBasicMaterial({ color: 0xf2b33d, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    const ringMat = own(new THREE.MeshBasicMaterial({ color: 0xf2b33d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    const group = new THREE.Group();
    const seen = new Set<string>();
    for (const id of this.spotIds) {
      // A room is shown by its building from outside, and by itself when its floor is open.
      let target = this.nodeById.get(id);
      if (target && !this.meshById.has(target.id)) {
        const floor = target.parentId ? this.nodeById.get(target.parentId) : undefined;
        target = floor?.kind === 'FLOOR' && floor.parentId ? this.nodeById.get(floor.parentId) : undefined;
      }
      const obj = target ? this.meshById.get(target.id) : undefined;
      if (!target || !obj || seen.has(target.id)) continue;
      seen.add(target.id);
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.z) * 0.6 + 1.5;
      const h = this.level.kind === 'campus' ? 64 : 9;
      const beam = new THREE.Mesh(own(new THREE.CylinderGeometry(radius, radius, h, 40, 1, true)), beamMat);
      beam.position.set(c.x, box.min.y + h / 2, c.z);
      const ring = new THREE.Mesh(own(new THREE.RingGeometry(radius, radius + 0.9, 48)), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c.x, box.min.y + 0.5, c.z);
      ring.userData.pulse = true;
      group.add(beam, ring);
    }
    this.world.add(group);
    this.beams = group;
  }

  private addTrees(W: number, D: number) {
    const count = this.opts.lowPower ? 50 : 140;
    const trunkGeo = this.geo(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 6));
    const crownGeo = this.geo(new THREE.IcosahedronGeometry(2.3, 0));
    const coneGeo = this.geo(new THREE.ConeGeometry(2, 4.6, 7));
    const trunks = new THREE.InstancedMesh(trunkGeo, this.material('#8A6A4B'), count);
    const crowns = new THREE.InstancedMesh(crownGeo, this.material(this.opts.night ? '#3E5C42' : '#5DAF6B', { roughness: 0.8, flatShading: true }), Math.ceil(count / 2));
    const cones = new THREE.InstancedMesh(coneGeo, this.material(this.opts.night ? '#34503A' : '#3E9461', { roughness: 0.8, flatShading: true }), Math.ceil(count / 2));
    crowns.castShadow = cones.castShadow = !this.opts.lowPower;
    const mtx = new THREE.Matrix4();
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    let ci = 0; let co = 0;
    for (let i = 0; i < count; i++) {
      // Inside the kerb, along its edge, so trees never sit in a building or on the road.
      const side = i % 4;
      const t = rnd() - 0.5;
      const inset = 3 + rnd() * 5;
      const x = side < 2 ? t * (W + 4) : (side === 2 ? -1 : 1) * (W / 2 + 9 - inset);
      const z = side >= 2 ? t * (D + 4) : (side === 0 ? -1 : 1) * (D / 2 + 9 - inset);
      const s = 0.75 + rnd() * 0.55;
      mtx.compose(new THREE.Vector3(x, 1.5 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, mtx);
      if (i % 2 === 0) {
        mtx.compose(new THREE.Vector3(x, 4 * s, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 3, 0)), new THREE.Vector3(s, s * 1.15, s));
        crowns.setMatrixAt(ci++, mtx);
      } else {
        mtx.compose(new THREE.Vector3(x, 4.6 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
        cones.setMatrixAt(co++, mtx);
      }
    }
    crowns.count = ci; cones.count = co;
    this.world.add(trunks, crowns, cones);
  }

  // ── LIFE (anonymous, illustrative) ──────────────────────────────────────

  private addLife(W: number, D: number) {
    if (this.opts.reducedMotion) return;
    // People walk the footpaths in lanes, so they pass rather than overlap.
    const count = this.level.kind === 'building' ? 0 : this.opts.lowPower ? 30 : 90;
    if (count) {
      const bodyGeo = this.geo(new THREE.CapsuleGeometry(0.42, 1.0, 3, 8));
      const headGeo = this.geo(new THREE.SphereGeometry(0.42, 10, 8));
      const body = new THREE.InstancedMesh(bodyGeo, this.material('#FFFFFF'), count);
      const head = new THREE.InstancedMesh(headGeo, this.material('#E8C4A0', { roughness: 0.6 }), count);
      const palette = ['#2F6FE4', '#2BA39A', '#F2B33D', '#E15554', '#5A67D8', '#FFFFFF'].map((c) => new THREE.Color(c));
      for (let i = 0; i < count; i++) body.setColorAt(i, palette[i % palette.length]);
      body.castShadow = !this.opts.lowPower;
      const paths: THREE.Vector3[][] = [
        [new THREE.Vector3(-W * 0.44, 0, 0), new THREE.Vector3(W * 0.44, 0, 0)],
        [new THREE.Vector3(0, 0, -D * 0.44), new THREE.Vector3(0, 0, D * 0.44)],
        [new THREE.Vector3(-W * 0.38, 0, -D * 0.38), new THREE.Vector3(-W * 0.38, 0, D * 0.38)],
        [new THREE.Vector3(W * 0.3, 0, -D * 0.28), new THREE.Vector3(W * 0.3, 0, D * 0.28)],
      ];
      const t = new Float32Array(count); const speed = new Float32Array(count); const lane = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        t[i] = (i * 0.137) % 1;
        // Half walk each way; direction is the sign of the speed.
        speed[i] = (0.008 + (i % 7) * 0.0016) * (i % 2 ? 1 : -1);
        lane[i] = ((i % 4) - 1.5) * 0.9;
      }
      this.people = { body, head, paths, t, speed, lane, count };
      this.scene.add(body, head);
    }

    // Traffic on the road loop: a few cars, and the school bus calling at its bay.
    const R = 13;
    const rw = W + 18 + 2 * R + 4; const rd = D + 18 + 2 * R + 4;
    const lane = R / 2 - 3;
    const loop = new THREE.CurvePath<THREE.Vector3>();
    const c = [
      new THREE.Vector3(-rw / 2 + lane, 0.2, -rd / 2 + lane), new THREE.Vector3(rw / 2 - lane, 0.2, -rd / 2 + lane),
      new THREE.Vector3(rw / 2 - lane, 0.2, rd / 2 - lane), new THREE.Vector3(-rw / 2 + lane, 0.2, rd / 2 - lane),
    ];
    for (let i = 0; i < 4; i++) loop.add(new THREE.LineCurve3(c[i], c[(i + 1) % 4]));
    if (!this.opts.lowPower) {
      const carCount = 6;
      const carGeo = this.box(2.4, 1.6, 4.6);
      const cars = new THREE.InstancedMesh(carGeo, this.material('#FFFFFF', { roughness: 0.35, metalness: 0.2 }), carCount);
      ['#E15554', '#3D7BE0', '#F2F2F2', '#2BA39A', '#E9B44C', '#4E5A6B'].forEach((col, i) => cars.setColorAt(i, new THREE.Color(col)));
      cars.castShadow = true;
      const ct = new Float32Array(carCount);
      for (let i = 0; i < carCount; i++) ct[i] = i / carCount;
      this.cars = { mesh: cars, t: ct, path: loop, count: carCount };
      this.scene.add(cars);
    }
    const bay = [...this.nodeById.values()].find((n) => n.kind === 'TRANSPORT_BAY');
    if (bay && this.level.kind === 'campus') {
      const g = new THREE.Group();
      const yellow = this.material('#F4B740', { roughness: 0.4 });
      const body = new THREE.Mesh(this.box(3.2, 3, 11), yellow);
      body.position.y = 2.2;
      const glass = this.material('#2B3240', { roughness: 0.2, metalness: 0.3 });
      const windows = new THREE.Mesh(this.box(3.25, 1, 9.2), glass);
      windows.position.set(0, 2.9, -0.4);
      const windscreen = new THREE.Mesh(this.box(2.8, 1.2, 0.1), glass);
      windscreen.position.set(0, 2.8, 5.52);
      const stripe = new THREE.Mesh(this.box(3.26, 0.25, 11.05), this.material('#2B3240'));
      stripe.position.y = 1.7;
      g.add(body, windows, windscreen, stripe);
      const wheelGeo = this.geo(new THREE.CylinderGeometry(0.75, 0.75, 0.6, 14));
      const tyre = this.material('#22262E');
      for (const [x, z] of [[-1.6, -3.4], [1.6, -3.4], [-1.6, 3.4], [1.6, 3.4]]) {
        const w = new THREE.Mesh(wheelGeo, tyre);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.75, z);
        g.add(w);
      }
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = !this.opts.lowPower; });
      // The bus leaves the road at the bay, stops, and rejoins the loop.
      const L = bay.layout;
      const path = new THREE.CurvePath<THREE.Vector3>();
      const enter = new THREE.Vector3(-rw / 2 + lane, 0.2, L.z - L.d * 0.45);
      const stop = new THREE.Vector3(L.x + L.w * 0.2, 0.6, L.z);
      const leave = new THREE.Vector3(-rw / 2 + lane, 0.2, L.z + L.d * 0.45);
      path.add(new THREE.LineCurve3(new THREE.Vector3(-rw / 2 + lane, 0.2, -rd / 2 + lane), enter));
      path.add(new THREE.QuadraticBezierCurve3(enter, new THREE.Vector3(L.x + L.w * 0.2, 0.6, L.z - L.d * 0.45), stop));
      path.add(new THREE.QuadraticBezierCurve3(stop, new THREE.Vector3(L.x + L.w * 0.2, 0.6, L.z + L.d * 0.45), leave));
      path.add(new THREE.LineCurve3(leave, new THREE.Vector3(-rw / 2 + lane, 0.2, rd / 2 - lane)));
      path.add(new THREE.LineCurve3(new THREE.Vector3(-rw / 2 + lane, 0.2, rd / 2 - lane), new THREE.Vector3(rw / 2 - lane, 0.2, rd / 2 - lane)));
      path.add(new THREE.LineCurve3(new THREE.Vector3(rw / 2 - lane, 0.2, rd / 2 - lane), new THREE.Vector3(rw / 2 - lane, 0.2, -rd / 2 + lane)));
      path.add(new THREE.LineCurve3(new THREE.Vector3(rw / 2 - lane, 0.2, -rd / 2 + lane), new THREE.Vector3(-rw / 2 + lane, 0.2, -rd / 2 + lane)));
      const lengths = path.getCurveLengths();
      const stopAt = lengths[1] / path.getLength();
      this.bus = { mesh: g, path, t: 0, stopAt, wait: 0 };
      this.scene.add(g);
    }
  }

  private stepLife(dt: number) {
    const m = new THREE.Matrix4();
    if (this.people) {
      const { body, head, paths, t, speed, lane, count } = this.people;
      const p = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        t[i] = (t[i] + speed[i] * dt * 6 + 1) % 1;
        const path = paths[i % paths.length];
        p.lerpVectors(path[0], path[1], t[i]);
        // Walkers keep to the side of their direction of travel.
        const side = lane[i] + (speed[i] > 0 ? 1.4 : -1.4);
        if (Math.abs(path[0].x - path[1].x) > 1) p.z += side; else p.x += side;
        const bob = Math.abs(Math.sin((this.elapsed * 9 + i) * 1.3)) * 0.12;
        m.makeTranslation(p.x, 1.25 + bob, p.z);
        body.setMatrixAt(i, m);
        m.makeTranslation(p.x, 2.35 + bob, p.z);
        head.setMatrixAt(i, m);
      }
      body.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
    }
    if (this.cars) {
      const { mesh, t, path, count } = this.cars;
      const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1); const fwd = new THREE.Vector3(0, 0, 1);
      for (let i = 0; i < count; i++) {
        t[i] = (t[i] + dt * 0.018) % 1;
        const pos = path.getPointAt(t[i]);
        const tan = path.getTangentAt(t[i]);
        q.setFromUnitVectors(fwd, tan.setY(0).normalize());
        m.compose(pos.setY(1.0), q, one);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.bus) {
      const b = this.bus;
      if (b.wait > 0) b.wait -= dt;
      else {
        const before = b.t;
        // Slow on the approach and the pull-out, normal speed on the road.
        const near = Math.abs(b.t - b.stopAt);
        b.t = (b.t + (near < 0.04 ? 0.006 : 0.016) * dt) % 1;
        if (before < b.stopAt && b.t >= b.stopAt) b.wait = 4; // a few seconds at the stop
      }
      const pos = b.path.getPointAt(b.t);
      const ahead = b.path.getPointAt((b.t + 0.004) % 1);
      b.mesh.position.copy(pos);
      b.mesh.lookAt(ahead.x, pos.y, ahead.z);
    }
    for (const pin of this.pins) pin.obj.position.y = pin.baseY + Math.sin(this.elapsed * 2.2 + pin.phase) * 0.6;
    if (this.seated) {
      // A small nod, as if writing.
      const { head, base, count, y } = this.seated;
      for (let i = 0; i < count; i++) {
        m.makeTranslation(base[i * 2], y + Math.sin(this.elapsed * 1.6 + i * 2.1) * 0.05, base[i * 2 + 1] - 0.05);
        head.setMatrixAt(i, m);
      }
      head.instanceMatrix.needsUpdate = true;
    }
    for (const t of this.teachers) {
      // A teacher walks along the board; an invigilator walks the side aisle.
      if (t.depth) t.obj.position.z = t.z + ((Math.sin(this.elapsed * 0.35 + t.phase) + 1) / 2) * t.depth;
      else t.obj.position.x = t.x + Math.sin(this.elapsed * 0.6 + t.phase) * t.span;
    }
    if (this.beams) for (const o of this.beams.children) if (o.userData.pulse) o.scale.setScalar(1 + Math.sin(this.elapsed * 2.4) * 0.05);
  }

  // ── PINS (what is happening, from the records) ──────────────────────────

  private pinMesh(color: string) {
    const g = new THREE.Group();
    const mat = this.material(color, { roughness: 0.35, emissive: new THREE.Color(color), emissiveIntensity: 0.25 });
    const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1.5, 18, 14)), mat);
    head.position.y = 3.6;
    const tip = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.15, 2.6, 18)), mat);
    tip.rotation.x = Math.PI;
    tip.position.y = 1.9;
    const dot = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.6, 12, 10)), this.material('#FFFFFF'));
    dot.position.set(0, 3.6, 1.15);
    g.add(head, tip, dot);
    return g;
  }

  /** The state of the rooms in a building, as the most notable one. */
  private buildingState(b: CampusNodeDto): string | null {
    const floors = new Set([...this.nodeById.values()].filter((n) => n.parentId === b.id).map((n) => n.id));
    const rooms = [...this.nodeById.values()].filter((n) => n.parentId && floors.has(n.parentId));
    const states = rooms.map(stateOf);
    for (const s of ['UNDER_MAINTENANCE', 'EXAM', 'EVENT', 'BOOKED', 'SCHEDULED_CLASS']) if (states.includes(s)) return s;
    return null;
  }

  private refreshPins() {
    for (const p of this.pins) this.world.remove(p.obj);
    this.pins = [];
    const nodes = [...this.nodeById.values()];
    const targets: Array<{ x: number; y: number; z: number; state: string }> = [];
    if (this.level.kind === 'campus') {
      for (const b of nodes.filter((n) => n.kind === 'BUILDING')) {
        const s = this.buildingState(b);
        if (s && s !== 'SCHEDULED_CLASS') targets.push({ x: b.layout.x, z: b.layout.z, y: Math.max(1, Math.round((b.layout.h || 4) / FLOOR_H)) * FLOOR_H + 2.5, state: s });
      }
      for (const g of nodes.filter((n) => GROUND_KINDS.has(n.kind))) {
        const s = stateOf(g);
        if (['EVENT', 'BOOKED', 'UNDER_MAINTENANCE'].includes(s)) targets.push({ x: g.layout.x, z: g.layout.z, y: 1.5, state: s });
      }
    } else {
      const lvl = this.level;
      const floor = nodes.find((n) => n.parentId === lvl.buildingId && n.kind === 'FLOOR' && (n.floorNo ?? 0) === (lvl.floorNo ?? 0));
      const y = 0.4 + (floor?.floorNo ?? 0) * INTERIOR_FLOOR_GAP + 3.8;
      for (const r of nodes.filter((n) => floor && n.parentId === floor.id)) {
        const s = stateOf(r);
        if (['EXAM', 'EVENT', 'BOOKED', 'UNDER_MAINTENANCE', 'SCHEDULED_CLASS'].includes(s)) targets.push({ x: r.layout.x, z: r.layout.z, y, state: s });
      }
    }
    targets.forEach((t, i) => {
      const pin = this.pinMesh(STATE_COLORS[t.state]);
      pin.position.set(t.x, t.y, t.z);
      this.world.add(pin);
      this.pins.push({ obj: pin, baseY: t.y, phase: i * 0.7 });
    });
  }

  /** Recolours rooms and moves pins for a refresh that changed only what is happening. */
  private refreshStates() {
    for (const [id, mesh] of this.stateMeshes) {
      const n = this.nodeById.get(id);
      // Grounds keep their own colour; rooms show what is happening in them.
      if (!n || GROUND_KINDS.has(n.kind)) continue;
      (mesh.material as THREE.MeshStandardMaterial).color?.set(STATE_COLORS[stateOf(n)] ?? STATE_COLORS.OTHER);
    }
    this.refreshPins();
    this.refreshOccupants();
  }

  // ── INTERACTION ─────────────────────────────────────────────────────────

  private downAt: { x: number; y: number } | null = null;
  private onPointerDown = (e: PointerEvent) => { this.downAt = { x: e.clientX, y: e.clientY }; };
  private hitAt(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return (this.raycaster.intersectObjects(this.pickables, true)[0]?.object.userData.id as string) ?? null;
  }
  private onPointerUp = (e: PointerEvent) => {
    if (!this.downAt || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 6) return; // a drag pans; only a tap selects
    this.opts.onSelect(this.hitAt(e));
  };
  private lastMove = 0;
  private onPointerMove = (e: PointerEvent) => {
    if (e.buttons || performance.now() - this.lastMove < 60) return;
    this.lastMove = performance.now();
    const id = this.hitAt(e);
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.opts.onHover?.(id);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') this.zoom(0.8);
    else if (e.key === '-') this.zoom(1.25);
    else if (e.key.toLowerCase() === 'h') this.home();
  };

  zoom(factor: number) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(dir.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(this.controls.target.clone(), this.controls.target.clone().add(dir.setLength(len)));
  }

  rotate(angle: number) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.flyTo(this.controls.target.clone(), this.controls.target.clone().add(dir));
  }

  home() {
    this.flyTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(170, 175, 215));
  }

  private flyTo(target: THREE.Vector3, position: THREE.Vector3) {
    if (this.opts.reducedMotion) {
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      return;
    }
    this.glide = { fromPos: this.camera.position.clone(), toPos: position, fromTarget: this.controls.target.clone(), toTarget: target, t: 0 };
  }

  setLevel(level: Level) {
    this.level = level;
    this.rebuild();
    if (level.kind === 'campus') this.home();
    else {
      const b = this.nodeById.get(level.buildingId);
      if (b) {
        const y = 0.4 + (level.floorNo ?? 0) * INTERIOR_FLOOR_GAP;
        const span = Math.max(b.layout.w, b.layout.d);
        this.flyTo(new THREE.Vector3(b.layout.x, y, b.layout.z), new THREE.Vector3(b.layout.x + span * 0.55, y + span * 0.75, b.layout.z + span * 0.85));
      }
    }
  }

  highlight(id: string | null) {
    this.selectedId = id;
    if (this.outline) { this.scene.remove(this.outline); this.outline.geometry.dispose(); (this.outline.material as THREE.Material).dispose(); this.outline = null; }
    const obj = id ? this.meshById.get(id) : null;
    if (!obj) { this.ring.visible = false; return; }
    const box = new THREE.Box3().setFromObject(obj);
    if (this.level.kind === 'building') {
      this.ring.visible = false;
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.6, 2.4, size.z + 0.6));
      this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2f6fe4 }));
      this.outline.position.set(c.x, box.min.y + 1.2, c.z);
      this.scene.add(this.outline);
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.62 + 1.8;
    this.ring.scale.set(r, r, r);
    this.ring.userData.base = r;
    this.ring.position.set(c.x, box.min.y + 0.45, c.z);
    this.ring.visible = true;
  }

  focus(id: string) {
    const obj = this.meshById.get(id);
    if (!obj) return;
    const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(this.level.kind === 'campus' ? 120 : 78);
    this.flyTo(c, c.clone().add(offset));
  }

  /** Screen positions of named objects, for the DOM labels (only a handful are labelled). */
  project(ids: string[]): Array<{ id: string; x: number; y: number; visible: boolean }> {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return ids.map((id) => {
      const obj = this.meshById.get(id);
      if (!obj) return { id, x: 0, y: 0, visible: false };
      const box = new THREE.Box3().setFromObject(obj);
      const p = box.getCenter(new THREE.Vector3());
      p.y = box.max.y + 1.8;
      p.project(this.camera);
      return { id, x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, visible: p.z < 1 && p.x > -1.1 && p.x < 1.1 && p.y > -1.1 && p.y < 1.1 };
    });
  }

  // ── EXTRAS ──────────────────────────────────────────────────────────────

  applyLighting(night: boolean) {
    this.opts.night = night;
    this.scene.background = new THREE.Color(night ? '#1B2130' : '#EEF2F7');
    this.scene.fog = new THREE.Fog(night ? 0x1b2130 : 0xeef2f7, 420, 1000);
    this.hemi.intensity = night ? 0.35 : 1.05;
    this.sun.intensity = night ? 0.35 : 2.1;
    this.sun.color.set(night ? '#9FB4D9' : '#FFFFFF');
    this.renderer.toneMappingExposure = night ? 0.9 : 1.05;
    if (this.nodeById.size) this.rebuild();
  }

  setQuality(lowPower: boolean) {
    this.opts.lowPower = lowPower;
    this.renderer.shadowMap.enabled = !lowPower;
    this.sun.castShadow = !lowPower;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1 : 1.75));
    this.rebuild();
  }

  setMotion(reducedMotion: boolean) {
    this.opts.reducedMotion = reducedMotion;
    this.controls.enableDamping = !reducedMotion;
    this.rebuild();
  }

  /** The container changed size without the window doing so (full-page mode). */
  resize() { this.onResize(); }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;
    if (this.glide) {
      this.glide.t = Math.min(1, this.glide.t + dt * 1.5);
      const e = 1 - (1 - this.glide.t) ** 3;
      this.camera.position.lerpVectors(this.glide.fromPos, this.glide.toPos, e);
      this.controls.target.lerpVectors(this.glide.fromTarget, this.glide.toTarget, e);
      if (this.glide.t >= 1) this.glide = null;
    }
    if (!this.opts.reducedMotion) {
      this.stepLife(dt);
      if (this.ring.visible) {
        this.ring.rotation.z += dt * 0.8;
        this.ring.scale.setScalar((this.ring.userData.base ?? 1) * (1 + Math.sin(this.elapsed * 3) * 0.04));
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames += 1;
    const now = performance.now();
    if (now - this.fpsWindowStart > 1000) { this.fps = Math.round((this.frames * 1000) / (now - this.fpsWindowStart)); this.frames = 0; this.fpsWindowStart = now; }
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('keydown', this.onKey);
    this.controls.dispose();
    this.highlight(null);
    this.clearWorld();
    for (const d of [...this.disposables, ...this.occDisposables, ...this.beamDisposables]) d.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}
