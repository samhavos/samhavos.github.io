/**
 * @file Query parameter helpers for bootstrapping the application.
 */

export type QueryHints = {
  repo?: string;
  board?: string;
  token?: string;
};

const KNOWN_KEYS: Array<keyof QueryHints> = ["repo", "board", "token"];

/**
 * Parse known query parameters from the current location.
 */
export function parseQueryHints(search: string = window.location.search): QueryHints {
  const params = new URLSearchParams(search);
  const hints: QueryHints = {};

  for (const key of KNOWN_KEYS) {
    const value = params.get(key);
    if (value && value.trim().length > 0) {
      hints[key] = value.trim();
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
