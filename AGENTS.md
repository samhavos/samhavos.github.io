# Agent Guidelines

- Use BEM naming for all CSS selectors in this project.
- Keep the connection header controls limited to a single `Connect` button paired with a `Clear` action; avoid reintroducing redundant credential buttons.
- Hover states for buttons should rely on subtle translation only—no rotation effects.
- The fullscreen toggle should share the standard button styling, sit alongside the connection header, and become a translucent overlay when fullscreen is active.
- Dark mode gridlines must remain bright; honor the `--board-lines` variable when generating board textures.
- In the new board flow, the credentials step should remain lightweight (inputs plus continue flow) without extra connect/update/remember buttons.
