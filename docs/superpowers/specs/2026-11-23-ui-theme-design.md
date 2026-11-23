# ClearReport visual identity: "Specimen"

Date: 2026-11-23. Replaces the "Sage" theme (calm reading room). Visual changes only.

## Concept

Labs stain blood under a microscope (H&E staining: haematoxylin violet, eosin rose) so the parts can be told apart. ClearReport uses the same two stains to tell apart where your data is, and adds a careful friend who goes over your printed report with a highlighter. The landing page is dark, like a microscope slide under light; the app is light paper with a very faint graph-paper grid, like a printed report.

## Colour meanings

Every colour has one meaning, and meaning is never carried by colour alone (always an icon and words as well).

| Colour | Meaning | Where |
| --- | --- | --- |
| Stain violet | On your device | Data trail device steps, Private path card, on-device chips, the device half of the data-journey beam, primary buttons and links (the app's brand) |
| Eosin rose | In the cloud | Data trail cloud steps, Full report path card, cloud chips, the cloud half of the beam after the shield |
| Highlighter yellow | Only "your lab and a guideline disagree" | In the app: the signature callout and the "Guideline: borderline" chip, nothing else. On the landing page: also one key phrase per section, drawn with the same marker stroke (since Prompt 21) |
| Peach | Above or below the lab's range | "Above range" / "Below range" chips and finding icons, always with an icon and words |
| Teal | Within the lab's range | "Within range" chips and finding icons |
| Red | Real errors only | Error notices and error text, always with an icon and words. A true red, clearly different in hue from the rose |

## Tokens

App (light), defined on `:root` in `src/index.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | #FCFCFA | Page background |
| `--card` | #FFFFFF | Cards, inputs |
| `--ink` | #111827 | Body text |
| `--ink-muted` | #4B5563 | Secondary text |
| `--muted` | #F1F1F4 | Neutral panels ("Please check" badge, pending rows) |
| `--border` | #E4E4E7 | Borders |
| `--grid-line` | #EEF0F4 | Graph-paper texture (decorative) |
| `--primary` / `--primary-hover` | #5B3FD1 / #4A31B8 | Primary buttons (white text), links |
| `--ring` | #5B3FD1 | Focus ring on light |
| `--device-bg` / `--device-fg` / `--device-border` | #EEEAFE / #4330A8 / #CFC6FA | On this device |
| `--cloud-bg` / `--cloud-fg` / `--cloud-border` | #FDE8F0 / #A12A63 / #F6C3D8 | In the cloud |
| `--highlight` / `--highlight-edge` / `--highlight-tint` | #FFE45C / #E9C400 / #FFF6C2 | Lab and guideline disagree (ink text) |
| `--status-range-bg` / `--status-range-fg` | #FDEBD8 / #8A3E00 | Above or below range |
| `--status-ok-bg` / `--status-ok-fg` | #DEF3EC / #0F5E4E | Within range |
| `--error` / `--error-bg` / `--error-border` | #B42318 / #FDECEA / #F2B8B2 | Errors |
| `--mask-outline` / `--mask-chip` / `--mask-fill` | #5B3FD1 / #4330A8 / violet at 35% | Suggested mask boxes (masking happens on the device) |
| `--radius` | 0.625rem | Corners |

Landing (dark):

| Token | Value | Use |
| --- | --- | --- |
| `--night` | #0B1020 | Hero and footer background |
| `--night-surface` | #121933 | Raised surfaces on dark (eyebrow pill, browser bar) |
| `--night-grid` | #1E2A4A | Microscope-slide grid lines |
| `--night-text` / `--night-muted` | #E8ECF6 / #9AA6C3 | Text on dark |
| `--glow-violet` / `--glow-rose` | #8B7CFF / #FF7AA8 | Headline gradient, glow, links and focus ring on dark |

Buttons on dark keep `--primary` with white text (6.83:1). The outlined secondary button on dark uses `--night-text` with a `--glow-violet` border. The focus ring on dark is `--glow-violet` (5.79:1 on `--night`), because `--primary` is only 2.77:1 there.

## Typography

- IBM Plex Sans 400, 500, 600, 700, IBM Plex Mono 400, 500 and IBM Plex Sans Devanagari 400, 600, self-hosted with `@fontsource` (no requests to Google Fonts). The Noto fonts are removed.
- Headlines: Plex Sans 700, letter spacing about -0.02em.
- Every test value, range and unit: Plex Mono with tabular numbers (`font-variant-numeric: tabular-nums`), so numbers line up and read like a lab printout.
- Hindi (`:lang(hi)`): Plex Sans Devanagari, line height 1.75.

## Textures

- Landing hero: a faint microscope-slide grid in `--night-grid`, in the same 65-degree perspective as before, fading out towards the bottom, with one soft violet radial glow behind the headline. Static.
- App and the landing page's light sections: a very faint graph-paper grid in `--grid-line` on `--paper`. It sits behind content only: long text is on solid cards, and the lines are faint enough (1.05:1 on paper) that short text on the paper itself stays clear.
- Print: no textures, no glow.

## Component treatments

- Landing: dark hero (headline in `--night-text`, "Keep your identity." in a violet-to-rose gradient), primary "Read my report" and outlined "Try a sample report", the product image with a thin violet edge glow (regenerated in the new theme from a Path 1 run of demo.pdf), the live HTML glucose card on phones. The product image (or the card) straddles the boundary: the night ends with a crisp edge halfway down it and the paper starts there, with no gradient band. The footer is dark again.
- Landing sections: a lab-report header above each heading (number and name in small Plex Mono capitals, for example "01 · WHAT LEAVES YOUR DEVICE"), and one highlighter mark per section on a key phrase.
- Brand mark: a circle (a microscope slide seen from above) split diagonally, violet and rose, with a thin outline (ink on light, `--night-text` on dark, the glow colours for the halves on dark). Used beside "ClearReport" in both headers, as the favicon and in the Open Graph image.
- Disclaimer above every app screen: a slim bar with an info icon and a light border, no fill.
- Data-journey beam: violet on the device side, rose after the shield.
- Data trail: violet dots and chips for device steps, rose for cloud steps.
- Path cards: Private has violet accents, Full report rose accents, Mask it yourself neutral with a violet button (masking happens on the device).
- Result cards: value in Plex Mono 500 at 1.7rem (1.5rem in the collapsed rows), the visual focus of each card; peach and teal status chips with icons.
- Signature callout: a highlighter band behind its heading (yellow marker stroke with a slightly irregular edge, CSS only) and a small pen icon; the body on `--highlight-tint`. The "Guideline: borderline" chip uses the same yellow.
- Mask, crop and canvas chips: violet outline and chip, white digits, black burned-in masks.

## Accessibility rules

- Every text pair passes WCAG AA (4.5:1); focus rings and other required non-text marks pass 3:1. `scripts/contrast.ts` checks every pair, including the headline gradient and the dark landing pairs, in `npm test`.
- The highlighter yellow is decoration behind ink text (13.94:1 on `--highlight`); the callout is identified by its heading and pen icon, not by the yellow.
- Colour never carries meaning alone: every status has an icon and words.
- `prefers-reduced-motion` is respected (no pulses, spinners turn static).
- Focus is visible on dark and on light.

## What does not change

No logic, extraction, privacy, copy meaning or test expectations change. Layout and markup stay as they are, apart from class names and icons needed for the treatments above (path card accents, the pen icon in the callout, monospace values).
