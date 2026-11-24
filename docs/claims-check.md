# Claims check, 2026-11-25

Every factual or numeric claim on the landing page, in the README, in `docs/demo-checklist.md` and in the film's voiceover (`clearreport-film/voice/lines.json`, the lines in TREATMENT.md), with its evidence. Status: **Supported**, **Partly supported** (exact wording suggested) or **Unsupported**. Evaluation numbers are from `npm run eval` (`test-data/results.md`) on 2026-11-25 and `npm test`.

## Landing page

| Claim | Where | Evidence | Status |
| --- | --- | --- | --- |
| 77% of US adults concerned about privacy of medical information given to AI; 41% of AI-for-health users uploaded results (KFF, February 2026) | `src/Landing.tsx:137` | KFF poll linked in README (200 OK) | Supported |
| Glucose Fasting 104 mg/dL, lab range 70-110, "Guideline: borderline" | `src/Landing.tsx:16`, hero card | `src/guidelines.ts:45` (ADA 100-125, tag "borderline"); `demo.pdf` ground truth | Supported |
| Nothing about the report is stored; no database, no storage bucket; only the 18+ answer is remembered | `src/Landing.tsx:43` | `src/Flow.tsx` (only `localStorage` key is `ADULT_KEY`); `firebase.json` has Hosting only | Supported |
| Private mode needs desktop Chrome 139+, 16 GB RAM or a GPU with more than 4 GB | `src/Landing.tsx:44` | `src/Flow.tsx` availability text; Chrome built-in AI docs | Supported |
| English with a Hindi version | `src/Landing.tsx:45`, Bento | `src/hindi.ts`, `hindi_enabled` in `src/remote.ts:10` | Supported |
| Free, no account | `src/Landing.tsx:46` | Anonymous Auth only (`src/firebase.ts`) | Supported |
| `ONLY_ON_DEVICE` reads rows of an unknown layout; "all 10 values right in three runs", each verified by plain code | `src/Landing.tsx:158` | README table "Context blocks, card cross-check (now)", runs 1-3: 10 of 10 values, 10 verified | Supported |
| `ONLY_ON_DEVICE` finds names, IDs and phones in a photo's text | `src/Landing.tsx:159` | `src/extract.ts:207` | Supported |
| `PREFER_ON_DEVICE` "What does this test mean?", sending only the test's name; cloud answers when the device cannot | `src/Landing.tsx:160` | `src/explain.ts:179`, `src/explain.ts:192` | Supported |
| `ONLY_IN_CLOUD` reads the covered image (or the full report with consent); writes explanation and Hindi from anonymous numbers | `src/Landing.tsx:167-168` | `src/extract.ts:80`, `src/explain.ts:55`, `src/explain.ts:153`; `npm run privacy-proof` | Supported |
| Busy: waits, retries, then tries Gemini 3.8 Flash once; names the model; daily limit stops at once | `src/Landing.tsx:170` | `src/retry.ts`, `src/remote.ts:8` (`gemini-3.8-flash`), "cloud fallback ok" in `npm test` | Supported |
| You approve the exact anonymous numbers or covered image before anything goes to the cloud | `src/Landing.tsx:193` | Review screen "Approve and send these numbers"; confirm screen "This exact image will be sent"; privacy proof: 0 Gemini requests before approval in Path 1 | Supported |
| Free tier; only anonymous numbers or a masked image you approved; stores nothing | `src/Landing.tsx:194` | `path3_enabled: false` (`src/remote.ts:11`) | Supported |
| App Check lets only the ClearReport web app call Gemini | `src/Landing.tsx:195` | `src/firebase.ts` (reCAPTCHA Enterprise); enforcement is a console setting (see overnight report, Task 7) | Supported (enforcement not visible in code) |
| "Plain code in your browser reads the PDF, checks each value and removes your name" | `src/Bento.tsx:84` | Unknown layouts are read by the on-device model (`src/extract.ts:243`) | Partly supported. **Changed on the branch** (`ce9d93d`) to "Your browser reads the PDF (plain code, or on-device AI for a layout it does not know), checks each value and removes your name." |
| Each result compared with the lab's range and a named guideline; says when they disagree | `src/Bento.tsx:86` | `src/guidelines.ts` (`checkAll`, `disagrees`) for 7 tests; other tests: lab range only | Supported |
| Questions for your doctor; never says you have a condition | `src/Bento.tsx:88` | `src/questions.ts`; `BANNED` in `src/guidelines.ts`, checked in `npm test` | Supported |
| "a misread number is caught before you see it" | `src/Bento.tsx:89` | A misread value is shown, marked "Please check this value" (`src/trust.ts`) | Partly supported. **Changed** (`ce9d93d`) to "a misread number is flagged for you to check before anything is sent." |
| "only that covered image is sent" | `src/Bento.tsx:90` | The approved anonymous numbers are also sent for the explanation | Partly supported. **Changed** (`ce9d93d`) to "only that covered image is sent to be read." |
| Private path: "Only anonymous numbers, age range and sex" go to Gemini | `src/Beam.tsx:21` | The payload also has `lab_name` (`src/privacy.ts`, privacy proof) | Partly supported. **Changed** (`ce9d93d`) to "Only anonymous numbers, lab name, age range and sex". |
| Compare slider: lab name kept, address, name, lab no., mobile, doctor struck; age shown as 50-59 / Female | `src/Compare.tsx:14-30` | Matches the privacy proof's payload for demo.pdf (age_band 50-59, sex Female) | Supported |

## README

| Claim | Evidence | Status |
| --- | --- | --- |
| KFF 77% / 41% | KFF link (200 OK) | Supported |
| C-RIDL: most Indian labs take ranges from kit inserts or Western literature | doi:10.1515/cclm-2018-0152 (resolves) | Supported (source not re-read tonight) |
| medRxiv preprint: 794,811 examinations, 33,244 Indian centres, reference ranges vary | medRxiv link blocks automated requests (403) | Supported per earlier reading; **check the link by hand** |
| PMC4062657: Indian reference intervals differ for hemoglobin, platelets | PMC link (200 OK) | Supported |
| AI-calls table: modes and what each call sees | `src/extract.ts:73, 80, 207, 243`, `src/explain.ts:55, 179`; privacy proof | Supported. **Line numbers fixed** (`8d77fa8`): 240 to 243, 204 to 207, 54 to 55, 176 to 179 |
| Path 1 never falls back to the cloud | `ONLY_ON_DEVICE` plus the `inferenceSource` check (`src/extract.ts:162`); privacy proof: 0 Gemini requests while reading | Supported |
| Retry 3 times with backoff, then fallback model once; daily limit never retried | `src/retry.ts`; "cloud fallback ok" in `npm test` | Supported |
| Remote Config defaults `gemini-3.5-flash-lite` and `gemini-3.8-flash`; Hindi and Path 3 switches | `src/remote.ts:7-11`, `remoteconfig.template.json` | Supported |
| Hosting headers `nosniff`, `no-referrer`, Permissions-Policy without camera, microphone, location | `firebase.json:53-61` | Supported |
| Cloud: 100% of values, units, ranges and flags on 6 clean images and 2 photos, no personal field missed | eval: "cloud clean" 6/6, "cloud photo" 2/2, all 100%, PII missed 0 | Supported |
| WM14/WM15: parser reads 32 of 32 and 54 of 54 rows with no model call; 94% / 96% on values, 32 of 33 / 54 of 55 found; cloud 97% / 78% | `npm test` textcheck lines; eval rows WM14 and WM15 | Supported |
| p1-p3 first-run table, and "all three now parse fully with 0 model calls, every value verifies" | first-run numbers are from saved runs not re-run tonight; `npm test`: "p1 parser reads 8 of 8 rows, all verified", p2 11 of 11, p3 8 of 8 | Supported (first-run figures: historical) |
| demo-unfamiliar table (7 runs) | Runs made in Chrome on 2026-11-23 (not repeatable tonight without the on-device model); `npm test`: "10 correct rows verified, every swapped value or range caught" | Supported (historical runs; the verification part is re-checked by `npm test`) |
| On-device image reading: 91% values, 58% ranges, 7 of 36 personal fields missed; photos 66% / 19% / 6 of 12 | eval: "device clean" and "device photo" rows | Supported |
| No wrong value is marked verified (+10 test, swapped values) | `scripts/textcheck.ts:74, 109` | Supported |
| Allow-listed payload; identity values also searched literally | `src/privacy.ts`; privacy proof | Supported |
| Nothing is stored | as for the landing page | Supported |
| Path 3 paused (`path3_enabled` false) | `src/remote.ts:11` | Supported |
| `npm run build` fails if the debug token reaches dist | `scripts/check-dist.mjs`; build output "debug token checked" | Supported |
| Disclaimer on every step; banned wording checked on every engine message and AI answer, template after two failures | `src/Flow.tsx` (`disclaimer` bar), `src/explain.ts` (`wordingOk`, `STRICTER`, `template`) | Supported |
| 18+ notice | `src/Flow.tsx` "Before you start" | Supported |
| Guideline table marked pending doctor review | `src/guidelines.ts`, `docs/guidelines.md` | Supported |
| Guideline checks cover 7 tests | `src/guidelines.ts` (fasting glucose, HbA1c, total cholesterol, LDL, HDL, triglycerides, hemoglobin) | Supported |
| Built from scratch starting 21 November 2026 | first commit `76729ed`, 2026-11-21 | Supported |
| Video link | "YouTube link to be added" placeholder | Unsupported until the film is published: add the link |
| Design credit: "File Upload" by Edu Calvo, https://21st.dev/@educlopez/components/file-upload | link returns 404 | Partly supported: **find the current URL** or cite the author without a link |

## docs/demo-checklist.md

| Claim | Evidence | Status |
| --- | --- | --- |
| demo.pdf: 7 rows, all "Verified against your PDF", 0 on-device model calls | `npm test`: "demo parser reads 7 of 7 rows, all verified" | Supported |
| Payload has no name, ID, phone or doctor; age 50-59 | privacy proof, Path 1 | Supported |
| Glucose card shows "Guideline: borderline" and the disagreement callout | `src/guidelines.ts:45` | Supported |
| demo-unfamiliar: 1 on-device call, 112 s / 77 s / 79 s, 10 rows verified | README table (runs on 2026-11-23) | Supported (historical) |
| Scene 2 step 5 suggests drawing boxes, "if any boxes are already there, check them first" | matches the r6-photo finding (suggested boxes miss the name, age and phone) | Supported; worth saying "the suggested boxes miss the name, age and phone on this photo, add them" |

## Film voiceover

| Line | Claim | Evidence | Status |
| --- | --- | --- | --- |
| 01 | "My lab says 104 is normal. A widely used guideline calls it borderline." | demo.pdf range 70-110; ADA 100-125, the app's tag "borderline" (`src/guidelines.ts:45`) | Supported |
| 02 | To ask an AI, I'd upload my name and medical history | General framing; KFF 41% uploaded results | Supported |
| 03 | 2026 preprint: reference ranges vary across 33,244 Indian labs | medRxiv (centres) | Supported ("labs" for "diagnostic centres") |
| 04 | 2026 US survey: 77% worried; 41% uploaded | KFF | Supported |
| 06 | Drag across a report to see exactly what it leaves out | `src/Compare.tsx` | Supported |
| 07-08 | PDF read on this laptop; name, ID, phone removed on the device | Path 1, `src/textrows.ts`; privacy proof | Supported |
| 09 | Every number checked against the PDF's own text | `src/trust.ts`, `src/textlayer.ts` | Supported |
| 10 | "Gemini in the cloud sees only the anonymous results I approved" | privacy proof: payload `lab_name, age_band, sex, tests` | Supported |
| 11 | Lab and named guideline disagree: shown, and turned into a doctor question | `src/questions.ts` (first question about the disagreement), demo-checklist step 10 | Supported |
| 12 | "Simple questions are answered by Gemini Nano, right here on the device" | Only "What does this test mean?" is `PREFER_ON_DEVICE`, and it falls back to the cloud when the device cannot | Partly supported. Suggest: "What a test means is answered by Gemini Nano, right here on the device." |
| 13 | It works in Hindi | `src/hindi.ts` | Supported |
| 14 | An unseen layout goes to Gemini Nano on the device | `src/extract.ts:243` | Supported |
| 15 | "It read all ten results correctly in one call, and plain code verified every number" | README table, runs 1-3 | Supported |
| 16-18 | No PDF: cover details yourself; suggestions from rules, and on capable laptops from on-device AI | `src/masks.ts`; `src/extract.ts:207` ("Look for more personal details") | Supported |
| 19 | Nothing leaves until you approve the exact image | confirm screen; privacy proof (requests only after "Send this image") | Supported |
| 21 | "all three modes: on-device only where the input is private, prefer on-device where it's safe either way, cloud only for anonymous data" | `ONLY_IN_CLOUD` also reads the covered image in Path 2 (not just anonymous numbers) | Partly supported. Suggest: "...and cloud only for anonymous numbers and images you covered." |
| 22 | Plain code / on-device / cloud principle | README "Design principle" | Supported |
| 23 | App Check, Anonymous Auth, Remote Config, Hosting | `src/firebase.ts`, `src/remote.ts`, `firebase.json` | Supported |
| 25 | "my name never left my laptop" | Path 1 privacy proof | Supported (Path 1) |
| 26 | Try it with a sample report, no upload needed | `/app?sample=demo` | Supported |

## README links checked (HEAD, then GET where refused)

All 200 except: medRxiv (403, bot protection; check by hand), doi:10.2337/dc26-S002 (403 from the journal, but the DOI resolves to the right article), 21st.dev file-upload credit (404). GitHub repo, LICENSE, `demo-unfamiliar.pdf` blob and raw links: 200. Every local file link in the README exists.
