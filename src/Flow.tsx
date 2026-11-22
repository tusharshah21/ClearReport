import { useEffect, useRef, useState } from 'react'
import { DEVICE_CREATE_OPTIONS, extractDoc, model, toB64, type Mode } from './extract'
import { isPdf, pdfPages } from './pdf'
import { toPayload } from './privacy'
import Review, { type Result } from './Review'
import type { Word } from './textlayer'
import { trustOf } from './trust'

// Images (one per page; a PDF is rendered to one PNG per page) live only in memory (Blob + object URL) for the life of one report. Nothing is written
// to storage, logged, or sent anywhere except the single extraction request of the chosen path.

declare const LanguageModel: { availability(o: object): Promise<string> } | undefined
type Avail = 'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api' | 'error'
type Path = 1 | 2 | 3
type Img = { blob: Blob; url: string; w: number; h: number }
type Step = 'choose' | 'upload' | 'mask' | 'confirm-masked' | 'consent' | 'extracting' | 'failed' | 'review' | 'approved'

const AVAIL_TEXT: Record<Avail, string> = {
  checking: 'Checking whether this device can read reports privately...',
  available: 'Good news: this device can read your report privately. The on-device model is ready, so the photo never leaves your computer.',
  downloadable: 'This device can read your report privately, but Chrome first needs a one-time download of its built-in AI model (a few GB). It starts when you choose Private.',
  downloading: 'This device can read your report privately. Chrome is still downloading its built-in AI model; Private will wait for it to finish.',
  unavailable: 'This device cannot run Chrome\'s built-in AI model (Chrome reports it as unavailable, usually not enough memory or graphics power). You can still mask your details yourself.',
  'no-api': 'This browser does not have Chrome\'s built-in AI. Private on-device reading needs desktop Chrome 139 or newer. You can still mask your details yourself.',
  error: 'Could not check for on-device AI. You can still mask your details yourself.',
}
const canDevice = (a: Avail) => a === 'available' || a === 'downloadable' || a === 'downloading'

// Decode (applying EXIF rotation), draw, re-encode as JPEG. The re-encode drops all EXIF/GPS metadata.
async function reencode(src: Blob, boxes: Box[] = []): Promise<Img> {
  const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' })
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  const g = c.getContext('2d')!
  g.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  g.fillStyle = '#000'
  for (const b of boxes) g.fillRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height) // burned into pixels
  const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('encode failed'))), 'image/jpeg', 0.92))
  return { blob, url: URL.createObjectURL(blob), w: c.width, h: c.height }
}

type Box = { x: number; y: number; w: number; h: number } // fractions of image size
function MaskTool({ img, initial, label, onDone, onCancel }: { img: Img; initial: Box[]; label: string; onDone: (boxes: Box[]) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [boxes, setBoxes] = useState<Box[]>(initial)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const pic = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const el = new Image()
    el.onload = () => { pic.current = el; draw() }
    el.src = img.url
  }, [img.url]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => draw())

  function draw() {
    const c = canvas.current, el = pic.current
    if (!c || !el) return
    c.width = Math.min(800, c.parentElement!.clientWidth)
    c.height = (c.width * img.h) / img.w
    const g = c.getContext('2d')!
    g.drawImage(el, 0, 0, c.width, c.height)
    g.fillStyle = '#000'
    for (const b of boxes) g.fillRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height)
    if (drag) {
      g.strokeStyle = '#e00'
      g.lineWidth = 2
      g.strokeRect(drag.x0 * c.width, drag.y0 * c.height, (drag.x1 - drag.x0) * c.width, (drag.y1 - drag.y0) * c.height)
    }
  }
  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  return (
    <div>
      {label && <p><b>{label}</b>{initial.length > 0 && ' (boxes copied from the previous page; move or redraw them if this page is laid out differently)'}</p>}
      <p>Drag to draw black boxes over <b>your name, patient ID / UHID, phone number and the doctor's name</b>, plus any QR code or barcode. Leave the test results visible.</p>
      <div style={{ maxWidth: 800 }}>
        <canvas
          ref={canvas}
          style={{ width: '100%', cursor: 'crosshair', touchAction: 'none', border: '1px solid #999' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }) }}
          onPointerMove={(e) => drag && setDrag({ ...drag, x1: at(e).x, y1: at(e).y })}
          onPointerUp={() => {
            if (drag && Math.abs(drag.x1 - drag.x0) > 0.005 && Math.abs(drag.y1 - drag.y0) > 0.005)
              setBoxes([...boxes, { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }])
            setDrag(null)
          }}
        />
      </div>
      <p>
        {boxes.length} box{boxes.length === 1 ? '' : 'es'}.{' '}
        <button disabled={!boxes.length} onClick={() => setBoxes(boxes.slice(0, -1))}>Undo</button>{' '}
        <button disabled={!boxes.length} onClick={() => setBoxes([])}>Clear</button>{' '}
        <button onClick={onCancel}>Cancel</button>{' '}
        <button disabled={!boxes.length} onClick={() => onDone(boxes)}><b>Done masking</b></button>{' '}
        {label && !boxes.length && <button onClick={() => onDone([])}>Nothing personal on this page</button>}
      </p>
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
  const devicePrep = useRef<Promise<void> | null>(null)

  useEffect(() => {
    if (typeof LanguageModel === 'undefined') return setAvail('no-api')
    LanguageModel.availability(DEVICE_CREATE_OPTIONS).then((a) => setAvail(a as Avail), () => setAvail('error'))
  }, [])

  function reset() {
    for (const i of [...(original ?? []), ...(toSend ?? [])]) URL.revokeObjectURL(i.url)
    setOriginal(null); setToSend(null); setMasks([]); setPageWords([]); setConsent(false); setError(''); setResult(null); setProgress(''); setPath(null); setStep('choose')
  }

  function choose(p: Path) {
    setPath(p)
    setConsent(false) // consent is per report, per choice; never carried over
    setError('')
    if (p === 1 && !devicePrep.current) {
      // Must start from this click: Chrome only allows the model download after a user gesture.
      devicePrep.current = model('device', 'full').initializeDeviceModel((v) => setProgress(`Downloading on-device model: ${Math.round(v * 100)}%`))
      devicePrep.current.then(() => setProgress(''), (e) => setProgress(`On-device model could not start: ${e}`))
    }
    if (!original) return setStep('upload')
    proceed(p, original)
  }

  async function onFile(f: File) {
    try {
      setProgress(isPdf(f) ? 'Reading PDF pages on this device...' : '')
      const pdf = isPdf(f) ? await pdfPages(f) : null
      const pages = await Promise.all((pdf ? pdf.map((p) => p.png) : [f]).map((b) => reencode(b)))
      setProgress('')
      setPageWords(pdf ? pdf.map((p) => p.words) : [null])
      setOriginal(pages)
      proceed(path!, pages)
    } catch (e) {
      setProgress('')
      setError(`Could not read that file (${(e as Error).message}). Please use a PDF, or a JPEG or PNG photo of the report.`)
    }
  }

  function proceed(p: Path, pages: Img[]) {
    if (p === 1) return run('device', pages)
    if (p === 2) { setMasks([]); return setStep('mask') }
    setStep('consent')
  }

  async function run(mode: Mode, pages: Img[]) {
    setStep('extracting')
    setError('')
    try {
      if (mode === 'device') await devicePrep.current
      const images = await Promise.all(pages.map(async (p) => ({ mimeType: 'image/jpeg', data: await toB64(p.blob) })))
      // One page per call. Same mode for every retry: a failed private read never falls back to the cloud.
      const r = await extractDoc('user', mode, images, (i) => pages.length > 1 && setProgress(`Reading page ${i + 1} of ${pages.length}...`))
      setProgress('')
      if (!r.ok) throw new Error(r.calls.find((c) => !c.ok)?.error ?? 'unknown error')
      const rows = ((r.output as { tests?: [] })?.tests ?? []) as Parameters<typeof trustOf>[0]
      setResult({ ...toPayload(r.output), run: r, trust: trustOf(rows, pageWords) })
      setStep('review')
    } catch (e) {
      setError(String(e))
      setStep('failed')
    }
  }

  const box = { border: '1px solid #bbb', borderRadius: 6, padding: 12, margin: '10px 0' }
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto', padding: 16, lineHeight: 1.45 }}>
      <h1 style={{ marginBottom: 4 }}>ClearReport</h1>
      <p style={{ marginTop: 0, color: '#555' }}>Understand your blood test report, privately. Not medical advice.</p>
      <p style={{ ...box, background: canDevice(avail) ? '#eef8ee' : '#f6f6f6' }} data-testid="availability">{AVAIL_TEXT[avail]}</p>
      {progress && <p>{progress}</p>}

      {step === 'choose' && (
        <section>
          <h2>How should we read your report?</h2>
          {canDevice(avail) && (
            <div style={{ ...box, borderColor: '#2a7' }}>
              <h3>1. Private <small>(recommended)</small></h3>
              <p>Your photo is read by AI that runs inside Chrome on this device. It is never uploaded. If this device can't manage it, we'll tell you and you can pick another option; we never switch to the cloud on our own.</p>
              <button onClick={() => choose(1)}><b>Read it privately</b></button>
            </div>
          )}
          <div style={{ ...box, borderColor: canDevice(avail) ? '#bbb' : '#2a7' }}>
            <h3>{canDevice(avail) ? '2. ' : ''}Mask it yourself {!canDevice(avail) && <small>(recommended for this device)</small>}</h3>
            <p>You cover your name, ID, phone and doctor's name with black boxes. The boxes are burned into a new copy of the photo, which is then read by Google's Gemini AI in the cloud. You see the exact image before it is sent.</p>
            <button onClick={() => choose(2)}>Mask my details</button>
          </div>
          <div style={box}>
            <h3>{canDevice(avail) ? '3. ' : ''}Send the full report <small>(needs your consent)</small></h3>
            <p>The whole photo, including your name, is sent to Google's Gemini AI to be read. Only choose this if you are comfortable with that.</p>
            <button onClick={() => choose(3)}>Review what this means</button>
          </div>
        </section>
      )}

      {step === 'upload' && (
        <section style={box}>
          <h2>Add a photo of your report</h2>
          <p>The PDF from your lab, or a clear, flat photo or screenshot of each page.</p>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />{' '}
          <button onClick={reset}>Back</button>
          {error && <p style={{ color: '#b00' }}>{error}</p>}
        </section>
      )}

      {step === 'mask' && original && (
        <section style={box}>
          <h2>Cover your personal details</h2>
          <MaskTool
            key={masks.length}
            img={original[masks.length]}
            initial={masks.at(-1) ?? []}
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
        <section style={box}>
          <h2>{toSend.length > 1 ? `These exact ${toSend.length} images will be sent.` : 'This exact image will be sent.'}</h2>
          <p>Check that your name, ID, phone and doctor's name are fully covered{toSend.length > 1 ? ' on every page' : ''}. {toSend.length > 1 ? 'These images' : 'This image'} (and nothing else from your device) {toSend.length > 1 ? 'go' : 'goes'} to Google's Gemini AI to be read, one page at a time.</p>
          {toSend.map((p, i) => <img key={i} src={p.url} alt={`Masked page ${i + 1} that will be sent`} style={{ maxWidth: '100%', border: '2px solid #333', marginBottom: 8 }} />)}
          <p>
            <button onClick={() => { setMasks([]); setStep('mask') }}>Fix the boxes</button>{' '}
            <button onClick={() => run('cloud', toSend)}><b>Send this image</b></button>
          </p>
        </section>
      )}

      {step === 'consent' && original && (
        <section style={box}>
          <h2>Before you send the full report</h2>
          <ul>
            <li>The <b>full {original.length > 1 ? `${original.length} pages` : 'photo'} of this report, including your name and any other details on {original.length > 1 ? 'them' : 'it'}</b>, will be sent to Google's Gemini API to be read.</li>
            <li>ClearReport does not store the photo. Google processes it under the Gemini API terms.</li>
            <li>This applies to this one report only. We will ask again next time.</li>
            <li>If you'd rather not, go back and mask your details yourself instead.</li>
          </ul>
          {original.map((p, i) => <img key={i} src={p.url} alt={`Page ${i + 1} that will be sent`} style={{ maxWidth: 200, border: '1px solid #999', marginRight: 6 }} />)}
          <p>
            <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I understand and agree to send the full image of this report, including my name, to Google's Gemini API.</label>
          </p>
          <p>
            <button onClick={() => { setConsent(false); setMasks([]); setStep('mask') }}>Mask my details instead</button>{' '}
            <button disabled={!consent} onClick={() => run('cloud', original)}><b>Send full report to Gemini</b></button>
          </p>
        </section>
      )}

      {step === 'extracting' && <p style={box}>Reading your report{path === 1 ? ' on this device (this can take a minute)' : ''}...</p>}

      {step === 'failed' && (
        <section style={{ ...box, borderColor: '#b00' }}>
          <h2>{path === 1 ? 'Private reading did not work on this device' : 'Reading failed'}</h2>
          <p style={{ color: '#555', fontSize: 13 }}>{error}</p>
          {path === 1 ? (
            <>
              <p>Nothing was sent anywhere. You can choose another option:</p>
              <button onClick={() => choose(2)}>Mask my details yourself</button>{' '}
              <button onClick={() => choose(3)}>Send the full report (asks for consent)</button>{' '}
            </>
          ) : (
            <button onClick={() => proceed(path!, original!)}>Try again</button>
          )}{' '}
          <button onClick={reset}>Start over</button>
        </section>
      )}

      {step === 'review' && result && <Review result={result} onCancel={reset} onApprove={() => setStep('approved')} />}

      {step === 'approved' && (
        <section style={box}>
          <h2>Approved</h2>
          <p>The explanation step is not built yet (next milestone). Nothing has been sent for explanation.</p>
          <button onClick={reset}>Read another report</button>
        </section>
      )}
    </main>
  )
}
