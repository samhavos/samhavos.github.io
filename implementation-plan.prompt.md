Implementation Plan (Draft)

1. Repository Bootstrapping
- Initialize `source` repo with minimal Vite (or plain ESBuild) setup including `index.html`, `styles.css`, `main.ts`.
- Create public `data` repo containing `boards/` directory and seed JSON board adhering to the chosen schema.
- Fork `source` into GitHub Pages repo (`username.github.io`); enable Pages from publish branch and configure HTTPS.

2. Frontend Foundations
- Build basic layout: header with repo/token controls, board selector, grid container, status footer.
- Implement repo selection prompt stored in `localStorage` (validate via GitHub API before saving).
- Set up lightweight state store to hold `repo`, `boards`, `currentBoard`, and auth token.

3. Data Fetching & Rendering
- Add helper to list board files (`GET /repos/{owner}/{repo}/contents/boards`).
- Fetch selected board JSON, normalize to ensure `items` length equals `size * size` (pad with blanks if short).
- Render grid using vanilla DOM updates or small reactive helpers; recompute bingo lines for visuals.

4. Authentication & Write Flow
- Implement GitHub App device authorization flow (start, poll, success, error states).
- Provide toggle to use manual PAT entry for development.
- When a tile is toggled:
	- Update `checkedAt` timestamp in memory.
	- Serialize with `JSON.stringify(board, null, 2)`.
	- Call GitHub Contents API with stored `sha`, commit message, and branch.
	- Update local `sha` from response; refresh UI state.
- Surface conflict modal on 409; offer reload/retry after pulling latest JSON.

5. Developer Tooling
- Add npm scripts: `dev`, `build`, `preview`, `lint`, `typecheck`.
- Configure ESLint + Prettier (optional) with TypeScript support.
- Document environment variables or config (e.g., default data repo for dev).

6. Testing
- Unit tests for board normalization, bingo detection, and JSON serialization round-trip.
- Integration test hitting throwaway repo using PAT (guarded by env var) to validate read/write flow.
- Manual QA checklist covering repo switch, token refresh, conflict handling, and offline mock mode.

7. Deployment Process
- Document steps to sync Pages fork with upstream `source` repo (fetch, merge, build, push).
- Optionally add GitHub Action in Pages fork to rebuild and deploy on push.
- Verify caching headers and Content-Type for JSON assets.

8. Documentation & Onboarding
- Update README explaining architecture, data schema, and local dev.
- Provide CONTRIBUTING guide covering auth token hygiene and release steps.
- Write player quickstart instructions (choose repo, authorize, play).

9. Post-MVP Enhancements
- Add `checkedBy` support derived from authenticated username.
- Offer board creation UI to scaffold new JSON files.
- Improve conflict resolution with visual diffs.
- Explore PWA features (offline view-only mode).
