# Demo recording checklist

All files are synthetic (fake names, IDs and phone numbers, "SYNTHETIC TEST DATA" footer). Never record a real report.

## Before recording

1. Deploy the latest build (the unit fix and the "you haven't" wording fix must be live), then open https://clearreport-717f3.web.app/app in Chrome on the laptop that runs Private (16 GB RAM or a graphics card with more than 4 GB memory).
2. Clear the site's data so Remote Config fetches the current prompt version instead of a cached one (production caches it for 1 hour): DevTools (F12) > Application > Storage > "Clear site data". Alternative: the icon left of the address bar > Site settings > Delete data. This also clears the "I am 18 or older" answer, so that screen comes back once.
3. Hard reload (Ctrl+Shift+R) so the page and its bundle are fresh.
4. Warm the on-device model: open chrome://on-device-internals and check that the model shows as ready (no download in progress). Then do one full run of demo.pdf (Scene 1 below) off camera, including one "What does this test mean?" tap. The first on-device call after a browser start is the slow one.
5. Check the footer of that warm-up run says the current prompt version (Prompt v7). If it says an older one, repeat step 2.
6. Reload the page (F5) to start the recording from a clean screen. The warm model stays loaded in Chrome; nothing from the warm-up run is kept by the page.
7. Close other heavy tabs and apps, set the browser zoom to 100%, and hide bookmarks and extensions from the toolbar.

## Scene 1: Private (PDF), read on this device, with the glucose callout

File: `test-data/reports/demo.pdf` (also served as the landing page's sample at `/samples/demo.pdf`)

1. Start on the landing page, https://clearreport-717f3.web.app/, and click **Try a sample report**. The app opens with the sample loaded and the banner "You are using a synthetic sample report. No real person's data." (Or open /app and choose `demo.pdf` after step 3.)
2. If shown, click **I am 18 or older**. Wait for the status line "This device can read your lab PDF privately..." under "How should we read your report?".
3. Click **Read it privately**.
4. (Only when not using the sample link) choose `demo.pdf` in the "PDF file" picker.
5. On "Check your results": point at the 7 rows, all "Verified against your PDF", and the line "Read on this device in 0.0 s (7 rows by the plain-code parser, 0 on-device model calls)".
6. Scroll to "What will be sent for the explanation": the JSON has no name, ID, phone or doctor; age is a range (50-59).
7. Click **Approve and send these numbers**.
8. Scroll to "Blood sugar", the Glucose Fasting (FBS) card: show the "Guideline: borderline" label and the "Your lab and a common guideline use different ranges" callout.
9. Click **What does this test mean?** on that card. Wait for the answer labelled "Answered on this device".
10. Scroll to "Questions you could ask your doctor": the first question is about fasting glucose.
11. Click **हिन्दी** in the language switch, then **English** to switch back.
12. Point at the Data trail panel on the right: every step says where it happened.

## Scene 2: Mask it yourself, with a phone photo

File: `test-data/reports/r6-photo.jpg`

1. Click **Start over** (or reload) to get back to "How should we read your report?".
2. Click **Mask my details**.
3. Choose `r6-photo.jpg`.
4. If "Straighten the photo" appears, click **Straighten** (or **Use the photo as it is**).
5. On "Cover your personal details": press and drag to draw a black box over the name, ID, phone and doctor's name (if any boxes are already there, check them first). **Zoom in** helps on small text.
6. Click **Done masking**.
7. On the screen showing the exact image to be sent, click **Send this image**.
8. On "Check your results", click **Approve and send these numbers**.
9. Show the explanation, then scroll to the LDL cholesterol card.

## Scene 3 (optional): a layout the parser does not know

File: `test-data/reports/demo-unfamiliar.pdf`

Read this before recording it. On 2026-11-23 this file did NOT read well on Path 1. The plain-code parser read 0 rows and the on-device model was used. Over two runs it returned 5 or 6 rows: no test names were right, the values were attached to the wrong tests, and no range was right. The cross-check against the PDF text caught most of this: 0 rows were marked "Verified" and 4 or 5 were marked "Please check", and Approve stays blocked until those are confirmed or corrected. It did not catch everything: in each run one row had an invented test name that is not in the PDF text, so it could not be checked and got the neutral "Read from image" badge, which does not block Approve. So the honest story for this scene is "the cross-check flags most of a bad read", not "the on-device model reads any layout" and not "the cross-check catches every error". If you record it, point at the "Read from image" row too, or skip this scene.

1. Click **Start over**, then **Read it privately**.
2. Choose `demo-unfamiliar.pdf`. Reading takes 35 to 55 seconds; the screen says "Reading your report on this device...".
3. On "Check your results", show the "Please check this value" rows and the "Use the number in your PDF" suggestions.
4. Click **Cancel** rather than sending these rows.

## After recording

- Close the tab. Nothing is stored by ClearReport; the report stays in that tab's memory only.
