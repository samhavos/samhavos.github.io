/**
 * @file Board data helpers including normalization and bingo detection.
 */

import type { BoardDocument, BoardItem } from "./types";

/**
 * Normalize a raw board document to guarantee a square grid with sanitized items.
 */
export function normalizeBoardDocument(doc: BoardDocument): BoardDocument & { size: number } {
  const items = Array.isArray(doc.items) ? doc.items.map((item) => normalizeItem(item)) : [];
  const providedSize = typeof doc.size === "number" && Number.isFinite(doc.size) ? Math.max(1, Math.round(doc.size)) : undefined;
  const inferredSize = providedSize ?? inferSize(items.length);
  const targetLength = inferredSize * inferredSize;

  while (items.length > targetLength) {
    items.pop();
  }

  while (items.length < targetLength) {
    items.push({ text: "" });
  }

  return {
    ...doc,
    size: inferredSize,
    items
  };
}

/**
 * Compute every fully checked bingo line across rows, columns, and diagonals.
 */
export function computeBingoLines(items: BoardItem[], size: number): number[][] {
  const completed: number[][] = [];
  const total = size * size;
  const isChecked = (index: number) => index < items.length && Boolean(items[index]?.checkedAt);

  for (let row = 0; row < size; row += 1) {
    const rowIndices: number[] = [];
    for (let col = 0; col < size; col += 1) {
      rowIndices.push(row * size + col);
    }
    if (rowIndices.every(isChecked)) {
      completed.push(rowIndices);
    }
  }

  for (let col = 0; col < size; col += 1) {
    const colIndices: number[] = [];
    for (let row = 0; row < size; row += 1) {
      colIndices.push(row * size + col);
    }
    if (colIndices.every(isChecked)) {
      completed.push(colIndices);
    }
  }

  const diag1: number[] = [];
  for (let i = 0; i < total; i += size + 1) {
    diag1.push(i);
  }
  if (diag1.every(isChecked)) {
    completed.push(diag1);
  }

  if (size > 1) {
    const diag2: number[] = [];
    for (let i = size - 1; i <= total - size; i += size - 1) {
      diag2.push(i);
    }
    if (diag2.every(isChecked)) {
      completed.push(diag2);
    }
  }

  return completed;
}

/**
 * Compose a human-readable commit message describing a tile toggle.
 */
export function buildCommitMessage(squareLabel: string, index: number, checked: boolean): string {
  const action = checked ? "Check" : "Uncheck";
  return `${action} square ${index + 1}: ${squareLabel}`;
}

function normalizeItem(item: BoardItem): BoardItem {
  const normalized: BoardItem = {
    text: typeof item.text === "string" ? item.text : ""
  };

  if (typeof item.checkedAt === "string" && item.checkedAt.trim().length > 0) {
    normalized.checkedAt = item.checkedAt;
  }

  for (const key of Object.keys(item)) {
    if (!Object.hasOwn(item, key)) {
      continue;
    }
    if (key === "text" || key === "checkedAt") {
      continue;
    }
    normalized[key] = item[key];
  }

  return normalized;
}

function inferSize(itemCount: number): number {
  if (itemCount <= 0) {
    return 5;
  }

  const root = Math.round(Math.sqrt(itemCount));
  return root > 0 ? root : 5;
}
