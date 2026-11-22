// Renders each PDF page to a PNG in the browser (pdf.js). Nothing leaves the device here.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl
export const MAX_PAGES = 10 // ponytail: hard cap so one upload can't trigger dozens of model calls; raise if real reports need it

export const isPdf = (f: Blob) => f.type === 'application/pdf'

export async function pdfToPngs(file: Blob, longSide = 2000): Promise<Blob[]> {
  // isEvalSupported:false: pdf.js never compiles code from the file (defence in depth for untrusted PDFs).
  const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
  try {
    if (doc.numPages > MAX_PAGES) throw new Error(`This PDF has ${doc.numPages} pages; at most ${MAX_PAGES} are supported.`)
    const out: Blob[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: longSide / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const g = canvas.getContext('2d')!
      g.fillStyle = '#fff' // PDFs are often transparent; models read black-on-white best
      g.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: g, viewport }).promise
      out.push(await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('render failed'))), 'image/png')))
      page.cleanup()
    }
    return out
  } finally {
    await doc.destroy()
  }
}
