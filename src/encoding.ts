/**
 * @file Utilities for base64 encoding and decoding JSON payloads.
 */

/**
 * Convert a UTF-8 string into a base64 encoded string.
 */
export function encodeBase64(value: string): string {
  const utf8 = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

/**
 * Decode a base64 string into its UTF-8 representation.
 */
export function decodeBase64(value: string): string {
  const cleaned = value.replace(/\n/g, "");
  const binary = window.atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
