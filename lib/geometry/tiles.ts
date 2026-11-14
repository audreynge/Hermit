// Web Mercator slippy-map tile containing a point, plus the point's position inside that tile (0..1).
export function tileFor(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const fxAll = ((lon + 180) / 360) * n;
  const fyAll = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const x = Math.floor(fxAll);
  const y = Math.floor(fyAll);
  return { x, y, z, fx: fxAll - x, fy: fyAll - y };
}

export const esriTile = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
