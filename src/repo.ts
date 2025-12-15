/**
 * @file Utilities for parsing and validating GitHub repository coordinates.
 */

import type { RepoCoords } from "./types";

/**
 * Parse user-entered repository text into owner/name coordinates.
 */
export function parseRepoInput(input: string): RepoCoords | null {
  if (!input) {
    return null;
  }

  const trimmed = input.replace(/\s+/g, "");
  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\.git)?/i);
  if (urlMatch) {
    return { owner: urlMatch[1], name: urlMatch[2] };
  }

  const parts = trimmed.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], name: parts[1] };
  }

  return null;
}
