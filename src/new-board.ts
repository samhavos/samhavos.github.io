/**
 * @file Entry point for the create-board flow rendered by new.html.
 */

import { encodeBase64 } from "./encoding";
import { createBoardContent, fetchRepoDetails, GithubError } from "./github";
import { parseRepoInput } from "./repo";
import { loadStoredRepo, loadTokenState, storeRepo, storeToken } from "./storage";
import type { QueryHints } from "./routing";
import type { BoardDocument, RepoCoords, StatusMessage } from "./types";

type CreationStep = "credentials" | "metadata" | "squares";

type CreateBoardState = {
  step: CreationStep;
  repo: RepoCoords | null;
  defaultBranch: string | null;
  token: string | null;
  rememberToken: boolean;
  filename: string;
  size: number;
  squares: string[];
  isFetchingRepo: boolean;
  isSubmitting: boolean;
};

const INITIAL_STATUS: StatusMessage = {
  level: "info",
  text: "Enter repo details to start a new board."
};

const SIZE_OPTIONS = [3, 4, 5, 6, 7];
const DEFAULT_SIZE = 5;

type CreationElements = {
  root: HTMLDivElement;
  status: HTMLDivElement;
  stepCredentials: HTMLDivElement;
  stepMetadata: HTMLDivElement;
  stepSquares: HTMLDivElement;
  repoInput: HTMLInputElement;
  repoConnect: HTMLButtonElement;
  tokenInput: HTMLInputElement;
  tokenRemember: HTMLInputElement;
  tokenApply: HTMLButtonElement;
  credentialsContinue: HTMLButtonElement;
  metadataBack: HTMLButtonElement;
  metadataContinue: HTMLButtonElement;
  filenameInput: HTMLInputElement;
  sizeSelect: HTMLSelectElement;
  squaresBack: HTMLButtonElement;
  squaresSubmit: HTMLButtonElement;
  squaresContainer: HTMLDivElement;
};

export function initializeNewBoardApp(hints: QueryHints = {}): void {
  const app = document.getElementById("app");
  if (!app) {
    throw new Error("Missing root container");
  }

  const root = app as HTMLDivElement;
  root.className = "app create-board";
  root.innerHTML = `
    <header class="create-board__header">
      <div class="create-board__header-main">
        <h1 class="create-board__title">Create a bingo board</h1>
        <p class="create-board__subtitle">Add a new board to your data repository in three quick steps.</p>
      </div>
      <nav class="create-board__nav">
        <a class="create-board__nav-link" href="index.html">Back to boards</a>
      </nav>
    </header>
    <main class="create-board__main">
      <section class="create-board__step create-board__step--credentials" aria-labelledby="create-step-credentials">
        <h2 id="create-step-credentials" class="create-board__step-title">1. Connect credentials</h2>
        <p class="create-board__help">We’ll remember these between visits using your browser’s storage.</p>
        <form class="create-board__form" id="create-credentials-form">
          <div class="create-board__field">
            <label class="create-board__label" for="create-repo-input">Data repository</label>
            <input class="create-board__input" id="create-repo-input" name="repo" placeholder="owner/name or https://github.com/owner/name" autocomplete="off" />
            <button class="create-board__button" id="create-repo-connect" type="submit">Connect</button>
          </div>
          <div class="create-board__field create-board__field--token">
            <label class="create-board__label" for="create-token-input">GitHub token (optional)</label>
            <input class="create-board__input" id="create-token-input" name="token" type="password" autocomplete="off" placeholder="ghp_..." />
            <div class="create-board__checkbox-row">
              <input class="create-board__checkbox" id="create-token-remember" type="checkbox" />
              <label class="create-board__checkbox-label" for="create-token-remember">Remember token on this device</label>
            </div>
            <div class="create-board__token-actions">
              <button class="create-board__button" id="create-token-apply" type="button">Update token</button>
            </div>
          </div>
          <div class="create-board__actions">
            <button class="create-board__button create-board__button--next" id="create-credentials-continue" type="button">Continue</button>
          </div>
        </form>
      </section>
      <section class="create-board__step create-board__step--metadata" aria-labelledby="create-step-metadata">
        <h2 id="create-step-metadata" class="create-board__step-title">2. Name the board</h2>
        <form class="create-board__form" id="create-metadata-form">
          <div class="create-board__field">
            <label class="create-board__label" for="create-filename-input">Board filename</label>
            <input class="create-board__input" id="create-filename-input" name="filename" placeholder="example.json" autocomplete="off" />
            <p class="create-board__help">Files are saved beneath <code>boards/</code> in your repository.</p>
          </div>
          <div class="create-board__field">
            <label class="create-board__label" for="create-size-select">Board size</label>
            <select class="create-board__input" id="create-size-select" name="size"></select>
          </div>
          <div class="create-board__actions">
            <button class="create-board__button create-board__button--previous" id="create-metadata-back" type="button">Back</button>
            <button class="create-board__button create-board__button--next" id="create-metadata-continue" type="button">Continue</button>
          </div>
        </form>
      </section>
      <section class="create-board__step create-board__step--squares" aria-labelledby="create-step-squares">
        <h2 id="create-step-squares" class="create-board__step-title">3. Enter square prompts</h2>
        <p class="create-board__help">Fill every square with text. You can type or paste content in any order.</p>
        <div class="create-board__squares" id="create-squares"></div>
        <div class="create-board__actions">
          <button class="create-board__button create-board__button--previous" id="create-squares-back" type="button">Back</button>
          <button class="create-board__button create-board__button--create" id="create-squares-submit" type="button" disabled>Fill all squares to save</button>
        </div>
      </section>
    </main>
    <footer class="status" id="status"></footer>
  `;

  const elements: CreationElements = {
    root,
    status: getRequired<HTMLDivElement>(root, "#status"),
    stepCredentials: getRequired<HTMLDivElement>(root, ".create-board__step--credentials"),
    stepMetadata: getRequired<HTMLDivElement>(root, ".create-board__step--metadata"),
    stepSquares: getRequired<HTMLDivElement>(root, ".create-board__step--squares"),
    repoInput: getRequired<HTMLInputElement>(root, "#create-repo-input"),
    repoConnect: getRequired<HTMLButtonElement>(root, "#create-repo-connect"),
    tokenInput: getRequired<HTMLInputElement>(root, "#create-token-input"),
    tokenRemember: getRequired<HTMLInputElement>(root, "#create-token-remember"),
    tokenApply: getRequired<HTMLButtonElement>(root, "#create-token-apply"),
    credentialsContinue: getRequired<HTMLButtonElement>(root, "#create-credentials-continue"),
    metadataBack: getRequired<HTMLButtonElement>(root, "#create-metadata-back"),
    metadataContinue: getRequired<HTMLButtonElement>(root, "#create-metadata-continue"),
    filenameInput: getRequired<HTMLInputElement>(root, "#create-filename-input"),
    sizeSelect: getRequired<HTMLSelectElement>(root, "#create-size-select"),
    squaresBack: getRequired<HTMLButtonElement>(root, "#create-squares-back"),
    squaresSubmit: getRequired<HTMLButtonElement>(root, "#create-squares-submit"),
    squaresContainer: getRequired<HTMLDivElement>(root, "#create-squares")
  };

  populateSizeOptions(elements.sizeSelect);

  const state: CreateBoardState = {
    step: "credentials",
    repo: null,
    defaultBranch: null,
    token: null,
    rememberToken: false,
    filename: "",
    size: DEFAULT_SIZE,
    squares: Array(DEFAULT_SIZE * DEFAULT_SIZE).fill(""),
    isFetchingRepo: false,
    isSubmitting: false
  };

  hydrateFromStorage(elements, state, hints);
  bindHandlers(elements, state);
  renderStep(elements, state);
  setStatus(elements.status, INITIAL_STATUS);
}

function populateSizeOptions(select: HTMLSelectElement): void {
  select.innerHTML = "";
  for (const value of SIZE_OPTIONS) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} × ${value}`;
    if (value === DEFAULT_SIZE) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

function hydrateFromStorage(elements: CreationElements, state: CreateBoardState, hints: QueryHints): void {
  const storedRepo = loadStoredRepo();
  const tokenState = loadTokenState();

  const repoHint = hints.repo ?? storedRepo ?? "";
  if (repoHint) {
    elements.repoInput.value = repoHint;
    const parsed = parseRepoInput(repoHint);
    if (parsed) {
      state.repo = parsed;
      void fetchDefaultBranch(parsed, state, elements);
    }
  }

  const tokenHint = tokenState.token ?? hints.token ?? null;
  if (tokenHint) {
    elements.tokenInput.value = tokenHint;
    state.token = tokenHint;
  }
  const remember = tokenState.remember && Boolean(tokenState.token);
  state.rememberToken = remember;
  elements.tokenRemember.checked = remember;

  const hintedFilename = hints.board ? deriveFilenameFromHint(hints.board) : "";
  if (hintedFilename) {
    state.filename = hintedFilename;
    elements.filenameInput.value = hintedFilename;
  }

  elements.sizeSelect.value = String(state.size);
  rebuildSquareInputs(elements, state);
  updateSquaresCompletion(elements, state);
}

function bindHandlers(elements: CreationElements, state: CreateBoardState): void {
  const credentialsForm = getRequired<HTMLFormElement>(elements.root, "#create-credentials-form");
  credentialsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void connectRepository(elements, state);
  });

  elements.repoConnect.addEventListener("click", (event) => {
    event.preventDefault();
    void connectRepository(elements, state);
  });

  elements.credentialsContinue.addEventListener("click", () => {
    void handleCredentialsContinue(elements, state);
  });

  elements.tokenApply.addEventListener("click", () => {
    persistToken(elements, state);
  });

  elements.tokenRemember.addEventListener("change", () => {
    state.rememberToken = elements.tokenRemember.checked;
  });

  elements.metadataBack.addEventListener("click", () => {
    state.step = "credentials";
    renderStep(elements, state);
  });

  elements.metadataContinue.addEventListener("click", () => {
    if (!applyMetadata(elements, state)) {
      return;
    }
    state.step = "squares";
    rebuildSquareInputs(elements, state);
    updateSquaresCompletion(elements, state);
    renderStep(elements, state);
  });

  elements.squaresBack.addEventListener("click", () => {
    state.step = "metadata";
    renderStep(elements, state);
  });

  elements.sizeSelect.addEventListener("change", () => {
    const parsed = Number.parseInt(elements.sizeSelect.value, 10);
    if (Number.isFinite(parsed) && SIZE_OPTIONS.includes(parsed)) {
      state.size = parsed;
      state.squares = Array(parsed * parsed).fill("");
      rebuildSquareInputs(elements, state);
      updateSquaresCompletion(elements, state);
    }
  });

  elements.filenameInput.addEventListener("blur", () => {
    if (!elements.filenameInput.value.trim()) {
      return;
    }
    elements.filenameInput.value = ensureJsonExtension(elements.filenameInput.value);
  });

  elements.squaresSubmit.addEventListener("click", () => {
    void submitBoard(elements, state);
  });
}

async function handleCredentialsContinue(elements: CreationElements, state: CreateBoardState): Promise<void> {
  if (!state.repo) {
    await connectRepository(elements, state);
    if (!state.repo) {
      return;
    }
  }
  state.step = "metadata";
  renderStep(elements, state);
}

async function connectRepository(elements: CreationElements, state: CreateBoardState): Promise<void> {
  if (state.isFetchingRepo) {
    return;
  }

  const repoText = elements.repoInput.value.trim();
  const parsed = parseRepoInput(repoText);
  if (!parsed) {
    setStatus(elements.status, { level: "error", text: "Enter repository as owner/name or a https://github.com URL." });
    elements.repoInput.focus();
    return;
  }

  state.isFetchingRepo = true;
  setStatus(elements.status, { level: "info", text: `Connecting to ${parsed.owner}/${parsed.name}...` });
  try {
    const details = await fetchRepoDetails(parsed, state.token ?? undefined);
    state.repo = parsed;
    state.defaultBranch = details.default_branch;
    storeRepo(repoText);
    setStatus(elements.status, { level: "success", text: `Connected to ${parsed.owner}/${parsed.name}.` });
  } catch (error) {
    const message = error instanceof GithubError ? error.message : "Unable to connect to repository.";
    setStatus(elements.status, { level: "error", text: message });
  } finally {
    state.isFetchingRepo = false;
  }
}

function persistToken(elements: CreationElements, state: CreateBoardState): void {
  const rawToken = elements.tokenInput.value.trim();
  const remember = elements.tokenRemember.checked;
  storeToken(rawToken || null, remember);
  state.token = rawToken || null;
  state.rememberToken = remember;
  const message = rawToken ? "Token saved." : "Token cleared.";
  setStatus(elements.status, { level: "success", text: message });
}

function applyMetadata(elements: CreationElements, state: CreateBoardState): boolean {
  const ensured = ensureJsonExtension(elements.filenameInput.value);
  if (!ensured || !isFilenameValid(ensured)) {
    setStatus(elements.status, {
      level: "error",
      text: "Use letters, numbers, dots, dashes, and underscores, ending with .json."
    });
    elements.filenameInput.focus();
    return false;
  }

  const parsedSize = Number.parseInt(elements.sizeSelect.value, 10);
  if (!Number.isFinite(parsedSize) || !SIZE_OPTIONS.includes(parsedSize)) {
    setStatus(elements.status, { level: "error", text: "Choose a supported board size." });
    elements.sizeSelect.focus();
    return false;
  }

  state.filename = ensured;
  if (state.size !== parsedSize) {
    state.size = parsedSize;
    state.squares = Array(parsedSize * parsedSize).fill("");
  }
  return true;
}

function rebuildSquareInputs(elements: CreationElements, state: CreateBoardState): void {
  const desired = state.size * state.size;
  if (state.squares.length !== desired) {
    state.squares = Array(desired).fill("");
  }

  elements.squaresContainer.innerHTML = "";
  for (let index = 0; index < desired; index += 1) {
    const wrapper = document.createElement("div");
    wrapper.className = "create-board__square";

    const label = document.createElement("label");
    label.className = "create-board__square-label";
    label.setAttribute("for", `create-square-${index}`);
    label.textContent = `Square ${index + 1}`;

    const input = document.createElement("textarea");
    input.className = "create-board__square-input";
    input.id = `create-square-${index}`;
    input.rows = 3;
    input.placeholder = "Enter prompt...";
    input.value = state.squares[index] ?? "";

    input.addEventListener("input", () => {
      state.squares[index] = input.value;
      updateSquaresCompletion(elements, state);
    });

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    elements.squaresContainer.appendChild(wrapper);
  }
}

function updateSquaresCompletion(elements: CreationElements, state: CreateBoardState): void {
  const total = state.size * state.size;
  const filled = state.squares.filter((value) => value.trim().length > 0).length;
  const remaining = total - filled;
  const ready = remaining === 0;

  elements.squaresSubmit.disabled = !ready || state.isSubmitting;

  if (state.isSubmitting) {
    elements.squaresSubmit.textContent = "Saving...";
    elements.squaresSubmit.classList.remove("create-board__button--ready");
  } else if (ready) {
    elements.squaresSubmit.textContent = "Save board";
    elements.squaresSubmit.classList.add("create-board__button--ready");
  } else {
    elements.squaresSubmit.textContent = `Fill ${remaining} more square${remaining === 1 ? "" : "s"}`;
    elements.squaresSubmit.classList.remove("create-board__button--ready");
  }
}

async function submitBoard(elements: CreationElements, state: CreateBoardState): Promise<void> {
  if (state.isSubmitting) {
    return;
  }

  if (!state.repo) {
    setStatus(elements.status, { level: "error", text: "Connect a repository before saving." });
    state.step = "credentials";
    renderStep(elements, state);
    return;
  }

  if (!state.defaultBranch) {
    await fetchDefaultBranch(state.repo, state, elements);
    if (!state.defaultBranch) {
      return;
    }
  }

  const trimmedSquares = state.squares.map((value) => value.trim());
  if (trimmedSquares.some((value) => value.length === 0)) {
    setStatus(elements.status, { level: "error", text: "Fill every square before saving." });
    return;
  }

  const documentPayload = createBoardDocument(state.size, trimmedSquares);
  const content = encodeBase64(JSON.stringify(documentPayload, null, 2));
  const boardPath = `boards/${state.filename}`;

  state.isSubmitting = true;
  updateSquaresCompletion(elements, state);
  setStatus(elements.status, { level: "info", text: `Creating ${boardPath}...` });

  try {
    await createBoardContent(
      state.repo,
      boardPath,
      {
        message: `Create board ${state.filename} (${state.size}x${state.size})`,
        content,
        branch: state.defaultBranch ?? undefined
      },
      state.token ?? undefined
    );

    setStatus(elements.status, { level: "success", text: `Created ${boardPath}. Redirecting...` });
    const nextUrl = `index.html?board=${encodeURIComponent(state.filename)}`;
    window.location.assign(nextUrl);
  } catch (error) {
    const message = error instanceof GithubError ? error.message : "Failed to create board.";
    setStatus(elements.status, { level: "error", text: message });
  } finally {
    state.isSubmitting = false;
    updateSquaresCompletion(elements, state);
  }
}

function renderStep(elements: CreationElements, state: CreateBoardState): void {
  elements.stepCredentials.hidden = state.step !== "credentials";
  elements.stepMetadata.hidden = state.step !== "metadata";
  elements.stepSquares.hidden = state.step !== "squares";

  if (state.step === "credentials") {
    elements.repoInput.focus();
  } else if (state.step === "metadata") {
    elements.filenameInput.focus();
  } else if (state.step === "squares") {
    const first = elements.squaresContainer.querySelector<HTMLTextAreaElement>("textarea");
    first?.focus();
  }
}

async function fetchDefaultBranch(repo: RepoCoords, state: CreateBoardState, elements: CreationElements): Promise<void> {
  try {
    const details = await fetchRepoDetails(repo, state.token ?? undefined);
    state.defaultBranch = details.default_branch;
  } catch (error) {
    const message = error instanceof GithubError ? error.message : "Failed to read repository details.";
    setStatus(elements.status, { level: "error", text: message });
  }
}

function createBoardDocument(size: number, squares: string[]): BoardDocument & { size: number } {
  const now = new Date().toISOString();
  return {
    items: squares.map((text) => ({ text })),
    size,
    createdAt: now,
    updatedAt: now
  };
}

function deriveFilenameFromHint(hint: string): string {
  const trimmed = hint.trim();
  if (!trimmed) {
    return "";
  }
  const last = trimmed.split("/").pop() ?? trimmed;
  return ensureJsonExtension(stripJsonExtension(last));
}

function ensureJsonExtension(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

function stripJsonExtension(value: string): string {
  if (value.toLowerCase().endsWith(".json")) {
    return value.slice(0, -5);
  }
  return value;
}

function isFilenameValid(value: string): boolean {
  return /^[A-Za-z0-9._\-]+\.json$/.test(value);
}

function getRequired<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing element ${selector}`);
  }
  return node;
}

function setStatus(target: HTMLDivElement, status: StatusMessage): void {
  target.classList.remove("status--error", "status--success");
  if (status.level === "error") {
    target.classList.add("status--error");
  } else if (status.level === "success") {
    target.classList.add("status--success");
  }
  target.textContent = status.text;
}
