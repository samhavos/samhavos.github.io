/**
 * @file Query parameter helpers for bootstrapping the application.
 */

export type QueryHints = {
  repo?: string;
  board?: string;
  token?: string;
  fullscreen?: boolean;
};

const STRING_HINT_KEYS = ["repo", "board", "token"] as const;
const BOOLEAN_HINT_KEYS = ["fullscreen"] as const;
const KNOWN_KEYS: Array<keyof QueryHints> = [...STRING_HINT_KEYS, ...BOOLEAN_HINT_KEYS];

/**
 * Parse known query parameters from the current location.
 */
export function parseQueryHints(search: string = window.location.search): QueryHints {
  const params = new URLSearchParams(search);
  const hints: QueryHints = {};

  for (const key of STRING_HINT_KEYS) {
    const value = params.get(key);
    if (value && value.trim().length > 0) {
      hints[key] = value.trim();
    }
  }

  if (params.has("fullscreen")) {
    const rawValue = params.get("fullscreen");
    if (!rawValue || rawValue.trim().length === 0) {
      hints.fullscreen = true;
    } else {
      const normalized = rawValue.trim().toLowerCase();
      hints.fullscreen = !["0", "false", "off", "no"].includes(normalized);
    }
  }

  return hints;
}

/**
 * Remove known query parameters from the URL without triggering navigation.
 */
export function clearQueryHints(keys: Array<keyof QueryHints> = KNOWN_KEYS): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  let mutated = false;

  for (const key of keys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      mutated = true;
    }
  }

  if (mutated) {
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, document.title, next);
  }
}
