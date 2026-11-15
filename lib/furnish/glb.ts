// Exact bounds of a GLB model from its header: accessor min/max under each node's transform. No rendering, and only
// the start of the file is needed (the glTF JSON chunk comes first).
import { Box3, Matrix4, Quaternion, Vector3 } from "three";

export type Bounds = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
type Node = { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] };
type Gltf = { scene?: number; scenes?: { nodes: number[] }[]; nodes?: Node[]; meshes?: { primitives: { attributes: { POSITION?: number } }[] }[]; accessors?: { min?: number[]; max?: number[] }[] };

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

/** Bytes needed to read the JSON chunk, or null if this isn't a GLB. Works on the first 20 bytes. */
export function glbHeaderLength(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 20) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== MAGIC || v.getUint32(16, true) !== JSON_CHUNK) return null;
  return 20 + v.getUint32(12, true);
}

/** Bounds in the model's own units (glTF is Y-up), or null if the header is missing, truncated or has no geometry. */
export function glbBounds(bytes: Uint8Array): Bounds | null {
  const need = glbHeaderLength(bytes);
  if (!need || bytes.byteLength < need) return null;
  let gltf: Gltf;
  try { gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, need))) as Gltf; } catch { return null; }
  const box = new Box3();
  const walk = (i: number, parent: Matrix4, depth: number) => {
    const n = gltf.nodes?.[i];
    if (!n || depth > 64) return;
    const local = n.matrix?.length === 16 ? new Matrix4().fromArray(n.matrix)
      : new Matrix4().compose(new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local);
    for (const p of n.mesh != null ? gltf.meshes?.[n.mesh]?.primitives ?? [] : []) {
      const a = p.attributes.POSITION != null ? gltf.accessors?.[p.attributes.POSITION] : undefined;
      if (a?.min?.length === 3 && a.max?.length === 3) box.union(new Box3(new Vector3(...a.min), new Vector3(...a.max)).applyMatrix4(world));
    }
    for (const c of n.children ?? []) walk(c, world, depth + 1);
  };
  for (const r of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) walk(r, new Matrix4(), 0);
  if (box.isEmpty()) return null;
  return { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
}
