/**
 * The campus world renderer (WORLD → LIFE → INTERACTION, following the World
 * Prompt Pack's structure; see docs/erp-operations/REFERENCE-ANALYSIS.md).
 *
 * Plain Three.js in a class so React only mounts, feeds and disposes it.
 * Everything drawn comes from the facility records the API sent for this
 * viewer — restricted spaces are already removed or masked server-side.
 * Movement of people and the bus is ANONYMOUS and ILLUSTRATIVE: it never
 * represents a tracked person, and the UI says so.
 *
 * Performance: shared geometries and materials, instanced trees and people,
 * shadows and agent count reduced in low-power mode, pixel ratio capped, the
 * loop paused when the tab is hidden, and full disposal on unmount.
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
  FREE: '#9CC9A4',
  SCHEDULED_CLASS: '#6F96C9',
  BOOKED: '#9A86C9',
  EVENT: '#E2B04C',
  UNDER_MAINTENANCE: '#E39A55',
  CLOSED: '#A9A39A',
  RESTRICTED: '#5C5650',
  OTHER: '#D9CDB4',
};

export function stateOf(n: CampusNodeDto): string {
  if (n.restricted && n.name === 'Restricted area') return 'RESTRICTED';
  if (n.status === 'UNDER_MAINTENANCE') return 'UNDER_MAINTENANCE';
  if (n.status === 'CLOSED') return 'CLOSED';
  const s = n.now?.[0]?.type;
  if (s === 'SCHEDULED_CLASS' || s === 'BOOKED' || s === 'EVENT') return s;
  if (n.now) return 'FREE';
  return 'OTHER';
}

const GROUND_KINDS = new Set(['GROUND', 'COURT', 'PARKING', 'TRANSPORT_BAY']);

export class CampusScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pickables: THREE.Object3D[] = [];
  private nodeById = new Map<string, CampusNodeDto>();
  private meshById = new Map<string, THREE.Mesh>();
  private world = new THREE.Group();
  private ring: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private raf = 0;
  private clock = new THREE.Clock();
  private agents: { mesh: THREE.InstancedMesh; paths: THREE.Vector3[][]; t: Float32Array; speed: Float32Array; count: number } | null = null;
  private bus: { mesh: THREE.Group; path: THREE.CatmullRomCurve3; t: number } | null = null;
  private glide: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  private disposables: Array<{ dispose: () => void }> = [];
  /** Geometry and materials of the current build; freed on every rebuild. */
  private buildDisposables: Array<{ dispose: () => void }> = [];
  private frames = 0;
  private fpsWindowStart = performance.now();
  public fps = 0;
  private visible = true;
  private level: Level = { kind: 'campus' };
  private selectedId: string | null = null;
  private onVisibility = () => { this.visible = document.visibilityState === 'visible'; if (this.visible) this.clock.getDelta(); };

  constructor(private container: HTMLElement, private opts: SceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !opts.lowPower, powerPreference: opts.lowPower ? 'low-power' : 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1 : 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = !opts.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Campus 3D view. Use the list or the building buttons for keyboard navigation; arrow keys move the camera, plus and minus zoom.');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 1, 2000);
    this.camera.position.set(150, 160, 190);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Strategy-game controls: drag pans, right-drag rotates, wheel/pinch zooms.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.screenSpacePanning = false;
    this.controls.enableDamping = !opts.reducedMotion;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 520;
    this.controls.listenToKeyEvents(this.renderer.domElement);

    this.hemi = new THREE.HemisphereLight(0xfff6e8, 0xc9b994, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
    this.sun.position.set(-120, 220, 90);
    this.sun.castShadow = !opts.lowPower;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = 180;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 600 });
    this.scene.add(this.hemi, this.sun, this.world);

    const ringGeo = new THREE.RingGeometry(1, 1.25, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xc9a23f, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.disposables.push(ringGeo, ringMat); // lives for the whole scene

    this.applyLighting(opts.night);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loop();
  }

  // ── WORLD ─────────────────────────────────────────────────────────────

  setData(nodes: CampusNodeDto[]) {
    this.nodeById = new Map(nodes.map((n) => [n.id, n]));
    this.rebuild();
  }

  private material(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02, ...opts });
    this.buildDisposables.push(m);
    return m;
  }

  private box(w: number, h: number, d: number) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.buildDisposables.push(g);
    return g;
  }

  private clearWorld() {
    this.pickables = [];
    this.meshById.clear();
    while (this.world.children.length) this.world.remove(this.world.children[0]);
    if (this.agents) { this.scene.remove(this.agents.mesh); this.agents = null; }
    if (this.bus) { this.scene.remove(this.bus.mesh); this.bus = null; }
    for (const d of this.buildDisposables) d.dispose();
    this.buildDisposables = [];
  }

  private rebuild() {
    this.clearWorld();
    const nodes = [...this.nodeById.values()];
    const campus = nodes.find((n) => n.kind === 'CAMPUS');
    const W = campus?.layout?.w ?? 240;
    const D = campus?.layout?.d ?? 180;

    const groundGeo = new THREE.PlaneGeometry(W + 80, D + 80);
    this.buildDisposables.push(groundGeo);
    const ground = new THREE.Mesh(groundGeo, this.material('#D9CFB4'));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.world.add(ground);
    // Paths between buildings (decorative, light paving).
    const pathMat = this.material('#EEE6D3');
    for (const [x, z, w, d] of [[0, 0, W * 0.9, 8], [0, 0, 8, D * 0.9], [-W * 0.38, 0, 6, D * 0.8]]) {
      const p = new THREE.Mesh(this.box(w, 0.2, d), pathMat);
      p.position.set(x, 0.1, z);
      p.receiveShadow = true;
      this.world.add(p);
    }

    for (const n of nodes) {
      if (n.kind === 'CAMPUS' || n.kind === 'FLOOR') continue;
      const L = n.layout ?? { x: 0, z: 0, w: 10, d: 10, h: 4 };
      if (GROUND_KINDS.has(n.kind)) {
        const color = n.kind === 'GROUND' ? '#A9C98E' : n.kind === 'COURT' ? '#C98F6B' : '#B9B3A6';
        const m = new THREE.Mesh(this.box(L.w, 0.4, L.d), this.material(color));
        m.position.set(L.x, 0.2, L.z);
        m.receiveShadow = true;
        m.userData.id = n.id;
        this.world.add(m);
        this.pickables.push(m);
        this.meshById.set(n.id, m);
        if (n.kind === 'GROUND') this.addTrack(L.x, L.z, L.w, L.d);
        continue;
      }
      if (n.kind === 'GATE') {
        const m = new THREE.Mesh(this.box(L.w, L.h || 3, 1.2), this.material('#8C7A5A'));
        m.position.set(L.x, (L.h || 3) / 2, L.z);
        m.userData.id = n.id;
        this.world.add(m);
        this.pickables.push(m);
        this.meshById.set(n.id, m);
        continue;
      }
      if (n.kind === 'BUILDING' && this.level.kind === 'campus') {
        const h = Math.max(L.h || 4, 4);
        const m = new THREE.Mesh(this.box(L.w, h, L.d), this.material(L.color ?? '#E6DCC6'));
        m.position.set(L.x, h / 2, L.z);
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.id = n.id;
        this.world.add(m);
        this.pickables.push(m);
        this.meshById.set(n.id, m);
        // Roof cap and window bands for a clay-model look.
        const roof = new THREE.Mesh(this.box(L.w + 1.2, 0.8, L.d + 1.2), this.material('#B8A988'));
        roof.position.set(L.x, h + 0.4, L.z);
        roof.castShadow = true;
        this.world.add(roof);
        const floors = Math.max(1, Math.round(h / 4));
        const winMat = this.material(this.opts.night ? '#F4D58A' : '#A9C3D6', { emissive: this.opts.night ? new THREE.Color('#E8B94A') : new THREE.Color('#000000'), emissiveIntensity: this.opts.night ? 0.8 : 0 });
        for (let f = 0; f < floors; f++) {
          const band = new THREE.Mesh(this.box(L.w + 0.1, 1.1, L.d + 0.1), winMat);
          band.position.set(L.x, f * 4 + 2.2, L.z);
          this.world.add(band);
        }
      }
    }

    if (this.level.kind === 'building') this.buildInterior(this.level.buildingId, this.level.floorNo);
    this.addTrees(W, D);
    if (!this.opts.reducedMotion) this.addLife(W, D);
    this.highlight(this.selectedId);
  }

  private addTrack(x: number, z: number, w: number, d: number) {
    const shape = new THREE.Shape();
    const rx = w * 0.42; const rz = d * 0.36;
    shape.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
    const hole = new THREE.Path();
    hole.absellipse(0, 0, rx - 3, rz - 3, 0, Math.PI * 2, true, 0);
    shape.holes.push(hole);
    const geo = new THREE.ShapeGeometry(shape, 48);
    this.buildDisposables.push(geo);
    const track = new THREE.Mesh(geo, this.material('#C2805C'));
    track.rotation.x = -Math.PI / 2;
    track.position.set(x, 0.45, z);
    this.world.add(track);
  }

  /** Inside a building: floors as slabs, rooms on the chosen floor coloured by state. */
  private buildInterior(buildingId: string, floorNo: number | null) {
    const b = this.nodeById.get(buildingId);
    if (!b) return;
    const floors = [...this.nodeById.values()].filter((n) => n.parentId === buildingId && n.kind === 'FLOOR').sort((a, c) => (a.floorNo ?? 0) - (c.floorNo ?? 0));
    const L = b.layout;
    const chosen = floorNo ?? floors[0]?.floorNo ?? 0;
    floors.forEach((f) => {
      const y = (f.floorNo ?? 0) * 6;
      const isOn = (f.floorNo ?? 0) === chosen;
      const slab = new THREE.Mesh(this.box(L.w + 2, 0.6, L.d + 2), this.material(isOn ? '#EFE7D6' : '#E2D8C2', { transparent: !isOn, opacity: isOn ? 1 : 0.28 }));
      slab.position.set(L.x, y, L.z);
      slab.receiveShadow = true;
      slab.userData.id = f.id;
      this.world.add(slab);
      this.pickables.push(slab);
      if (!isOn) return;
      const rooms = [...this.nodeById.values()].filter((n) => n.parentId === f.id);
      for (const r of rooms) {
        const RL = r.layout;
        const st = stateOf(r);
        const h = Math.min(RL.h || 3.4, 5);
        const m = new THREE.Mesh(this.box(Math.max(RL.w, 2), h, Math.max(RL.d, 2)), this.material(STATE_COLORS[st] ?? STATE_COLORS.OTHER, { transparent: true, opacity: 0.92 }));
        m.position.set(RL.x, y + 0.3 + h / 2, RL.z);
        m.castShadow = true;
        m.userData.id = r.id;
        this.world.add(m);
        this.pickables.push(m);
        this.meshById.set(r.id, m);
        // Desks for classrooms/labs: a few instanced blocks (illustrative furniture).
        if (['CLASSROOM', 'LECTURE_HALL', 'LAB'].includes(r.kind) && !this.opts.lowPower) {
          const deskGeo = this.box(1.2, 0.8, 0.7);
          const desks = new THREE.InstancedMesh(deskGeo, this.material('#8C6E4A'), 12);
          const mtx = new THREE.Matrix4();
          let i = 0;
          for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
            mtx.makeTranslation(RL.x - RL.w / 2 + 2 + col * ((RL.w - 4) / 3), y + 0.7, RL.z - RL.d / 2 + 3 + row * ((RL.d - 6) / 2));
            desks.setMatrixAt(i++, mtx);
          }
          this.world.add(desks);
        }
      }
    });
    // Ghost outline of the building shell.
    const shell = new THREE.Mesh(this.box(L.w + 2.4, floors.length * 6 + 2, L.d + 2.4), this.material('#C9BDA2', { transparent: true, opacity: 0.08, depthWrite: false }));
    shell.position.set(L.x, (floors.length * 6) / 2, L.z);
    this.world.add(shell);
  }

  private addTrees(W: number, D: number) {
    const count = this.opts.lowPower ? 40 : 110;
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 2.5, 6);
    const crownGeo = new THREE.SphereGeometry(2.2, 8, 6);
    this.buildDisposables.push(trunkGeo, crownGeo);
    const trunks = new THREE.InstancedMesh(trunkGeo, this.material('#7A5C3C'), count);
    const crowns = new THREE.InstancedMesh(crownGeo, this.material('#6E9A5E'), count);
    crowns.castShadow = !this.opts.lowPower;
    const mtx = new THREE.Matrix4();
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < count; i++) {
      // Around the campus edge so trees never sit inside a building.
      const side = i % 4;
      const t = rnd() - 0.5;
      const x = side < 2 ? t * (W + 50) : (side === 2 ? -1 : 1) * (W / 2 + 12 + rnd() * 18);
      const z = side >= 2 ? t * (D + 50) : (side === 0 ? -1 : 1) * (D / 2 + 12 + rnd() * 18);
      const s = 0.8 + rnd() * 0.6;
      mtx.compose(new THREE.Vector3(x, 1.25 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, mtx);
      mtx.compose(new THREE.Vector3(x, 3.8 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 1.1, s));
      crowns.setMatrixAt(i, mtx);
    }
    this.world.add(trunks, crowns);
  }

  // ── LIFE (anonymous, illustrative) ──────────────────────────────────────

  private addLife(W: number, D: number) {
    const count = this.opts.lowPower ? 24 : 70;
    const geo = new THREE.CapsuleGeometry(0.45, 1.1, 3, 6);
    this.buildDisposables.push(geo);
    const mesh = new THREE.InstancedMesh(geo, this.material('#5A6F8C'), count);
    // Walk along the paths: each person has a lane offset so people pass
    // rather than overlap, and a speed within a walking range.
    const paths: THREE.Vector3[][] = [
      [new THREE.Vector3(-W * 0.45, 1, -2), new THREE.Vector3(W * 0.45, 1, -2)],
      [new THREE.Vector3(W * 0.45, 1, 2), new THREE.Vector3(-W * 0.45, 1, 2)],
      [new THREE.Vector3(-2, 1, -D * 0.45), new THREE.Vector3(-2, 1, D * 0.45)],
      [new THREE.Vector3(2, 1, D * 0.45), new THREE.Vector3(2, 1, -D * 0.45)],
    ];
    const t = new Float32Array(count);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) { t[i] = (i * 0.137) % 1; speed[i] = 0.012 + (i % 7) * 0.0025; }
    this.agents = { mesh, paths, t, speed, count };
    this.scene.add(mesh);

    // A bus on the approach road into the bus bay.
    const bay = [...this.nodeById.values()].find((n) => n.kind === 'TRANSPORT_BAY');
    if (bay) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.box(4, 3.2, 11), this.material('#E6B13A'));
      body.position.y = 2.2;
      body.castShadow = true;
      const stripe = new THREE.Mesh(this.box(4.05, 0.5, 11.05), this.material('#3D3A33'));
      stripe.position.y = 2.6;
      g.add(body, stripe);
      const L = bay.layout;
      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(L.x - 40, 0, L.z - D * 0.55), new THREE.Vector3(L.x, 0, L.z - L.d * 0.45), new THREE.Vector3(L.x, 0, L.z + L.d * 0.3),
        new THREE.Vector3(L.x - 30, 0, L.z + D * 0.55),
      ]);
      this.bus = { mesh: g, path, t: 0 };
      this.scene.add(g);
    }
  }

  private stepLife(dt: number) {
    if (this.agents) {
      const { mesh, paths, t, speed, count } = this.agents;
      const mtx = new THREE.Matrix4();
      const p = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        t[i] = (t[i] + speed[i] * dt * 6) % 1;
        const path = paths[i % paths.length];
        p.lerpVectors(path[0], path[1], t[i]);
        const lane = ((i % 3) - 1) * 1.1;
        if (Math.abs(path[0].x - path[1].x) > 1) p.z += lane; else p.x += lane;
        mtx.makeTranslation(p.x, 1, p.z);
        mesh.setMatrixAt(i, mtx);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.bus) {
      // Slow into the bay, pause, leave: speed eases near the stop (t≈0.5).
      const near = Math.abs(this.bus.t - 0.5);
      const v = near < 0.06 ? 0.004 : 0.03;
      this.bus.t = (this.bus.t + v * dt) % 1;
      const pos = this.bus.path.getPointAt(this.bus.t);
      const ahead = this.bus.path.getPointAt(Math.min(this.bus.t + 0.01, 1));
      this.bus.mesh.position.copy(pos);
      this.bus.mesh.lookAt(ahead.x, pos.y, ahead.z);
    }
  }

  // ── INTERACTION ─────────────────────────────────────────────────────────

  private downAt: { x: number; y: number } | null = null;
  private onPointerDown = (e: PointerEvent) => { this.downAt = { x: e.clientX, y: e.clientY }; };
  private onPointerUp = (e: PointerEvent) => {
    if (!this.downAt || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 6) return; // a drag pans; only a tap selects
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    this.opts.onSelect((hit?.object.userData.id as string) ?? null);
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
    this.flyTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(150, 160, 190));
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
        const y = (level.floorNo ?? 0) * 6;
        this.flyTo(new THREE.Vector3(b.layout.x, y, b.layout.z), new THREE.Vector3(b.layout.x + 55, y + 65, b.layout.z + 70));
      }
    }
  }

  highlight(id: string | null) {
    this.selectedId = id;
    const mesh = id ? this.meshById.get(id) : null;
    if (!mesh) { this.ring.visible = false; return; }
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.62 + 1.5;
    this.ring.scale.set(r, r, r);
    this.ring.position.set(c.x, box.min.y + 0.35, c.z);
    this.ring.visible = true;
  }

  focus(id: string) {
    const mesh = this.meshById.get(id);
    if (!mesh) return;
    const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(this.level.kind === 'campus' ? 120 : 60);
    this.flyTo(c, c.clone().add(offset));
  }

  /** Screen positions of named objects, for the DOM labels (only a handful are labelled). */
  project(ids: string[]): Array<{ id: string; x: number; y: number; visible: boolean }> {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return ids.map((id) => {
      const mesh = this.meshById.get(id);
      if (!mesh) return { id, x: 0, y: 0, visible: false };
      const box = new THREE.Box3().setFromObject(mesh);
      const p = box.getCenter(new THREE.Vector3());
      p.y = box.max.y + 1.5;
      p.project(this.camera);
      return { id, x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, visible: p.z < 1 && p.x > -1.1 && p.x < 1.1 && p.y > -1.1 && p.y < 1.1 };
    });
  }

  // ── EXTRAS ──────────────────────────────────────────────────────────────

  applyLighting(night: boolean) {
    this.opts.night = night;
    this.scene.background = new THREE.Color(night ? '#1E2433' : '#F2ECDF');
    this.scene.fog = new THREE.Fog(night ? 0x1e2433 : 0xf2ecdf, 380, 900);
    this.hemi.intensity = night ? 0.35 : 0.9;
    this.sun.intensity = night ? 0.25 : 1.4;
    this.sun.color.set(night ? '#9FB4D9' : '#FFF1D6');
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

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.glide) {
      this.glide.t = Math.min(1, this.glide.t + dt * 1.6);
      const e = 1 - (1 - this.glide.t) ** 3;
      this.camera.position.lerpVectors(this.glide.fromPos, this.glide.toPos, e);
      this.controls.target.lerpVectors(this.glide.fromTarget, this.glide.toTarget, e);
      if (this.glide.t >= 1) this.glide = null;
    }
    if (!this.opts.reducedMotion) {
      this.stepLife(dt);
      if (this.ring.visible) this.ring.rotation.z += dt * 0.8;
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
    this.renderer.domElement.removeEventListener('keydown', this.onKey);
    this.controls.dispose();
    this.clearWorld();
    for (const d of this.disposables) d.dispose();
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
