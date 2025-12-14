type StatusLevel = "info" | "success" | "error";

type RepoCoords = {
  owner: string;
  name: string;
};

type BoardItem = {
  text: string;
  checkedAt?: string;
  [key: string]: unknown;
};

type BoardDocument = {
  board?: string;
  createdAt?: string;
  updatedAt?: string;
  size?: number;
  items: BoardItem[];
  [key: string]: unknown;
};

type BoardSummary = {
  name: string;
  path: string;
  sha: string;
};

type LoadedBoard = {
  summary: BoardSummary;
  doc: BoardDocument & { size: number };
  sha: string;
};

type StatusMessage = {
  level: StatusLevel;
  text: string;
};

type GithubContentFile = {
  name: string;
  path: string;
  sha: string;
  download_url?: string;
  type: "file" | string;
};

type GithubContentResponse = {
  content: string;
  encoding: string;
  sha: string;
};

class GithubError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const REPO_STORAGE_KEY = "bingos.repo";
const TOKEN_STORAGE_KEY = "bingos.token";
const TOKEN_REMEMBER_KEY = "bingos.token.remember";
const GITHUB_API_VERSION = "2022-11-28";

const app = document.getElementById("app");
if (!app) {
  throw new Error("Missing root container");
}

app.innerHTML = `
  <header>
    <div class="field-group repo-group">
      <label for="repo-input">Data repository</label>
      <input id="repo-input" name="repo" placeholder="owner/name or https://github.com/owner/name" autocomplete="off" />
      <button id="repo-apply" type="button">Connect</button>
    </div>
    <div class="field-group token-group">
      <label for="token-input">GitHub token (optional)</label>
      <input id="token-input" name="token" type="password" autocomplete="off" placeholder="ghp_..." />
      <div class="checkbox-row">
        <input id="token-remember" type="checkbox" />
        <label for="token-remember">Remember token on this device</label>
      </div>
      <button id="token-apply" type="button">Update Token</button>
    </div>
    <button id="sign-out" type="button">Sign out</button>
  </header>
  <main>
    <div class="board-meta">
      <label for="board-select">Board</label>
      <select id="board-select"></select>
      <span id="board-info"></span>
    </div>
    <div class="board-grid" id="board-grid" aria-busy="false"></div>
  </main>
  <footer class="status" id="status"></footer>
`;

const elements = {
  repoInput: document.getElementById("repo-input") as HTMLInputElement,
  repoApply: document.getElementById("repo-apply") as HTMLButtonElement,
  tokenInput: document.getElementById("token-input") as HTMLInputElement,
  tokenApply: document.getElementById("token-apply") as HTMLButtonElement,
  tokenRemember: document.getElementById("token-remember") as HTMLInputElement,
  signOut: document.getElementById("sign-out") as HTMLButtonElement,
  boardSelect: document.getElementById("board-select") as HTMLSelectElement,
  boardGrid: document.getElementById("board-grid") as HTMLDivElement,
  boardInfo: document.getElementById("board-info") as HTMLSpanElement,
  status: document.getElementById("status") as HTMLDivElement
};

const state: {
  repo: RepoCoords | null;
  defaultBranch: string | null;
  token: string | null;
  boards: BoardSummary[];
  currentBoard: LoadedBoard | null;
  isCommitting: boolean;
} = {
  repo: null,
  defaultBranch: null,
  token: null,
  boards: [],
  currentBoard: null,
  isCommitting: false
};

initializeFromStorage();
attachEventHandlers();
refreshBoardOptions();
setStatus({ level: "info", text: "Enter a GitHub repo to load boards." });

if (state.repo) {
  const storedValue = elements.repoInput.value.trim();
  if (storedValue) {
    void connectToRepo(storedValue);
  }
}

function initializeFromStorage(): void {
  const storedRepo = window.localStorage.getItem(REPO_STORAGE_KEY);
  if (storedRepo) {
    elements.repoInput.value = storedRepo;
    const parsed = parseRepoInput(storedRepo);
    if (parsed) {
      state.repo = parsed;
    }
  }

  const rememberFlag = window.localStorage.getItem(TOKEN_REMEMBER_KEY) === "true";
  elements.tokenRemember.checked = rememberFlag;
  if (rememberFlag) {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedToken) {
      state.token = storedToken;
      elements.tokenInput.value = storedToken;
    }
  }
}

function attachEventHandlers(): void {
  elements.repoApply.addEventListener("click", () => {
    const value = elements.repoInput.value.trim();
    void connectToRepo(value);
  });

  elements.repoInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const value = elements.repoInput.value.trim();
      void connectToRepo(value);
    }
  });

  elements.tokenApply.addEventListener("click", () => {
    updateToken(elements.tokenInput.value.trim());
  });

  elements.tokenRemember.addEventListener("change", () => {
    if (!elements.tokenRemember.checked) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.setItem(TOKEN_REMEMBER_KEY, "false");
      setStatus({ level: "info", text: "Token will only persist in memory." });
    } else {
      window.localStorage.setItem(TOKEN_REMEMBER_KEY, "true");
      if (state.token) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, state.token);
      }
    }
  });

  elements.tokenInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      updateToken(elements.tokenInput.value.trim());
    }
  });

  elements.signOut.addEventListener("click", () => {
    state.token = null;
    elements.tokenInput.value = "";
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.setItem(TOKEN_REMEMBER_KEY, "false");
    elements.tokenRemember.checked = false;
    setStatus({ level: "success", text: "Signed out locally." });
  });

  elements.boardSelect.addEventListener("change", () => {
    const selectedPath = elements.boardSelect.value;
    const summary = state.boards.find((entry) => entry.path === selectedPath);
    if (summary) {
      void loadBoard(summary);
    }
  });
}

async function connectToRepo(inputValue: string): Promise<void> {
  const parsed = parseRepoInput(inputValue);
  if (!parsed) {
    setStatus({ level: "error", text: "Enter a repository like owner/name." });
    return;
  }

  setStatus({ level: "info", text: "Checking repository access..." });
  elements.repoApply.disabled = true;

  try {
    const repoInfo = await githubFetchJson<{ default_branch: string }>(`https://api.github.com/repos/${parsed.owner}/${parsed.name}`);
    state.repo = parsed;
    state.defaultBranch = repoInfo.default_branch;
    window.localStorage.setItem(REPO_STORAGE_KEY, `${parsed.owner}/${parsed.name}`);
    setStatus({ level: "success", text: `Connected to ${parsed.owner}/${parsed.name} (branch ${state.defaultBranch}).` });
    await loadBoards();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read repository.";
    setStatus({ level: "error", text: message });
  } finally {
    elements.repoApply.disabled = false;
  }
}

function parseRepoInput(input: string): RepoCoords | null {
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

async function loadBoards(): Promise<void> {
  if (!state.repo) {
    return;
  }

  setStatus({ level: "info", text: "Loading boards directory..." });

  try {
    const ref = state.defaultBranch ? `?ref=${encodeURIComponent(state.defaultBranch)}` : "";
    const url = `https://api.github.com/repos/${state.repo.owner}/${state.repo.name}/contents/boards${ref}`;
    const contents = await githubFetchJson<GithubContentFile[] | GithubContentFile>(url);

    const files = Array.isArray(contents) ? contents : [contents];
    const boardFiles = files.filter((entry) => entry.type === "file" && entry.name.toLowerCase().endsWith(".json"));

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

    setStatus({ level: "success", text: `Loaded ${state.boards.length} board file(s).` });

    const selectedPath = elements.boardSelect.value;
    const firstBoard = state.boards.find((entry) => entry.path === selectedPath) ?? state.boards[0];
    if (firstBoard) {
      elements.boardSelect.value = firstBoard.path;
      await loadBoard(firstBoard);
    }
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

async function loadBoard(summary: BoardSummary): Promise<void> {
  if (!state.repo) {
    return;
  }

  setStatus({ level: "info", text: `Fetching ${summary.name}...` });

  try {
    const ref = state.defaultBranch ? `?ref=${encodeURIComponent(state.defaultBranch)}` : "";
    const encodedPath = encodePath(summary.path);
    const url = `https://api.github.com/repos/${state.repo.owner}/${state.repo.name}/contents/${encodedPath}${ref}`;
    const response = await githubFetchJson<GithubContentResponse & { content: string; sha: string }>(url);

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

function normalizeBoardDocument(doc: BoardDocument): BoardDocument & { size: number } {
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
    option.textContent = board.name;
    elements.boardSelect.appendChild(option);
  }
}

function renderBoard(board: LoadedBoard | null): void {
  elements.boardGrid.innerHTML = "";
  elements.boardInfo.textContent = "";

  if (!board) {
    return;
  }

  const { doc } = board;
  elements.boardGrid.style.gridTemplateColumns = `repeat(${doc.size}, 1fr)`;

  const bingos = computeBingoLines(doc.items, doc.size);
  const infoParts: string[] = [];

  if (doc.board) {
    infoParts.push(doc.board);
  } else {
    infoParts.push(board.summary.name);
  }

  infoParts.push(`${doc.size}x${doc.size}`);
  infoParts.push(`${bingos.length} bingo${bingos.length === 1 ? "" : "s"}`);

  if (doc.updatedAt) {
    infoParts.push(`Updated ${new Date(doc.updatedAt).toLocaleString()}`);
  }

  elements.boardInfo.textContent = infoParts.join(" | ");

  doc.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "board-square";
    button.dataset.index = index.toString();
    button.textContent = item.text || "\u00A0";

    if (item.checkedAt) {
      button.classList.add("checked");
    }

    button.addEventListener("click", () => {
      void handleSquareToggle(index);
    });

    elements.boardGrid.appendChild(button);
  });
}

function computeBingoLines(items: BoardItem[], size: number): number[][] {
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

  const commitMessage = buildCommitMessage(squareLabel, index, checked);
  const payload = {
    message: commitMessage,
    content: encodeBase64(JSON.stringify(updatedDoc, null, 2)),
    sha: previousSha,
    branch: state.defaultBranch ?? undefined
  };

  try {
    const encodedPath = encodePath(summary.path);
    const url = `https://api.github.com/repos/${state.repo.owner}/${state.repo.name}/contents/${encodedPath}`;
    const response = await githubFetchJson<{ content: { sha: string }; commit: { sha: string } }>(url, {
      method: "PUT",
      body: JSON.stringify(payload)
    });

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

function buildCommitMessage(squareLabel: string, index: number, checked: boolean): string {
  const action = checked ? "Check" : "Uncheck";
  return `${action} square ${index + 1}: ${squareLabel}`;
}

function updateToken(rawToken: string): void {
  state.token = rawToken ? rawToken : null;

  if (elements.tokenRemember.checked && state.token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, state.token);
    window.localStorage.setItem(TOKEN_REMEMBER_KEY, "true");
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    if (!elements.tokenRemember.checked) {
      window.localStorage.setItem(TOKEN_REMEMBER_KEY, "false");
    }
  }

  if (state.token) {
    setStatus({ level: "success", text: "Token updated for this session." });
  } else {
    setStatus({ level: "info", text: "Cleared token from memory." });
  }

  if (state.repo) {
    void loadBoards();
  }
}

async function githubFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);

  if (state.token) {
    headers.set("Authorization", `Bearer ${state.token}`);
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

function encodeBase64(value: string): string {
  const utf8 = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function decodeBase64(value: string): string {
  const cleaned = value.replace(/\n/g, "");
  const binary = window.atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function setStatus(message: StatusMessage): void {
  elements.status.textContent = message.text;
  elements.status.className = "status";
  if (message.level === "error") {
    elements.status.classList.add("error");
  } else if (message.level === "success") {
    elements.status.classList.add("success");
  }
}
