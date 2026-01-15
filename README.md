# Office Bingos

## Overview

Office Bingos is a Vite-powered TypeScript SPA that lets teams host bingo boards in a GitHub repository. The viewer at `index.html` pulls board definitions from the repo’s `boards/` directory, renders them with deterministic “whiteboard” styling, and lets collaborators toggle squares while recording commits back to GitHub. A companion creator flow at `new.html` walks through credential setup, metadata entry, and square authoring to publish brand-new boards.

## Key Features

- GitHub-backed storage: load, create, and update board JSON files through the GitHub REST API using fine-grained tokens.
- Deterministic styling: SVG textures, custom fonts, and dark-mode aware rendering provide a consistent hand-drawn aesthetic.
- Connection management: Collapsible “Connection details” panel groups repo, token, and status info with a single `Connect` action and quick `Clear` reset.
- Guided creation: Three-step wizard captures repo credentials, board metadata, and square prompts before writing the file to `boards/`.
- Local persistence: Browser storage remembers the last repo and (optionally) a token between sessions.

## Getting Started

1. Install dependencies: `npm install`
2. Start the dev server: `npm run dev`
3. Open the viewer at `http://localhost:5173/index.html` to browse existing boards.
4. Visit `http://localhost:5173/new.html` to create a board. Supply the repo in `owner/name` form and a GitHub token that can read/write the target repository.

### Tips

- Boards are stored in `boards/<name>.json`; filenames should end in `.json` and live under that directory.
- The fullscreen toggle mirrors other buttons and floats translucent while active.
- Dark mode expects white gridlines; ensure custom styles respect the `--board-lines` CSS variable.

## AI Disclaimer

This codebase was built almost entirely with the help of GitHub Copilot (GPT-5-Codex), and much of it was "vibe coded" to chase a particular look and feel rather than written with long-term maintainability in mind. Expect unconventional structure, ad-hoc styling, and absolutely no automated tests. Please treat this repository as an experiment rather than production-ready software.
