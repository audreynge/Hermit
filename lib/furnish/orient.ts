// An item's full orientation: yaw (rotY, any angle, about the vertical axis) plus pitch and roll in quarter turns, for
// models that load upside down or on their side. Pitch turns about the item's width axis (local x: "tip forward or
// back", 180 = "flip upright"); roll about its depth axis (local z: "tip onto its side"). The scene applies them as
// Euler "YXZ" (yaw · pitch · roll); an item's box is always re-seated so its bottom-center stays on its spot (pos),
// on the floor or on the piece it stands on.
import type { Size } from "./catalog";

type V3 = { x: number; y: number; z: number };
export type Tilt = { pitch?: number; roll?: number }; // degrees; missing = 0 (saves from before tipping existed)

/** An angle snapped to a quarter turn, in [0, 360). */
export const quarter = (deg?: number) => (Number.isFinite(deg) ? (((Math.round(deg! / 90) % 4) + 4) % 4) * 90 : 0);
const tidy = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n);
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * An item's local box (x within ±w/2, y from 0 to h, z within ±d/2) tipped by roll (about z), then pitch (about x):
 * the matrix Rx(pitch)·Rz(roll), which is what the scene's "YXZ" Euler applies inside the yaw. Returns the tipped box's
 * extents (w across, d deep, h tall) and the local offset that brings its bottom-center back to the item's spot, so a
 * flipped item stands on the floor instead of hanging through it.
 */
export function orient(size: Size, pitch = 0, roll = 0): { size: Size; offset: V3 } {
  const p = rad(quarter(pitch)), r = rad(quarter(roll));
  const cp = Math.round(Math.cos(p)), sp = Math.round(Math.sin(p)), cr = Math.round(Math.cos(r)), sr = Math.round(Math.sin(r));
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const x of [-size.w / 2, size.w / 2]) for (const y of [0, size.h]) for (const z of [-size.d / 2, size.d / 2]) {
    const x1 = cr * x - sr * y, y1 = sr * x + cr * y; // roll about z
    const v = { x: x1, y: cp * y1 - sp * z, z: sp * y1 + cp * z }; // then pitch about x
    for (const k of ["x", "y", "z"] as const) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
  }
  return {
    size: { w: tidy(max.x - min.x), d: tidy(max.z - min.z), h: tidy(max.y - min.y) },
    offset: { x: tidy(-(min.x + max.x) / 2), y: tidy(-min.y), z: tidy(-(min.z + max.z) / 2) },
  };
}

/**
 * Where an item's scene node goes and how it turns (radians, Euler order "YXZ"): the tipped box is shifted back by its
 * offset, turned by the yaw, so its bottom-center lands on `pos`. `size` is the box the node holds (the fitted model's
 * size, or the placeholder box's).
 */
export function pose(size: Size, tilt: Tilt, pos: V3, rotY: number): { position: V3; rotation: V3 } {
  const { offset } = orient(size, tilt.pitch, tilt.roll);
  const a = rad(rotY), c = Math.cos(a), s = Math.sin(a);
  return {
    position: { x: pos.x + c * offset.x + s * offset.z, y: pos.y + offset.y, z: pos.z - s * offset.x + c * offset.z },
    rotation: { x: rad(quarter(tilt.pitch)), y: a, z: rad(quarter(tilt.roll)) },
  };
}

/** The tilt after a quarter-turn tip about the item's width axis ("x": forward/back, flip) or depth axis ("z": side). */
export function tipped(t: Tilt, axis: "x" | "z", degrees: number): { pitch: number; roll: number } {
  const pitch = quarter(t.pitch), roll = quarter(t.roll);
  return axis === "x" ? { pitch: quarter(pitch + degrees), roll } : { pitch, roll: quarter(roll + degrees) };
}

/** Saved items from any version: pitch and roll present and snapped to quarter turns (older saves had neither), yaw a
 *  finite angle. Anything that isn't a list of items comes back empty. */
export function migrate<T extends { rotY?: unknown } & Tilt>(saved: unknown): (T & { rotY: number; pitch: number; roll: number })[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((p): p is T => !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string" && !!(p as { pos?: unknown }).pos && !!(p as { size?: unknown }).size)
    .map((p) => ({ ...p, rotY: Number.isFinite(p.rotY) ? (p.rotY as number) : 0, pitch: quarter(p.pitch), roll: quarter(p.roll) }));
}
