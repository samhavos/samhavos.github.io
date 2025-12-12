Overview Plan

Project Vision
- Deliver a browser-only remake of the office "Bingos" whiteboard that persists board state in Git and remains easy to audit.
- Keep the experience lightweight so anyone can open the page, point it at a repo, and start playing without installs.

Guiding Constraints
- Deploy on GitHub Pages; no custom backend, functions, or secret storage.
- Persist every board as plain text files in a Git repository to preserve history and enable manual edits.
- Perform all reads/writes via browser calls to GitHub APIs (CORS-compliant) using user-provided credentials.

Repository Strategy
- Canonical `source` repository (e.g., `office-bingos`) contains the TypeScript/HTML source code.
- GitHub Pages repository is a fork of `source`; treat `source` as upstream and push built assets to the fork's publish branch.
- Public `data` repository stores board JSON files (`boards/*.json`); frontend loads from it directly via GitHub REST/Raw endpoints.
- Avoid submodules; runtime fetches data from the configured repo based on user selection.

Data Model Summary
- Board files are JSON documents with fields like:
	```json
	{
		"board": "Holiday 2025",
		"createdAt": "2025-12-01T09:00:00Z",
		"updatedAt": "2025-12-11T15:45:12Z",
		"size": 5,
		"items": [
			{ "text": "Someone says 'synergy'" },
			{ "text": "Deploy breaks prod", "checkedAt": "2025-12-10T14:23:11Z" }
		]
	}
	```
- `items` is a flat ordered list; the UI lays it out left-to-right, top-to-bottom according to `size` (or inferred square).
	- `checkedAt` is optional; omit it for unchecked squares. No additional history/milestones stored.

Authentication & Permissions
- Primary approach: GitHub App with Device Authorization flow scoped to `contents: write` on the chosen data repo.
- Fallback: user-entered fine-grained PAT limited to repository contents.
- Tokens remain in memory by default; optional opt-in persistence with clear warnings.
- Display authenticated GitHub username and provide sign-out to revoke local state.

Runtime Frontend Flow
1. On first visit, prompt for target data repo (`owner/name` or full URL); persist selection in `localStorage`.
2. Fetch list of board JSON files from the repo via GitHub REST `contents` endpoint.
3. Load a board, parse JSON (no extra libraries needed), render grid, and compute bingo status client-side.
4. When a square is toggled, update `checkedAt` and commit the new JSON via `PUT /repos/{owner}/{repo}/contents/...`.
5. Handle content `sha` mismatches by prompting reload and optionally showing diff summary.

Local Development Story
- Serve the static frontend from `http://localhost` using Vite or a lightweight dev server.
- Point data repo picker at a personal test repo; GitHub CORS headers allow direct API access from localhost.
- Include sample board JSON files and scripts to reset demo data.

Deployment Workflow
- Develop and review in `source`.
- After merge to `main`, sync GitHub Pages fork from upstream, run production build, commit artifacts, and push to publish branch.
- GitHub Pages redeploys automatically; no CI secrets necessary.

Outstanding Questions
- Determine UX for conflict resolution and whether to provide diff previews.
- Decide if commits alone are enough for authorship or if per-item `checkedBy` is required later.
- Confirm default board size and whether to support non-square grids.
- Explore subtle UI polish without introducing large frameworks.
