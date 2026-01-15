/**
 * @file Initializes and orchestrates the Office Bingos frontend UI.
 */

import { buildCommitMessage, computeBingoLines, normalizeBoardDocument } from "./board";
import { decodeBase64, encodeBase64 } from "./encoding";
import { fetchBoardContent, fetchBoardDirectory, fetchRepoDetails, GithubError, putBoardContent } from "./github";
import { parseRepoInput } from "./repo";
import { clearStoredRepo, clearToken, loadStoredRepo, loadTokenState, storeRepo, storeToken } from "./storage";
import type { QueryHints } from "./routing";
import type {
  BoardDocument,
  BoardSummary,
  LoadedBoard,
  RepoCoords,
  StatusMessage
} from "./types";

type LineOrientation = "row" | "column" | "diag-primary" | "diag-secondary";
type GridOrientation = "horizontal" | "vertical";

type SquareFontSpec = {
  name: string;
  scale: number;
  lineHeight?: number;
};

type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

const AVAILABLE_SQUARE_FONTS: SquareFontSpec[] = [
  { name: "Bristol", scale: 1.15, lineHeight: 1.1 },
  { name: "Janitor", scale: 1 },
  { name: "Brown Bag Lunch", scale: 1.8, lineHeight: 0.8 },
  { name: "Sortelo", scale: 1.5 }
];

const DEFAULT_BOARD_LINE_COLOR = "rgba(17, 17, 17, 0.92)";
const DEFAULT_GRID_COLOR: RgbaColor = { r: 17, g: 17, b: 17, a: 0.92 };

const INITIAL_STATUS: StatusMessage = {
  level: "info",
  text: "Enter a GitHub repo to load boards."
};

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function parseRgbaColor(value: string): RgbaColor | null {
  const trimmed = value.trim();

  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const shorthand = hex.length === 3 || hex.length === 4;
    const full = hex.length === 6 || hex.length === 8;
    if (!shorthand && !full) {
      return null;
    }

    const normalized = shorthand
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;

    const hasAlpha = normalized.length === 8;
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    const aChannel = hasAlpha ? Number.parseInt(normalized.slice(6, 8), 16) / 255 : 1;

    if ([r, g, b, aChannel].some((channel) => Number.isNaN(channel))) {
      return null;
    }

    return {
      r,
      g,
      b,
      a: clampAlpha(aChannel)
    };
  }

  const match = trimmed.match(
    /^rgba?\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*(?:\/|,)\s*([0-9]+(?:\.[0-9]+)?)\s*)?\)$/i
  );

  if (!match) {
    return null;
  }

  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] !== undefined ? Number(match[4]) : 1;

  if ([r, g, b, a].some((channel) => Number.isNaN(channel))) {
    return null;
  }

  return {
    r: Math.max(0, Math.min(255, r)),
    g: Math.max(0, Math.min(255, g)),
    b: Math.max(0, Math.min(255, b)),
    a: clampAlpha(a)
  };
}

function formatRgbaColor(color: RgbaColor): string {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  const a = clampAlpha(color.a);
  const alphaText = Number.isInteger(a) ? a.toString(10) : a.toFixed(3).replace(/\.0+$/, "").replace(/0+$/, "");
  return `rgba(${r}, ${g}, ${b}, ${alphaText})`;
}

function lightenColor(color: RgbaColor, ratio: number): RgbaColor {
  return {
    r: Math.round(color.r + (255 - color.r) * ratio),
    g: Math.round(color.g + (255 - color.g) * ratio),
    b: Math.round(color.b + (255 - color.b) * ratio),
    a: color.a
  };
}

function darkenColor(color: RgbaColor, ratio: number): RgbaColor {
  return {
    r: Math.round(color.r * (1 - ratio)),
    g: Math.round(color.g * (1 - ratio)),
    b: Math.round(color.b * (1 - ratio)),
    a: color.a
  };
}

function formatBoardLabel(fileName: string): string {
  return fileName.toLowerCase().endsWith(".json") ? fileName.slice(0, -5) : fileName;
}

function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function createRandomGenerator(seedValue: string): () => number {
  let state = hashSeed(seedValue) || 0x12345678;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCrossMask(seedValue: string): string {
  const rand = createRandomGenerator(seedValue);

  const jitter = (base: number, range: number) => (base + (rand() - 0.5) * range);

  const p1 = {
    c1x: jitter(20, 4),
    c1y: jitter(20, 4),
    c2x: jitter(32, 16),
    c2y: jitter(32, 16),
    ex: jitter(52, 4),
    ey: jitter(52, 4)
  };

  const p2 = {
    c1x: jitter(52, 4),
    c1y: jitter(20, 4),
    c2x: jitter(32, 16),
    c2y: jitter(32, 16),
    ex: jitter(12, 4),
    ey: jitter(52, 4)
  };

  const opaBase = 0.5 + rand() * 0.4;

  const opaStart1 = (opaBase + rand() * 0.1).toFixed(2);
  const opaEnd1 = (opaBase + rand() * 0.1).toFixed(2);
  const opaStart2 = (opaBase + rand() * 0.1).toFixed(2);
  const opaEnd2 = (opaBase + rand() * 0.1).toFixed(2);

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
    `<defs>` +
    `<linearGradient id='g1' gradientUnits='userSpaceOnUse' x1='8' y1='8' x2='56' y2='56'>` +
    `<stop offset='0' stop-color='white' stop-opacity='${opaStart1}'/>` +
    `<stop offset='1' stop-color='white' stop-opacity='${opaEnd1}'/>` +
    `</linearGradient>` +
    `<linearGradient id='g2' gradientUnits='userSpaceOnUse' x1='56' y1='8' x2='8' y2='56'>` +
    `<stop offset='0' stop-color='white' stop-opacity='${opaStart2}'/>` +
    `<stop offset='1' stop-color='white' stop-opacity='${opaEnd2}'/>` +
    `</linearGradient>` +
    `</defs>` +
    `<path d='M8 10 C ${p1.c1x.toFixed(1)} ${p1.c1y.toFixed(1)} ${p1.c2x.toFixed(1)} ${p1.c2y.toFixed(1)} ${p1.ex.toFixed(1)} ${p1.ey.toFixed(1)}' fill='none' stroke='url(#g1)' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<path d='M56 10 C ${p2.c1x.toFixed(1)} ${p2.c1y.toFixed(1)} ${p2.c2x.toFixed(1)} ${p2.c2y.toFixed(1)} ${p2.ex.toFixed(1)} ${p2.ey.toFixed(1)}' fill='none' stroke='url(#g2)' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/>` +
    `</svg>`;

  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");

  return `url("data:image/svg+xml,${encoded}")`;
}

const crossMaskCache = new Map<string, string>();

function getCrossMask(seedValue: string): string {
  const cached = crossMaskCache.get(seedValue);
  if (cached) {
    return cached;
  }
  const mask = buildCrossMask(seedValue);
  crossMaskCache.set(seedValue, mask);
  return mask;
}

function getSquareFont(seedBase: string, index: number): SquareFontSpec {
  const hash = hashSeed(`${seedBase}:font:${index}`);
  const fontIndex = Math.abs(hash) % AVAILABLE_SQUARE_FONTS.length;
  return AVAILABLE_SQUARE_FONTS[fontIndex] ?? AVAILABLE_SQUARE_FONTS[0];
}

function buildStrikeTexture(seedValue: string, orientation: LineOrientation): string {
  const rand = createRandomGenerator(seedValue);
  const jitter = (base: number, spread: number) => base + (rand() - 0.5) * spread;

  const isVertical = orientation === "column";
  const isDiagonal = orientation === "diag-primary" || orientation === "diag-secondary";
  const viewBox = isVertical ? "0 0 64 256" : "0 0 256 64";
  const segments = 20;

  const buildOffsets = (center: number, driftScale: number, wobbleAmp: number) => {
    const samples: number[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const progress = i / segments;
      const drift = (progress - 0.5) * driftScale;
      const wobble = Math.sin((progress + rand() * 0.15) * Math.PI * 4 * (isDiagonal ? 1.3 : 1)) * wobbleAmp;
      const micro = Math.sin((progress * 12) + rand() * 0.6) * (wobbleAmp * 0.45);
      samples.push(jitter(center + drift + wobble + micro, wobbleAmp * 0.4));
    }
    return samples;
  };

  const composePath = (offsets: number[], axis: "horizontal" | "vertical") => {
    const step = 256 / segments;
    let d = axis === "vertical" ? `M${offsets[0].toFixed(2)} 0` : `M0 ${offsets[0].toFixed(2)}`;
    for (let i = 1; i <= segments; i += 1) {
      const prevOffset = offsets[i - 1];
      const targetOffset = offsets[i];
      const prevPrimary = step * (i - 1);
      const targetPrimary = step * i;
      const delta = targetOffset - prevOffset;
      const c1Primary = prevPrimary + step / 3 + jitter(0, step * 0.22);
      const c2Primary = prevPrimary + (step * 2) / 3 + jitter(0, step * 0.22);
      const c1Secondary = prevOffset + delta * 0.35 + jitter(0, Math.abs(delta) * 0.6 + 10);
      const c2Secondary = prevOffset + delta * 0.7 + jitter(0, Math.abs(delta) * 0.6 + 10);

      if (axis === "vertical") {
        const c1x = c1Secondary;
        const c1y = c1Primary;
        const c2x = c2Secondary;
        const c2y = c2Primary;
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${targetOffset.toFixed(2)} ${targetPrimary.toFixed(2)}`;
      } else {
        const c1x = c1Primary;
        const c1y = c1Secondary;
        const c2x = c2Primary;
        const c2y = c2Secondary;
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${targetPrimary.toFixed(2)} ${targetOffset.toFixed(2)}`;
      }
    }
    return d;
  };

  const center = 32;
  const horizontalDrift = isDiagonal ? 16 : 10;
  const horizontalAmpMain = isDiagonal ? 22 : 18;
  const horizontalAmpAccent = horizontalAmpMain * 0.6;
  const verticalDrift = isDiagonal ? 14 : 10;
  const verticalAmpMain = isDiagonal ? 20 : 16;
  const verticalAmpAccent = verticalAmpMain * 0.6;

  const mainOffsets = isVertical
    ? buildOffsets(center, verticalDrift, verticalAmpMain)
    : buildOffsets(center, horizontalDrift, horizontalAmpMain);

  const accentOffsets = isVertical
    ? buildOffsets(center + jitter(0, 3), verticalDrift * 0.75, verticalAmpAccent)
    : buildOffsets(center + jitter(0, 3), horizontalDrift * 0.75, horizontalAmpAccent);

  const mainPath = composePath(mainOffsets, isVertical ? "vertical" : "horizontal");
  const accentPath = composePath(accentOffsets, isVertical ? "vertical" : "horizontal");

  const gradient = isVertical
    ? { x1: 32, y1: 0, x2: 32, y2: 256 }
    : { x1: 0, y1: 32, x2: 256, y2: 32 };

  const mainStrokeWidth = isDiagonal ?  50 : 50;
  const accentStrokeWidth = mainStrokeWidth * 0.58;

  const startOpacity = (0.86 + rand() * 0.06).toFixed(2);
  const midOpacity = (0.54 + rand() * 0.12).toFixed(2);
  const endOpacity = (0.72 + rand() * 0.08).toFixed(2);
  const accentStartOpacity = (0.68 + rand() * 0.08).toFixed(2);
  const accentEndOpacity = (0.32 + rand() * 0.12).toFixed(2);

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}' preserveAspectRatio='none'>` +
    `<defs>` +
    `<linearGradient id='strokeGrad' gradientUnits='userSpaceOnUse' x1='${gradient.x1}' y1='${gradient.y1}' x2='${gradient.x2}' y2='${gradient.y2}'>` +
    `<stop offset='0' stop-color='${isDiagonal ? "#fcb1a6" : "#fb948f"}' stop-opacity='${startOpacity}'/>` +
    `<stop offset='0.45' stop-color='${isDiagonal ? "#f77f78" : "#f96c68"}' stop-opacity='${midOpacity}'/>` +
    `<stop offset='1' stop-color='${isDiagonal ? "#eb3c3c" : "#e52a2a"}' stop-opacity='${endOpacity}'/>` +
    `</linearGradient>` +
    `<linearGradient id='strokeGradAccent' gradientUnits='userSpaceOnUse' x1='${gradient.x1}' y1='${gradient.y1}' x2='${gradient.x2}' y2='${gradient.y2}'>` +
    `<stop offset='0' stop-color='${isDiagonal ? "#ffd2cb" : "#ffc3bf"}' stop-opacity='${accentStartOpacity}'/>` +
    `<stop offset='1' stop-color='${isDiagonal ? "#f76a6a" : "#f95858"}' stop-opacity='${accentEndOpacity}'/>` +
    `</linearGradient>` +
    `</defs>` +
    `<path d='${mainPath}' fill='none' stroke='url(#strokeGrad)' stroke-width='${mainStrokeWidth}' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<path d='${accentPath}' fill='none' stroke='url(#strokeGradAccent)' stroke-width='${accentStrokeWidth}' stroke-linecap='round' stroke-linejoin='round'/>` +
    `</svg>`;

  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");

  return `url("data:image/svg+xml,${encoded}")`;
}

const strikeTextureCache = new Map<string, string>();

function getStrikeTexture(seedValue: string, orientation: LineOrientation): string {
  const key = `${orientation}|${seedValue}`;
  const cached = strikeTextureCache.get(key);
  if (cached) {
    return cached;
  }
  const texture = buildStrikeTexture(seedValue, orientation);
  strikeTextureCache.set(key, texture);
  return texture;
}

function buildGridTexture(seedValue: string, orientation: GridOrientation, strokeColor: string): string {
  const rand = createRandomGenerator(seedValue);
  const jitter = (base: number, spread: number) => base + (rand() - 0.5) * spread;

  const isVertical = orientation === "vertical";
  const viewBox = isVertical ? "0 0 64 256" : "0 0 256 64";
  const segments = 24;

  const buildOffsets = (center: number, driftScale: number, wobbleAmp: number, microScale: number) => {
    const samples: number[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const progress = i / segments;
      const drift = (progress - 0.5) * driftScale;
      const wobble = Math.sin((progress * 6) + rand() * 0.4) * wobbleAmp;
      const micro = Math.sin((progress * 18) + rand() * 0.6) * microScale;
      samples.push(jitter(center + drift + wobble + micro, wobbleAmp * 0.35));
    }
    return samples;
  };

  const composePath = (offsets: number[], axis: GridOrientation) => {
    const step = 256 / segments;
    let d = axis === "vertical" ? `M${offsets[0].toFixed(2)} 0` : `M0 ${offsets[0].toFixed(2)}`;
    for (let i = 1; i <= segments; i += 1) {
      const prevOffset = offsets[i - 1];
      const targetOffset = offsets[i];
      const prevPrimary = step * (i - 1);
      const targetPrimary = step * i;
      const delta = targetOffset - prevOffset;
      const c1Primary = prevPrimary + step / 3 + jitter(0, step * 0.14);
      const c2Primary = prevPrimary + (step * 2) / 3 + jitter(0, step * 0.14);
      const c1Secondary = prevOffset + delta * 0.35 + jitter(0, Math.abs(delta) * 0.45 + 5);
      const c2Secondary = prevOffset + delta * 0.7 + jitter(0, Math.abs(delta) * 0.45 + 5);

      if (axis === "vertical") {
        const c1x = c1Secondary;
        const c1y = c1Primary;
        const c2x = c2Secondary;
        const c2y = c2Primary;
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${targetOffset.toFixed(2)} ${targetPrimary.toFixed(2)}`;
      } else {
        const c1x = c1Primary;
        const c1y = c1Secondary;
        const c2x = c2Primary;
        const c2y = c2Secondary;
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${targetPrimary.toFixed(2)} ${targetOffset.toFixed(2)}`;
      }
    }
    return d;
  };

  const center = 32;
  const mainOffsets = buildOffsets(center, isVertical ? 8 : 12, isVertical ? 10 : 12, isVertical ? 3.5 : 4);
  const accentOffsets = buildOffsets(center + jitter(0, 2.5), isVertical ? 6 : 8, isVertical ? 7 : 9, isVertical ? 2.4 : 3.2);

  const mainPath = composePath(mainOffsets, orientation);
  const accentPath = composePath(accentOffsets, orientation);

  const baseColor = parseRgbaColor(strokeColor) ?? DEFAULT_GRID_COLOR;
  const normalizedBase: RgbaColor = { ...baseColor, a: clampAlpha(baseColor.a) };
  const baseAlpha = normalizedBase.a;

  const mainLight = lightenColor(normalizedBase, 0.06);
  const mainDark = darkenColor(normalizedBase, 0.08);
  const accentLight = lightenColor(normalizedBase, 0.18);
  const accentDark = darkenColor(normalizedBase, 0.22);

  const mainStartColor = formatRgbaColor({ ...mainLight, a: clampAlpha(baseAlpha * 1.05) });
  const mainMidColor = formatRgbaColor({ ...normalizedBase, a: clampAlpha(baseAlpha * 0.85) });
  const mainEndColor = formatRgbaColor({ ...mainDark, a: clampAlpha(baseAlpha * 0.95) });
  const accentStartColor = formatRgbaColor({ ...accentLight, a: clampAlpha(baseAlpha * 0.6) });
  const accentEndColor = formatRgbaColor({ ...accentDark, a: clampAlpha(baseAlpha * 0.35) });

  const gradient = isVertical
    ? { x1: 32, y1: 0, x2: 32, y2: 256 }
    : { x1: 0, y1: 32, x2: 256, y2: 32 };

  const mainStrokeWidth = isVertical ? 40 : 40;
  const accentStrokeWidth = mainStrokeWidth * 0.52;

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}' preserveAspectRatio='none'>` +
    `<defs>` +
    `<linearGradient id='mainGrad' gradientUnits='userSpaceOnUse' x1='${gradient.x1}' y1='${gradient.y1}' x2='${gradient.x2}' y2='${gradient.y2}'>` +
    `<stop offset='0' stop-color='${mainStartColor}'/>` +
    `<stop offset='0.42' stop-color='${mainMidColor}'/>` +
    `<stop offset='1' stop-color='${mainEndColor}'/>` +
    `</linearGradient>` +
    `<linearGradient id='accentGrad' gradientUnits='userSpaceOnUse' x1='${gradient.x1}' y1='${gradient.y1}' x2='${gradient.x2}' y2='${gradient.y2}'>` +
    `<stop offset='0' stop-color='${accentStartColor}'/>` +
    `<stop offset='1' stop-color='${accentEndColor}'/>` +
    `</linearGradient>` +
    `</defs>` +
    `<path d='${mainPath}' fill='none' stroke='url(#mainGrad)' stroke-width='${mainStrokeWidth}' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<path d='${accentPath}' fill='none' stroke='url(#accentGrad)' stroke-width='${accentStrokeWidth}' stroke-linecap='round' stroke-linejoin='round'/>` +
    `</svg>`;

  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");

  return `url("data:image/svg+xml,${encoded}")`;
}

const gridTextureCache = new Map<string, string>();

function getGridTexture(seedValue: string, orientation: GridOrientation, strokeColor: string): string {
  const normalizedColor = strokeColor.replace(/\s+/g, " ").trim();
  const key = `${orientation}|${normalizedColor}|${seedValue}`;
  const cached = gridTextureCache.get(key);
  if (cached) {
    return cached;
  }
  const texture = buildGridTexture(seedValue, orientation, normalizedColor);
  gridTextureCache.set(key, texture);
  return texture;
}

/**
 * Wire up the DOM, restore stored preferences, and start the application.
 * Accepts optional query-derived hints for repo, board, and token.
 */
export function initializeApp(hints: QueryHints = {}): void {
  const app = document.getElementById("app");
  if (!app) {
    throw new Error("Missing root container");
  }

  const root = app as HTMLDivElement;

  root.classList.add("app");
  root.innerHTML = `
    <header class="app__header">
      <div class="app__connection-row">
        <div class="app__connection">
          <button class="app__connection-toggle" id="connection-toggle" type="button" aria-expanded="false">
            <span class="app__connection-toggle-label">Connection details</span>
            <span class="app__connection-status" id="connection-status">Not connected</span>
            <span class="app__connection-chevron" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M4.47 6.03a.75.75 0 0 1 1.06 0L8 8.44l2.47-2.41a.75.75 0 1 1 1.06 1.06l-3 2.92a.75.75 0 0 1-1.06 0l-3-2.92a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </span>
          </button>
          <div class="app__connection-panel" id="connection-panel" hidden>
            <div class="app__connection-grid">
              <div class="app__control-group app__control-group--repo">
                <label class="app__control-label" for="repo-input">Data repository</label>
                <input class="app__control-input" id="repo-input" name="repo" placeholder="owner/name or https://github.com/owner/name" autocomplete="off" />
              </div>
              <div class="app__control-group app__control-group--token">
                <label class="app__control-label" for="token-input">GitHub token (optional)</label>
                <input class="app__control-input" id="token-input" name="token" type="password" autocomplete="off" placeholder="ghp_..." />
                <div class="app__checkbox-row">
                  <input class="app__checkbox" id="token-remember" type="checkbox" />
                  <label class="app__checkbox-label" for="token-remember">Remember token on this device</label>
                </div>
              </div>
            </div>
            <div class="app__connection-actions">
              <button class="app__button app__button--connect" id="connection-apply" type="button">Connect</button>
              <button class="app__button app__button--clear" id="connection-clear" type="button">Clear</button>
            </div>
          </div>
        </div>
        <button class="app__button app__button--fullscreen" id="fullscreen-toggle" type="button" aria-pressed="false" aria-label="Enter fullscreen">
          <span class="app__fullscreen-icon app__fullscreen-icon--enter" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M4 2C2.89543 2 2 2.89543 2 4V8C2 8.55228 2.44772 9 3 9C3.55228 9 4 8.55228 4 8V4H8C8.55228 4 9 3.55228 9 3C9 2.44772 8.55228 2 8 2H4Z" />
              <path d="M20 2C21.1046 2 22 2.89543 22 4V8C22 8.55228 21.5523 9 21 9C20.4477 9 20 8.55228 20 8V4H16C15.4477 4 15 3.55228 15 3C15 2.44772 15.4477 2 16 2H20Z" />
              <path d="M20 22C21.1046 22 22 21.1046 22 20V16C22 15.4477 21.5523 15 21 15C20.4477 15 20 15.4477 20 16V20H16C15.4477 20 15 20.4477 15 21C15 21.5523 15.4477 22 16 22H20Z" />
              <path d="M2 20C2 21.1046 2.89543 22 4 22H8C8.55228 22 9 21.5523 9 21C9 20.44772 8.55228 20 8 20H4V16C4 15.4477 3.55228 15 3 15C2.44772 15 2 15.4477 2 16V20Z" />
            </svg>
          </span>
          <span class="app__fullscreen-icon app__fullscreen-icon--exit" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M7 9C8.10457 9 9 8.10457 9 7V3C9 2.44772 8.55228 2 8 2C7.44772 2 7 2.44772 7 3V7H3C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9H7Z" />
              <path d="M17 9C15.8954 9 15 8.10457 15 7V3C15 2.44772 15.4477 2 16 2C16.5523 2 17 2.44772 17 3V7H21C21.5523 7 22 7.44772 22 8C22 8.55228 21.5523 9 21 9H17Z" />
              <path d="M17 15C15.8954 15 15 15.8954 15 17V21C15 21.5523 15.4477 22 16 22C16.5523 22 17 21.5523 17 21V17H21C21.5523 17 22 16.5523 22 16C22 15.4477 21.5523 15 21 15H17Z" />
              <path d="M9 17C9 15.8954 8.10457 15 7 15H3C2.44772 15 2 15.4477 2 16C2 16.5523 2.44772 17 3 17H7V21C7 21.5523 7.44772 22 8 22C8.55228 22 9 21.5523 9 21V17Z" />
            </svg>
          </span>
        </button>
      </div>
    </header>
    <main class="app__main">
      <div class="board">
        <div class="board__meta">
          <label class="board__label" for="board-select">Board</label>
          <select class="board__select" id="board-select"></select>
          <span class="board__info" id="board-info"></span>
          <a class="board__create-link" id="board-create-link" href="new.html">Create new board</a>
        </div>
        <div class="board__grid-container">
          <div class="board__grid" id="board-grid" aria-busy="false"></div>
          <div class="board__grid-lines" id="board-lines" aria-hidden="true"></div>
        </div>
      </div>
    </main>
    <footer class="status" id="status"></footer>
  `;

  const elements = {
    body: document.body,
    connectionToggle: document.getElementById("connection-toggle") as HTMLButtonElement,
    connectionPanel: document.getElementById("connection-panel") as HTMLDivElement,
    connectionStatus: document.getElementById("connection-status") as HTMLSpanElement,
    repoInput: document.getElementById("repo-input") as HTMLInputElement,
    tokenInput: document.getElementById("token-input") as HTMLInputElement,
    tokenRemember: document.getElementById("token-remember") as HTMLInputElement,
    connectionApply: document.getElementById("connection-apply") as HTMLButtonElement,
    connectionClear: document.getElementById("connection-clear") as HTMLButtonElement,
    boardSelect: document.getElementById("board-select") as HTMLSelectElement,
    boardGrid: document.getElementById("board-grid") as HTMLDivElement,
    boardInfo: document.getElementById("board-info") as HTMLSpanElement,
    boardLines: document.getElementById("board-lines") as HTMLDivElement,
    status: document.getElementById("status") as HTMLDivElement,
    fullscreenToggle: document.getElementById("fullscreen-toggle") as HTMLButtonElement,
    createLink: document.getElementById("board-create-link") as HTMLAnchorElement
  };

  const state: {
    repo: RepoCoords | null;
    defaultBranch: string | null;
    token: string | null;
    tokenRemembered: boolean;
    boards: BoardSummary[];
    currentBoard: LoadedBoard | null;
    isCommitting: boolean;
    isFullscreen: boolean;
    isDarkMode: boolean;
  } = {
    repo: null,
    defaultBranch: null,
    token: null,
    tokenRemembered: false,
    boards: [],
    currentBoard: null,
    isCommitting: false,
    isFullscreen: false,
    isDarkMode: false
  };

  updateCreateLink();
  refreshConnectionStatus();

  let pendingBoardHint: string | null = hints.board ?? null;
  let statusInitialized = false;
  let prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  applyQueryHints();
  hydrateFromStorage();
  attachEventHandlers();
  toggleFullscreen(Boolean(hints.fullscreen));
  refreshBoardOptions();

  if (!statusInitialized) {
    setStatus(INITIAL_STATUS);
  }

  if (state.repo) {
    void connectToRepo(elements.repoInput.value.trim());
  }

  function applyQueryHints(): void {
    const applied: string[] = [];
    const ignored: string[] = [];

    if (hints.repo) {
      const parsed = parseRepoInput(hints.repo);
      if (parsed) {
        state.repo = parsed;
        elements.repoInput.value = `${parsed.owner}/${parsed.name}`;
        applied.push(`repo ${parsed.owner}/${parsed.name}`);
      } else {
        elements.repoInput.value = hints.repo;
        ignored.push("repo");
      }
    }

    if (hints.token) {
      state.token = hints.token;
      elements.tokenInput.value = hints.token;
      elements.tokenRemember.checked = false;
      applied.push("token (not stored)");
    }

    if (pendingBoardHint) {
      applied.push(`board ${pendingBoardHint}`);
    }

    if (typeof hints.fullscreen === "boolean") {
      applied.push(`fullscreen ${hints.fullscreen ? "on" : "off"}`);
    }

    updateCreateLink();
    refreshConnectionStatus();

    if (ignored.length > 0) {
      setStatus({ level: "error", text: `Ignored URL parameter(s): ${ignored.join(", ")}.` });
    } else if (applied.length > 0) {
      setStatus({ level: "info", text: `Using URL parameters: ${applied.join(", ")}.` });
    }
  }

  function hydrateFromStorage(): void {
    const storedRepo = loadStoredRepo();
    if (!state.repo && storedRepo) {
      const parsed = parseRepoInput(storedRepo);
      if (parsed) {
        state.repo = parsed;
        elements.repoInput.value = `${parsed.owner}/${parsed.name}`;
      }
    }

    const tokenState = loadTokenState();
    if (!state.token && tokenState.token) {
      state.token = tokenState.token;
      elements.tokenInput.value = tokenState.token;
    }

    if (hints.token) {
      elements.tokenRemember.checked = false;
      state.tokenRemembered = false;
    } else {
      elements.tokenRemember.checked = tokenState.remember;
      state.tokenRemembered = tokenState.remember && Boolean(tokenState.token);
    }

    updateCreateLink();
    refreshConnectionStatus();
    setConnectionPanelOpen(!state.repo);
  }

  function attachEventHandlers(): void {
    elements.connectionToggle.addEventListener("click", () => {
      setConnectionPanelOpen(elements.connectionPanel.hidden);
    });

    elements.connectionApply.addEventListener("click", () => {
      applyConnectionSettings();
    });

    elements.repoInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyConnectionSettings();
      }
    });

    elements.tokenInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyConnectionSettings();
      }
    });

    elements.tokenRemember.addEventListener("change", () => {
      if (elements.tokenRemember.checked) {
        storeToken(state.token, true);
        state.tokenRemembered = Boolean(state.token);
        if (state.token) {
          setStatus({ level: "success", text: "Token will be remembered on this device." });
        } else {
          setStatus({ level: "info", text: "No token yet—add one to remember it here." });
        }
      } else {
        storeToken(null, false);
        state.tokenRemembered = false;
        setStatus({ level: "info", text: "Token will only persist in memory." });
      }
      refreshConnectionStatus();
    });

    elements.connectionClear.addEventListener("click", () => {
      state.repo = null;
      state.defaultBranch = null;
      state.boards = [];
      state.currentBoard = null;
      elements.repoInput.value = "";
      refreshBoardOptions();
      renderBoard(null);
      updateCreateLink();
      clearStoredRepo();

      state.token = null;
      state.tokenRemembered = false;
      elements.tokenInput.value = "";
      clearToken();
      elements.tokenRemember.checked = false;

      refreshConnectionStatus();
      setStatus({ level: "success", text: "Cleared connection details." });
      setConnectionPanelOpen(true);
    });

    elements.boardSelect.addEventListener("change", () => {
      const selectedPath = elements.boardSelect.value;
      const summary = state.boards.find((entry) => entry.path === selectedPath);
      if (summary) {
        void loadBoard(summary);
      }
    });

    elements.createLink.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.assign(buildCreateLinkHref(state.repo));
    });

    elements.fullscreenToggle.addEventListener("click", () => {
      toggleFullscreen(!state.isFullscreen);
    });

    prefersDark.addEventListener("change", ({ matches }) => {
      updateDarkMode(matches);
    });
  }

  function applyConnectionSettings(): void {
    const tokenValue = elements.tokenInput.value.trim();
    const currentToken = state.token ?? "";
    if (tokenValue !== currentToken) {
      updateToken(tokenValue);
    }

    const repoValue = elements.repoInput.value.trim();
    void connectToRepo(repoValue);
  }

  function setConnectionPanelOpen(open: boolean): void {
    elements.connectionPanel.hidden = !open;
    elements.connectionPanel.setAttribute("aria-hidden", open ? "false" : "true");
    elements.connectionToggle.setAttribute("aria-expanded", open ? "true" : "false");
    elements.connectionToggle.classList.toggle("app__connection-toggle--open", open);
  }

  function refreshConnectionStatus(): void {
    const parts: string[] = [];

    if (state.repo) {
      const branchFragment = state.defaultBranch ? ` (${state.defaultBranch})` : "";
      parts.push(`${state.repo.owner}/${state.repo.name}${branchFragment}`);
    } else {
      parts.push("Repo not connected");
    }

    let tokenFragment = "Token not set";
    if (state.token) {
      tokenFragment = state.tokenRemembered ? "Token saved" : "Token in memory";
    }
    parts.push(tokenFragment);

    elements.connectionStatus.textContent = parts.join(" • ");
  }

  function updateCreateLink(): void {
    elements.createLink.href = buildCreateLinkHref(state.repo);
  }

  function buildCreateLinkHref(repo: RepoCoords | null): string {
    const params = new URLSearchParams();
    if (repo) {
      params.set("repo", `${repo.owner}/${repo.name}`);
    }
    const query = params.toString();
    return query ? `new.html?${query}` : "new.html";
  }

  updateDarkMode(prefersDark.matches);

  async function connectToRepo(inputValue: string): Promise<void> {
    const parsed = parseRepoInput(inputValue);
    if (!parsed) {
      setStatus({ level: "error", text: "Enter a repository like owner/name." });
      return;
    }

    setStatus({ level: "info", text: "Checking repository access..." });
    elements.connectionApply.disabled = true;

    try {
      const repoInfo = await fetchRepoDetails(parsed, state.token ?? undefined);
      state.repo = parsed;
      state.defaultBranch = repoInfo.default_branch;
      storeRepo(`${parsed.owner}/${parsed.name}`);
      refreshConnectionStatus();
      setConnectionPanelOpen(false);
      updateCreateLink();
      setStatus({ level: "success", text: `Connected to ${parsed.owner}/${parsed.name} (branch ${state.defaultBranch}).` });
      await loadBoards();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read repository.";
      setStatus({ level: "error", text: message });
      refreshConnectionStatus();
      setConnectionPanelOpen(true);
    } finally {
      elements.connectionApply.disabled = false;
    }
  }

  async function loadBoards(): Promise<void> {
    if (!state.repo) {
      return;
    }

    setStatus({ level: "info", text: "Loading boards directory..." });

    try {
      const boardFiles = await fetchBoardDirectory(state.repo, state.defaultBranch, state.token ?? undefined);
      state.boards = boardFiles.map((file) => ({
        name: file.name,
        path: file.path,
        sha: file.sha
      }));

      refreshBoardOptions();

      if (state.boards.length === 0) {
        setStatus({ level: "info", text: "No board JSON files found in boards/." });
        state.currentBoard = null;
        renderBoard(null);
        return;
      }

      const selectedPath = elements.boardSelect.value;
      let boardToLoad: BoardSummary | null = null;

      if (pendingBoardHint) {
        const match = resolveBoardHint(pendingBoardHint, state.boards);
        if (match) {
          boardToLoad = match;
          pendingBoardHint = null;
        } else {
          setStatus({ level: "info", text: `Board "${pendingBoardHint}" not found; showing default.` });
          pendingBoardHint = null;
        }
      }

      if (!boardToLoad) {
        boardToLoad = state.boards.find((entry) => entry.path === selectedPath) ?? state.boards[0] ?? null;
      }

      if (boardToLoad) {
        elements.boardSelect.value = boardToLoad.path;
        await loadBoard(boardToLoad);
      }
      setStatus({ level: "success", text: `Loaded ${state.boards.length} board file(s).` });
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) {
        state.boards = [];
        refreshBoardOptions();
        state.currentBoard = null;
        renderBoard(null);
        setStatus({ level: "info", text: "boards/ folder not found yet." });
        return;
      }

      const message = error instanceof Error ? error.message : "Failed to load boards.";
      setStatus({ level: "error", text: message });
      state.boards = [];
      refreshBoardOptions();
    }
  }

  function resolveBoardHint(hint: string, boards: BoardSummary[]): BoardSummary | undefined {
    const trimmed = hint.trim();
    if (!trimmed) {
      return undefined;
    }

    const ensureJson = (value: string): string => (value.toLowerCase().endsWith(".json") ? value : `${value}.json`);
    const ensureBoardsPrefix = (value: string): string => (value.startsWith("boards/") ? value : `boards/${value}`);

    const bare = trimmed.startsWith("boards/") ? trimmed.slice("boards/".length) : trimmed;
    const bareWithJson = ensureJson(bare);

    const pathCandidates = [
      trimmed,
      ensureBoardsPrefix(trimmed),
      ensureBoardsPrefix(ensureJson(trimmed)),
      ensureBoardsPrefix(bareWithJson)
    ];

    for (const candidate of pathCandidates) {
      const match = boards.find((board) => board.path === candidate);
      if (match) {
        return match;
      }
    }

    const nameCandidates = [bare, bareWithJson];

    for (const candidate of nameCandidates) {
      const match =
        boards.find((board) => board.name === candidate) ??
        boards.find((board) => formatBoardLabel(board.name) === candidate);
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  async function loadBoard(summary: BoardSummary): Promise<void> {
    if (!state.repo) {
      return;
    }

    setStatus({ level: "info", text: `Fetching ${summary.name}...` });

    try {
      const response = await fetchBoardContent(state.repo, summary.path, state.defaultBranch, state.token ?? undefined);
      if (response.encoding !== "base64") {
        throw new Error("Unsupported content encoding from GitHub.");
      }

      const decoded = decodeBase64(response.content);
      const parsed = JSON.parse(decoded) as BoardDocument;
      const normalized = normalizeBoardDocument(parsed);

      state.currentBoard = {
        summary,
        doc: normalized,
        sha: response.sha
      };

      renderBoard(state.currentBoard);
      setStatus({ level: "success", text: `Loaded ${summary.name}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load board.";
      setStatus({ level: "error", text: message });
    }
  }

  function refreshBoardOptions(): void {
    elements.boardSelect.innerHTML = "";
    if (state.boards.length === 0) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "No boards found";
      elements.boardSelect.appendChild(emptyOption);
      elements.boardSelect.disabled = true;
      return;
    }

    elements.boardSelect.disabled = false;
    for (const board of state.boards) {
      const option = document.createElement("option");
      option.value = board.path;
      option.textContent = formatBoardLabel(board.name);
      elements.boardSelect.appendChild(option);
    }
  }

  function renderBoard(board: LoadedBoard | null): void {
    elements.boardGrid.innerHTML = "";
    if (elements.boardLines) {
      elements.boardLines.innerHTML = "";
    }
    elements.boardInfo.textContent = "";

    if (!board) {
      return;
    }

    const { doc } = board;
    elements.boardGrid.style.gridTemplateColumns = `repeat(${doc.size}, 1fr)`;

    const bingos = computeBingoLines(doc.items, doc.size);
    const infoParts: string[] = [];

    infoParts.push(`${doc.size}x${doc.size}`);
    infoParts.push(`${bingos.length} bingo${bingos.length === 1 ? "" : "s"}`);

    if (doc.updatedAt) {
      infoParts.push(`Updated ${new Date(doc.updatedAt).toLocaleString()}`);
    }

    elements.boardInfo.textContent = infoParts.join(" | ");

    const maskSeedBase = board.summary.path || board.summary.name;

    const inkLayer = document.createElement("div");
    inkLayer.className = "board__grid-ink";
    inkLayer.setAttribute("aria-hidden", "true");
    elements.boardGrid.appendChild(inkLayer);
    const computedStyles = window.getComputedStyle(root);
    const boardLineColor = computedStyles.getPropertyValue("--board-lines").trim() || DEFAULT_BOARD_LINE_COLOR;
    renderGridInk(inkLayer, doc.size, maskSeedBase, boardLineColor);

    doc.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "board__square";
      button.dataset.index = index.toString();
      button.textContent = item.text || "\u00A0";

      const maskSeed = `${maskSeedBase}:${index}`;
      button.style.setProperty("--board-cross-mask", getCrossMask(maskSeed));

      const squareFont = getSquareFont(maskSeedBase, index);
      button.style.setProperty("--board-square-font", `'${squareFont.name}', var(--board-square-fallback-font-stack)`);
      button.style.setProperty("--board-square-font-scale", squareFont.scale.toString());
      if (typeof squareFont.lineHeight === "number") {
        button.style.setProperty("--board-square-line-height", squareFont.lineHeight.toString());
      } else {
        button.style.removeProperty("--board-square-line-height");
      }

      if (item.checkedAt) {
        button.classList.add("board__square--checked");
      }

      button.addEventListener("click", () => {
        void handleSquareToggle(index);
      });

      elements.boardGrid.appendChild(button);
    });

    renderBingoLines(bingos, doc.size, maskSeedBase);
  }

  function renderGridInk(layer: HTMLDivElement, size: number, boardSeed: string, lineColor: string): void {
    layer.innerHTML = "";
    if (!Number.isFinite(size) || size <= 0) {
      return;
    }

    const baseThickness = 6;

    for (let row = 0; row <= size; row += 1) {
      const lineSeed = `${boardSeed}:grid-h:${row}`;
      const line = document.createElement("div");
      line.className = "board__grid-ink-line board__grid-ink-line--horizontal";
      line.style.setProperty("--board-grid-texture", getGridTexture(lineSeed, "horizontal", lineColor));

      const thickness = row === 0 || row === size ? baseThickness + 1.2 : baseThickness;
      line.style.height = `${thickness}px`;
      line.style.left = "0";
      line.style.right = "";

      if (row === 0) {
        line.style.top = "0";
        line.style.bottom = "";
        line.style.transform = "none";
      } else if (row === size) {
        line.style.top = "";
        line.style.bottom = "0";
        line.style.transform = "none";
      } else {
        const position = (row / size) * 100;
        line.style.top = `${position}%`;
        line.style.bottom = "";
        line.style.transform = "translateY(-50%)";
      }

      layer.appendChild(line);
    }

    for (let col = 0; col <= size; col += 1) {
      const lineSeed = `${boardSeed}:grid-v:${col}`;
      const line = document.createElement("div");
      line.className = "board__grid-ink-line board__grid-ink-line--vertical";
      line.style.setProperty("--board-grid-texture", getGridTexture(lineSeed, "vertical", lineColor));

      const thickness = col === 0 || col === size ? baseThickness + 1.2 : baseThickness;
      line.style.width = `${thickness}px`;
      line.style.top = "0";
      line.style.bottom = "";

      if (col === 0) {
        line.style.left = "0";
        line.style.right = "";
        line.style.transform = "none";
      } else if (col === size) {
        line.style.left = "";
        line.style.right = "0";
        line.style.transform = "none";
      } else {
        const position = (col / size) * 100;
        line.style.left = `${position}%`;
        line.style.right = "";
        line.style.transform = "translateX(-50%)";
      }

      layer.appendChild(line);
    }
  }

  function renderBingoLines(lines: number[][], size: number, boardSeed: string): void {
    if (!elements.boardLines) {
      return;
    }

    if (lines.length === 0) {
      elements.boardLines.className = "board__grid-lines";
      return;
    }

    elements.boardLines.className = "board__grid-lines board__grid-lines--visible";

    for (const lineIndices of lines) {
      const line = document.createElement("div");
      const orientation = determineLineOrientation(lineIndices, size);
      line.className = `board__grid-line board__grid-line--${orientation}`;
      const lineSeed = `${boardSeed}:${orientation}:${lineIndices.join("-")}`;
      line.style.setProperty("--board-strike-texture", getStrikeTexture(lineSeed, orientation));

      switch (orientation) {
        case "row": {
          const rowIndex = Math.floor((lineIndices[0] ?? 0) / size);
          const center = ((rowIndex + 0.5) / size) * 100;
          line.style.top = `${center}%`;
          line.style.left = "0";
          line.style.transform = "translateY(-50%)";
          break;
        }
        case "column": {
          const colIndex = (lineIndices[0] ?? 0) % size;
          const center = ((colIndex + 0.5) / size) * 100;
          line.style.left = `${center}%`;
          line.style.top = "0";
          line.style.transform = "translateX(-50%)";
          break;
        }
        case "diag-primary":
        case "diag-secondary": {
          line.style.left = "50%";
          line.style.top = "50%";
          line.style.transform = orientation === "diag-primary" ? "translate(-50%, -50%) rotate(45deg)" : "translate(-50%, -50%) rotate(-45deg)";
          break;
        }
        default:
          break;
      }

      elements.boardLines.appendChild(line);
    }
  }

  function determineLineOrientation(lineIndices: number[], size: number): LineOrientation {
    if (lineIndices.length < 2 || size <= 1) {
      return "row";
    }

    const delta = lineIndices[1] - lineIndices[0];

    if (delta === 1) {
      return "row";
    }
    if (delta === size) {
      return "column";
    }
    if (delta === size + 1) {
      return "diag-primary";
    }
    return "diag-secondary";
  }

  async function handleSquareToggle(index: number): Promise<void> {
    if (!state.currentBoard || state.isCommitting) {
      return;
    }

    const board = state.currentBoard;
    const items = board.doc.items.map((item) => ({ ...item }));
    if (!items[index]) {
      return;
    }

    const toggledItem = items[index];
    const textForMessage = typeof toggledItem.text === "string" && toggledItem.text.trim().length > 0 ? toggledItem.text : `Square ${index + 1}`;
    const now = new Date().toISOString();

    if (toggledItem.checkedAt) {
      delete toggledItem.checkedAt;
    } else {
      toggledItem.checkedAt = now;
    }

    for (const item of items) {
      if (item.checkedAt === undefined) {
        delete item.checkedAt;
      }
      if (typeof item.text !== "string") {
        item.text = "";
      }
    }

    const updatedDoc: BoardDocument & { size: number } = {
      ...board.doc,
      items,
      updatedAt: now,
      size: board.doc.size
    };

    await commitBoardUpdate(updatedDoc, board.summary, board.sha, textForMessage, index, Boolean(toggledItem.checkedAt));
  }

  async function commitBoardUpdate(
    updatedDoc: BoardDocument & { size: number },
    summary: BoardSummary,
    previousSha: string,
    squareLabel: string,
    index: number,
    checked: boolean
  ): Promise<void> {
    if (!state.repo) {
      return;
    }

    state.isCommitting = true;
    elements.boardGrid.setAttribute("aria-busy", "true");
    setStatus({ level: "info", text: "Saving board..." });

    const payload = {
      message: buildCommitMessage(squareLabel, index, checked, summary.name),
      content: encodeBase64(JSON.stringify(updatedDoc, null, 2)),
      sha: previousSha,
      branch: state.defaultBranch ?? undefined
    };

    try {
      const response = await putBoardContent(state.repo, summary, payload, state.token ?? undefined);
      const newSha = response.content.sha;

      state.currentBoard = {
        summary,
        doc: updatedDoc,
        sha: newSha
      };

      const boardIndex = state.boards.findIndex((entry) => entry.path === summary.path);
      if (boardIndex >= 0) {
        state.boards[boardIndex] = { ...summary, sha: newSha };
      }

      renderBoard(state.currentBoard);
      setStatus({ level: "success", text: "Board saved." });
    } catch (error) {
      if (error instanceof GithubError && error.status === 403) {
        setStatus({
          level: "error",
          text: "Write blocked: use a fine-grained GitHub access token with read and write permissions for this repository."
        });
        return;
      }

      if (error instanceof GithubError && error.status === 409) {
        setStatus({ level: "error", text: "Content conflict detected. Reloading board." });
        await loadBoard(summary);
        return;
      }

      const message = error instanceof Error ? error.message : "Failed to save board.";
      setStatus({ level: "error", text: message });
    } finally {
      state.isCommitting = false;
      elements.boardGrid.setAttribute("aria-busy", "false");
    }
  }

  function updateToken(rawToken: string): void {
    state.token = rawToken ? rawToken : null;
    storeToken(state.token, elements.tokenRemember.checked);
    state.tokenRemembered = elements.tokenRemember.checked && Boolean(state.token);

    if (state.token) {
      setStatus({ level: "success", text: "Token updated for this session." });
    } else {
      setStatus({ level: "info", text: "Cleared token from memory." });
    }

    refreshConnectionStatus();

    if (state.repo) {
      void loadBoards();
    }
  }

  function setStatus(message: StatusMessage): void {
    elements.status.textContent = message.text;
    elements.status.className = "status";
    if (message.level === "error") {
      elements.status.classList.add("status--error");
    } else if (message.level === "success") {
      elements.status.classList.add("status--success");
    }
    statusInitialized = true;
  }

  function toggleFullscreen(nextState: boolean): void {
    state.isFullscreen = nextState;
    root.classList.toggle("app--fullscreen", state.isFullscreen);
    elements.fullscreenToggle.setAttribute("aria-pressed", state.isFullscreen ? "true" : "false");
    elements.fullscreenToggle.setAttribute(
      "aria-label",
      state.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
    );
  }

  function updateDarkMode(isDark: boolean): void {
    state.isDarkMode = isDark;
    elements.body.classList.toggle("body--dark", isDark);
    root.classList.toggle("app--dark", isDark);
    elements.status.classList.toggle("status--dark", isDark);
    elements.fullscreenToggle.classList.toggle("app__button--fullscreen-dark", isDark);
    if (state.currentBoard) {
      renderBoard(state.currentBoard);
    }
  }
}
