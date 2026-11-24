# ClearReport: a quick guide for judges

ClearReport explains a blood test report in plain English or Hindi while keeping the patient's identity on their own device. Everything below uses synthetic reports only.

## What to click first

1. Open https://clearreport-717f3.web.app and click **Try a sample report**. The app opens with a synthetic report (a fictional patient) already loaded.
2. Confirm you are 18 or older, then pick how the report is read. Each choice shows, before anything is sent, exactly what leaves the device.
3. On the landing page, drag the slider in **Privacy promises** to compare the report with what is sent, and open **Under the hood** to see which step runs where.

## Sample reports

- The built-in sample: "Try a sample report" (served from `/samples/demo.pdf`).
- A layout the plain-code parser has never seen, read by on-device AI: [demo-unfamiliar.pdf](https://github.com/tusharshah21/ClearReport/blob/main/test-data/reports/demo-unfamiliar.pdf) (direct download: https://raw.githubusercontent.com/tusharshah21/ClearReport/main/test-data/reports/demo-unfamiliar.pdf).
- More synthetic reports in [test-data/reports](../test-data/reports): `r2.png` (a lab range that disagrees with a guideline), `r6-photo.jpg` (a phone photo), `p1.pdf` to `p3.pdf` (text PDFs).

## How to enable on-device AI (Path 1)

Desktop Chrome 139 or newer, with 16 GB of RAM or a graphics card with more than 4 GB of memory, and free disk space for the model.

1. Open `chrome://flags/#prompt-api-for-gemini-nano` and set it to Enabled.
2. Open `chrome://flags/#optimization-guide-on-device-model` and set it to Enabled.
3. Restart Chrome, then open `chrome://on-device-internals` to check that the model is ready.

Without it, known lab layouts are still read on the device by plain code; only unfamiliar layouts need the on-device model.

## What each path shows

- **Path 1, read on this device.** A text PDF is read in the browser (plain code, or Gemini Nano for an unfamiliar layout). Every value is checked against the PDF text, your name and IDs are removed, and only anonymous numbers, the lab name, an age range and sex are sent to Gemini in the cloud for the explanation.
- **Path 2, mask it yourself.** For a scan or photo. Suggested boxes over names, IDs and phone numbers are found on the device; you adjust them, they are burned in as solid black, and you see the exact image before it is sent to be read.
- **Path 3, full report.** Sends the unmasked report after explicit, per-report consent. It is paused for now (see below).

After reading, the report view shows each result against the lab's range and, for 7 tests, against a common guideline, plus a data trail of every step and where it ran.

## Known limits

- **Free-tier daily limit.** The cloud model runs on Google's free tier. When the day's quota is used up, the app says so and shows the results with plain-language range checks only; it does not retry. The quota resets at midnight Pacific time (1:30 PM IST).
- **Path 3 is paused** while the project is on the free tier (`path3_enabled` is false in Remote Config). The code and consent screen remain.
- Guideline thresholds and the plain-language test descriptions have not yet been reviewed by a doctor. Adult ranges only.
- Accuracy was measured on 2 real public sample reports from one lab chain and on synthetic reports; other labs' layouts may differ.
- A PDF of more than 10 pages is refused with a message asking for only the results pages.
