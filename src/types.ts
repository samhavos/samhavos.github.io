/**
 * @file Shared type definitions for the Office Bingos frontend.
 */

export type StatusLevel = "info" | "success" | "error";

export type RepoCoords = {
  owner: string;
  name: string;
};

export type BoardItem = {
  text: string;
  checkedAt?: string;
  [key: string]: unknown;
};

export type BoardDocument = {
  board?: string;
  createdAt?: string;
  updatedAt?: string;
  size?: number;
  items: BoardItem[];
  [key: string]: unknown;
};

export type BoardSummary = {
  name: string;
  path: string;
  sha: string;
};

export type LoadedBoard = {
  summary: BoardSummary;
  doc: BoardDocument & { size: number };
  sha: string;
};

export type StatusMessage = {
  level: StatusLevel;
  text: string;
};

export type GithubContentFile = {
  name: string;
  path: string;
  sha: string;
  download_url?: string;
  type: "file" | string;
};

export type GithubContentResponse = {
  content: string;
  encoding: string;
  sha: string;
};
