# Flutter Wings — a Flappy Bird clone

A self-contained vanilla HTML/CSS/JS Flappy Bird clone. No build step, no dependencies, no external image or sound files — the bird, pipes, sky, and every sound effect are generated in code (Canvas 2D + Web Audio API).

## Run it locally

You just need a static file server (opening `index.html` directly with `file://` also works in most browsers, but a local server avoids any browser security warnings):

**Option A — Python (built into most systems):**
```bash
cd flappy
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

**Option B — Node:**
```bash
cd flappy
npx serve .
```

**Option C — just double-click `index.html`.**

## Controls
- **Space bar**, **mouse click**, or **tap** — flap
- **P** or the pause button — pause/resume
- Speaker icon — mute/unmute sound effects

## Files
- `index.html` — page structure, screens (start/pause/game over), HUD
- `style.css` — responsive layout and cartoon-styled UI chrome
- `script.js` — all game logic: physics, pipes, collisions, particles, day/night cycle, difficulty scaling, audio synthesis, and localStorage high-score persistence
- `assets/` — intentionally empty; graphics are drawn on canvas and sounds are synthesized, so no binary assets are needed. Drop your own sprite/audio files here if you want to swap in custom art later.

## Notes on the implementation
- Physics use delta-time scaling, so gameplay feels consistent whether the display runs at 60Hz, 90Hz, or 120Hz.
- Difficulty ramps smoothly: pipe gap narrows and pipe speed/spawn-rate increase as your score rises, each capped at a sane minimum/maximum so it never becomes unfair-impossible.

- Day/night is on its own independent cycle (not tied to score) with interpolated sky colors, a moving sun/moon, fading stars, and parallax clouds/hills.
- High score is saved via `localStorage` with a try/catch fallback, so the game still runs fine in private-browsing modes where storage is blocked.
