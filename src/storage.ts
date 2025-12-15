/**
 * @file Helpers for persisting lightweight app preferences in localStorage.
 */

const REPO_STORAGE_KEY = "bingos.repo";
const TOKEN_STORAGE_KEY = "bingos.token";
const TOKEN_REMEMBER_KEY = "bingos.token.remember";

export type TokenState = {
  token: string | null;
  remember: boolean;
};

/**
 * Load the stored repository input value, if any.
 */
export function loadStoredRepo(): string | null {
  return window.localStorage.getItem(REPO_STORAGE_KEY);
}

/**
 * Persist the repository input value for future sessions.
 */
export function storeRepo(value: string): void {
  window.localStorage.setItem(REPO_STORAGE_KEY, value);
}

/**
 * Remove any repository information from storage.
 */
export function clearStoredRepo(): void {
  window.localStorage.removeItem(REPO_STORAGE_KEY);
}

/**
 * Load the cached token and remember flag from storage.
 */
export function loadTokenState(): TokenState {
  const rememberRaw = window.localStorage.getItem(TOKEN_REMEMBER_KEY);
  const remember = rememberRaw === "true";
  const token = remember ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  return { token, remember };
}

/**
 * Store the token with respect to the remember flag.
 */
export function storeToken(token: string | null, remember: boolean): void {
  if (remember && token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    window.localStorage.setItem(TOKEN_REMEMBER_KEY, "true");
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.setItem(TOKEN_REMEMBER_KEY, remember ? "true" : "false");
  }
}

/**
 * Clear any persisted token information permanently.
 */
export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.setItem(TOKEN_REMEMBER_KEY, "false");
}
