import { useEffect, useRef, useState } from 'react'
import { guessCorners, straighten, type Quad } from './crop'
import { extractDoc, extractRows, findPersonal, TEXT_CREATE_OPTIONS, toB64, warmText, type Run } from './extract'
import { explain, type Explained } from './explain'
import Explanation from './Explanation'
import { Busy, DataTrail } from './ui'
import { checkAll, DISCLAIMER, type Check } from './guidelines'
import { aiBoxes, nonResultLines, ocrWords, suggestMasks, type Suggestion } from './masks'
import { isPdf, pdfPages } from './pdf'
import { toPayload, type Payload } from './privacy'
import { config } from './remote'
import Review, { type Result } from './Review'
import type { Line, Word } from './textlayer'
import { rowsForModel } from './textrows'
import { keepPrintedFlags, trustOf } from './trust'

// Images (one per page; a PDF is rendered to one PNG per page) live only in memory (Blob + object URL) for the life of one report. Nothing is written
// to storage, logged, or sent anywhere except the single extraction request of the chosen path.

declare const LanguageModel: { availability(o: object): Promise<string> } | undefined
type Avail = 'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api' | 'error'
type Path = 1 | 2 | 3
type Img = { blob: Blob; url: string; w: number; h: number }
type Step = 'choose' | 'upload' | 'crop' | 'mask' | 'confirm-masked' | 'consent' | 'extracting' | 'failed' | 'review' | 'explaining' | 'explained'

const AVAIL_TEXT: Record<Avail, string> = {
  checking: 'Checking whether this device can read reports privately...',
  available: 'This device can read your lab PDF privately: the on-device AI is ready.',
  downloadable: 'This device can read your lab PDF privately. Chrome first needs a one-time download of its built-in AI (a few GB), which starts when you choose Private.',
  downloading: 'This device can read your lab PDF privately. Chrome is still downloading its built-in AI; Private will wait for it.',
  unavailable: "This device can't run Chrome's built-in AI (usually not enough memory or graphics power), so private reading is not offered. You can still cover your details yourself.",
  'no-api': "This browser doesn't have Chrome's built-in AI, so private reading is not offered here (it needs desktop Chrome 139 or newer). You can still cover your details yourself.",
  error: "We couldn't check for on-device AI, so private reading is not offered. You can still cover your details yourself.",
}
const ADULT_KEY = 'clearreport.adult-notice-seen'
const canDevice = (a: Avail) => a === 'available' || a === 'downloadable' || a === 'downloading'

// Long side of every image sent to the cloud (was 2000; smaller uploads, see test-data/results.md).
const MAX_SIDE = 1600

// Decode (applying EXIF rotation), draw, re-encode as JPEG. The re-encode drops all EXIF/GPS metadata.
async function reencode(src: Blob, boxes: Box[] = []): Promise<Img> {
  const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  const g = c.getContext('2d')!
  g.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  g.fillStyle = tok('mask-black')
  for (const b of boxes) g.fillRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height) // burned into pixels
  // PDF pages stay PNG: JPEG artifacts around watermarks made the model mark far more values unreadable (WM14: 20 rows vs 1).
  const type = src.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('encode failed'))), type, 0.92))
  return { blob, url: URL.createObjectURL(blob), w: c.width, h: c.height }
}

// Fractions of image size. field is set on boxes suggested by masks.ts until the user moves or keeps them; all boxes are burned in the same way.
type Box = { x: number; y: number; w: number; h: number; field?: string; method?: 'rule' | 'ai' }
// Canvas colours come from the CSS tokens (src/index.css), so the theme has one source.
const tok = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
function MaskTool({ img, initial, label, onDone, onCancel, onFindMore, aiNote }: { img: Img; initial: Box[]; label: string; onDone: (boxes: Box[]) => void; onCancel: () => void; onFindMore?: (current: Box[]) => Promise<Box[]>; aiNote?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [boxes, setBoxes] = useState<Box[]>(initial)
  const [more, setMore] = useState<'idle' | 'busy' | number | 'failed'>('idle') // the optional on-device check
  async function findMore() {
    setMore('busy')
    try { const extra = await onFindMore!(boxes); setBoxes((b) => [...b, ...extra]); setMore(extra.length) } catch { setMore('failed') }
  }
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [move, setMove] = useState<{ i: number; dx: number; dy: number } | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const pic = useRef<HTMLImageElement | null>(null)
  // Zoom for small screens: pinch with two fingers (which also pans), or the zoom buttons. One finger still draws.
  const [zoom, setZoom] = useState(1)
  const wrap = useRef<HTMLDivElement>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number; mx: number; my: number; sl: number; st: number } | null>(null)
  const spread = () => { const [a, b] = [...touches.current.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 } }
  const zoomTo = (z: number) => setZoom(Math.min(4, Math.max(1, Math.round(z * 100) / 100)))
  const nSuggested = boxes.filter((b) => b.field).length
  const numbers = new Map(boxes.flatMap((b, i) => (b.field ? [i] : [])).map((i, k) => [i, k + 1])) // box index -> chip number
  const FIELD: Record<string, string> = { name: 'name', patient_name: 'name', id: 'ID', patient_id: 'ID', phone: 'phone', doctor: "doctor's name", doctor_name: "doctor's name", 'age/sex': 'age and sex', age: 'age', sex: 'sex', barcode: 'barcode', address: 'address', date_of_birth: 'date of birth' }

  useEffect(() => {
    const el = new Image()
    el.onload = () => { pic.current = el; draw() }
    el.src = img.url
  }, [img.url]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => draw())

  function draw() {
    const c = canvas.current, el = pic.current
    if (!c || !el) return
    c.width = Math.min(800, c.parentElement!.clientWidth) * zoom
    c.height = (c.width * img.h) / img.w
    const g = c.getContext('2d')!
    g.drawImage(el, 0, 0, c.width, c.height)
    g.save(); g.scale(zoom, zoom) // chips and outlines keep their on-screen size
    const Z = (v: number) => v / zoom
    boxes.forEach((b, i) => {
      const [x, y, w, h] = [Z(b.x * c.width), Z(b.y * c.height), Z(b.w * c.width), Z(b.h * c.height)]
      if (b.field) {
        // Suggested: see-through so the user can check what is underneath; burned in solid black like the rest.
        g.fillStyle = tok('mask-fill')
        g.fillRect(x, y, w, h)
        g.strokeStyle = tok('mask-outline')
        g.lineWidth = 2
        g.strokeRect(x, y, w, h)
        // A numbered chip at the box's left edge; the list under the image says who suggested each one.
        // (Text beside each box collided on phone-width images.)
        const n = String(numbers.get(i)), r = 11
        g.fillStyle = tok('mask-chip') // darker than the box outline: white digits on it pass 4.5:1
        g.beginPath(); g.arc(Math.max(r, x - r - 2), y + h / 2, r, 0, 2 * Math.PI); g.fill()
        g.fillStyle = tok('card')
        g.font = `600 13px 'IBM Plex Sans', system-ui, sans-serif`
        g.textAlign = 'center'; g.textBaseline = 'middle'
        g.fillText(n, Math.max(r, x - r - 2), y + h / 2 + 1)
        g.textAlign = 'start'
      } else {
        g.fillStyle = tok('mask-black')
        g.fillRect(x, y, w, h)
      }
      if (i === sel) {
        g.strokeStyle = tok('ring')
        g.lineWidth = 3
        g.strokeRect(x - 2, y - 2, w + 4, h + 4)
      }
    })
    if (drag) {
      g.strokeStyle = tok('ring')
      g.lineWidth = 2
      g.strokeRect(Z(drag.x0 * c.width), Z(drag.y0 * c.height), Z((drag.x1 - drag.x0) * c.width), Z((drag.y1 - drag.y0) * c.height))
    }
    g.restore()
  }
  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  return (
    <div>
      {label && <p><b>{label}</b>{initial.some((b) => !b.field) && ' (your boxes from the previous page are copied here; move or redraw them if this page is laid out differently)'}</p>}
      <p>Draw a box over <b>your name, patient ID or UHID, phone number and the doctor's name</b>, plus any QR code or barcode: press and drag with your mouse or finger. Leave the test results visible.</p>
      <div className="legend" aria-hidden="true"><span><i style={{ background: 'var(--mask-fill)', border: '2px solid var(--mask-outline)' }} />Suggested, please check</span><span><i style={{ background: 'var(--mask-black)' }} />Your box</span></div>
      {nSuggested > 0 && (
        <p className="notice" data-testid="suggested-note">
          <b>{nSuggested} suggested box{nSuggested === 1 ? '' : 'es'}</b> (violet outline, found on this device). They can miss things or cover the wrong spot, so please check each one: drag a box to move it, or click it and press <i>Remove selected box</i>. Add any boxes they missed.
        </p>
      )}
      {onFindMore && (
        <p data-testid="find-more">
          <button disabled={more === 'busy'} onClick={findMore}>Look for more personal details (on-device AI)</button>{' '}<br />
          <span role="status">
            {more === 'busy' && 'Checking the text around your results, on this device. This can take up to a minute...'}
            {typeof more === 'number' && `Found ${more} more box${more === 1 ? '' : 'es'}. Nothing left this device.`}
            {more === 'failed' && 'The on-device AI could not check this page. The label suggestions are still here.'}
          </span>
        </p>
      )}
      {aiNote && <p className="muted" style={{ marginTop: 8 }} data-testid="mask-note">{aiNote}</p>}
      <div className="actions zoom-bar" role="group" aria-label="Zoom">
        <button className="quiet" disabled={zoom >= 4} onClick={() => zoomTo(zoom * 1.5)}>Zoom in</button>
        <button className="quiet" disabled={zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}>Zoom out</button>
        <span className="muted small" role="status">{zoom > 1 ? `${Math.round(zoom * 100)}%. Pinch or use two fingers to move around.` : 'On a phone, pinch with two fingers to zoom.'}</span>
      </div>
      <div className={`canvas-wrap${zoom > 1 ? ' zoomed' : ''}`} ref={wrap}>
        <canvas
          ref={canvas}
          aria-label="Your report. Press and drag to draw a black box; drag a box to move it. Keyboard: Tab tabs to the next box, arrow keys move it, Shift with arrow keys resizes it, Delete removes it."
          style={{ cursor: 'crosshair', touchAction: 'none', width: `${zoom * 100}%` }}
          tabIndex={0}
          // Keyboard path: select a box with Tab (or add one with the button below), then move, resize or remove it.
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey && boxes.length && (sel === null || sel < boxes.length - 1)) { e.preventDefault(); return setSel(sel === null ? 0 : sel + 1) }
            if (sel === null) return
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setBoxes(boxes.filter((_, i) => i !== sel)); return setSel(null) }
            const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
            if (!d) return
            e.preventDefault()
            const s = 0.01
            setBoxes(boxes.map((b, i) => {
              if (i !== sel) return b
              if (e.shiftKey) return { ...b, w: Math.min(1 - b.x, Math.max(0.01, b.w + d[0] * s)), h: Math.min(1 - b.y, Math.max(0.01, b.h + d[1] * s)) }
              return { ...b, x: Math.min(1 - b.w, Math.max(0, b.x + d[0] * s)), y: Math.min(1 - b.h, Math.max(0, b.y + d[1] * s)) }
            }))
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            if (e.pointerType === 'touch') touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (touches.current.size === 2) { // second finger: this is a pinch, not a box
              setDrag(null); setMove(null)
              const s = spread(), w = wrap.current!
              pinch.current = { d: s.d, z: zoom, mx: s.mx, my: s.my, sl: w.scrollLeft, st: w.scrollTop }
              return
            }
            if (touches.current.size > 2) return
            const p = at(e)
            const hit = boxes.findLastIndex((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
            setSel(hit < 0 ? null : hit)
            if (hit >= 0) setMove({ i: hit, dx: p.x - boxes[hit].x, dy: p.y - boxes[hit].y })
            else setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }}
          onPointerMove={(e) => {
            if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (pinch.current && touches.current.size === 2) {
              const s = spread(), k = pinch.current, w = wrap.current!
              const z = Math.min(4, Math.max(1, (k.z * s.d) / k.d))
              setZoom(z)
              // keep the point between the fingers under the fingers, and follow a two-finger pan
              const r = w.getBoundingClientRect()
              w.scrollLeft = ((k.sl + k.mx - r.left) * z) / k.z - (s.mx - r.left)
              w.scrollTop = ((k.st + k.my - r.top) * z) / k.z - (s.my - r.top)
              return
            }
            if (pinch.current) return
            const p = at(e)
            if (move) setBoxes(boxes.map((b, i) => (i === move.i ? { ...b, x: Math.min(1 - b.w, Math.max(0, p.x - move.dx)), y: Math.min(1 - b.h, Math.max(0, p.y - move.dy)) } : b)))
            else if (drag) setDrag({ ...drag, x1: p.x, y1: p.y })
          }}
          onPointerCancel={(e) => { touches.current.delete(e.pointerId); if (!touches.current.size) pinch.current = null; setDrag(null); setMove(null) }}
          onPointerUp={(e) => {
            touches.current.delete(e.pointerId)
            if (pinch.current) { if (!touches.current.size) pinch.current = null; return }
            if (drag && Math.abs(drag.x1 - drag.x0) > 0.005 && Math.abs(drag.y1 - drag.y0) > 0.005)
              setBoxes([...boxes, { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }])
            setDrag(null)
            setMove(null)
          }}
        />
      </div>
      {nSuggested > 0 && (
        <ol className="small" data-testid="suggested-list" style={{ paddingLeft: 22, margin: '4px 0 8px' }}>
          {boxes.map((b, i) => b.field && (
            <li key={i} value={numbers.get(i)}>Possibly your {FIELD[b.field] ?? b.field}: suggested by {b.method === 'ai' ? 'the on-device AI' : 'a label rule'}, please check</li>
          ))}
        </ol>
      )}
      <p className="muted" role="status">{boxes.length} box{boxes.length === 1 ? '' : 'es'} on this page.</p>
      <div className="actions">
        <button className="quiet" onClick={() => { setBoxes([...boxes, { x: 0.3, y: 0.08, w: 0.35, h: 0.04 }]); setSel(boxes.length); canvas.current?.focus() }}>Add a box</button>
        <button className="quiet" disabled={sel === null} onClick={() => { setBoxes(boxes.filter((_, i) => i !== sel)); setSel(null) }}>Remove selected box</button>
        <button className="quiet" disabled={!boxes.length} onClick={() => { setBoxes(boxes.slice(0, -1)); setSel(null) }}>Undo</button>
        <button className="quiet" disabled={!boxes.length} onClick={() => { setBoxes([]); setSel(null) }}>Clear</button>
      </div>
      <div className="actions">
        <button className="quiet" onClick={onCancel}>Cancel</button>
        {label && !boxes.length && <button onClick={() => onDone([])}>Nothing personal on this page</button>}
        <button className="primary" disabled={!boxes.length} onClick={() => onDone(boxes)}>Done masking</button>
      </div>
    </div>
  )
}

// Photos only: drag the 4 corners onto the page's corners, pre-placed by a cheap brightness guess (crop.ts).
function CropTool({ img, onDone }: { img: Img; onDone: (q: Quad | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pic = useRef<HTMLImageElement | null>(null)
  const [q, setQ] = useState<Quad | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  useEffect(() => {
    const el = new Image()
    el.onload = () => { pic.current = el; setQ(guessCorners(el)) }
    el.src = img.url
  }, [img.url])
  useEffect(() => {
    const c = canvas.current, el = pic.current
    if (!c || !el || !q) return
    c.width = Math.min(800, c.parentElement!.clientWidth)
    c.height = (c.width * img.h) / img.w
    const g = c.getContext('2d')!
    g.drawImage(el, 0, 0, c.width, c.height)
    g.strokeStyle = tok('primary'); g.lineWidth = 2; g.fillStyle = tok('crop-fill')
    g.beginPath(); q.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, p.x * c.width, p.y * c.height)); g.closePath(); g.stroke()
    const r = Math.max(12, c.width / 40) // big enough to grab with a finger
    for (const p of q) { g.beginPath(); g.arc(p.x * c.width, p.y * c.height, r, 0, 2 * Math.PI); g.fill(); g.stroke() }
  })
  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  return (
    <div>
      <p>Drag the four blue dots onto the four corners of the report page. We then straighten the page on this device, which makes the text easier to read. If the photo is already straight, you can skip this.</p>
      <div className="canvas-wrap">
        <canvas
          ref={canvas}
          aria-label="Report photo with four corner handles"
          style={{ touchAction: 'none', cursor: 'move' }}
          onPointerDown={(e) => {
            if (!q) return
            const p = at(e), r = canvas.current!.getBoundingClientRect()
            const d = q.map((c) => Math.hypot((c.x - p.x) * r.width, (c.y - p.y) * r.height))
            const i = d.indexOf(Math.min(...d))
            if (d[i] < 44) { e.currentTarget.setPointerCapture(e.pointerId); setDrag(i) }
          }}
          onPointerMove={(e) => drag !== null && q && setQ(q.map((c, i) => (i === drag ? at(e) : c)) as Quad)}
          onPointerUp={() => setDrag(null)}
        />
      </div>
      <div className="actions">
        <button className="quiet" onClick={() => onDone(null)}>Use the photo as it is</button>
        <button className="primary" disabled={!q} onClick={() => onDone(q)}>Straighten</button>
      </div>
    </div>
  )
}

// Upload: a drop zone around the native file input (which stays for keyboard and screen-reader use). Layout idea from
// Edu Calvo "File Upload" (MIT). A dropped file goes through the same checks as a chosen one (onFile).
const fileIcon = (label: string) => (
  <span className="file-icon"><svg viewBox="0 0 24 30" aria-hidden="true"><path d="M3 2h12l6 6v20H3z" fill="var(--card)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M15 2v6h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg><span>{label}</span></span>
)
function DropZone({ pdfOnly, onFile }: { pdfOnly: boolean; onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={`drop${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
    >
      <div className="drop-icons" aria-hidden="true">{fileIcon('PDF')}{!pdfOnly && <>{fileIcon('JPG')}{fileIcon('PNG')}</>}</div>
      <p className="drop-hint" aria-hidden="true">{dragging ? 'Drop it here' : 'Drag your file here, or choose it below'}</p>
      <label htmlFor="file" className="sr-only">{pdfOnly ? 'PDF file' : 'Photo or PDF file'}</label>
      <input id="file" type="file" accept={pdfOnly ? 'application/pdf' : 'image/*,application/pdf'} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <p className="drop-accepts small">{pdfOnly ? 'Accepts: the PDF your lab sent.' : 'Accepts: a photo, screenshot or PDF.'}</p>
    </div>
  )
}

export default function Flow() {
  const [avail, setAvail] = useState<Avail>('checking')
  const [path, setPath] = useState<Path | null>(null)
  const [step, setStep] = useState<Step>('choose')
  const [original, setOriginal] = useState<Img[] | null>(null)
  const [toSend, setToSend] = useState<Img[] | null>(null)
  const [masks, setMasks] = useState<Box[][]>([]) // one list of boxes per page, filled page by page
  const [consent, setConsent] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [pageWords, setPageWords] = useState<(Word[] | null)[]>([]) // PDF text layer per page; null for photos. Local only.
  const [suggest, setSuggest] = useState<Box[][]>([]) // suggested mask boxes per page (Path 2)
  const [ocrLines, setOcrLines] = useState<(Line[] | null)[]>([]) // OCR lines that are not results, per page (Path 2, local only)
  const [skipped, setSkipped] = useState<number[]>([]) // 1-based PDF pages with no results, never sent
  const [approved, setApproved] = useState<{ payload: Payload; checks: Check[]; confirmed: boolean[] } | null>(null)
  const [explained, setExplained] = useState<Explained | null>(null)
  const [cropped, setCropped] = useState(false)
  const devicePrep = useRef<Promise<void> | null>(null)
  // The 18+ notice is shown once per browser. Only this acknowledgement is remembered, never a report or a consent.
  const [adult, setAdult] = useState(() => { try { return localStorage.getItem(ADULT_KEY) === '1' } catch { return false } })
  // "Try a sample report" (/app?sample=demo): the synthetic demo.pdf, served as a static file, loaded as if chosen.
  const [sample, setSample] = useState(false)
  const wantsSample = useRef(new URLSearchParams(location.search).get('sample') === 'demo')

  useEffect(() => {
    if (typeof LanguageModel === 'undefined') return setAvail('no-api')
    LanguageModel.availability(TEXT_CREATE_OPTIONS).then((a) => setAvail(a as Avail), () => setAvail('error'))
  }, [])

  // The sample loads once the 18+ notice is answered, then the user picks a path as usual (PDF text and page image
  // are both kept, so every path works and Mask it yourself gets its suggested boxes from the PDF text).
  useEffect(() => {
    if (!adult || !wantsSample.current) return
    wantsSample.current = false
    ;(async () => {
      try {
        setProgress('Loading the sample report...')
        const res = await fetch('/samples/demo.pdf')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const all = await pdfPages(await res.blob())
        const pdf = all.some((p) => p.results) ? all.filter((p) => p.results) : all
        setSkipped(all.flatMap((p, i) => (pdf.includes(p) ? [] : [i + 1])))
        const pages = await Promise.all(pdf.flatMap((p) => (p.png ? [p.png] : [])).map((b) => reencode(b)))
        setPageWords(pdf.map((p) => p.words))
        setOriginal(pages)
        setSample(true)
        setProgress('')
      } catch (e) {
        setProgress('')
        setError(`The sample report could not be loaded (${(e as Error).message}). You can still add your own report.`)
      }
    })()
  }, [adult])

  // Each new screen moves keyboard and screen-reader focus to its heading (not on first load).
  const firstStep = useRef(true)
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return }
    const h = document.querySelector<HTMLElement>('#main section h2, #main section h1')
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: false }) }
  }, [step])

  // Start-up of the on-device model overlaps with what the user does next (upload, review). The status line says so honestly.
  function startWarm() {
    if (devicePrep.current) return
    setProgress('Preparing the on-device model...')
    devicePrep.current = warmText((v) => setProgress(`Downloading on-device model: ${Math.round(v * 100)}%`))
    const mine = (s: string) => s.startsWith('Preparing the on-device') || s.startsWith('Downloading on-device')
    devicePrep.current.then(() => setProgress((s) => (mine(s) ? '' : s)), (e) => setProgress(`On-device model could not start: ${e}`))
  }

  function reset() {
    for (const i of [...(original ?? []), ...(toSend ?? [])]) URL.revokeObjectURL(i.url)
    setOriginal(null); setToSend(null); setMasks([]); setPageWords([]); setSuggest([]); setOcrLines([]); setSkipped([]); setConsent(false); setError(''); setResult(null); setApproved(null); setExplained(null); setProgress(''); setPath(null); setCropped(false); setStep('choose')
    if (sample) { setSample(false); history.replaceState(null, '', '/app') } // Start over means your own report
  }

  function choose(p: Path) {
    setPath(p)
    setConsent(false) // consent is per report, per choice; never carried over
    setError('')
    // Must start from this click when a download is needed: Chrome only allows it after a user gesture.
    if (p === 1) startWarm()
    if (!original || (p !== 1 && !original.length)) return setStep('upload') // Path 1 kept no page images
    if (isPhotoFile && !cropped) return setStep('crop')
    proceed(p, original)
  }

  async function onFile(f: File) {
    try {
      setProgress(isPdf(f) ? 'Reading PDF pages on this device...' : '')
      // Path 1 needs only the PDF's text layer, so pages are not drawn as images. A PDF with no text is drawn after
      // all, because the user then picks Path 2 or 3.
      const textOnly = path === 1 && isPdf(f)
      let all = isPdf(f) ? await pdfPages(f, 2000, !textOnly) : null
      if (textOnly && !all!.some((p) => p.words.length)) all = await pdfPages(f)
      // Pages with no results (checked locally, pdf.ts) are dropped here: not masked, not shown for consent, not sent.
      const pdf = all && (all.some((p) => p.results) ? all.filter((p) => p.results) : all)
      setSkipped(all ? all.flatMap((p, i) => (pdf!.includes(p) ? [] : [i + 1])) : [])
      const pages = await Promise.all((pdf ? pdf.flatMap((p) => (p.png ? [p.png] : [])) : [f]).map((b) => reencode(b)))
      setProgress('')
      const words = pdf ? pdf.map((p) => p.words) : [null]
      setPageWords(words)
      setOriginal(pages)
      // A text PDF with the model already on this device: start loading it now (no download, so no gesture needed).
      if (words.some((w) => w?.length) && avail === 'available') startWarm()
      if (path === 1 && !words.some((w) => w?.length)) {
        // Path 1 reads a PDF's text on this device. Photos and scanned PDFs have no text, so the user picks Path 2 or 3.
        setPath(null)
        setError("Private reading works with the PDF your lab sent (it reads the PDF's text). This file has no text to read, so please choose how to continue below.")
        return setStep('choose')
      }
      if (!pdf) return setStep('crop') // photos: straighten first
      proceed(path!, pages, words)
    } catch (e) {
      setProgress('')
      setError(`Could not read that file (${(e as Error).message}). Please use a PDF, or a JPEG or PNG photo of the report.`)
    }
  }

  function proceed(p: Path, pages: Img[], words = pageWords) {
    if (p === 1) return runText(words)
    if (p === 2) { setMasks([]); return prepareMasks(pages, words) }
    setStep('consent')
  }

  // Suggested boxes from the PDF text layer, or from local OCR for photos and scanned pages. Never sent anywhere.
  async function prepareMasks(pages: Img[], words: (Word[] | null)[]) {
    const out: Box[][] = []
    const lines: (Line[] | null)[] = []
    try {
      for (const [i, img] of pages.entries()) {
        let w = words[i]
        if (!w?.length) {
          setProgress(`Looking for your details on page ${i + 1} of ${pages.length}, on this device...`)
          const t0 = performance.now()
          w = await ocrWords(img.blob)
          console.info(`ClearReport OCR page ${i + 1}: ${Math.round(performance.now() - t0)} ms, ${w.length} words`) // timing only, no text
        }
        const ocr = !words[i]?.length
        let found = suggestMasks(w, ocr)
        if (ocr && found.length < 2) {
          const w2 = await ocrWords(img.blob, true) // dim photo: retry with strong contrast, keep the better one
          const again = suggestMasks(w2, true)
          if (again.length > found.length) { found = again; w = w2 }
        }
        lines[i] = ocr ? nonResultLines(w) : null // kept in memory for the optional on-device check below
        out.push(found)
      }
    } catch (e) {
      console.warn('Mask suggestions unavailable:', String(e)) // the user can still mask by hand
    }
    setOcrLines(lines)
    setProgress('')
    setSuggest(out)
    setStep('mask')
  }

  // Optional, on the user's click: the on-device model points out personal details that have no label (a name
  // printed alone, an address) in the OCR lines that are not results. ONLY_ON_DEVICE, never the cloud.
  async function findMore(page: number, current: Box[]): Promise<Box[]> {
    const lines = ocrLines[page] ?? []
    const r = await findPersonal(lines.map((l) => l.text))
    const extra = aiBoxes(lines, r.found, current as Suggestion[])
    console.info(`ClearReport on-device mask check page ${page + 1}: ${extra.length} more boxes, ${r.calls} calls, ${r.ms} ms`) // counts only
    return extra
  }

  // Path 1: the PDF's text, identity removed locally (textrows.ts), read by the on-device model only.
  function runText(words: (Word[] | null)[]) {
    return read(words, async () => {
      const rows = rowsForModel(words.map((w) => w ?? []))
      // Rows the parser reads need no model; only leftover rows wait for the warm-up to finish.
      return extractRows('user', rows.batches, rows, (done, total) => setProgress(`Read ${done} of ${total} groups of rows on this device...`), async () => {
        setProgress('Preparing the on-device model...')
        await devicePrep.current
      })
    })
  }

  // Paths 2 and 3: one image per page to Gemini in the cloud.
  function run(pages: Img[]) {
    return read(pageWords, async () => {
      // Size only, never content: pixel size, type and bytes of each image sent.
      pages.forEach((p, i) => console.info(`ClearReport sending image ${i + 1}/${pages.length}: ${p.w}x${p.h} ${p.blob.type} ${Math.round(p.blob.size / 1024)} KB`))
      const images = await Promise.all(pages.map(async (p) => ({ mimeType: p.blob.type, data: await toB64(p.blob) })))
      if (pages.length > 1) setProgress(`Reading ${pages.length} pages...`)
      return extractDoc('user', 'cloud', images, (done, total) => total > 1 && setProgress(`Read ${done} of ${total} pages...`))
    })
  }

  // words: passed in, because Path 1 starts in the same tick the upload sets pageWords (state would still be stale here).
  async function read(words: (Word[] | null)[], go: () => Promise<Run>) {
    setStep('extracting')
    setError('')
    try {
      const r = await go()
      setProgress('')
      if (!r.ok) throw new Error(r.calls.find((c) => !c.ok)?.error ?? 'unknown error')
      const rows = ((r.output as { tests?: [] })?.tests ?? []) as Parameters<typeof trustOf>[0]
      const trust = trustOf(rows, words)
      // Path 1: drop any flag the on-device model gave that the PDF does not print beside the value.
      const output = r.strategy === 'rows' && r.output ? { ...r.output, tests: keepPrintedFlags(rows, trust) } : r.output
      setResult({ ...toPayload(output), run: r, trust })
      setStep('review')
    } catch (e) {
      setError(String(e))
      setStep('failed')
    }
  }

  // Only the approved anonymous payload and the plain-code range checks go to the explanation call.
  async function approve(payload: Payload, confirmed: boolean[]) {
    const checks = checkAll(payload)
    setApproved({ payload, checks, confirmed })
    setStep('explaining')
    setExplained(await explain(payload, checks)) // never throws: falls back to the template
    setStep('explained')
  }

  const noText = !!original && !pageWords.some((w) => w?.length) // a photo or a scanned PDF: Path 1 cannot read it
  const isPhotoFile = pageWords.length === 1 && pageWords[0] === null
  const showPath1 = canDevice(avail) && !noText
  const recommended: Path = showPath1 ? 1 : 2
  const pages = (n: number) => `${n} page${n === 1 ? '' : 's'}`

  return (
    <div className="app">
      <header>
        <p className="brand"><a href="/">ClearReport</a></p>
        <p>Understand your blood test report, in plain words, privately.</p>
      </header>
      <main className="content" id="main">
        <p className="notice no-print" data-testid="disclaimer">{DISCLAIMER}</p>
        {sample && <p className="notice calm sample-banner no-print" role="status" data-testid="sample-banner">You are using a synthetic sample report. No real person's data.</p>}

        {step === 'choose' && !original && (
          <section className="card hero" aria-labelledby="hero-title">
            <h1 id="hero-title">Your blood test report, explained in plain words, with your personal details kept on your device.</h1>
            <ol className="steps3">
              <li><b>1. Read</b>Your report's numbers are read, on this device when it can.</li>
              <li><b>2. Check</b>You see exactly what will be sent, with your name and details removed, and approve it.</li>
              <li><b>3. Explain</b>Gemini explains the anonymous numbers in plain English or Hindi, with questions for your doctor.</li>
            </ol>
          </section>
        )}

        {!adult && (
          <section className="card" style={{ borderColor: 'var(--primary)' }} data-testid="adult-notice" aria-labelledby="adult-title">
            <h2 id="adult-title">Before you start</h2>
            <p>ClearReport is for adults aged 18 and over. Results for children and teenagers use different ranges. If you are under 18, please go through your report with a parent or guardian and your doctor.</p>
            <button className="primary" onClick={() => { try { localStorage.setItem(ADULT_KEY, '1') } catch { /* private mode: ask again next time */ } setAdult(true) }}>I am 18 or older</button>
          </section>
        )}

        {adult && progress && <Busy>{progress}</Busy>}
        {adult && skipped.length > 0 && step !== 'choose' && (
          <p className="muted" data-testid="skipped">
            Page{skipped.length > 1 ? 's' : ''} {skipped.join(', ')} of your PDF {skipped.length > 1 ? 'have' : 'has'} no test results (checked on this device), so {skipped.length > 1 ? 'they are' : 'it is'} left out and never sent.
          </p>
        )}

        {adult && step === 'choose' && (
          <section className="card" aria-labelledby="choose-title">
            <h2 id="choose-title">How should we read your report?</h2>
            <p className={`notice ${canDevice(avail) ? 'calm' : ''}`} data-testid="availability" role="status">{avail === 'checking' ? <span className="status-line" style={{ margin: 0 }}><span className="spinner" aria-hidden="true" />{AVAIL_TEXT.checking}</span> : AVAIL_TEXT[avail]}</p>
            {error && <p className="notice" role="alert">{error}</p>}
            <div className="paths">
              {showPath1 && (
                <div className={`path private ${recommended === 1 ? 'recommended' : ''}`}>
                  <span className="tag">Recommended</span>
                  <h3>Private</h3>
                  <p>Your PDF is read on this device. Only anonymous results are sent for the explanation, and you approve them first.</p>
                  <p className="accepts">Accepts: the PDF your lab sent (not photos). If this device can't manage it, we say so; we never switch to the cloud on our own.</p>
                  <button className="primary" onClick={() => choose(1)}>Read it privately</button>
                </div>
              )}
              <div className={`path ${recommended === 2 ? 'recommended' : ''}`}>
                {recommended === 2 && <span className="tag">Recommended{noText ? '' : ' for this device'}</span>}
                <h3>Mask it yourself</h3>
                <p>You cover your name, ID, phone and doctor's name with black boxes. The covered copy is read by Google's Gemini in the cloud. You see the exact image before it is sent.</p>
                <p className="accepts">Accepts: a photo, screenshot or PDF. Works on a phone.</p>
                <button className={recommended === 2 ? 'primary' : ''} onClick={() => choose(2)}>Mask my details</button>
              </div>
              {/* Not offered here, but shown greyed so people know it exists and what it needs. */}
              {!showPath1 && !noText && avail !== 'checking' && (
                <div className="path unavailable" data-testid="path1-unavailable" role="group" aria-labelledby="p1-off">
                  <span className="tag off">Not available on this device</span>
                  <h3 id="p1-off">Private</h3>
                  <p>Needs Chrome on a laptop with 16 GB RAM or a graphics card with more than 4 GB memory.</p>
                  <details className="mini how">
                    <summary>See how private reading works</summary>
                    <ol className="how-steps">
                      <li>Chrome's built-in AI reads your lab PDF on the device itself.</li>
                      <li>Your name, ID and phone are removed on the device, before anything is sent.</li>
                      <li>Only the anonymous numbers go to Gemini, after you approve them.</li>
                    </ol>
                    <div className="how-map" role="img" aria-label="Diagram: your PDF is read and cleaned on this device; only anonymous numbers go to Gemini in the cloud.">
                      <span className="box device">PDF</span><span aria-hidden="true">→</span>
                      <span className="box device">Read + remove details<small>on this device</small></span><span aria-hidden="true">→</span>
                      <span className="box cloud">Numbers only<small>to Gemini</small></span>
                    </div>
                  </details>
                  <button disabled>Read it privately</button>
                </div>
              )}
              {config().path3 && (
                <div className="path full">
                  <h3>Send the full report</h3>
                  <p>The whole report, including your name, is sent to Google's Gemini to be read. Only choose this if you are comfortable with that.</p>
                  <p className="accepts">Accepts: a photo, screenshot or PDF. Asks for your consent first.</p>
                  <button onClick={() => choose(3)}>Review what this means</button>
                </div>
              )}
            </div>
          </section>
        )}

        {step === 'upload' && (
          <section className="card" aria-labelledby="upload-title">
            <h2 id="upload-title">{path === 1 ? 'Add the PDF from your lab' : 'Add a photo or PDF of your report'}</h2>
            <p>{path === 1
              ? 'Choose the PDF file your lab sent you (by email, app or website). It is read on this device.'
              : 'Choose the PDF from your lab, or take a clear, flat photo of each page in good light. A screenshot works too.'}</p>
            <DropZone pdfOnly={path === 1} onFile={onFile} />
            {error && <p className="notice error" role="alert">{error}</p>}
            <div className="actions"><button className="quiet" onClick={reset}>Back</button></div>
          </section>
        )}

        {step === 'crop' && original && (
          <section className="card" aria-labelledby="crop-title">
            <h2 id="crop-title">Straighten the photo</h2>
            <CropTool
              img={original[0]}
              onDone={async (q) => {
                let pages = original
                if (q) {
                  const img = await reencode(await straighten(original[0].blob, q))
                  URL.revokeObjectURL(original[0].url)
                  pages = [img]
                  setOriginal(pages)
                }
                setCropped(true)
                proceed(path!, pages, [null])
              }}
            />
          </section>
        )}

        {step === 'mask' && original && (
          <section className="card" aria-labelledby="mask-title">
            <h2 id="mask-title">Cover your personal details</h2>
            <MaskTool
              onFindMore={ocrLines[masks.length] && avail === 'available' ? (cur) => findMore(masks.length, cur) : undefined}
              aiNote={ocrLines[masks.length] && avail !== 'available' ? 'The on-device AI is not available on this device, so these suggestions come from label rules only.' : ''}
              key={masks.length}
              img={original[masks.length]}
              initial={[...(masks.at(-1) ?? []).filter((b) => !b.field), ...(suggest[masks.length] ?? [])]}
              label={original.length > 1 ? `Page ${masks.length + 1} of ${original.length}` : ''}
              onCancel={reset}
              onDone={async (boxes) => {
                const all = [...masks, boxes]
                if (all.length < original.length) return setMasks(all)
                for (const i of toSend ?? []) URL.revokeObjectURL(i.url)
                setToSend(await Promise.all(original.map((p, i) => reencode(p.blob, all[i]))))
                setMasks(all)
                setStep('confirm-masked')
              }}
            />
          </section>
        )}

        {step === 'confirm-masked' && toSend && (
          <section className="card" aria-labelledby="confirm-title">
            <h2 id="confirm-title">{toSend.length > 1 ? `These exact ${toSend.length} images will be sent` : 'This exact image will be sent'}</h2>
            <p>Check that your name, ID, phone and doctor's name are fully covered{toSend.length > 1 ? ' on every page' : ''}. {toSend.length > 1 ? 'These images' : 'This image'} (and nothing else from your device) {toSend.length > 1 ? 'go' : 'goes'} to Google's Gemini to be read.</p>
            {toSend.map((p, i) => <img key={i} src={p.url} alt={`Masked page ${i + 1} that will be sent`} style={{ border: '2px solid var(--ink)', borderRadius: 8, marginBottom: 8 }} />)}
            <div className="actions">
              <button className="quiet" onClick={() => { setMasks([]); setStep('mask') }}>Fix the boxes</button>
              <button className="primary" onClick={() => run(toSend)}>Send {toSend.length > 1 ? 'these images' : 'this image'}</button>
            </div>
          </section>
        )}

        {step === 'consent' && original && (
          <section className="card" aria-labelledby="consent-title">
            <h2 id="consent-title">Before you send the full report</h2>
            <ul>
              <li>The <b>full {original.length > 1 ? pages(original.length) : 'photo'} of this report, including your name and any other details on {original.length > 1 ? 'them' : 'it'}</b>, will be sent to Google's Gemini to be read.</li>
              <li>ClearReport does not store the report. Google processes it under the Gemini API terms.</li>
              <li>This applies to this one report only. We will ask again next time.</li>
              <li>If you'd rather not, go back and cover your details yourself instead.</li>
            </ul>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {original.map((p, i) => <img key={i} src={p.url} alt={`Page ${i + 1} that will be sent`} style={{ maxWidth: 180, border: '1px solid var(--border)', borderRadius: 6 }} />)}
            </div>
            <p style={{ marginTop: 14 }}>
              <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I understand and agree to send the full image of this report, including my name, to Google's Gemini.</label>
            </p>
            <div className="actions">
              <button className="quiet" onClick={() => { setPath(2); setConsent(false); setMasks([]); prepareMasks(original, pageWords) }}>Cover my details instead</button>
              <button className="primary" disabled={!consent} onClick={() => run(original)}>Send the full report</button>
            </div>
          </section>
        )}

        {step === 'extracting' && !progress && (
          <section className="card"><Busy>{path === 1 ? 'Reading your report on this device. This can take a minute the first time...' : 'Gemini is reading your report. This usually takes 10 to 40 seconds...'}</Busy></section>
        )}

        {step === 'failed' && (
          <section className="card" aria-labelledby="failed-title" style={{ borderColor: 'var(--error-border)' }}>
            <h2 id="failed-title">{path === 1 ? 'Private reading did not work on this device' : 'We could not read your report this time'}</h2>
            <p>{path === 1 ? 'Nothing was sent anywhere. You can choose another way to continue.' : 'Nothing was saved. This is usually a network problem; trying again often works.'}</p>
            <details className="mini"><summary>Technical details</summary><p className="muted small">{error}</p></details>
            <div className="actions">
              {path === 1 ? (
                <>
                  <button className="primary" onClick={() => choose(2)}>Mask my details yourself</button>
                  {config().path3 && <button onClick={() => choose(3)}>Send the full report (asks for consent)</button>}
                </>
              ) : (
                <button className="primary" onClick={() => proceed(path!, original!)}>Try again</button>
              )}
              <button className="quiet" onClick={reset}>Start over</button>
            </div>
          </section>
        )}

        {step === 'review' && result && <Review result={result} onCancel={reset} onApprove={approve} />}

        {step === 'explaining' && (
          <section className="card"><Busy>Writing a plain-language explanation from the anonymous summary you approved. This takes about 10 to 30 seconds...</Busy></section>
        )}

        {step === 'explained' && approved && explained && result && (
          <Explanation payload={approved.payload} checks={approved.checks} badges={result.trust.map((t) => t.badge)} confirmed={approved.confirmed} explained={explained} readBy={[...new Set(result.run.calls.flatMap((c) => (c.ok && c.model ? [c.model] : [])))]} onDone={reset} />
        )}
      </main>
      <DataTrail path={path} step={step} hasFile={!!original} />
    </div>
  )
}
