// The ClearReport mark: a circle split by an asymmetric S-curve, violet (on your device) top-left and rose (in the
// cloud) bottom-right, an off-white gap of even width along the curve, and an off-white shield in the violet lobe.
// One source for the header mark (ui.tsx Logo), the favicons (scripts/icons.ts) and the OG image (scripts/og.ts).
// At 16 px the shield is dropped (shield: false). Drawn on a 100 x 100 grid, circle r 50 at 50,50.

export const LOGO = {
  violet: '#5B3FD1',
  rose: '#C2367A',
  gap: '#F4F1EA',
  // The dividing curve, edge to edge. Its ends sit at different heights and its two bends differ in depth, so it does
  // not read as a yin-yang.
  curve: 'M-2 74C26 82 42 74 50 54S66 20 102 26',
  // Everything below and right of the curve: the rose half.
  rosePath: 'M-2 74C26 82 42 74 50 54S66 20 102 26L102 102L-2 102Z',
  gapWidth: 7,
  shield: 'M30 19.5C25 22.6 21.5 23.4 18.5 23.4V33C18.5 40.6 23.4 45.2 30 48C36.6 45.2 41.5 40.6 41.5 33V23.4C38.5 23.4 35 22.6 30 19.5Z',
  shieldScale: 'translate(30 34) scale(1.15) translate(-30 -34)', // 15% larger, so it still reads at 32 px
}

// The mark's parts as SVG markup inside a 0 0 100 100 viewBox, clipped to the circle so nothing spills past its edge.
export function logoParts(id: string, shield = true) {
  return `<clipPath id="${id}"><circle cx="50" cy="50" r="50"/></clipPath><g clip-path="url(#${id})">`
    + `<rect width="100" height="100" fill="${LOGO.violet}"/><path d="${LOGO.rosePath}" fill="${LOGO.rose}"/>`
    + `<path d="${LOGO.curve}" fill="none" stroke="${LOGO.gap}" stroke-width="${LOGO.gapWidth}"/></g>`
    + (shield ? `<path d="${LOGO.shield}" fill="${LOGO.gap}" transform="${LOGO.shieldScale}"/>` : '')
}

// A standalone SVG file. With bg (the apple-touch-icon), the mark sits at 80% on a square of that colour.
export function logoSvg({ size, shield = true, bg }: { size?: number; shield?: boolean; bg?: string }) {
  const dims = size ? ` width="${size}" height="${size}"` : ''
  const parts = logoParts(shield ? 'cs' : 'c', shield)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${dims}>`
    + (bg ? `<rect width="100" height="100" fill="${bg}"/><g transform="translate(10 10) scale(0.8)">${parts}</g>` : parts)
    + '</svg>'
}
