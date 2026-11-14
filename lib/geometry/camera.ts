// A 2D view over a plan drawn in feet: (x, y) is the foot at the view's top-left corner, z is screen px per foot.
export type Camera = { x: number; y: number; z: number };
export type Box = { x: number; y: number; x2: number; y2: number };

export const BASE_Z = 14; // 100%
export const MIN_Z = BASE_Z * 0.1;
export const MAX_Z = BASE_Z * 4;

const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

export const toFeet = (c: Camera, px: number, py: number) => ({ x: c.x + px / c.z, y: c.y + py / c.z });

export const pan = (c: Camera, dxPx: number, dyPx: number): Camera => ({ ...c, x: c.x + dxPx / c.z, y: c.y + dyPx / c.z });

/** Zooms by `factor` keeping the foot under screen point (px, py) in place. */
export function zoomAt(c: Camera, factor: number, px: number, py: number): Camera {
  const z = clampZ(c.z * factor);
  const f = toFeet(c, px, py);
  return { z, x: f.x - px / z, y: f.y - py / z };
}

/** Frames `box` in a vw×vh view with `pad` px of margin, never zooming past 200%. */
export function fit(box: Box | null, vw: number, vh: number, pad = 48): Camera {
  if (!box || vw <= 0 || vh <= 0) return { x: 0, y: 0, z: BASE_Z };
  const w = Math.max(1, box.x2 - box.x), h = Math.max(1, box.y2 - box.y);
  const z = clampZ(Math.min((vw - 2 * pad) / w, (vh - 2 * pad) / h, BASE_Z * 2));
  return { z, x: box.x + w / 2 - vw / 2 / z, y: box.y + h / 2 - vh / 2 / z };
}
