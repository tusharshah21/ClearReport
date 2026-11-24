// Plain code: the message shown when an added file cannot be read. Says what is wrong and what to do instead,
// in words a person understands (pdf.js and the browser only say "No password given" or "could not be decoded").
export function fileError(e: unknown, file: { name: string; type: string }): string {
  const err = e as { name?: string; message?: string }
  const msg = String(err?.message ?? e)
  if (err?.name === 'PasswordException' || /password/i.test(msg))
    return "This PDF is protected with a password, so it can't be opened here. Open it in your PDF viewer, save or print it as a new PDF without a password, then add that file."
  const pages = msg.match(/has (\d+) pages; at most (\d+)/)
  if (pages)
    return `This PDF has ${pages[1]} pages; ClearReport reads at most ${pages[2]}. Save only the pages with your results as a new PDF, then add that file.`
  if (/\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type))
    return "iPhone HEIC photos can't be read in this browser. Please add a JPEG or PNG instead (on iPhone, take a screenshot of the photo, or set Camera > Formats to Most Compatible)."
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
    return "This file can't be opened as a PDF (it may be empty, damaged, or not really a PDF). Please add the PDF your lab sent, or a JPEG or PNG photo of the report."
  return "This file type can't be read here. Please add the PDF your lab sent, or a JPEG or PNG photo of the report."
}

// A read that found no test results at all (an invoice, a letter): shown instead of an empty results table.
export const NO_RESULTS = 'No test results were found in this file.'
