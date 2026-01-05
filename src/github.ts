/**
 * @file Wrappers around the GitHub REST API used by the frontend.
 */
import type {
  BoardSummary,
  GithubContentFile,
  GithubContentResponse,
  RepoCoords
} from "./types";

const GITHUB_API_VERSION = "2022-11-28";

export type RepoDetails = {
  default_branch: string;
};

export type PutContentResponse = {
  content: { sha: string };
  commit: { sha: string };
};

/**
 * Custom error type that preserves HTTP status codes from GitHub responses.
 */
export class GithubError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Fetch repository metadata to confirm access and read default branch details.
 */
export async function fetchRepoDetails(repo: RepoCoords, token?: string): Promise<RepoDetails> {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}`;
  return githubFetchJson<RepoDetails>(url, token);
}

/**
 * Retrieve the list of JSON files under the boards directory.
 */
export async function fetchBoardDirectory(
  repo: RepoCoords,
  branch: string | null,
  token?: string
): Promise<GithubContentFile[]> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/boards${ref}`;
  const response = await githubFetchJson<GithubContentFile[] | GithubContentFile>(url, token);
  const files = Array.isArray(response) ? response : [response];
  return files.filter((entry) => entry.type === "file" && entry.name.toLowerCase().endsWith(".json"));
}

/**
 * Download a single board JSON file from GitHub.
 */
export async function fetchBoardContent(
  repo: RepoCoords,
  path: string,
  branch: string | null,
  token?: string
): Promise<GithubContentResponse> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const encodedPath = encodePath(path);
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${encodedPath}${ref}`;
  return githubFetchJson<GithubContentResponse>(url, token);
}

/**
 * Commit an updated board document back to GitHub.
 */
export async function putBoardContent(
  repo: RepoCoords,
  summary: BoardSummary,
  payload: {
    message: string;
    content: string;
    sha: string;
    branch?: string;
  },
  token?: string
): Promise<PutContentResponse> {
  const encodedPath = encodePath(summary.path);
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${encodedPath}`;
  return githubFetchJson<PutContentResponse>(url, token, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/**
 * Create a new board document in the data repository.
 */
export async function createBoardContent(
  repo: RepoCoords,
  path: string,
  payload: {
    message: string;
    content: string;
    branch?: string;
  },
  token?: string
): Promise<PutContentResponse> {
  const encodedPath = encodePath(path);
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${encodedPath}`;

  const body: Record<string, string> = {
    message: payload.message,
    content: payload.content
  };

  if (payload.branch) {
    body.branch = payload.branch;
  }

  return githubFetchJson<PutContentResponse>(url, token, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

async function githubFetchJson<T>(url: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "omit"
  });

  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data.message) {
        errorMessage = data.message;
      }
    } catch (error) {
      console.error("Failed to parse error payload", error);
    }
    throw new GithubError(response.status, errorMessage);
  }

  return (await response.json()) as T;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
