Repo Structure Plan (Draft)

Goals
- Keep source code, deployment artifacts, and board data logically separated while remaining compatible with GitHub Pages limitations.
- Allow contributors to work in appropriately named repos without wrestling with private submodules.

Chosen Layout
1. `source` repository (private or public)
	- Contains TypeScript, HTML, CSS, and build tooling.
	- Main branch (`main`) is the canonical history for development.
2. GitHub Pages repository (fork of `source`)
	- Named per Pages requirements (`username.github.io` or `<project>.github.io`).
	- Adds `source` as upstream remote; syncs periodically.
	- Publishes built `/dist` assets on its default branch so GitHub Pages can serve them.
3. `data` repository (public)
	- Stores board JSON files under `boards/`.
	- No code; commit history reflects gameplay progress.

Why Not Submodules?
- GitHub Pages build pipeline does not fetch private submodules and does not recurse into public ones by default.
- Keeping runtime data external avoids deployment surprises and lets the site point at any user-selected repo.

Sync Workflow
1. Development happens in `source` repo.
2. When ready to release, update Pages fork:
	- `git fetch upstream && git merge upstream/main` (from within fork).
	- Run `npm run build` (or equivalent) to refresh static assets.
	- Commit the contents of `dist/` (the fork can keep source files or store only built assets).
	- Push to the fork's publish branch; Pages redeploys automatically.
3. Data repo remains independent; no deployment coupling required.

Data Repo Flexibility
- Since the data repo is public, any deployment or local dev environment can read boards without auth.
- Frontend prompts users for repo coordinates, so staging/experimental repos are easy to target.
- Write permissions are limited via fine-grained PAT scopes to prevent broad access.

Open Considerations
- Decide whether the Pages fork should keep build artifacts alongside source or maintain a build-only branch (e.g., `pages`).
- Document manual sync steps to avoid drift between `source` and fork.
- Establish naming convention for board files (`YYYY-MM-board.json`, `team-retreat.json`, etc.).
