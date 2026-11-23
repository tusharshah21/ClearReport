// Renders each PDF page to a PNG in the browser (pdf.js). Nothing leaves the device here.
import { getDocument, GlobalWorkerOptions, OPS, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pageWords, pagesWithResults, type Word } from './textlayer'

GlobalWorkerOptions.workerSrc = workerUrl
export const MAX_PAGES = 10 // ponytail: hard cap so one upload can't trigger dozens of model calls; raise if real reports need it

export const isPdf = (f: Blob) => f.type === 'application/pdf'

// "WxH" of each image a page draws (for pagesWithResults).
export async function imageSizes(page: PDFPageProxy): Promise<string[]> {
  const ops = await page.getOperatorList()
  return ops.fnArray.flatMap((fn, k) => (fn === OPS.paintImageXObject ? [`${ops.argsArray[k][1]}x${ops.argsArray[k][2]}`] : []))
}

// Each page as a PNG plus its text-layer words (empty for scanned PDFs). The words never leave the device.
// render = false skips the PNGs (png is null): Path 1 reads only the text layer.
export type PdfPage = { png: Blob | null; words: Word[]; images: string[]; results: boolean }
export async function pdfPages(file: Blob, longSide = 2000, render = true): Promise<PdfPage[]> {
  // isEvalSupported:false: pdf.js never compiles code from the file (defence in depth for untrusted PDFs).
  const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
  try {
    if (doc.numPages > MAX_PAGES) throw new Error(`This PDF has ${doc.numPages} pages; at most ${MAX_PAGES} are supported.`)
    const out: PdfPage[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const words = await pageWords(page)
      if (!render) { out.push({ png: null, words, results: true, images: await imageSizes(page) }); page.cleanup(); continue }
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: longSide / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const g = canvas.getContext('2d')!
      g.fillStyle = '#fff' // PDFs are often transparent; models read black-on-white best
      g.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: g, viewport }).promise
      const png = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('render failed'))), 'image/png'))
      out.push({ png, words, results: true, images: await imageSizes(page) })
      page.cleanup()
    }
    const results = pagesWithResults(out)
    return out.map((p, i) => ({ ...p, results: results[i] }))
  } finally {
    await doc.destroy()
  }
}
