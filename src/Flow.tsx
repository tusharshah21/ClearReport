import { useEffect, useRef, useState } from 'react'
import { DEVICE_CREATE_OPTIONS, extractDoc, model, toB64, type Mode } from './extract'
import { DISCLAIMER } from './guidelines'
import { ocrWords, suggestMasks } from './masks'
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
const ADULT_KEY = 'clearreport.adult-notice-seen'
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
  // PDF pages stay PNG: JPEG artifacts around watermarks made the model mark far more values unreadable (WM14: 20 rows vs 1).
  const type = src.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('encode failed'))), type, 0.92))
  return { blob, url: URL.createObjectURL(blob), w: c.width, h: c.height }
}

// Fractions of image size. field is set on boxes suggested by masks.ts until the user moves or keeps them; all boxes are burned in the same way.
type Box = { x: number; y: number; w: number; h: number; field?: string }
const SUGGESTED = '#e07000'
function MaskTool({ img, initial, label, onDone, onCancel }: { img: Img; initial: Box[]; label: string; onDone: (boxes: Box[]) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [boxes, setBoxes] = useState<Box[]>(initial)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [move, setMove] = useState<{ i: number; dx: number; dy: number } | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const pic = useRef<HTMLImageElement | null>(null)
  const nSuggested = boxes.filter((b) => b.field).length

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
    boxes.forEach((b, i) => {
      const [x, y, w, h] = [b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height]
      if (b.field) {
        // Suggested: see-through so the user can check what is underneath; burned in solid black like the rest.
        g.fillStyle = 'rgba(224, 112, 0, 0.45)'
        g.fillRect(x, y, w, h)
        g.strokeStyle = SUGGESTED
        g.lineWidth = 2
        g.strokeRect(x, y, w, h)
        g.font = '11px system-ui, sans-serif'
        g.fillStyle = SUGGESTED
        g.textBaseline = 'middle'
        g.fillText('Suggested, please check', x + w + 4, y + h / 2) // beside the box: stacked rows would overlap labels above
      } else {
        g.fillStyle = '#000'
        g.fillRect(x, y, w, h)
      }
      if (i === sel) {
        g.strokeStyle = '#06c'
        g.lineWidth = 3
        g.strokeRect(x - 2, y - 2, w + 4, h + 4)
      }
    })
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
      {label && <p><b>{label}</b>{initial.some((b) => !b.field) && ' (your boxes from the previous page are copied here; move or redraw them if this page is laid out differently)'}</p>}
      <p>Drag to draw black boxes over <b>your name, patient ID / UHID, phone number and the doctor's name</b>, plus any QR code or barcode. Leave the test results visible.</p>
      {nSuggested > 0 && (
        <p style={{ background: '#fff4e0', padding: 8 }} data-testid="suggested-note">
          <b style={{ color: SUGGESTED }}>{nSuggested} suggested box{nSuggested === 1 ? '' : 'es'}</b> (orange, found on this device). They can miss things or cover the wrong spot, so please check each one: drag a box to move it, or click it and press <i>Remove selected box</i>. Add any boxes they missed.
        </p>
      )}
      <div style={{ maxWidth: 800 }}>
        <canvas
          ref={canvas}
          style={{ width: '100%', cursor: 'crosshair', touchAction: 'none', border: '1px solid #999' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = at(e)
            const hit = boxes.findLastIndex((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
            setSel(hit < 0 ? null : hit)
            if (hit >= 0) setMove({ i: hit, dx: p.x - boxes[hit].x, dy: p.y - boxes[hit].y })
            else setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }}
          onPointerMove={(e) => {
            const p = at(e)
            if (move) setBoxes(boxes.map((b, i) => (i === move.i ? { ...b, x: Math.min(1 - b.w, Math.max(0, p.x - move.dx)), y: Math.min(1 - b.h, Math.max(0, p.y - move.dy)) } : b)))
            else if (drag) setDrag({ ...drag, x1: p.x, y1: p.y })
          }}
          onPointerUp={() => {
            if (drag && Math.abs(drag.x1 - drag.x0) > 0.005 && Math.abs(drag.y1 - drag.y0) > 0.005)
              setBoxes([...boxes, { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }])
            setDrag(null)
            setMove(null)
          }}
        />
      </div>
      <p>
        {boxes.length} box{boxes.length === 1 ? '' : 'es'}.{' '}
        <button disabled={sel === null} onClick={() => { setBoxes(boxes.filter((_, i) => i !== sel)); setSel(null) }}>Remove selected box</button>{' '}
        <button disabled={!boxes.length} onClick={() => { setBoxes(boxes.slice(0, -1)); setSel(null) }}>Undo</button>{' '}
        <button disabled={!boxes.length} onClick={() => { setBoxes([]); setSel(null) }}>Clear</button>{' '}
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
  const [suggest, setSuggest] = useState<Box[][]>([]) // suggested mask boxes per page (Path 2)
  const [skipped, setSkipped] = useState<number[]>([]) // 1-based PDF pages with no results, never sent
  const devicePrep = useRef<Promise<void> | null>(null)
  // The 18+ notice is shown once per browser. Only this acknowledgement is remembered, never a report or a consent.
  const [adult, setAdult] = useState(() => { try { return localStorage.getItem(ADULT_KEY) === '1' } catch { return false } })

  useEffect(() => {
    if (typeof LanguageModel === 'undefined') return setAvail('no-api')
    LanguageModel.availability(DEVICE_CREATE_OPTIONS).then((a) => setAvail(a as Avail), () => setAvail('error'))
  }, [])

  function reset() {
    for (const i of [...(original ?? []), ...(toSend ?? [])]) URL.revokeObjectURL(i.url)
    setOriginal(null); setToSend(null); setMasks([]); setPageWords([]); setSuggest([]); setSkipped([]); setConsent(false); setError(''); setResult(null); setProgress(''); setPath(null); setStep('choose')
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
      const all = isPdf(f) ? await pdfPages(f) : null
      // Pages with no results (checked locally, pdf.ts) are dropped here: not masked, not shown for consent, not sent.
      const pdf = all && (all.some((p) => p.results) ? all.filter((p) => p.results) : all)
      setSkipped(all ? all.flatMap((p, i) => (pdf!.includes(p) ? [] : [i + 1])) : [])
      const pages = await Promise.all((pdf ? pdf.map((p) => p.png) : [f]).map((b) => reencode(b)))
      setProgress('')
      const words = pdf ? pdf.map((p) => p.words) : [null]
      setPageWords(words)
      setOriginal(pages)
      proceed(path!, pages, words)
    } catch (e) {
      setProgress('')
      setError(`Could not read that file (${(e as Error).message}). Please use a PDF, or a JPEG or PNG photo of the report.`)
    }
  }

  function proceed(p: Path, pages: Img[], words = pageWords) {
    if (p === 1) return run('device', pages)
    if (p === 2) { setMasks([]); return prepareMasks(pages, words) }
    setStep('consent')
  }

  // Suggested boxes from the PDF text layer, or from local OCR for photos and scanned pages. Never sent anywhere.
  async function prepareMasks(pages: Img[], words: (Word[] | null)[]) {
    const out: Box[][] = []
    try {
      for (const [i, img] of pages.entries()) {
        let w = words[i]
        if (!w?.length) {
          setProgress(`Looking for your details on page ${i + 1} of ${pages.length}, on this device...`)
          const t0 = performance.now()
          w = await ocrWords(img.blob)
          console.info(`ClearReport OCR page ${i + 1}: ${Math.round(performance.now() - t0)} ms, ${w.length} words`) // timing only, no text
        }
        out.push(suggestMasks(w))
      }
    } catch (e) {
      console.warn('Mask suggestions unavailable:', String(e)) // the user can still mask by hand
    }
    setProgress('')
    setSuggest(out)
    setStep('mask')
  }

  async function run(mode: Mode, pages: Img[]) {
    setStep('extracting')
    setError('')
    try {
      if (mode === 'device') await devicePrep.current
      const images = await Promise.all(pages.map(async (p) => ({ mimeType: p.blob.type, data: await toB64(p.blob) })))
      // One page per call. Same mode for every retry: a failed private read never falls back to the cloud.
      if (pages.length > 1) setProgress(`Reading ${pages.length} pages...`)
      const r = await extractDoc('user', mode, images, (done, total) => total > 1 && setProgress(`Read ${done} of ${total} pages...`))
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
      <p style={{ marginTop: 0, color: '#555' }}>Understand your blood test report, privately.</p>
      <p style={{ ...box, background: '#fffbe6' }} data-testid="disclaimer">{DISCLAIMER}</p>
      {!adult && (
        <section style={{ ...box, borderColor: '#b35900' }} data-testid="adult-notice">
          <h2>Before you start</h2>
          <p>ClearReport is for adults aged 18 and over. Results for children and teenagers use different ranges. If you are under 18, please go through your report with a parent or guardian and your doctor.</p>
          <button onClick={() => { try { localStorage.setItem(ADULT_KEY, '1') } catch { /* private mode: ask again next time */ } setAdult(true) }}><b>I am 18 or older</b></button>
        </section>
      )}
      {adult && <p style={{ ...box, background: canDevice(avail) ? '#eef8ee' : '#f6f6f6' }} data-testid="availability">{AVAIL_TEXT[avail]}</p>}
      {adult && progress && <p>{progress}</p>}
      {adult && skipped.length > 0 && step !== 'choose' && (
        <p style={{ color: '#555' }} data-testid="skipped">
          Page{skipped.length > 1 ? 's' : ''} {skipped.join(', ')} of your PDF {skipped.length > 1 ? 'have' : 'has'} no test results (checked on this device), so {skipped.length > 1 ? 'they are' : 'it is'} left out and never sent.
        </p>
      )}

      {adult && step === 'choose' && (
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
