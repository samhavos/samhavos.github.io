Data Format & Frontend Plan (Draft)

File Format Goals
- Keep board files human-readable and diff-friendly while requiring no extra parsing libraries.
- Support variable board sizes via a single ordered list of squares.
- Store only essential metadata to reduce merge conflicts.

JSON Structure
- Example `boards/holiday-2025.json`:
	```json
	{
		"board": "Holiday 2025",
		"createdAt": "2025-12-01T09:00:00Z",
		"updatedAt": "2025-12-11T15:45:12Z",
		"size": 5,
		"items": [
			{ "text": "Someone says 'synergy'" },
			{ "text": "Deploy breaks prod", "checkedAt": "2025-12-10T14:23:11Z" },
			{ "text": "Pager goes off" }
		]
	}
	```
- `size` is optional; when absent, infer it by rounding the square root of `items.length` (fallback to 5).
- Omit `checkedAt` for unchecked squares; when present, set to an ISO timestamp indicating completion.
- Additional metadata (`notes`, `updatedBy`) can be added later if needed without breaking the consumer.

Frontend Responsibilities
- Prompt user for data repo (`owner/name` or URL) on first load; store in `localStorage` and allow changes via settings panel.
- List available boards by calling `GET /repos/{repo}/contents/boards` and filtering for `.json` files.
- Fetch selected board, parse with `JSON.parse`, and normalize the data (ensure `items` length matches `size^2`, pad with empty strings if necessary).
- Render grid as `<table>` with buttons that toggle `checkedAt` values.
- Recalculate bingo lines on every render using the normalized matrix representation.

Write Flow
- When toggling a square:
	1. Update the corresponding `items[index].checkedAt` to `new Date().toISOString()` or delete the key.
	2. Serialize updated board using `JSON.stringify(board, null, 2)` for stable formatting.
	3. Use GitHub Contents API to PUT the new file with the latest `sha` and a descriptive commit message.
	4. Refresh in-memory data from the response to capture new `sha` and `updatedAt` if tracked.
- Handle 409 by refetching the file, merging changes (last-write wins or manual resolution prompt), and retrying.

UI & UX Notes
- Keep styling minimal: CSS grid or table layout with accessible color contrast and focus states.
- Use strikethrough or colored backgrounds to indicate checked squares; compute full-line bingos client-side.
- Provide status bar showing last update time and current auth user.
- Offer reset link to clear stored repo/token information.

Local Development
- Serve via `npm run dev` (Vite) or simple static server; GitHub APIs accept requests from `http://localhost` thanks to permissive CORS headers.
- Provide mock data JSON files for offline prototyping; fall back to these when token is absent.
