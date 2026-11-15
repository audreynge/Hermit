// How to turn and scale a model so it stands upright at the item's real-world size. Model files use arbitrary units
// and sometimes the wrong "up" axis, so we try each axis as up (and both horizontal turns), scale so the height
// matches, and keep the orientation whose footprint best matches the item.
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Size } from "./catalog";
import type { Bounds } from "./glb";

export type Fit = {
  rotation: { x: number; y: number; z: number }; // radians, Euler XYZ, applied to the model inside its node
  scale: number;
  position: { x: number; y: number; z: number }; // puts the model's bottom-center on the node origin
  fitted: Size; // rendered size in meters
  error: number; // mean |log ratio| of footprint vs target; 0 = perfect, ln 2 ≈ 0.69 = off by 2×
};

// Which model axis becomes "up": as authored (Y), Z-up exports, X-up exports. Non-authored orientations pay a small
// penalty so they only win when clearly better.
const UPS: [Quaternion, number][] = [
  [new Quaternion(), 0],
  [new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), 0.15],
  [new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2), 0.15],
];
const YAWS = [0, Math.PI / 2];

/** `cap`: never exceed the target footprint (shrinking height instead), for items whose spot was planned around their size. */
export function fitModel(b: Bounds, target: Size, cap = false): Fit | null {
  const src = new Box3(new Vector3(b.min.x, b.min.y, b.min.z), new Vector3(b.max.x, b.max.y, b.max.z));
  let best: (Fit & { score: number }) | null = null;
  for (const [up, penalty] of UPS) {
    for (const yaw of YAWS) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(up);
      const box = src.clone().applyMatrix4(new Matrix4().makeRotationFromQuaternion(q));
      const s3 = box.getSize(new Vector3());
      if (![s3.x, s3.y, s3.z].every((n) => Number.isFinite(n) && n > 1e-6)) continue;
      const byHeight = target.h / s3.y, scale = cap ? Math.min(byHeight, target.w / s3.x, target.d / s3.z) : byHeight;
      const w = s3.x * scale, d = s3.z * scale;
      // Scored on the uncapped shape, so capping never changes which way up the model stands.
      const error = (Math.abs(Math.log((s3.x * byHeight) / target.w)) + Math.abs(Math.log((s3.z * byHeight) / target.d))) / 2;
      const score = error + penalty + (yaw ? 0.01 : 0);
      if (best && score >= best.score) continue;
      const c = box.getCenter(new Vector3());
      const e = new Euler().setFromQuaternion(q, "XYZ");
      best = { rotation: { x: e.x || 0, y: e.y || 0, z: e.z || 0 }, scale, position: { x: -c.x * scale, y: -box.min.y * scale, z: -c.z * scale }, fitted: { w, d, h: s3.y * scale }, error, score };
    }
  }
  if (!best) return null;
  const { score: _score, ...fit } = best;
  return fit;
}
