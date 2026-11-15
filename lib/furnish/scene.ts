// Browser-only glue: mirrors the placed-items list into the Matterport Bundle scene (findings in docs/FURNISH_PLAN.md).
// Every item shows a box at its size at once; a model replaces it when loaded, or the box stays if loading fails.
import type { MpSdk } from "@matterport/webcomponent";
import type * as THREE from "three";
import { MATERIALS, type Size } from "./catalog";
import { fitModel } from "./fit";
import type { Placed, Vec } from "./ops";
import { classify, samplePoints, type Footprint, type ProbeResult, type Sample } from "./probe";

export type LoadState = "ready" | "failed";
// The placeholder box and the model live on separate scene objects: a started node can't take new components, and
// models are queued (MAX_LOADING at a time) so many heavy downloads don't all time out together.
type Entry = {
  key: string; obj: MpSdk.Scene.IObject; node: MpSdk.Scene.INode; box: MpSdk.Scene.IComponent;
  mobj?: MpSdk.Scene.IObject; mnode?: MpSdk.Scene.INode; model?: MpSdk.Scene.IComponent; started?: number;
  root?: THREE.Object3D; paint?: string; done?: LoadState;
};
type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const SELECT_GLOW = 0x2a1208; // faint warm glow on the selected item
const LOAD_TIMEOUT_MS = 12_000; // per model, from when its download starts
const MAX_LOADING = 3;

// A see-through box at the item's size: the placeholder while loading, and the fallback when there's no model.
function boxFactory(): MpSdk.Scene.IComponent {
  return {
    inputs: { w: 1, d: 1, h: 1, pulse: true },
    onInit(this: MpSdk.Scene.IComponent & { mesh: Mesh; t: number }) {
      const T = this.context.three;
      const { w, d, h } = this.inputs as { w: number; d: number; h: number };
      this.mesh = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshStandardMaterial({ color: 0xe8735a, transparent: true, opacity: 0.5 }));
      this.mesh.position.y = h / 2;
      this.t = 0;
      this.outputs.objectRoot = this.mesh;
      this.outputs.collider = this.mesh;
    },
    onTick(this: MpSdk.Scene.IComponent & { mesh: Mesh; t: number }, dt: number) {
      if (!(this.inputs as { pulse: boolean }).pulse) { this.mesh.material.opacity = 0.5; return; }
      this.t += dt / 1000;
      this.mesh.material.opacity = 0.3 + 0.2 * Math.sin(this.t * 4);
    },
  } as unknown as MpSdk.Scene.IComponent;
}

const keyOf = (p: Placed) => `${p.model?.url ?? "box"}|${p.size.w}|${p.size.d}|${p.size.h}`;
const meshes = (root: THREE.Object3D) => { const out: Mesh[] = []; root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); }); return out; };

export async function createScene(sdk: MpSdk, onLoad: (id: string, state: LoadState, fitted?: Size) => void) {
  let camera: THREE.Camera | null = null;
  const cameraFactory = () => ({ onInit(this: MpSdk.Scene.IComponent) { camera = this.context.camera; } }) as unknown as MpSdk.Scene.IComponent;
  await sdk.Scene.registerComponents([{ name: "hermit.box", factory: boxFactory }, { name: "hermit.camera", factory: cameraFactory }]).catch(() => null);
  const [lights] = await sdk.Scene.createObjects(1);
  const ln = lights.addNode();
  ln.addComponent("mp.lights");
  ln.addComponent(sdk.Scene.Component.AMBIENT_LIGHT, { intensity: 0.8 });
  ln.addComponent("hermit.camera");
  lights.start();
  const T = sdk.Scene.THREE as typeof THREE;
  const entries = new Map<string, Entry>();
  const ray = new T.Raycaster();

  function settle(id: string, e: Entry, state: LoadState, fitted?: Size) {
    if (e.done) return;
    e.done = state;
    (e.box.inputs as { pulse: boolean }).pulse = false;
    onLoad(id, state, fitted);
  }

  // Once the model is in: turn and scale it to the item's real size (bottom-center on the node), hide the box.
  // Models measured on the server (bounds from the file header) are fitted exactly; older saved ones are measured here.
  function fit(id: string, e: Entry, p: Placed) {
    if (!p.model) { settle(id, e, "ready"); return; }
    if (!e.model) return; // waiting for a download slot
    const root = e.model.outputs.objectRoot as THREE.Object3D | null;
    if (!root) { if (Date.now() - e.started! > LOAD_TIMEOUT_MS) settle(id, e, "failed"); return; }
    if (e.root === root) return;
    // Bounds measured on the server (file header), else measured here in the model's own frame (it hasn't been moved yet).
    let bounds = p.model.bounds, measuredHere = false;
    if (!bounds) {
      root.updateWorldMatrix(true, true);
      const box = new T.Box3().setFromObject(root).applyMatrix4(root.matrixWorld.clone().invert());
      if (!box.isEmpty()) { bounds = { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } }; measuredHere = true; }
    }
    const f = bounds && fitModel(bounds, p.size, p.planned);
    if (!f) { settle(id, e, "failed"); return; }
    // Set the transform on the loaded object itself (standard position·rotation·scale), not through the loader's
    // local* inputs: the loader applies localPosition inside the scaled frame, which shifted off-center models away.
    root.position.set(f.position.x, f.position.y, f.position.z);
    root.rotation.set(f.rotation.x, f.rotation.y, f.rotation.z, "XYZ");
    root.scale.setScalar(f.scale);
    e.root = root;
    (e.box.outputs.objectRoot as THREE.Object3D).visible = false;
    e.paint = undefined;
    settle(id, e, "ready", measuredHere ? f.fitted : undefined);
  }

  function paint(e: Entry, p: Placed, selected: boolean) {
    const target = e.root ?? (e.box.outputs.objectRoot as THREE.Object3D | null);
    if (!target) return;
    const key = `${!!e.root}|${p.color}|${p.material}|${selected}`;
    if (e.paint === key) return;
    e.paint = key;
    const preset = p.material ? MATERIALS[p.material] : undefined;
    for (const m of meshes(target)) {
      if (!m.userData.orig) {
        m.material = m.material.clone();
        // No environment map in the tour: fully metallic PBR materials (common on Sketchfab) would render black.
        if (typeof m.material.metalness === "number") m.material.metalness = Math.min(m.material.metalness, 0.35);
        m.userData.orig = m.material.clone();
      }
      m.material.copy(m.userData.orig as THREE.MeshStandardMaterial);
      const color = p.color ?? preset?.color;
      if (color) { m.material.map = null; m.material.color.set(color); }
      if (preset) { m.material.roughness = preset.roughness; m.material.metalness = preset.metalness; }
      m.material.emissive?.setHex(selected ? SELECT_GLOW : 0x000000);
      // The selected item shows through walls (x-ray), so a just-placed or dragged item never seems to vanish.
      if (selected) { m.material.depthTest = false; m.material.transparent = true; m.material.opacity = Math.min(m.material.opacity, 0.85); }
      m.renderOrder = selected ? 10 : 0;
      m.material.needsUpdate = true;
    }
  }

  async function build(p: Placed): Promise<Entry> {
    const [obj] = await sdk.Scene.createObjects(1);
    const node = obj.addNode();
    const box = node.addComponent("hermit.box", { w: p.size.w, d: p.size.d, h: p.size.h, pulse: !!p.model });
    obj.start();
    return { key: keyOf(p), obj, node, box };
  }
  async function startModel(e: Entry, p: Placed) {
    const [mobj] = await sdk.Scene.createObjects(1);
    const mnode = mobj.addNode();
    e.model = mnode.addComponent(sdk.Scene.Component.GLTF_LOADER, { url: p.model!.url });
    mobj.start();
    Object.assign(e, { mobj, mnode, started: Date.now() });
  }
  const stop = (e: Entry) => { e.obj.stop(); e.mobj?.stop(); };

  const place = (e: Entry, pos: Vec, rotY: number) => {
    for (const n of [e.node, e.mnode]) { if (!n) continue; n.position.set(pos.x, pos.y, pos.z); n.obj3D.rotation.y = (rotY * Math.PI) / 180; }
  };
  let latest: { items: Placed[]; selected?: string } = { items: [] };
  let busy: Promise<void> = Promise.resolve();
  let dragging: string | null = null;
  /** Brings the scene in line with the list: builds new or re-modeled items, removes deleted ones, updates the rest. */
  function sync(items: Placed[], selected?: string) {
    latest = { items, selected };
    busy = busy.then(async () => {
      const { items, selected } = latest;
      for (const [id, e] of entries) if (!items.some((p) => p.id === id && keyOf(p) === e.key)) { stop(e); entries.delete(id); }
      let loading = [...entries.values()].filter((e) => e.model && !e.done).length;
      for (const p of items) {
        let e = entries.get(p.id);
        if (!e) { e = await build(p); entries.set(p.id, e); }
        if (p.model && !e.model && loading < MAX_LOADING) { await startModel(e, p); loading++; }
        if (dragging !== p.id) place(e, p.pos, p.rotY);
        fit(p.id, e, p);
        paint(e, p, p.id === selected);
      }
    }).catch((err) => console.warn("[hermit] furnish scene sync failed", err));
  }
  // Models load asynchronously; keep fitting until every item has settled.
  const timer = setInterval(() => { if ([...entries.values()].some((e) => !e.done)) sync(latest.items, latest.selected); }, 400);

  function rayAt(x: number, y: number, rect: DOMRect) {
    if (!camera) return null;
    ray.setFromCamera(new T.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
    return ray;
  }

  function screenOf(pos: Vec, rect: DOMRect): { x: number; y: number; behind: boolean } | null {
    if (!camera) return null;
    const v = new T.Vector3(pos.x, pos.y, pos.z).project(camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, behind: v.z > 1 };
  }

  return {
    sync,
    /** Camera position and horizontal look direction, read synchronously from the live camera. */
    camera(): { pos: Vec; forward: { x: number; z: number } } {
      if (!camera) return { pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, z: -1 } };
      const d = camera.getWorldDirection(new T.Vector3()), p = camera.getWorldPosition(new T.Vector3());
      const l = Math.hypot(d.x, d.z) || 1;
      return { pos: { x: p.x, y: p.y, z: p.z }, forward: { x: d.x / l, z: d.z / l } };
    },
    /** The camera ray through a screen point (world space), for hit-testing items with `hitItem`. */
    ray(x: number, y: number, rect: DOMRect): { origin: Vec; dir: Vec } | null {
      const r = rayAt(x, y, rect)?.ray;
      return r ? { origin: { x: r.origin.x, y: r.origin.y, z: r.origin.z }, dir: { x: r.direction.x, y: r.direction.y, z: r.direction.z } } : null;
    },
    /** Rendered world bounds of an item (what the user actually sees), for checks and tests. */
    bounds(id: string): { min: Vec; max: Vec; model: boolean } | null {
      const e = entries.get(id), o = e && (e.root ?? (e.box.outputs.objectRoot as THREE.Object3D | null));
      if (!o) return null;
      o.updateWorldMatrix(true, true);
      const b = new T.Box3().setFromObject(o);
      return { min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z }, model: !!e!.root };
    },
    /** Screen position of a world point; `behind` when it's behind the camera (don't draw it). */
    screenOf,
    /** Whether a footprint would sit on a built-in surface: casts the tour's ray through each sample point's pixel
     *  (first model surface hit, see probe.ts). Points behind the camera or off-screen stay unknown. `rect` is the viewer's. */
    async probe(fp: Footprint, floorY: number, rect: DOMRect): Promise<ProbeResult> {
      const samples: Sample[] = [];
      for (const at of samplePoints(fp, floorY)) {
        const p = screenOf(at, rect), pt = p && !p.behind ? { x: p.x - rect.left, y: p.y - rect.top } : null;
        const seen = pt && pt.x >= 0 && pt.x <= rect.width && pt.y >= 0 && pt.y <= rect.height;
        const hit = seen ? (await sdk.Renderer.getWorldPositionData(pt).catch(() => null))?.position ?? null : undefined;
        samples.push({ at, hit });
      }
      return classify(floorY, fp, samples);
    },
    /** Where a screen point's ray meets the floor plane at height y (synchronous, for smooth dragging). */
    floorAt(x: number, y: number, rect: DOMRect, floorY: number): Vec | null {
      const hit = rayAt(x, y, rect)?.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -floorY), new T.Vector3());
      return hit ? { x: hit.x, y: floorY, z: hit.z } : null;
    },
    /** Moves an item's node without touching state, for live dragging; drag(null) ends it. */
    drag(id: string | null, pos?: Vec, rotY?: number) {
      dragging = id;
      const e = id ? entries.get(id) : undefined;
      if (e && pos) place(e, pos, rotY ?? 0);
    },
    destroy() { clearInterval(timer); for (const e of entries.values()) stop(e); entries.clear(); lights.stop(); },
  };
}
export type FurnishScene = Awaited<ReturnType<typeof createScene>>;
