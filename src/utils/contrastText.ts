// Picks whichever of two existing text colors (typically INK and PARCHMENT)
// reads legibly against an arbitrary background color, using the WCAG
// relative-luminance contrast formula. Used for category-color badges where
// the background comes from a fixed swatch list rather than the app's
// text/background palette, so a single hardcoded text color can't cover it.

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getContrastTextColor(backgroundHex: string, darkText: string, lightText: string): string {
  const darkContrast = contrastRatio(backgroundHex, darkText);
  const lightContrast = contrastRatio(backgroundHex, lightText);
  return darkContrast >= lightContrast ? darkText : lightText;
}
