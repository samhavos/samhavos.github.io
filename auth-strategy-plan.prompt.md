Authentication & Authorization Plan (Draft)

Objectives
- Enable the browser-based frontend to read and write JSON board files in whichever data repo the user selects.
- Avoid embedding long-lived secrets in the static site while keeping the onboarding flow manageable for non-engineers.

Supported Auth Paths
- GitHub App (Device Authorization)
	- Register a GitHub App installed on the data repo with `contents: write` permission only.
	- Frontend launches the device flow using the public `client_id`; users authorize via github.com and receive a short-lived token.
	- Tokens are scoped to the single repo; refresh by repeating the device flow when they expire.
	- Pros: Least privilege, revocable per user, no shared credentials.
	- Cons: Requires app registration and polling logic in the browser.
- Per-User Fine-Grained PAT
	- Each teammate creates a PAT scoped to `contents: write` for the chosen repo.
	- Frontend prompts for the token, stores in memory (optional opt-in persistence), and uses it for REST requests.
	- Pros: Immediate to implement, no app setup.
	- Cons: Manual token management, risk if someone stores the token insecurely.
- Dedicated Machine User PAT (fallback only)
	- Create a machine user with access to the public data repo.
	- Share its PAT with trusted facilitators when absolutely necessary.
	- Use sparingly; shared credentials complicate auditing and revocation.

Token Handling
- Default to in-memory storage; wipe on tab close or explicit sign-out.
- Provide optional `localStorage` persistence with clear warning and auto-expiration timestamp.
- Debounce write operations to stay clear of GitHub abuse detection and rate limits.

Repo Selection Impact
- Users choose the data repo on first load; store `owner/name` in `localStorage`.
- Validate repo existence before attempting auth to provide early feedback.
- Ensure tokens are scoped to the selected repo; warn if token does not cover writes.

Security Notes
- Never log tokens or include them in commit messages.
- Encourage using secondary GitHub accounts or PATs dedicated to this project if organizational policy requires.
- Surfacing the authenticated username via `/user` API helps users confirm which identity is active before committing.
