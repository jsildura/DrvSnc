export interface AccentPreset {
  id: string;
  name: string;
  hex: string;
  hoverHex: string;
  textDarkHex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'indigo',
    name: 'Indigo',
    hex: '#4f46e5',
    hoverHex: '#4338ca',
    textDarkHex: '#818cf8',
  },
  {
    id: 'blue',
    name: 'Google Blue',
    hex: '#1a73e8',
    hoverHex: '#1557b0',
    textDarkHex: '#669df6',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    hex: '#059669',
    hoverHex: '#047857',
    textDarkHex: '#34d399',
  },
  {
    id: 'violet',
    name: 'Violet',
    hex: '#7c3aed',
    hoverHex: '#6d28d9',
    textDarkHex: '#a78bfa',
  },
  {
    id: 'amber',
    name: 'Amber',
    hex: '#ea580c',
    hoverHex: '#c2410c',
    textDarkHex: '#fb923c',
  },
  {
    id: 'rose',
    name: 'Rose',
    hex: '#e11d48',
    hoverHex: '#be123c',
    textDarkHex: '#fb7185',
  },
  {
    id: 'cyan',
    name: 'Cyan',
    hex: '#0891b2',
    hoverHex: '#0e7490',
    textDarkHex: '#38bdf8',
  },
];
export const DEFAULT_ACCENT_COLOR = '#4f46e5';

export function resolveAccentHex(color?: string): string {
  if (!color) return DEFAULT_ACCENT_COLOR;
  const trimmed = color.trim().toLowerCase();
  if (trimmed === 'default' || trimmed === 'drive') {
    return DEFAULT_ACCENT_COLOR;
  }
  const preset = ACCENT_PRESETS.find(
    (p) => p.id === trimmed || p.hex.toLowerCase() === trimmed
  );
  if (preset) return preset.hex;

  const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return hexToRgb(hex) ? hex : DEFAULT_ACCENT_COLOR;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const sanitized = hex.replace(/^#/, '');
  if (sanitized.length === 3) {
    const r = parseInt(sanitized[0] + sanitized[0], 16);
    const g = parseInt(sanitized[1] + sanitized[1], 16);
    const b = parseInt(sanitized[2] + sanitized[2], 16);
    return isNaN(r) || isNaN(g) || isNaN(b) ? null : { r, g, b };
  }
  if (sanitized.length === 6) {
    const r = parseInt(sanitized.substring(0, 2), 16);
    const g = parseInt(sanitized.substring(2, 4), 16);
    const b = parseInt(sanitized.substring(4, 6), 16);
    return isNaN(r) || isNaN(g) || isNaN(b) ? null : { r, g, b };
  }
  return null;
}

export function adjustBrightness(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const adjust = (channel: number) =>
    Math.min(255, Math.max(0, Math.round(channel + (percent / 100) * 255)));
  const r = adjust(rgb.r).toString(16).padStart(2, '0');
  const g = adjust(rgb.g).toString(16).padStart(2, '0');
  const b = adjust(rgb.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Standard WCAG 2.1 relative luminance calculation
 * Returns value in [0, 1] where 0 is purest black and 1 is purest white.
 */
export function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((val) =>
    val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * WCAG 2.1 Contrast Ratio between two hex colors (returns 1 to 21)
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return 1;
  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns accessible text color (#ffffff or #0f172a) for a given background color,
 * ensuring high readability and WCAG AA/AAA contrast.
 */
export function getContrastText(backgroundHex: string): '#ffffff' | '#0f172a' {
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) return '#ffffff';
  const lum = getLuminance(rgb.r, rgb.g, rgb.b);
  // Dominant/saturated accents (indigo, blue, violet, rose, amber, cyan) require white text.
  // Only high-luminance colors (e.g. bright yellow, lime, pastel cyan) use dark text.
  return lum > 0.55 ? '#0f172a' : '#ffffff';
}

/**
 * Ensures text color against white background has at least minRatio (default 4.5:1)
 * by progressively darkening if the color is too bright.
 */
export function ensureContrastOnLight(hex: string, minRatio = 4.5): string {
  let current = hex;
  if (getContrastRatio(current, '#ffffff') >= minRatio) return current;
  for (let percent = -5; percent >= -80; percent -= 5) {
    current = adjustBrightness(hex, percent);
    if (getContrastRatio(current, '#ffffff') >= minRatio) return current;
  }
  return current;
}

/**
 * Ensures text color against dark background (#252527) has at least minRatio (default 4.5:1)
 * by progressively lightening if the color is too dark.
 */
export function ensureContrastOnDark(hex: string, minRatio = 4.5): string {
  let current = hex;
  if (getContrastRatio(current, '#252527') >= minRatio) return current;
  for (let percent = 5; percent <= 80; percent += 5) {
    current = adjustBrightness(hex, percent);
    if (getContrastRatio(current, '#252527') >= minRatio) return current;
  }
  return current;
}

export function applyAccentColor(color: string): void {
  if (typeof document === 'undefined') return;

  const baseHex = resolveAccentHex(color);
  const preset = ACCENT_PRESETS.find(
    (p) => p.hex.toLowerCase() === baseHex.toLowerCase() || p.id === color.toLowerCase()
  );

  const rgb = hexToRgb(baseHex) || hexToRgb(DEFAULT_ACCENT_COLOR)!;
  const lum = getLuminance(rgb.r, rgb.g, rgb.b);

  const hoverHex = preset ? preset.hoverHex : adjustBrightness(baseHex, lum > 0.6 ? -18 : -14);
  const activeHex = adjustBrightness(baseHex, lum > 0.6 ? -25 : -20);
  const contrastHex = getContrastText(baseHex);
  const textLightHex = ensureContrastOnLight(baseHex);
  const textDarkHex = preset?.textDarkHex ? preset.textDarkHex : ensureContrastOnDark(baseHex);

  // If the accent is very light (luminance > 0.82), add a subtle border for solid buttons so they don't blend into white backgrounds
  const btnBorder = lum > 0.82 ? 'rgba(0, 0, 0, 0.18)' : 'transparent';

  const root = document.documentElement;
  root.style.setProperty('--color-accent', baseHex);
  root.style.setProperty('--color-accent-hover', hoverHex);
  root.style.setProperty('--color-accent-active', activeHex);
  root.style.setProperty('--color-accent-contrast', contrastHex);
  root.style.setProperty('--color-accent-on', contrastHex);
  root.style.setProperty('--color-accent-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
  root.style.setProperty('--color-accent-dark', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
  root.style.setProperty('--color-accent-text', textLightHex);
  root.style.setProperty('--color-accent-text-dark', textDarkHex);
  root.style.setProperty('--color-accent-border', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
  root.style.setProperty('--color-accent-ring', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`);
  root.style.setProperty('--color-accent-btn-border', btnBorder);
}

export function getStoredAccentColor(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_ACCENT_COLOR;
  const stored = localStorage.getItem('gdu_accent_color');
  return resolveAccentHex(stored || undefined);
}

export function storeAccentColor(color: string): void {
  if (typeof localStorage === 'undefined') return;
  const validHex = resolveAccentHex(color);
  localStorage.setItem('gdu_accent_color', validHex);
}
