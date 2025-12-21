/**
 * @file Initializes and orchestrates the Office Bingos frontend UI.
 */

import { buildCommitMessage, computeBingoLines, normalizeBoardDocument } from "./board";
import { decodeBase64, encodeBase64 } from "./encoding";
import { fetchBoardContent, fetchBoardDirectory, fetchRepoDetails, GithubError, putBoardContent } from "./github";
import { parseRepoInput } from "./repo";
import { clearToken, loadStoredRepo, loadTokenState, storeRepo, storeToken } from "./storage";
import type { QueryHints } from "./routing";
import type {
  BoardDocument,
  BoardSummary,
  LoadedBoard,
  RepoCoords,
  StatusMessage
} from "./types";

const INITIAL_STATUS: StatusMessage = {
  level: "info",
  text: "Enter a GitHub repo to load boards."
};

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
    <button class="app__fullscreen-toggle" id="fullscreen-toggle" type="button" aria-pressed="false" aria-label="Toggle fullscreen">
      Fullscreen
    </button>
    <header class="app__header">
      <div class="app__control-group app__control-group--repo">
        <label class="app__control-label" for="repo-input">Data repository</label>
        <input class="app__control-input" id="repo-input" name="repo" placeholder="owner/name or https://github.com/owner/name" autocomplete="off" />
        <button class="app__button app__button--connect" id="repo-apply" type="button">Connect</button>
      </div>
      <div class="app__control-group app__control-group--token">
        <label class="app__control-label" for="token-input">GitHub token (optional)</label>
        <input class="app__control-input" id="token-input" name="token" type="password" autocomplete="off" placeholder="ghp_..." />
        <div class="app__checkbox-row">
          <input class="app__checkbox" id="token-remember" type="checkbox" />
          <label class="app__checkbox-label" for="token-remember">Remember token on this device</label>
        </div>
        <button class="app__button app__button--token" id="token-apply" type="button">Update Token</button>
      </div>
      <button class="app__button app__button--sign-out" id="sign-out" type="button">Sign out</button>
    </header>
    <main class="app__main">
      <div class="board">
        <div class="board__meta">
          <label class="board__label" for="board-select">Board</label>
          <select class="board__select" id="board-select"></select>
          <span class="board__info" id="board-info"></span>
        </div>
        <div class="board__grid-container">
          <div class="board__grid" id="board-grid" aria-busy="false"></div>
        </div>
      </div>
    </main>
    <footer class="status" id="status"></footer>
  `;

  const elements = {
    body: document.body,
    repoInput: document.getElementById("repo-input") as HTMLInputElement,
    repoApply: document.getElementById("repo-apply") as HTMLButtonElement,
    tokenInput: document.getElementById("token-input") as HTMLInputElement,
    tokenApply: document.getElementById("token-apply") as HTMLButtonElement,
    tokenRemember: document.getElementById("token-remember") as HTMLInputElement,
    signOut: document.getElementById("sign-out") as HTMLButtonElement,
    boardSelect: document.getElementById("board-select") as HTMLSelectElement,
    boardGrid: document.getElementById("board-grid") as HTMLDivElement,
    boardInfo: document.getElementById("board-info") as HTMLSpanElement,
    status: document.getElementById("status") as HTMLDivElement,
    fullscreenToggle: document.getElementById("fullscreen-toggle") as HTMLButtonElement
  };

  const state: {
    repo: RepoCoords | null;
    defaultBranch: string | null;
    token: string | null;
    boards: BoardSummary[];
    currentBoard: LoadedBoard | null;
    isCommitting: boolean;
    isFullscreen: boolean;
  } = {
    repo: null,
    defaultBranch: null,
    token: null,
    boards: [],
    currentBoard: null,
    isCommitting: false,
    isFullscreen: false
  };

  let pendingBoardHint: string | null = hints.board ?? null;
  let statusInitialized = false;
  let prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  applyQueryHints();
  hydrateFromStorage();
  attachEventHandlers();
  toggleFullscreen(false);
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
    } else {
      elements.tokenRemember.checked = tokenState.remember;
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

    elements.tokenInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        updateToken(elements.tokenInput.value.trim());
      }
    });

    elements.tokenRemember.addEventListener("change", () => {
      if (!elements.tokenRemember.checked) {
        storeToken(null, false);
        setStatus({ level: "info", text: "Token will only persist in memory." });
      } else {
        storeToken(state.token, true);
      }
    });

    elements.signOut.addEventListener("click", () => {
      state.token = null;
      elements.tokenInput.value = "";
      clearToken();
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

    elements.fullscreenToggle.addEventListener("click", () => {
      toggleFullscreen(!state.isFullscreen);
    });

    prefersDark.addEventListener("change", ({ matches }) => {
      updateDarkMode(matches);
    });
  }

  updateDarkMode(prefersDark.matches);

  async function connectToRepo(inputValue: string): Promise<void> {
    const parsed = parseRepoInput(inputValue);
    if (!parsed) {
      setStatus({ level: "error", text: "Enter a repository like owner/name." });
      return;
    }

    setStatus({ level: "info", text: "Checking repository access..." });
    elements.repoApply.disabled = true;

    try {
      const repoInfo = await fetchRepoDetails(parsed, state.token ?? undefined);
      state.repo = parsed;
      state.defaultBranch = repoInfo.default_branch;
      storeRepo(`${parsed.owner}/${parsed.name}`);
      setStatus({ level: "success", text: `Connected to ${parsed.owner}/${parsed.name} (branch ${state.defaultBranch}).` });
      await loadBoards();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read repository.";
      setStatus({ level: "error", text: message });
    } finally {
      elements.repoApply.disabled = false;
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
    const normalized = hint.startsWith("boards/") ? hint : `boards/${hint}`;
    const filename = normalized.split("/").pop();

    return (
      boards.find((board) => board.path === normalized) ??
      boards.find((board) => board.path === hint) ??
      boards.find((board) => board.name === hint) ??
      (filename ? boards.find((board) => board.name === filename) : undefined)
    );
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
      button.className = "board__square";
      button.dataset.index = index.toString();
      button.textContent = item.text || "\u00A0";

      if (item.checkedAt) {
        button.classList.add("board__square--checked");
      }

      button.addEventListener("click", () => {
        void handleSquareToggle(index);
      });

      elements.boardGrid.appendChild(button);
    });
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
      message: buildCommitMessage(squareLabel, index, checked),
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

    if (state.token) {
      setStatus({ level: "success", text: "Token updated for this session." });
    } else {
      setStatus({ level: "info", text: "Cleared token from memory." });
    }

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
    elements.fullscreenToggle.textContent = state.isFullscreen ? "Exit fullscreen" : "Fullscreen";
    elements.fullscreenToggle.setAttribute("aria-pressed", state.isFullscreen ? "true" : "false");
    elements.fullscreenToggle.setAttribute(
      "aria-label",
      state.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
    );
    updateBoardLayout();
  }

  function updateDarkMode(isDark: boolean): void {
    elements.body.classList.toggle("body--dark", isDark);
    root.classList.toggle("app--dark", isDark);
    elements.status.classList.toggle("status--dark", isDark);
    elements.fullscreenToggle.classList.toggle("app__fullscreen-toggle--dark", isDark);
  }

  function updateBoardLayout(): void {
    const grid = elements.boardGrid;
    if (!grid) {
      return;
    }

    const parent = grid.parentElement as HTMLElement | null;
    if (!parent) {
      return;
    }

    const availableSize = Math.min(parent.clientWidth, parent.clientHeight);
    grid.style.width = `${availableSize}px`;
    grid.style.height = `${availableSize}px`;
  }
}
