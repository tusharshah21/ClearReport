# Overnight report, 2026-11-25

Branch `overnight-2026-11-25` (local only: nothing deployed, pushed or merged). No Gemini calls were made: every automated browser route-aborts `firebasevertexai.googleapis.com` and `generativelanguage.googleapis.com`, and Claude in Chrome was not used.

## Read this first

- **No leak in the code paths.** `npm run privacy-proof` intercepted every request to Gemini (captured, then aborted) for Path 2 with r1.png, r6-photo.jpg and demo.pdf, and Path 1 with demo.pdf. No ground-truth name, ID, phone or doctor name appears in any request text, the explanation payload has only the allow-listed fields, Path 1 sends nothing while reading, and every masked pixel in the images sent is solid black.
- **But the suggested boxes alone are not enough on r6-photo.** After the default Straighten step, the 2 suggested boxes cover the reg. no. and the doctor, and miss the patient name ("SUNITA NOTAREALPERSON"), the age/sex and the phone. A user who clicks "Done masking" without adding boxes would send those. The app does tell users the boxes "can miss things" and shows "This exact image will be sent" before sending, so this is a suggestion-quality gap, not a code leak. Not changed tonight (the OCR label rules for photos need care, and a change could move boxes in the demo). See "Needs Tushar's decision".

## Passed

### Task 1: baseline on main (fb967ac)

- `npm test` (contrast, checks, textcheck): exit 0, every check ok.
- `tsc -p tsconfig.app.json --noEmit`: exit 0, no errors.
- `vite build` + `check-dist`: exit 0; 3 banned strings absent from dist (debug token checked).
- `npm run eval` (plain code, scores saved runs, no AI calls): exit 0. Summary: cloud clean 100% found, device text pdf 100% on every column, device photo 91% found / 66% value (the weakest set, as known). `results.md` only changed its timestamp and gained "no run" rows for demo and demo-unfamiliar, so that change was reverted.

### Task 2: privacy proof by interception

New `scripts/privacy-proof.ts`, run as `npm run privacy-proof` (needs `npm run dev`). Result file: `docs/overnight/privacy-proof.txt`. Final run: 15 checks ok, 1 WARN, 0 FAIL.

- Path 2, r1.png: 5 suggested boxes; 20,400 masked pixels all black; OCR reads "Placeholder", "Sharma" and the phone on the unmasked page and none of them on the image sent.
- Path 2, demo.pdf: 5 suggested boxes; 19,764 masked pixels all black (PNG, exact); OCR reads the lab no. and phone unmasked and neither on the image sent.
- Path 2, r6-photo.jpg: masked pixels all black, but see "Read this first": OCR cannot read the identity even unmasked (WARN), and by eye the name, age and phone are visible in the image sent.
- Path 1, demo.pdf (stubbed on-device model): 0 Gemini requests while reading; the explanation requests carry only `lab_name, age_band, sex, tests`, and each test only `name, value, unit, lab_range, printed_flag, range_check, range_check_note`; age as band 50-59.
- Every request part is only `text` or `inlineData`; other outbound request bodies (auth, App Check) carry no identity.

### Task 3: edge cases

Files in `test-data/edge/` (made by `test-data/edge-gen.ts`, fake identities only), run by `scripts/edge.ts` through Path 1 (stand-in on-device model that answers with no tests, so whatever Path 1 shows came from plain code) and Path 2 (no AI, up to the mask screen). Full table: `docs/overnight/edge.md`. 0 Gemini requests.

| File | Expected | Before | After |
| --- | --- | --- | --- |
| scanned.pdf (no text layer) | Path 1 explains it needs a text PDF, offers Path 2 | As expected: back to the paths screen with "This file has no text to read, so please choose how to continue below." Path 2 reaches the mask screen. | Same. Note: Path 2 found 0 suggested boxes on this scanned page. |
| password.pdf | Clear message | "Could not read that file (No password given). Please use a PDF..." | "This PDF is protected with a password... save or print it as a new PDF without a password, then add that file." |
| pages-20.pdf (results on page 1) | Reads page 1, skips the rest | Refused: "(This PDF has 20 pages; at most 10 are supported.) Please use a PDF..." | Same limit, clearer: "...Save only the pages with your results as a new PDF, then add that file." 0.4 s, 21 MB heap. The limit itself: see "Needs Tushar's decision". |
| invoice.pdf | "No test results found", nothing invented | **Bug:** "Check your results" with an empty table and Approve enabled | "We found no test results in this file" with only Start over. Nothing invented in either version. |
| empty.pdf, text-renamed.pdf | Clear message | "Could not read that file (The PDF file is empty...). Please use a PDF..." (it is named .pdf) | "This file can't be opened as a PDF (it may be empty, damaged, or not really a PDF)..." |
| report.docx | Clear message | "...(The source image could not be decoded.)..." | "This file type can't be read here. Please add the PDF your lab sent, or a JPEG or PNG photo." |
| iphone.heic | Works, or a clear message | "...could not be decoded..." (Chrome on desktop cannot decode HEIC) | "iPhone HEIC photos can't be read in this browser. Please add a JPEG or PNG instead (on iPhone, take a screenshot...)." iPhone Safari usually converts HEIC to JPEG on upload, so phones are mostly fine. |
| photo-12mp.jpg (4000x3000) | Works | Straighten, then mask screen in 6.1 s, 24 MB heap; image scaled to 1600 px before anything else | Same. 2 suggested boxes (same r6 gap as Task 2). |
| one-test.pdf | Works | Path 1: 1 row (Glucose Fasting) | Same |
| unknown-test.pdf | Unknown test kept, not dropped or renamed | Path 1: "Serum Zorblin Index" kept as printed, beside the 3 known tests | Same |
| no-age-sex.pdf | Works without age and sex | Path 1: 3 rows | Same |

### Task 4: cross-browser and phone width

`scripts/xbrowser.ts` (Chrome with built-in AI off, Firefox 1xx and WebKit from Playwright, 1280 and 390 px with touch; Gemini blocked).

- **Live site, before the fix:** landing passes everywhere: no sideways scroll, the phone menu opens and Escape closes it, the compare slider moves by mouse drag and by touch tap. On /app, the 18+ notice and the greyed Private card ("Needs Chrome on a laptop with 16 GB RAM...") pass everywhere, with no sideways scroll on the paths screen.
- **Bug found:** "Try a sample report" then a quick "Mask my details" lands on "Add a photo or PDF of your report" with the sample banner showing, and the sample is never used (Chrome 1280 and 390, Firefox 390, WebKit 1280 and 390; screenshot `docs/overnight/x-live-sample-race-before.png`). Fixed in `6c6bdbc`: a path picked while the sample loads waits under "Loading the sample report..." and carries on once it has loaded.
- **After the fix (dev server, the sample delayed 3 s to force the race):** every check passes in all three browsers at both widths, up to "This exact image will be sent". Results: `docs/overnight/xbrowser.md`.
- Console noise, not app bugs: on the live site headless Chrome gets a 403 (App Check's reCAPTCHA scoring an automated browser) and WebKit gets 400/401/403 from App Check and Anonymous Auth in automation. One WebKit "Could not resolve hostname" on localhost.

### Task 5: accessibility, performance, SEO

Lighthouse 13 (live site, before; headless Chrome, default throttling):

| Page | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| Landing, mobile | 98 | 100 | 100 | 92 |
| Landing, desktop | 100 | 100 | 100 | 92 |
| /app, mobile | 62 | 100 | 73 | 83 |
| /app, desktop | 89 | 100 | 73 | 83 |

- SEO fixed (`fd4cb18`): `/robots.txt` returned the HTML page (Firebase rewrites everything to index.html), so Lighthouse read 35 errors; now a real `robots.txt`. /app's canonical link pointed at `/`; now set to `/app` when the tool loads. After, on the dev server: SEO 100 on both pages (live numbers change only after a deploy).
- axe-core 4 (WCAG 2.1 A/AA + best practice), landing and /app start, paths, mask and confirm screens, desktop and phone: no WCAG violations. One best-practice issue fixed (`e2419d6`): once a report or the sample is loaded, the hero (the only h1) is hidden, so later screens had no h1; a screen-reader-only h1 now fills that gap (no visual change). After: 0 violations on every screen.
- Left as is: /app best practices 73 is App Check's reCAPTCHA (a third-party cookie, and a 403 console error when an automated browser is scored); expected with App Check on. /app mobile performance 62 (FCP/LCP about 6 s on throttled 4G): the app waits up to 3 s for Remote Config before its first paint, and the Flow chunk is 464 kB. See "Needs Tushar's decision".

### Task 6: claims audit

`docs/claims-check.md` maps every claim on the landing page, in the README, in the demo checklist and in the 25 voiceover lines to its evidence. README figures match tonight's `npm run eval` exactly. Results:

- README: AI-calls table line numbers were stale (240, 204, 54, 176); fixed to 243, 207, 55, 179 (`8d77fa8`).
- Landing, 4 claims partly supported, text-only fix committed on the branch for your approval (`ce9d93d`): Bento "Plain code in your browser reads the PDF" (unknown layouts use on-device AI), "a misread number is caught before you see it" (it is shown, flagged), "only that covered image is sent" (the approved numbers follow), Beam "Only anonymous numbers, age range and sex" (the lab name is sent too). Checked at 375 px: no sideways scroll.
- Voiceover, 2 lines partly supported (not changed, the film is yours): line 12 "Simple questions are answered by Gemini Nano" (only "What does this test mean?"; suggest "What a test means is answered by Gemini Nano, right here on the device"), line 21 "cloud only for anonymous data" (the covered image also goes to the cloud; suggest "cloud only for anonymous numbers and images you covered").
- Links: everything 200 except medRxiv (403 to bots: check by hand), the ADA DOI (journal 403s bots, DOI resolves correctly) and the 21st.dev "File Upload" credit (404). README video link is still a placeholder.

### Task 7: security and repo hygiene

- **Secrets in history (113 commits, all branches):** `.env` never committed. None of the 8 `.env` values appear in any revision except the project ID (public, it is in the site URL). No `AIza` key, private key, `sk-`/`ghp_`/`xox`/`AKIA` token or UUID debug token in any patch. (The first scan stopped early because a `.docx` diff driver choked on the fake `report.docx`; rescanned with `--no-textconv`, and `.gitattributes` now marks `test-data/edge/**` as binary, `210c073`.)
- **Debug token:** set only inside `if (import.meta.env.DEV)` in `src/firebase.ts`, which Vite removes from production builds; `scripts/check-dist.mjs` fails the build if `VITE_APPCHECK_DEBUG_TOKEN` or the token value is in `dist/`. Tonight's build: token value in 0 dist files.
- **App Check:** the code initializes App Check with reCAPTCHA Enterprise before any AI call, with auto refresh. Whether App Check is *enforced* for Firebase AI Logic is a console setting; no Firebase or gcloud CLI is set up here, so I could not read it. Please confirm in Firebase console > App Check > APIs > Firebase AI Logic: "Enforced". (Live behaviour agrees: headless browsers that fail reCAPTCHA scoring get 403 from App Check.)
- **npm audit:** 4 high, all one chain: `@grpc/grpc-js <=1.13.5` under `@firebase/firestore`, pulled in by the `firebase` package. The app never imports Firestore and grpc-js is Node-only, so none of it is in the browser bundle. Fix is `npm audit fix --force` (a firebase version change), not done tonight.
- **Licence:** GitHub detects `Apache-2.0`; repo public.
- **Large or stray files:** no tracked file over 300 KB; 5.0 MB tracked in total; no logs, env files, videos, WM14/WM15 PDFs or run files tracked. One stray untracked file found: `eng.traineddata` (5 MB) written to the repo root by tesseract.js during the privacy proof; deleted, and the proof now caches it in the temp folder (`af4cff4`).

### Task 8: film draft check (`clearreport-film/edit/out/draft-v1.mp4`, not re-rendered)

- **Length and format:** 2:54.23 (174.23 s), under 2:55. 1920x1080, 30 fps, H.264 + AAC.
- **Loudness:** -14.1 LUFS integrated, LRA 5.4 LU, peak -1.5 dBFS. On target.
- **Placeholder slates:** 14 slates (01, 02, 05, 07 to 13, 24 to 27), each exactly its `shots.json` length (6.5, 5, 4, 5, 4, 4, 8, 8, 6, 3, 4, 5.5, 7, 2.5 s) and each long enough for its VO line. They differ from the treatment's storyboard times by up to 3 s (for example 08: 7 s in the treatment, 4 s in the draft); that is the Gate 1 retime, and the total still lands at 2:54.
- **Caption text vs treatment:** word-for-word the same, except line 18: the voice and caption say "as well", while TREATMENT.md still says "too" (update the treatment).
- **Issues, with timestamps (frames every 5 s checked):**
  1. **2:11.0, cue 24 never shows.** The .srt has `00:02:11,067 --> 00:02:11,017` (negative length) for "Firebase AI Logic in all three modes:", so the first half of line 21 is missing on screen and in the .srt; viewers only see "on-device only where the input is private...". Likely cause: in `film.js` CUES, the split part "on-device only..." is placed at a Whisper word that comes before the first part's start, and the first part is cut at the next cue. Fix the split start, or hold the first part for at least 1.8 s and shift the second.
  2. **1:29 to 1:33, shot 15:** the two-line caption "It read all ten results correctly in one call..." sits over the 4th to 5th rows of the results table while the line is about those rows. Raise the camera target or end the caption before the scroll reaches them.
  3. **2:18 to 2:27, shot 22 (README):** the AI-calls table shows the old line numbers (`extract.ts:240`, `:204`, `explain.ts:54`, `:176`), fixed tonight in `8d77fa8`. Recapture shot 22 after this branch is pushed, or the film shows stale numbers.
  4. **2:10 to 2:16, shot 21:** the caption covers the last bullets of the "On this device" and "In the cloud" columns (the `PREFER_ON_DEVICE` line it is talking about stays visible). Minor.
  5. **Lines 12 and 21** are only partly supported by the app (see Task 6 and `docs/claims-check.md`).
- Specimen is never under a caption in the sampled frames.

### Task 9: Devpost prep

- **Gallery images** in `docs/devpost/`, each 1500x1000 JPEG, 139 to 178 KB, the real screen on a dark frame with a one-line caption bar (IBM Plex Sans, the site's own font, loaded from `node_modules`). Made by `scripts/devpost.ts` from the live site with Gemini blocked and built-in AI off, synthetic sample only, so you can re-run it after a deploy:
  1. `01-landing-hero.jpg`: the landing hero.
  2. `02-compare.jpg`: the drag-to-compare report, slider at 55%.
  3. `03-mask.jpg`: the mask screen with the 5 suggested boxes on the sample.
  4. `04-under-the-hood.jpg`: "Under the hood".
  5. `05-unfamiliar-layout.jpg`: from yesterday's Scene 3 take B at 1:58 (`capture/chrome/B-scene3.mkv`, cropped to the page). It shows 9 of the 10 verified rows (Haemoglobin to TSH), each "Verified against your PDF"; the 10th (Serum Creatinine) is just below the fold in every frame where the table is still. Re-run with `UNFAMILIAR_FRAME=<jpg> npx tsx scripts/devpost.ts`.
- **`docs/JUDGES.md`:** what to click first, the sample reports, how to enable on-device AI, what each path shows, and known limits (free-tier daily limit, Path 3 paused, not yet doctor-reviewed, 10-page cap). Every fact taken from the README or the code.
- **Link to demo-unfamiliar.pdf** (checked, 200): https://github.com/tusharshah21/ClearReport/blob/main/test-data/reports/demo-unfamiliar.pdf, direct download https://raw.githubusercontent.com/tusharshah21/ClearReport/main/test-data/reports/demo-unfamiliar.pdf

### Task 10: judge simulation (opinion, not a measurement)

Three imagined judges, each scoring the live site, README and draft film as they stand this morning (before tonight's fixes are deployed).

| Judge | Technological Implementation | Design | Potential Impact | Quality of the Idea |
| --- | --- | --- | --- | --- |
| A, engineer who reads the code | 9 | 8 | 7 | 8 |
| B, product designer who only uses the site, partly on a phone | 7 | 8 | 7 | 8 |
| C, health and privacy judge | 8 | 7 | 8 | 9 |
| Average | 8.0 | 7.7 | 7.3 | 8.3 |

- **A:** Firebase AI Logic used in all three modes with a clear reason for each; every value cross-checked against the PDF text; a build check that fails on leaked secrets; real eval numbers with the weak set (photos, 66% value) shown openly. Loses points for the 464 kB app chunk and the 3 s Remote Config wait before first paint.
- **B:** The landing page and compare slider are strong and calm. On a phone, /app shows nothing for about 6 s on throttled 4G (Lighthouse 62), which reads as broken. Before tonight's fix, "Try a sample report" then a quick "Mask my details" lost the sample, which a judge clicking fast would hit.
- **C:** Keeping identity on the device is the right idea for India, where reports are shared over WhatsApp. Trust drops if the judge tries `r6-photo.jpg` and the suggested boxes miss the patient name and phone. "Not yet reviewed by a doctor" is honest but caps impact; Hindi helps reach.

**The 10 highest-impact improvements that fit in 3 days and keep the design freeze:**

1. **Deploy this branch after review**, so judges get the sample race fix, the no-results screen, clear file errors and SEO 100. Largest gain for least work.
2. **Fix the film:** cue 24 at 2:11 (negative length), the 1:29 caption over the rows, and recapture shot 22 with the new README line numbers. The film is what most judges watch first.
3. **Photo mask suggestions** (option (a) in "Needs Tushar's decision"): catch "PATIENT :" and "PH :" on photos and scans, with a check in `scripts/checks.ts`. Removes the one trust failure a judge can find with the repo's own test file. Boxes are an existing UI element, so no design change.
4. **Render before Remote Config loads** on /app: show the 18+ notice at once and apply config when it arrives. Cuts the phone blank screen from about 6 s; no visual change.
5. **Make sure the free-tier daily limit cannot hit during judging:** either move AI Logic to a paid tier for the judging window or say in JUDGES.md and on Devpost when the quota resets. A judge who meets "Today's free AI limit has been reached" sees a reduced app.
6. **Put the video and `docs/JUDGES.md` at the top of the README** and replace the video placeholder link; upload the 5 gallery images to Devpost.
7. **Correct VO lines 12 and 21** (suggested wording in Task 6) before the final render, so nothing in the film overstates what the app does.
8. **Count only pages with results against the 10-page cap**, so long real lab PDFs (with terms and method pages) are not refused.
9. **One named clinician review of the 7 guideline thresholds**, even a short written note in the README. Moves "not yet reviewed by a doctor" to "reviewed by Dr X on date", the biggest credibility gain for Potential Impact.
10. **Broaden the accuracy evidence:** add 2 or 3 more synthetic layouts modelled on other Indian lab chains to `npm run eval`, so "measured on 2 real reports from one lab chain" becomes a wider claim. Test-data only.

## Fixed (commit IDs)

- `1a327fa` Add `npm run privacy-proof`.
- `d502c21` Clear messages for files the app cannot read (new `src/fileerror.ts`, checks in `scripts/checks.ts`), and "We found no test results in this file" instead of an empty results table with Approve enabled.
- `82dca5f` Edge-case files and `scripts/edge.ts`.
- `6c6bdbc` Sample report race: a path picked while the sample loads now carries on.
- `a3dfac2` `scripts/xbrowser.ts`.
- `fd4cb18` Real `robots.txt`; canonical link `/app` on the tool page.
- `e2419d6` An h1 on every app screen (screen-reader-only once the hero is hidden).
- `8d77fa8` README AI-calls table line numbers.
- `ce9d93d` **Landing wording (needs your approval before deploy):** 3 Bento lines and 1 Beam line made accurate.
- `d2f14b9` `docs/claims-check.md`.
- `210c073` `.gitattributes`: edge-case files are binary.
- `af4cff4` Privacy proof keeps its OCR cache out of the repo.
- `09bf1c0` Devpost gallery images and `scripts/devpost.ts`.
- `10c04e9` `docs/JUDGES.md`.

## Decisions I made

- Privacy proof uses installed Chrome with `--disable-features=AIPromptAPI,...` (Playwright's own Chromium is not downloaded on this machine), and a stand-in `LanguageModel` for Path 1. The init script is passed as a string, because tsx wraps functions in a `__name()` helper the page does not have.
- A synthetic name word that is also ordinary app text is not searched for: "Example" (from "Dr. Example Iyer") is in the prompt as "for example". The other words (Iyer, Fictitious, Meera), IDs and phones are still searched.
- Photos in the proof go through the default "Straighten" step, as a user would; `PROOF_ASIS=1` uses "Use the photo as it is" instead (then r6-photo keeps only 2 tiny boxes and the whole header is visible).

- The no-results screen reuses the existing failed card (same styles), with new words only. It shows no "Try again" or "Mask my details" button, because neither helps with a file that is not a lab report.
- Tools downloaded for testing only, none added to `package.json`: Playwright's Firefox and WebKit (`npx playwright install firefox webkit`, into Playwright's own cache), and Lighthouse and axe-core installed in a temporary scratch folder outside the repo.
- Gallery image 5 uses the take B frame at 1:58, the stillest frame with the most verified rows (9 of 10). A frame with all 10 would catch the page mid-scroll and look blurred. The caption says "every value verified", which the frame supports.
- `docs/JUDGES.md` repeats only what the README and code already say; one wrong number in my first draft (a 20-page cap) was corrected to the real 10 before committing.
- Final `npm run eval` and `scripts/edge.ts` runs only changed a timestamp and heap/timing figures, so those file changes were reverted rather than committed.

- `password.pdf` is a minimal hand-made PDF with a Standard security handler whose password check fails, which is what any reader sees for a password-protected PDF. No library was downloaded to make a real encrypted one. The HEIC test file has a real HEIC header only, since Chrome on desktop cannot decode HEIC at all (a real iPhone file behaves the same here).

## Needs Tushar's decision

- **20-page PDFs are refused outright** (`MAX_PAGES = 10` in `src/pdf.ts`), even when only page 1 has results. Long lab PDFs (terms, method notes, graphs) can pass 10 pages. Option: count only pages with results (`pagesWithResults` already finds them) against the limit, and still render at most 10. That changes the PDF reading path, so I left it.
- **/app first paint on phones (Lighthouse mobile 62):** `main.tsx` awaits `loadConfig()` (up to 3 s) before rendering anything. Rendering the 18+ notice first and loading Remote Config behind it would cut the blank wait; it changes start-up order, so I left it.
- **Scanned PDFs get 0 suggested boxes** on the mask screen (scanned.pdf is the r2 report as a picture). Same area as the r6-photo gap: OCR-based suggestions on images.

- **r6-photo mask suggestions miss the patient name, age/sex and phone** (Task 2). Options: (a) improve the photo label rules in `src/masks.ts` (for example a "PATIENT :" label with the value after a wide gap, and "PH :"), with a check in `scripts/checks.ts`; (b) on photos, add a plain line on the mask screen such as "Photos: please check the name, age and phone yourself"; (c) leave as is. (b) is copy only; (a) changes suggestions, so the demo boxes would need a re-check.

## Skipped

- **App Check enforcement for AI Logic:** a console setting with no CLI access here. Please check it by hand (Task 7).
- **`npm audit fix --force`:** it changes the firebase version, which is more than a bug fix; the 4 high findings are in Firestore code the app never loads.
- **On-device steps in your own Chrome:** not needed tonight; every check ran in automated browsers with Gemini blocked. Nothing was sent to the cloud.
- **Film changes and re-render:** reported only (Task 8), as asked.
- **Landing wording and VO wording:** the landing fix is on the branch for your approval (`ce9d93d`); VO lines 12 and 21 are suggestions only.

## Final status

Re-run at the end on `overnight-2026-11-25` (14 commits ahead of `main`, plus this report):

- `npm test`: exit 0. `tsc -p tsconfig.app.json --noEmit`: exit 0. `npm run build` (with `check-dist`): exit 0, debug token absent from `dist/`. `npm run lint`: exit 0 (4 old warnings, none from tonight's changes).
- `npm run eval`: exit 0, same scores as the baseline.
- `npm run privacy-proof`: 15 checks ok, 1 WARN (r6-photo, as above), 0 FAIL. No `eng.traineddata` left in the repo.
- `scripts/edge.ts`: exit 0, same results as the table above, 0 Gemini requests.
- Nothing deployed, pushed or merged.

## Plan for today

1. Review the branch commit by commit; the one that needs a real yes or no is `ce9d93d` (landing wording).
2. Decide the four items in "Needs Tushar's decision"; the r6-photo mask suggestions matter most for judges.
3. Confirm App Check is enforced for Firebase AI Logic in the console.
4. Merge, push and deploy; then re-run `npx tsx scripts/devpost.ts` against the live site if anything visible changed, and upload `docs/devpost/*.jpg` to Devpost.
5. Fix the film (cue 24, the 1:29 caption, recapture shot 22, VO lines 12 and 21) and render the final cut.
6. Then work down the Task 10 list.
