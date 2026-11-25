# ClearReport

**Demo video:** [Watch it on YouTube (2:53)](https://youtu.be/9BSmEUX1kyw) · **Judging?** Start with the one-page [guide for judges](docs/JUDGES.md).

**Your blood test report, explained in plain English or Hindi, with your personal details kept on your device.**

Live demo: https://clearreport-717f3.web.app (landing page), the app itself at https://clearreport-717f3.web.app/app. "Try a sample report" on the landing page opens the app with a synthetic report already loaded.

![ClearReport explaining a synthetic report: a summary that names the results above and below the lab's range, results grouped by panel, and a callout where the lab's range and a published guideline disagree](docs/screenshots/08-explanation-desktop.jpg)

## The problem

- **People worry about sharing medical data with AI, and upload it anyway.** In KFF's February 2026 survey of US adults, 77% said they are concerned about the privacy of medical information given to AI tools, and 41% of those who used AI for health information had uploaded personal medical information such as test results ([KFF](https://www.kff.org/public-opinion/kff-tracking-poll-on-health-information-and-trust-use-of-ai-for-health-information-and-advice/)).
- **Many Indian labs print ranges that were not set for Indian patients.** Researchers in the IFCC C-RIDL study note that most laboratories in India take reference values from manufacturers' kit inserts or from the literature, which is based mainly on Western populations ([Clin Chem Lab Med 2018](https://doi.org/10.1515/cclm-2018-0152)).
- **The printed range is not a fixed truth.** A 2026 preprint analysing 794,811 examinations across 33,244 Indian diagnostic centres found significant variation in laboratory reference ranges (Lakhani S., "Cardiometabolic Risk and Diagnostic-Laboratory Reference-Range Disagreement in 794,811 Indian Insurance Applicants: An Aggregate Analysis of Digitized Medical Examinations", [medRxiv preprint](https://www.medrxiv.org/content/10.64898/2026.06.01.26354654v1), posted June 3, 2026). A study of apparently healthy Indian adults also found reference intervals that differ from the ranges in current use for hemoglobin, platelet count and other tests ([PMC4062657](https://pmc.ncbi.nlm.nih.gov/articles/PMC4062657/)). So "inside the lab's range" and "fine by a published guideline" can disagree, and nobody tells the patient.

## What ClearReport does differently

1. **Privacy by design.** Personal details are removed on the device before anything is read in the cloud, or the user covers them before sending. The cloud explanation only ever sees an allow-listed, anonymous summary that the user approved.
2. **The lab's range is checked against named guidelines.** Plain code (no AI) compares each result with the lab's printed range and with a named, dated guideline (ADA 2026, NCEP ATP III, WHO 2024). When the two disagree, the card says so and what it means for that result.

| Approach | Where the report is read | Personal details | Checks the printed range |
| --- | --- | --- | --- |
| Cloud explainers | In the cloud, as uploaded | Sent with the report | Usually takes the lab's range as given |
| Fully on-device apps | On the device | Stay on the device | Limited by what a small model can explain |
| ClearReport: local redaction, then cloud | On the device where possible, or a copy the user has covered | Removed or covered on the device first | Against named guidelines, in plain code |

## How it works

The user picks one of three paths. A data trail beside every step shows what happens on the device and what goes to the cloud.

```mermaid
flowchart LR
  subgraph Device["On this device"]
    P1["Path 1, Private: lab PDF read on the device (text layer, plain-code parser, on-device AI for rows the parser cannot read)"]
    P2["Path 2, Mask it yourself: on-device OCR suggests boxes, the user covers name, ID, phone and doctor"]
    P3["Path 3, Full report: nothing removed, explicit consent"]
    R["Personal details removed; the user reviews the anonymous numbers"]
  end
  subgraph Cloud["Gemini, in the cloud"]
    X["Reads the covered image (Path 2) or the full image (Path 3)"]
    E["Explains the approved anonymous numbers, in English and Hindi"]
  end
  P1 --> R
  P2 --> X
  P3 --> X
  X --> R
  R -->|"after the user approves"| E
```

1. **Read.** Path 1 reads a lab PDF entirely on the device. Path 2 sends only an image the user has masked, after showing them the exact image. Path 3 sends the full report, only after consent.
2. **Check.** The user sees each value with a badge ("Verified against your PDF", "Please check this value", "Read from image") and approves the anonymous summary.
3. **Explain.** Gemini explains the approved numbers. The range check, the guideline callouts and the summary of findings are plain code, so they are the same whatever the model writes.

## How we use Firebase AI Logic

Every AI call in the app, with its inference mode:

| Mode | What it does | What data it sees | Code |
| --- | --- | --- | --- |
| `ONLY_ON_DEVICE` | Path 1: reads result rows the plain-code parser could not read, with their neighbouring lines (see [Accuracy and evaluation](#accuracy-and-evaluation)) | Blocks of lines from the PDF text around those rows, with identity lines already dropped | [src/extract.ts:243](src/extract.ts#L243) |
| `ONLY_ON_DEVICE` | Path 2, optional "Look for more personal details": finds names, IDs and phone numbers in the OCR text so they can be boxed | The page's OCR text, which never leaves the device | [src/extract.ts:207](src/extract.ts#L207) |
| `ONLY_ON_DEVICE` | Evaluation only (dev spike page): reads a report image on the device | Synthetic test images | [src/extract.ts:73](src/extract.ts#L73) |
| `ONLY_IN_CLOUD` | Paths 2 and 3: reads the results from the image | Path 2: the image the user covered and approved. Path 3: the full image, with consent | [src/extract.ts:80](src/extract.ts#L80) |
| `ONLY_IN_CLOUD` | Writes the explanation, and the Hindi translation when the user taps Hindi | The approved payload: lab name, age band, sex, test names, values, units, printed ranges and flags, plus the plain-code range-check results | [src/explain.ts:55](src/explain.ts#L55) |
| `PREFER_ON_DEVICE` | "What does this test mean?" | The test's name only, never a value | [src/explain.ts:179](src/explain.ts#L179) |

Path 1 never falls back to the cloud: if the device cannot run the model, the app says so and offers the other paths.

When the cloud model is busy (errors 500 "high demand", 503 or 429), every cloud call (reading an image, the explanation, the Hindi translation, and the cloud side of "What does this test mean?") waits and retries three times with backoff, then tries the fallback model from Remote Config once ([src/retry.ts](src/retry.ts)). The explanation footer names the model that actually answered. If both are still busy, extraction says it could not read the report, the explanation falls back to the plain range-check summary, and Hindi offers "Try again".

A free-tier daily limit is different: a 429 that says the requests-per-day quota is used up is never retried and never sent to the fallback model, because both would only spend more of the day's quota. The call stops at once. The explanation shows the plain range-check summary with "Today's free AI limit has been reached. Your results are shown with plain-language checks only. Try again after 1:30 PM IST." (the quota resets at midnight Pacific time); reading an image, Hindi and "What does this test mean?" say the same and offer no "Try again". A per-minute 429 and a 500 or 503 "high demand" still count as busy. `npm test` checks this with the real error text.

**Design principle:** plain code where rules are reliable (parsing, identity removal, range checks, guideline wording, doctor questions as a fallback), on-device AI where data is private (reading the PDF, finding personal details), cloud AI where data is anonymous (the explanation) or the user chose to send it (reading a covered or consented image).

## Other Firebase products

| Product | What it does here |
| --- | --- |
| App Check (reCAPTCHA Enterprise) | Only the ClearReport web app can call Gemini through Firebase AI Logic. A debug token is used in local development only. |
| Anonymous Authentication | Gives each session an anonymous Firebase user, with no account, email or name. |
| Remote Config | Holds the cloud model name (`cloud_model`, default `gemini-3.5-flash-lite`), the fallback model (`cloud_model_fallback`, default `gemini-3.8-flash`), the prompt version shown under each explanation, and switches for Hindi and Path 3. In-code defaults keep the app working if it cannot be fetched. |
| Hosting | Serves the static app with `nosniff`, `no-referrer` and a Permissions-Policy that turns off camera, microphone and location. |

## Accuracy and evaluation

All numbers below come from `npm run eval` (`test-data/results.md`) and `npm test`.

- **Synthetic reports (6 layouts, ground truth in `test-data/ground-truth`):** the cloud read 100% of values, units, ranges and flags on all 6 clean images and both phone photos, with no personal field missed.
- **Dr Lal PathLabs public sample PDFs (WM14, WM15):** Path 1 reads them on the device with the plain-code parser: 32 of 32 and 54 of 54 result rows, with no call to the on-device model. Against our hand-made ground truth, the saved runs score 94% (WM14) and 96% (WM15) on values, with 32 of 33 and 54 of 55 tests found. The cloud runs on the same PDFs scored 97% and 78% on values.
- **Unfamiliar layouts, first run (on-device fallback).** Three synthetic text PDFs were built to look unlike anything the parser was written for. On the first, untuned run, the plain-code parser read few rows and the rest went to the on-device model:

  | PDF | Rows read by the parser | On-device calls | Time | Values right | Notes | Identity leaks |
  | --- | --- | --- | --- | --- | --- | --- |
  | p1: result first, unit inside the result cell | 0 of 8 | 9 | 129.6 s | 88% | plus 8 junk rows | 0 |
  | p2: two tests per printed row | 1 of 5 paired rows | 1 | 102.2 s | 100% | all 11 tests found | 0 |
  | p3: wrapped names, sex-specific ranges, footnote marks | 3 of 5 | 5 | 51.5 s | 75% | 6 of 8 tests found, plus 2 extra | 0 |

  With the parser switched off, p1 took 1 on-device call (about 70 s) with one unit error: the platelet count came back converted to 260000 /cumm, a value that does not match the PDF text, so the cross-check would mark it "Please check this value" (that run recorded the error; it did not go through the review screen).

  We then improved the parser with general rules, not rules for these files: it types each column instead of assuming the name comes first, splits side-by-side rows when both halves parse, joins wrapped names, and picks the patient's own bounds from "M: / F:" ranges. All three layouts now parse fully (8, 11 and 8 rows) with 0 model calls, and every value verifies against the PDF text (checked in `npm test`). Layouts the parser has not seen still fall back to the on-device model, and every value it returns is cross-checked against the PDF text. The next result shows how far that fallback can be trusted.
- **A new unfamiliar layout, before and after giving the model context.** `demo-unfamiliar.pdf` (synthetic, 10 tests in two-column result cards: the name, then the value and unit, then "Expected:" and the range, each on its own line) was read on Path 1 in Chrome, with the parser unchanged. Run 1 of each version is the first read after the page loaded; the later runs are warm.

  | Version | Run | Rows by the parser | Rows from the on-device model | On-device calls | Time | Right names | Right values | Right ranges | Right flags | Verified | Please check | Read from image | Identity sent |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Value lines only | 1 | 0 | 5 | 5 | 54.2 s | 0 of 10 | 4 of 10, under wrong names | 0 | not scored | 0 | 4 | 1 | none |
  | Value lines only | 2 | 0 | 6 | 1 | 34.8 s | 0 of 10 | 6 of 10, under wrong names | 0 | not scored | 0 | 5 | 1 | none |
  | Context blocks | 1 | 0 | 10 | 1 | 96.1 s | 10 of 10 | 10 of 10 | 10 of 10 | not recorded | 0 | 10 | 0 | none |
  | Context blocks | 2 | 0 | 10 | 1 | 77.5 s | 10 of 10 | 10 of 10 | 10 of 10 | 9 of 10 | 0 | 10 | 0 | none |
  | Context blocks, card cross-check (now) | 1 | 0 | 10 | 1 | 111.9 s | 10 of 10 | 10 of 10 | 10 of 10 | 10 of 10 | 10 | 0 | 0 | none |
  | Context blocks, card cross-check (now) | 2 | 0 | 10 | 1 | 77.2 s | 10 of 10 | 10 of 10 | 10 of 10 | 9 of 10 | 10 | 0 | 0 | none |
  | Context blocks, card cross-check (now) | 3 | 0 | 10 | 1 | 79.4 s | 10 of 10 | 10 of 10 | 10 of 10 | 10 of 10 | 10 | 0 | 0 | none |

  Before, the row builder sent the model only the value lines (for example "12.6 g/dL | 7,600 /cumm"), because the names and ranges sit on lines of their own, so the model invented test names and dropped rows, and one row per run got the neutral "Read from image" badge, which did not block approval. Two changes followed. First, where the parser cannot read a row, the model now gets a block of lines in reading order: the unread rows plus up to two lines either side (names above, ranges below), at most 18 lines per block, with identity lines removed as before, and context lines with a personal-details label, a title before a name, a long ID or a phone number never sent. Second, a row on a PDF page that cannot be matched to the PDF text is now always "Please check this value". With both, every test came back right in both runs, in one call each, but every row still showed "Please check": the cross-check looked for the value only on the same line as the test's name, and in this layout it is on the next line. In run 2 the model also marked HbA1c as "High", which the PDF does not print (it is printed for Total Cholesterol, in the card beside it).

  Two more general changes followed (no rule for this file). First, the cross-check ([src/textlayer.ts](src/textlayer.ts)) still looks on the name's own line first, but when that line has no number it reads the lines under the name, in the name's own column, until a blank gap, a line with another test's name (one of the report's other rows, or any name in the alias table), or four lines; the column ends where the next card starts on the name's line. The row beside a name likewise ends at another test's name, which matters for tables printed two to a line (p2). Second, in Path 1 a flag from the on-device model is kept only if the PDF prints that flag beside that value; on a verified value the flag is the one the PDF prints there, so a flag the model left out comes back too ([src/trust.ts](src/trust.ts)). Now every row of this file verifies and Approve is enabled at once. In warm run 2 the model left out Triglycerides' "High"; that run was made before the second half of the flag rule (bringing back a missed flag) was added, and run 3 has every flag right. `npm test` checks the window on this file and on hand-placed layouts: every correct row verifies, and every test given another test's value or range (beside it, above or below it, or the next test in a list with no gap) never verifies. Age band and sex were not found, because they share a line with the phone number, which is removed.

  The same blocks with the parser switched off on p1-p3 (one on-device call each). Before the card cross-check: p1 8 of 8 tests with right names, values and units, 7 of 8 ranges (Haemoglobin's lower bound was lost), 8 of 8 flags, 58.2 s; p2 11 of 11 on every field, 99.9 s; p3 8 of 8 names, values, units and ranges, 7 of 8 flags, 71.6 s. With it (Prompt 19): p1 8 of 8 on every field, 60.8 s; p2 11 of 11 on every field, 85.1 s; p3 8 of 8 on every field, 70.0 s (the model got 7 of 8 flags; the PDF flag rule corrected the eighth). All 27 rows verified, no extra rows and no identity sent. Reports the parser reads fully are unchanged: demo.pdf, WM14 and WM15 read 7, 32 and 54 rows, all verified, with 0 model calls.
- **On-device image reading did not hold up, so we moved on-device work to text.** Reading report images with the on-device model: on 6 clean images it got 91% of values but only 58% of printed ranges, and missed 7 of 36 personal fields; on 2 phone photos it got 66% of values and 19% of ranges, and missed 6 of 12 personal fields. That is why Path 1 accepts lab PDFs and reads their text, and photos go through Path 2.
- **No wrong value is marked as verified.** For PDFs, each value, unit and range is cross-checked against the PDF's own text layer on the device. A test changes every WM14 and WM15 value by +10 and checks that none of them verifies, and that a missing unit never verifies. Another gives each test of p1-p3, demo.pdf and demo-unfamiliar.pdf the value of every other test in the same report, and checks that none of these verifies. Values that do not match are shown as "Please check this value" and must be confirmed before they count. A row on a PDF page that cannot be matched to the PDF text (its name or value is not found there) is also "Please check this value". "Read from image" is used only for pages with no text layer (photos and scans).

## Privacy and safety

- **Allow-listed payload.** The explanation call receives only lab name, age band, sex and the test rows ([src/privacy.ts](src/privacy.ts)). Identity values found in the report are also searched for literally and removed wherever they ended up.
- **Nothing is stored.** Report images stay in the tab's memory. ClearReport has no database and no storage bucket.
- **Gemini terms.** The Gemini Developer API currently runs on Google's free tier. ClearReport only sends anonymous numbers or a masked image you approved, and stores nothing. Path 3 (sending the full report) is paused while the project is on the free tier (`path3_enabled` is false in Remote Config; the code stays).
- **Consent for Path 3.** Sending the full report needs an explicit, per-report consent that is never remembered.
- **Debug token check.** `npm run build` fails if the App Check debug token or dev-only code reaches `dist/` ([scripts/check-dist.mjs](scripts/check-dist.mjs)).
- **No medical advice.** A disclaimer sits at the top of every step. Wording rules ban diagnosis-style phrases ("you have", "diabetes range" and others), checked in code on every engine message and every AI answer, with a plain template when the AI's wording fails twice.
- **Adults only.** A notice asks for confirmation of age 18 or over, because children's ranges differ.
- **Guidelines pending review.** The guideline table is marked as pending review by a doctor in the code and in the docs.

## Medical guidelines used

Each threshold was checked against its source text; details and the wording rules are in [docs/guidelines.md](docs/guidelines.md).

| Test | Source | Edition |
| --- | --- | --- |
| Fasting glucose, HbA1c | ADA Standards of Care in Diabetes, Section 2, Tables 2.1 and 2.2 | Diabetes Care 2026;49(Suppl. 1):S27-S49, [doi:10.2337/dc26-S002](https://doi.org/10.2337/dc26-S002) |
| Total cholesterol, LDL, HDL, triglycerides | NCEP Adult Treatment Panel III Final Report | Circulation 2002;106(25):3143-3421, [PMID 12485966](https://pubmed.ncbi.nlm.nih.gov/12485966/) |
| Hemoglobin | WHO Guideline on haemoglobin cutoffs to define anaemia | WHO 2024, ISBN 978-92-4-008854-2, [NBK602198](https://www.ncbi.nlm.nih.gov/books/NBK602198/) |
| Lipid note (no thresholds) | Lipid Association of India Expert Consensus Statement | J Assoc Physicians India 2020, [PMID 33350610](https://pubmed.ncbi.nlm.nih.gov/33350610/) |

WBC, platelets and TSH have no guideline check: no single named guideline threshold could be attributed.

## Limitations

- The guideline thresholds have not yet been reviewed by a doctor.
- Guideline checks cover 7 tests. Every other test is compared with the lab's printed range only.
- Path 1 needs desktop Chrome with its built-in AI and a lab PDF with a text layer. Scanned PDFs and photos go through Path 2 or 3.
- Accuracy was measured on 2 real sample reports from one lab chain and on synthetic reports. Real reports from other labs may be laid out in ways we have not seen.
- The explanation is written by a cloud model. Its wording is checked, but its plain-language descriptions of what a test measures are not reviewed by a doctor.
- Hindi is a translation of the English explanation; it is not shown if it changes any number.
- Adult ranges only.

## Try it

1. Open https://clearreport-717f3.web.app/app, or click "Try a sample report" on https://clearreport-717f3.web.app to start with the synthetic `demo.pdf` (fictional patient; served from `/samples/demo.pdf`).
2. Use the synthetic reports in [test-data/reports](test-data/reports): `r2.png` shows a lab range that disagrees with a guideline, `r6-photo.jpg` is a phone photo, and `p1.pdf` to `p3.pdf` are text PDFs for Path 1.
3. Or download Dr Lal PathLabs' public sample reports: [WM14.pdf](https://cdn1.lalpathlabs.com/live/reports/WM14.pdf) and [WM15.pdf](https://cdn1.lalpathlabs.com/live/reports/WM15.pdf).

**To use Path 1 (on-device AI)** you need desktop Chrome 139 or newer on a laptop or desktop with 16 GB of RAM or a graphics card with more than 4 GB of memory, and free disk space for the model. Then:

1. Open `chrome://flags/#prompt-api-for-gemini-nano` and set it to Enabled.
2. Open `chrome://flags/#optimization-guide-on-device-model` and set it to Enabled.
3. Restart Chrome, then open `chrome://on-device-internals` to see whether the model is ready or downloading.

See Chrome's [built-in AI documentation](https://developer.chrome.com/docs/ai/get-started) for the current hardware requirements.

## Run locally

Prerequisites: Node.js (developed on Node 24), a Firebase project on the Blaze plan, and desktop Chrome for Path 1.

1. In the Firebase console: add a web app, enable **AI Logic** with the Gemini Developer API, enable **Anonymous** sign-in under Authentication, and set up **App Check** with a reCAPTCHA Enterprise key (from the same Google Cloud project, with the reCAPTCHA Enterprise API enabled). Add a debug token for local development.
2. `cp .env.example .env` and fill in the web app config, the reCAPTCHA site key and the debug token.
3. Optional: publish the Remote Config defaults with `npx firebase-tools deploy --only remoteconfig`.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit checks: parser, privacy, range checks, wording, questions, trust badges
npm run build      # type check, build, and fail if dev-only secrets reached dist/
npm run gen        # regenerate the synthetic reports and ground truth
npm run eval       # score saved extraction runs in test-data/runs, write test-data/results.md
```

`npm run eval` scores runs saved from the dev evaluation page (`http://localhost:5173/?spike`); the runs are not in the repository.

## Built during the submission period

All of it, from scratch, starting 21 November 2026: the three paths, the on-device PDF reader and parser, the masking tool with OCR suggestions, identity removal, the trust badges and PDF cross-check, the guideline range check, the explanation screen with Hindi, the data trail, the evaluation harness and synthetic reports, and this documentation.

## Roadmap

- A lab range registry: printed ranges per lab and test, built from non-personal data only, so differences between labs are visible.
- Move the Gemini Developer API to the paid tier before wider use, and turn Path 3 back on.
- More Indian languages.
- An Android app using Gemini Nano on the device.
- ABDM integration, so reports can come straight from a health locker with the user's consent.

## License

[Apache-2.0](LICENSE)

## Design credits

No UI library is installed. These MIT-licensed designs were used as visual references only and rebuilt in plain CSS and SVG:

- Visual identity "Specimen" (our own; see [the spec](docs/superpowers/specs/2026-11-23-ui-theme-design.md)): stain violet for on this device, eosin rose for the cloud, highlighter yellow only where your lab and a guideline disagree. Every colour pair passes WCAG AA (`npx tsx scripts/contrast.ts --table`). Type is IBM Plex Sans, Plex Mono and Plex Sans Devanagari (SIL Open Font License), self-hosted with Fontsource.
- The "What leaves your device" beam: Magic UI "Animated Beam" by dillionverma, MIT, https://21st.dev/@dillionverma/components/animated-beam
- The Data trail timeline: Dice UI "Timeline", MIT, https://21st.dev/@diceui/components/timeline
- The upload drop zone: "File Upload" by Edu Calvo (educlopez) on 21st.dev, MIT (its component page now returns 404)
- The landing page hero (perspective grid and centred layout): "Hero Section Dark" by kinfe123 / FarmUI, MIT, https://21st.dev/@kinfe123/components/hero-section-dark
- The landing "How it works" bento grid (card sizes on a six-column grid, a small illustration in each card): "Marketing Feature Bento" on 21st.dev, licence not stated on the page, so only the layout idea was used and no code was copied; the illustrations show ClearReport's own steps
- The "Your report" / "Sent to explain" compare slider on the landing page: "Compare Reveal" from Motiq, MIT, https://motiq.dev/components/compare-reveal (rebuilt on a native range input, without the spring physics)
- The landing footer (diagonal light shaft and the large cropped wordmark): "Beam Wordmark Footer" by Kedhar (kedhareswer) on 21st.dev, licence not stated on the page, so only the look was used and no code was copied
