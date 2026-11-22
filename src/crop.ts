// 4-corner crop and straighten for photos, plain canvas code (no libraries). Runs on this device only.
export type Pt = { x: number; y: number } // fractions of the image
export type Quad = [Pt, Pt, Pt, Pt] // top-left, top-right, bottom-right, bottom-left

// Solve A x = b (Gaussian elimination with partial pivoting).
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  return M.map((r, i) => r[n] / r[i])
}

// Homography mapping each src point to its dst point: returns [a..h] for x' = (ax+by+c)/(gx+hy+1), y' = (dx+ey+f)/(gx+hy+1).
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [], b: number[] = []
  src.forEach(({ x, y }, i) => {
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  })
  return solve(A, b)
}
export const apply = (H: number[], { x, y }: Pt): Pt => {
  const w = H[6] * x + H[7] * y + 1
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }
}

// Cheap corner guess: a report is a bright page on a darker background. On a 200 px thumbnail, take the
// bright pixels and their extreme points along the diagonals. Falls back to the image corners if unsure.
export function guessCorners(img: CanvasImageSource & { width: number; height: number }): Quad {
  const full: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  const s = 200 / Math.max(img.width, img.height)
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const lum: number[] = []
  for (let i = 0; i < d.length; i += 4) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
  const sorted = [...lum].sort((a, b) => a - b)
  // A quarter of the way from background to paper: shaded paper corners (r6-photo: 152 vs background 92, paper 214) stay in.
  const lo = sorted[Math.floor(lum.length * 0.1)], hi = sorted[Math.floor(lum.length * 0.9)]
  const t = lo + (hi - lo) * 0.25
  let tl = { v: Infinity, x: 0, y: 0 }, tr = { v: -Infinity, x: 0, y: 0 }, br = { v: -Infinity, x: 0, y: 0 }, bl = { v: -Infinity, x: 0, y: 0 }, n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (lum[y * w + x] < t) continue
    n++
    if (x + y < tl.v) tl = { v: x + y, x, y }
    if (x - y > tr.v) tr = { v: x - y, x, y }
    if (x + y > br.v) br = { v: x + y, x, y }
    if (y - x > bl.v) bl = { v: y - x, x, y }
  }
  // Paper must be a real part of the picture but not all of it (a flat scan or screenshot needs no crop).
  if (n < w * h * 0.15 || n > w * h * 0.97) return full
  const f = (p: { x: number; y: number }) => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h })
  return [f(tl), f(tr), f(br), f(bl)]
}

// Warp the quad to an upright rectangle (long side at most 2000 px). Inverse mapping, nearest pixel.
export async function straighten(src: Blob, q: Quad): Promise<Blob> {
  const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' })
  const W = bmp.width, H = bmp.height
  const P = q.map((p) => ({ x: p.x * W, y: p.y * H }))
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
  let ow = Math.max(dist(P[0], P[1]), dist(P[3], P[2])), oh = Math.max(dist(P[0], P[3]), dist(P[1], P[2]))
  const k = Math.min(2, 2000 / Math.max(ow, oh)) // up to 2x: small tilted text survives the warp better
  ow = Math.round(ow * k); oh = Math.round(oh * k)
  const inC = document.createElement('canvas')
  inC.width = W; inC.height = H
  const ig = inC.getContext('2d', { willReadFrequently: true })!
  ig.drawImage(bmp, 0, 0)
  bmp.close()
  const sd = ig.getImageData(0, 0, W, H).data
  const out = document.createElement('canvas')
  out.width = ow; out.height = oh
  const og = out.getContext('2d')!
  const od = og.createImageData(ow, oh)
  const Hm = homography([{ x: 0, y: 0 }, { x: ow, y: 0 }, { x: ow, y: oh }, { x: 0, y: oh }], P) // output -> source
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    // Bilinear: nearest-pixel sampling aliased tilted text (r6-photo lost 2 values that way).
    const p = apply(Hm, { x: x + 0.5, y: y + 0.5 })
    const fx = Math.min(W - 1, Math.max(0, p.x - 0.5)), fy = Math.min(H - 1, Math.max(0, p.y - 0.5))
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), ax = fx - x0, ay = fy - y0
    const oi = (y * ow + x) * 4
    for (let ch = 0; ch < 3; ch++) {
      const a = sd[(y0 * W + x0) * 4 + ch], b = sd[(y0 * W + x1) * 4 + ch], c = sd[(y1 * W + x0) * 4 + ch], d = sd[(y1 * W + x1) * 4 + ch]
      od.data[oi + ch] = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay
    }
    od.data[oi + 3] = 255
  }
  og.putImageData(od, 0, 0)
  return new Promise((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new Error('encode failed'))), 'image/jpeg', 0.92))
}
