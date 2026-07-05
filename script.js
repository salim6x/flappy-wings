/* =====================================================================
   FLUTTER WINGS — a vanilla-JS Flappy Bird clone
   ---------------------------------------------------------------------
   Everything (bird, pipes, clouds, hills, sun/moon) is drawn procedurally
   on <canvas>, and every sound effect is synthesized live with the
   Web Audio API — so the game needs zero external image or audio files.

   Sections in this file:
     1. Setup & constants
     2. Persistence (high score / mute) helpers
     3. Audio engine (synth sound effects)
     4. Entities: Bird, Pipes, Particles, Background
     5. Game state machine + input handling
     6. Update / draw / main loop
   ===================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------
     1. SETUP & CONSTANTS
  ------------------------------------------------------------------ */

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // UI elements
  const scoreDisplay   = document.getElementById('score-display');
  const startScreen    = document.getElementById('start-screen');
  const pauseScreen    = document.getElementById('pause-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const startHighScoreEl = document.getElementById('start-high-score');
  const finalScoreEl     = document.getElementById('final-score');
  const finalHighScoreEl = document.getElementById('final-high-score');
  const newBestBadge     = document.getElementById('new-best-badge');
  const startBtn   = document.getElementById('start-btn');
  const resumeBtn  = document.getElementById('resume-btn');
  const restartBtn = document.getElementById('restart-btn');
  const pauseBtn   = document.getElementById('pause-btn');
  const muteBtn    = document.getElementById('mute-btn');
  const birdPreviewEl = document.getElementById('bird-preview');

  // Logical (CSS) size of the canvas — recalculated on resize.
  let W = 0, H = 0;
  let DPR = Math.min(window.devicePixelRatio || 1, 2.5);

  function resizeCanvas() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // Ground height scales with viewport, capped for large screens.
    GROUND_H = Math.min(120, Math.max(70, H * 0.14));
  }

  // Tunable gameplay constants (tuned for a 60fps baseline; all motion
  // is scaled by delta-time so play feels the same at any frame rate).
  const GRAVITY        = 1600;   // px/s^2
  const FLAP_VELOCITY   = -460;  // px/s, instantaneous upward velocity on flap
  const MAX_FALL_SPEED  = 900;   // terminal velocity
  const BIRD_X_RATIO    = 0.30;  // bird's horizontal position as fraction of width
  const BIRD_RADIUS     = 18;

  const PIPE_WIDTH        = 78;
  const PIPE_GAP_START     = 210;
  const PIPE_GAP_MIN       = 132;
  const PIPE_SPEED_START   = 190;  // px/s
  const PIPE_SPEED_MAX     = 340;
  const PIPE_INTERVAL_START = 1.55; // seconds between spawns
  const PIPE_INTERVAL_MIN   = 1.05;

  let GROUND_H = 90;

  const DAY_CYCLE_SECONDS = 50; // full day->night->day loop length

  /* ------------------------------------------------------------------
     2. PERSISTENCE
  ------------------------------------------------------------------ */

  const STORAGE_KEYS = { highScore: 'flutterWings_highScore', muted: 'flutterWings_muted' };

  function loadHighScore() {
    try {
      const v = localStorage.getItem(STORAGE_KEYS.highScore);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (e) {
      return 0; // localStorage unavailable (private mode, etc.) — fall back silently
    }
  }

  function saveHighScore(v) {
    try { localStorage.setItem(STORAGE_KEYS.highScore, String(v)); }
    catch (e) { /* ignore — non-critical */ }
  }

  function loadMuted() {
    try { return localStorage.getItem(STORAGE_KEYS.muted) === '1'; }
    catch (e) { return false; }
  }

  function saveMuted(v) {
    try { localStorage.setItem(STORAGE_KEYS.muted, v ? '1' : '0'); }
    catch (e) { /* ignore */ }
  }

  let highScore = loadHighScore();
  let muted = loadMuted();

  /* ------------------------------------------------------------------
     3. AUDIO ENGINE — tiny synth, no files needed
  ------------------------------------------------------------------ */

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  // Generic short blip/sweep synth used for all effects.
  function playTone({ freqStart, freqEnd, duration, type = 'sine', gain = 0.18, delay = 0 }) {
    if (muted || !audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
    }
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  const sfx = {
    flap()  { playTone({ freqStart: 420, freqEnd: 680, duration: 0.11, type: 'sine', gain: 0.15 }); },
    score() {
      playTone({ freqStart: 660, freqEnd: 990, duration: 0.14, type: 'triangle', gain: 0.18 });
      playTone({ freqStart: 990, freqEnd: 1320, duration: 0.14, type: 'triangle', gain: 0.12, delay: 0.06 });
    },
    hit() {
      playTone({ freqStart: 160, freqEnd: 40, duration: 0.35, type: 'sawtooth', gain: 0.22 });
    },
    swoosh() { playTone({ freqStart: 300, freqEnd: 120, duration: 0.2, type: 'sine', gain: 0.08 }); },
  };

  function setMuted(v) {
    muted = v;
    saveMuted(v);
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  /* ------------------------------------------------------------------
     4. ENTITIES
  ------------------------------------------------------------------ */

  // ---- Bird -----------------------------------------------------------
  const bird = {
    x: 0, y: 0, vy: 0, rotation: 0, wingPhase: 0,
    reset() {
      this.x = W * BIRD_X_RATIO;
      this.y = H * 0.4;
      this.vy = 0;
      this.rotation = 0;
      this.wingPhase = 0;
    },
    flap() {
      this.vy = FLAP_VELOCITY;
      sfx.flap();
      spawnFlapParticles(this.x - BIRD_RADIUS * 0.4, this.y + BIRD_RADIUS * 0.5);
    },
    update(dt) {
      this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL_SPEED);
      this.y += this.vy * dt;
      // Rotation follows vertical velocity: nose up on flap, dive on fall.
      const targetRot = Math.max(-0.5, Math.min(1.3, this.vy / 500));
      this.rotation += (targetRot - this.rotation) * Math.min(1, dt * 10);
      this.wingPhase += dt * (this.vy < 0 ? 16 : 8);
    },
    draw(g) {
      g.save();
      g.translate(this.x, this.y);
      g.rotate(this.rotation);

      // Wing (drawn behind body), flaps via sine motion
      const wingLift = Math.sin(this.wingPhase) * 6;
      g.fillStyle = '#E9A93B';
      g.beginPath();
      g.ellipse(-4, 4 + wingLift * 0.4, 11, 7, -0.3, 0, Math.PI * 2);
      g.fill();

      // Body
      const grad = g.createRadialGradient(-5, -6, 2, 0, 0, BIRD_RADIUS + 4);
      grad.addColorStop(0, '#FFE58A');
      grad.addColorStop(1, '#FFC93F');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, BIRD_RADIUS, BIRD_RADIUS * 0.86, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#2B2140';
      g.lineWidth = 2;
      g.stroke();

      // Belly highlight
      g.fillStyle = '#FFF3D2';
      g.beginPath();
      g.ellipse(2, 6, BIRD_RADIUS * 0.62, BIRD_RADIUS * 0.44, 0, 0, Math.PI * 2);
      g.fill();

      // Eye
      g.fillStyle = '#2B2140';
      g.beginPath();
      g.arc(8, -6, 3.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(9, -7, 1.1, 0, Math.PI * 2);
      g.fill();

      // Beak
      g.fillStyle = '#FF6B5B';
      g.beginPath();
      g.moveTo(BIRD_RADIUS - 4, -2);
      g.lineTo(BIRD_RADIUS + 9, 1);
      g.lineTo(BIRD_RADIUS - 4, 5);
      g.closePath();
      g.fill();
      g.strokeStyle = '#2B2140';
      g.lineWidth = 1.5;
      g.stroke();

      g.restore();
    },
    // Approximate hit box as a slightly-shrunk circle for forgiving collisions.
    hitRadius() { return BIRD_RADIUS * 0.78; }
  };

  // ---- Pipes ------------------------------------------------------------
  let pipes = [];
  let pipeSpawnTimer = 0;

  function currentPipeGap(score) {
    return Math.max(PIPE_GAP_MIN, PIPE_GAP_START - score * 2.2);
  }
  function currentPipeSpeed(score) {
    return Math.min(PIPE_SPEED_MAX, PIPE_SPEED_START + score * 3.5);
  }
  function currentPipeInterval(score) {
    return Math.max(PIPE_INTERVAL_MIN, PIPE_INTERVAL_START - score * 0.012);
  }

  function spawnPipe() {
    const margin = 60;
    const gap = currentPipeGap(score);
    const usable = H - GROUND_H - margin * 2 - gap;
    const gapTop = margin + Math.random() * Math.max(20, usable);
    pipes.push({ x: W + PIPE_WIDTH, gapTop, gap, scored: false, hue: Math.random() });
  }

  function drawPipeSegment(g, x, y, w, h, flipped) {
    // Body
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#3FBE6B');
    grad.addColorStop(0.5, '#4CD97B');
    grad.addColorStop(1, '#37A85C');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#25753F';
    g.lineWidth = 3;
    g.strokeRect(x, y, w, h);

    // Lip / cap
    const capH = 22;
    const capY = flipped ? y + h - capH : y;
    g.fillStyle = '#3FC470';
    g.fillRect(x - 6, capY, w + 12, capH);
    g.strokeStyle = '#25753F';
    g.strokeRect(x - 6, capY, w + 12, capH);
  }

  function updatePipes(dt) {
    const speed = currentPipeSpeed(score);
    pipeSpawnTimer -= dt;
    if (pipeSpawnTimer <= 0) {
      spawnPipe();
      pipeSpawnTimer = currentPipeInterval(score);
    }
    for (const p of pipes) {
      p.x -= speed * dt;
      if (!p.scored && p.x + PIPE_WIDTH < bird.x - bird.hitRadius()) {
        p.scored = true;
        score++;
        scoreDisplay.textContent = String(score);
        sfx.score();
        spawnScoreParticles(bird.x, bird.y);
        pulseScoreDisplay();
      }
    }
    pipes = pipes.filter(p => p.x + PIPE_WIDTH > -20);
  }

  function drawPipes(g) {
    for (const p of pipes) {
      drawPipeSegment(g, p.x, 0, PIPE_WIDTH, p.gapTop, false);
      drawPipeSegment(g, p.x, p.gapTop + p.gap, PIPE_WIDTH, H - GROUND_H - (p.gapTop + p.gap), true);
    }
  }

  function pulseScoreDisplay() {
    scoreDisplay.style.transform = 'scale(1.25)';
    requestAnimationFrame(() => {
      scoreDisplay.style.transition = 'transform 0.18s ease';
      scoreDisplay.style.transform = 'scale(1)';
    });
  }

  // ---- Particles ----------------------------------------------------------
  let particles = [];

  function spawnScoreParticles(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      particles.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 40,
        life: 0.6 + Math.random() * 0.3, age: 0,
        color: Math.random() < 0.5 ? '#FFD23F' : '#FF6B5B', size: 3 + Math.random() * 3,
        kind: 'spark'
      });
    }
  }

  function spawnFlapParticles(x, y) {
    particles.push({
      x, y, vx: -40 - Math.random() * 30, vy: 20 + Math.random() * 20,
      life: 0.4, age: 0, color: 'rgba(255,255,255,0.6)', size: 3, kind: 'puff'
    });
  }

  function spawnCrashParticles(x, y) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 220;
      particles.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 60,
        life: 0.7 + Math.random() * 0.5, age: 0,
        color: ['#FF6B5B', '#FFD23F', '#2B2140', '#FFF8ED'][i % 4],
        size: 3 + Math.random() * 4, kind: 'debris'
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt; // light gravity on particles
    }
    particles = particles.filter(p => p.age < p.life);
  }

  function drawParticles(g) {
    for (const p of particles) {
      const t = 1 - p.age / p.life;
      g.globalAlpha = Math.max(0, t);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size * (p.kind === 'puff' ? (1 + (1 - t)) : 1), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  // ---- Background: sky, sun/moon, clouds, hills, scrolling ground --------
  let elapsedTime = 0; // drives day/night cycle, independent of score
  let clouds = [];
  let hills = [];
  let groundOffset = 0;

  function initBackground() {
    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * W,
        y: 40 + Math.random() * (H * 0.35),
        scale: 0.6 + Math.random() * 0.9,
        speed: 8 + Math.random() * 14,
      });
    }
    hills = [];
    for (let i = 0; i < 5; i++) {
      hills.push({ x: i * (W / 3), width: W / 2.4 + Math.random() * 80, height: 40 + Math.random() * 50 });
    }
  }

  function lerpColor(c1, c2, t) {
    const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * t);
    const gC = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return `rgb(${r},${gC},${bl})`;
  }

  function dayPhase() {
    // 0 = full day, 1 = full night, smooth cosine loop
    return (Math.cos((elapsedTime / DAY_CYCLE_SECONDS) * Math.PI * 2) + 1) / 2;
  }

  function drawBackground(g, dt, moving) {
    const phase = dayPhase(); // 0 day .. 1 night
    const skyTop    = lerpColor('#8ED8FF', '#1B1E4A', phase);
    const skyBottom = lerpColor('#D9F4FF', '#3B3D77', phase);
    const grad = g.createLinearGradient(0, 0, 0, H - GROUND_H);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(1, skyBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // Sun / moon — swaps smoothly, arcs across the sky with elapsed time
    const arc = (elapsedTime % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;
    const sx = W * arc;
    const sy = H * 0.22 + Math.sin(arc * Math.PI) * -60 + 60;
    g.save();
    g.globalAlpha = 1 - phase * 0.15;
    g.fillStyle = phase < 0.5 ? '#FFE58A' : '#EDEFFF';
    g.beginPath();
    g.arc(sx, sy, 30, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // Stars fade in at night
    if (phase > 0.5) {
      g.save();
      g.globalAlpha = (phase - 0.5) * 2;
      g.fillStyle = '#fff';
      for (let i = 0; i < 40; i++) {
        const sxp = (i * 137.5) % W;
        const syp = (i * 71.3) % (H * 0.5);
        g.fillRect(sxp, syp, 2, 2);
      }
      g.restore();
    }

    // Clouds
    g.fillStyle = phase < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(230,230,255,0.35)';
    for (const c of clouds) {
      if (moving) c.x -= c.speed * dt;
      if (c.x < -100) c.x = W + 100;
      drawCloud(g, c.x, c.y, c.scale);
    }

    // Distant hills
    const hillColor = lerpColor('#7FD68A', '#232B54', phase);
    g.fillStyle = hillColor;
    for (const h of hills) {
      if (moving) h.x -= 12 * dt;
      if (h.x < -h.width) h.x = W;
      drawHill(g, h.x, H - GROUND_H, h.width, h.height);
    }
  }

  function drawCloud(g, x, y, s) {
    g.beginPath();
    g.ellipse(x, y, 26 * s, 16 * s, 0, 0, Math.PI * 2);
    g.ellipse(x + 20 * s, y + 4 * s, 20 * s, 13 * s, 0, 0, Math.PI * 2);
    g.ellipse(x - 20 * s, y + 5 * s, 18 * s, 12 * s, 0, 0, Math.PI * 2);
    g.fill();
  }

  function drawHill(g, x, baseY, w, h) {
    g.beginPath();
    g.moveTo(x - w / 2, baseY);
    g.quadraticCurveTo(x, baseY - h, x + w / 2, baseY);
    g.closePath();
    g.fill();
  }

  function drawGround(g, dt, moving) {
    const phase = dayPhase();
    const groundColor = lerpColor('#DEB870', '#4A3F63', phase);
    const groundColor2 = lerpColor('#C9A45E', '#3A3153', phase);
    const y = H - GROUND_H;
    g.fillStyle = groundColor;
    g.fillRect(0, y, W, GROUND_H);

    // Scrolling stripe pattern for a sense of speed
    const stripeW = 40;
    if (moving) groundOffset = (groundOffset - currentPipeSpeed(score) * dt) % stripeW;
    g.fillStyle = groundColor2;
    for (let x = groundOffset - stripeW; x < W; x += stripeW) {
      g.fillRect(x, y, stripeW / 2, GROUND_H);
    }
    // top edge highlight
    g.fillStyle = lerpColor('#F2D98B', '#5C5080', phase);
    g.fillRect(0, y, W, 6);
  }

  /* ------------------------------------------------------------------
     5. GAME STATE MACHINE + INPUT
  ------------------------------------------------------------------ */

  const STATE = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover' };
  let state = STATE.START;
  let score = 0;

  function showScreen(el) { el.classList.remove('hidden'); }
  function hideScreen(el) { el.classList.add('hidden'); }

  function goToStart() {
    state = STATE.START;
    score = 0;
    pipes = [];
    particles = [];
    pipeSpawnTimer = currentPipeInterval(0);
    bird.reset();
    scoreDisplay.textContent = '0';
    startHighScoreEl.textContent = String(highScore);
    hideScreen(pauseScreen);
    hideScreen(gameoverScreen);
    showScreen(startScreen);
  }

  function startGame() {
    ensureAudio();
    state = STATE.PLAYING;
    score = 0;
    pipes = [];
    particles = [];
    pipeSpawnTimer = currentPipeInterval(0);
    bird.reset();
    scoreDisplay.textContent = '0';
    hideScreen(startScreen);
    hideScreen(gameoverScreen);
    hideScreen(pauseScreen);
    sfx.swoosh();
  }

  function endGame() {
    if (state === STATE.GAMEOVER) return;
    state = STATE.GAMEOVER;
    sfx.hit();
    spawnCrashParticles(bird.x, bird.y);
    let isNewBest = false;
    if (score > highScore) { highScore = score; saveHighScore(highScore); isNewBest = true; }
    finalScoreEl.textContent = String(score);
    finalHighScoreEl.textContent = String(highScore);
    newBestBadge.classList.toggle('hidden', !isNewBest);
    setTimeout(() => showScreen(gameoverScreen), 500); // brief pause to let crash read
  }

  function togglePause() {
    if (state === STATE.PLAYING) {
      state = STATE.PAUSED;
      showScreen(pauseScreen);
    } else if (state === STATE.PAUSED) {
      state = STATE.PLAYING;
      hideScreen(pauseScreen);
    }
  }

  function handleFlapInput(e) {
    if (e) e.preventDefault();
    if (state === STATE.PLAYING) {
      bird.flap();
    } else if (state === STATE.START) {
      startGame();
      bird.flap();
    }
    // GAMEOVER / PAUSED: ignore flap input on canvas (use explicit buttons)
  }

  canvas.addEventListener('pointerdown', handleFlapInput);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      handleFlapInput(e);
    } else if (e.code === 'KeyP') {
      togglePause();
    }
  });

  startBtn.addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
  restartBtn.addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
  resumeBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
  pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state === STATE.PLAYING || state === STATE.PAUSED) togglePause();
  });
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); setMuted(!muted); });

  // The overlays are full-screen panels sitting above the canvas, so without
  // their own handlers only the small button inside would respond to a tap —
  // everywhere else on screen would silently do nothing. These make the
  // *whole* overlay tappable, matching the "tap anywhere to play" convention.
  // Button handlers above call stopPropagation(), so clicking the button
  // itself only triggers once, not twice.
  startScreen.addEventListener('pointerdown', (e) => { e.preventDefault(); startGame(); });
  gameoverScreen.addEventListener('pointerdown', (e) => { e.preventDefault(); startGame(); });
  pauseScreen.addEventListener('pointerdown', (e) => { e.preventDefault(); togglePause(); });

  // Prevent double-tap-to-zoom / rubber-band scrolling on mobile Safari.
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('resize', () => {
    resizeCanvas();
    initBackground();
    if (state !== STATE.PLAYING) bird.reset();
  });

  /* ------------------------------------------------------------------
     6. COLLISION + MAIN LOOP
  ------------------------------------------------------------------ */

  function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX, dy = cy - closestY;
    return dx * dx + dy * dy < r * r;
  }

  function checkCollisions() {
    const r = bird.hitRadius();
    // Ground / ceiling
    if (bird.y + r >= H - GROUND_H) { bird.y = H - GROUND_H - r; endGame(); return; }
    if (bird.y - r <= 0) { bird.y = r; bird.vy = 0; }
    // Pipes
    for (const p of pipes) {
      if (bird.x + r > p.x && bird.x - r < p.x + PIPE_WIDTH) {
        const inGap = bird.y - r > p.gapTop && bird.y + r < p.gapTop + p.gap;
        if (!inGap) {
          const hitTop = circleRectOverlap(bird.x, bird.y, r, p.x, 0, PIPE_WIDTH, p.gapTop);
          const hitBottom = circleRectOverlap(bird.x, bird.y, r, p.x, p.gapTop + p.gap, PIPE_WIDTH, H - GROUND_H - (p.gapTop + p.gap));
          if (hitTop || hitBottom) { endGame(); return; }
        }
      }
    }
  }

  let lastTime = performance.now();

  function loop(now) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 1 / 30); // clamp to avoid huge jumps after tab switch

    const moving = state === STATE.PLAYING;
    if (moving) elapsedTime += dt;

    // ---- update ----
    if (state === STATE.PLAYING) {
      bird.update(dt);
      updatePipes(dt);
      checkCollisions();
    }
    if (state !== STATE.PAUSED) {
      updateParticles(dt);
    }

    // ---- draw ----
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, dt, moving);
    drawPipes(ctx);
    drawGround(ctx, dt, moving);
    if (state !== STATE.START) bird.draw(ctx);
    drawParticles(ctx);

    if (state === STATE.START) {
      drawIdleBird(ctx, dt);
    }

    requestAnimationFrame(loop);
  }

  // Gentle bobbing bird preview while on the start screen
  let idleT = 0;
  function drawIdleBird(g, dt) {
    idleT += dt;
    const savedY = bird.y;
    bird.x = W * BIRD_X_RATIO;
    bird.y = H * 0.4 + Math.sin(idleT * 2.4) * 10;
    bird.rotation = Math.sin(idleT * 2.4) * 0.08;
    bird.wingPhase += dt * 6;
    bird.draw(g);
    bird.y = savedY;
  }

  /* ------------------------------------------------------------------
     BOOT
  ------------------------------------------------------------------ */

  function boot() {
    resizeCanvas();
    initBackground();
    bird.reset();
    setMuted(muted);
    startHighScoreEl.textContent = String(highScore);
    goToStart();
    requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(loop); });
  }

  boot();

})();
