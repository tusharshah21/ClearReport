# ClearReport

Explains Indian blood test reports privately. The report image is read by an on-device model (Gemini Nano in Chrome, via Firebase AI Logic hybrid inference in `ONLY_ON_DEVICE` mode). Identity fields are stripped in plain code, and only reviewed, de-identified values go to a cloud model for a plain-language explanation.

Status: milestone 1, an extraction accuracy spike. Not for real medical use.

## Run

```bash
npm install
cp .env.example .env   # fill in Firebase config
npm run gen            # render synthetic reports + ground truth into test-data/
npm run dev            # spike page at http://localhost:5173
npm run eval           # score saved runs, write test-data/results.md
```

Needs desktop Chrome 139+ with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled.

## License

Apache-2.0
