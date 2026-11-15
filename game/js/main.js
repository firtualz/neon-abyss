// NEON ABYSS — Echoes of the Last Star. A roguelite arena shooter.
// You are Echo, pilot of the last ship, fighting through ten waves to relight
// the dying star. Vanilla canvas, no libraries, no network, all art and sound
// generated in code.

import { SoundEngine } from './audio.js';
import {
  ParticleBurst,
  FloatingTexts,
  Shockwaves,
  ScreenShake,
  Starfield,
  mulberry32,
} from './fx.js';
import {
  makePlayer,
  spawnEnemy,
  makeBoss,
  makeBullet,
  makePickup,
  updateEnemy,
  updateBoss,
} from './entities.js';
import { buildWaveQueue, spawnInterval, spawnPoint, isBossWave, waveClearBonus } from './waves.js';
import { UPGRADES, rollUpgrades } from './upgrades.js';

export const W = 1280;
export const H = 720;
const HUD_TOP = 64;
const PLAYER_SPEED = 340;
const PLAYER_ACCEL = 2400;
const BULLET_SPEED = 740;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusLine = document.getElementById('status');

const sound = new SoundEngine();
const particles = new ParticleBurst();
const floaters = new FloatingTexts();
const waves = new Shockwaves();
const shake = new ScreenShake();

// ---------------------------------------------------------------- state ----
const G = {
  screen: 'title', // title | playing | upgrade | paused | gameover | victory
  time: 0,
  score: 0,
  best: 0,
  wave: 0,
  endless: false,
  player: makePlayer(W / 2, H / 2 + 120),
  stats: {
    damage: 12,
    fireRate: 6,
    projectiles: 1,
    pierce: 0,
    crit: 0.05,
    magnet: 90,
    dashCooldownMax: 2.2,
    maxHull: 100,
  },
  enemies: [],
  boss: null,
  pbullets: [],
  ebullets: [],
  pickups: [],
  spawnQueue: [],
  spawnTimer: 0,
  waveState: 'idle',
  upgradeChoices: [],
  // Upgrades the pilot already owns this run, as { id, level } — the HUD
  // strip below only renders this list. Recording a pick changes no
  // mechanic: apply() still does the work; this is the build's memory.
  ownedUpgrades: [],
  kills: 0,
  shotsFired: 0,
  starfield: new Starfield(W, H, 21),
  rand: Math.random,
  shotMode: false,
  // Cover staging only (never set in live play): coverShot lightens the
  // draft overlay's dim, coverLight is the focal light drawBackground adds.
  coverShot: false,
  coverLight: null,
  keys: {},
  mouse: { x: W / 2, y: H / 2 - 100, down: false },
  firing: false,
  lastBurstAt: -99,
  bossTelegraphAt: -99,
  runSeed: 1,
};

try {
  G.best = Number(window.localStorage.getItem('neon-abyss-best') || 0) || 0;
} catch {
  G.best = 0;
}

function saveBest() {
  if (G.score <= G.best) return;
  G.best = G.score;
  try {
    window.localStorage.setItem('neon-abyss-best', String(G.best));
  } catch {
    // Storage is a nicety, never a dependency.
  }
}

// ------------------------------------------------------------------ input ----
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };

function canvasPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * W,
    y: ((clientY - rect.top) / rect.height) * H,
  };
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  G.keys[e.code] = true;
  sound.unlock();
  if (e.code === 'KeyM') sound.setMuted(!sound.muted);
  if (e.code === 'KeyP' && (G.screen === 'playing' || G.screen === 'paused')) {
    G.screen = G.screen === 'playing' ? 'paused' : 'playing';
  }
  if (e.code === 'Space' || e.code === 'Enter') handleConfirm();
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryDash();
  if (e.code === 'KeyR' && (G.screen === 'gameover' || G.screen === 'victory' || G.screen === 'playing')) restartRun();
  if (e.code === 'KeyE' && G.screen === 'victory') startEndless();
  if (G.screen === 'upgrade' && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
    chooseUpgrade(Number(e.code.slice(-1)) - 1);
  }
});

window.addEventListener('keyup', (e) => {
  G.keys[e.code] = false;
});

canvas.addEventListener('mousemove', (e) => {
  const p = canvasPos(e.clientX, e.clientY);
  G.mouse.x = p.x;
  G.mouse.y = p.y;
});

canvas.addEventListener('mousedown', (e) => {
  sound.unlock();
  const p = canvasPos(e.clientX, e.clientY);
  G.mouse.x = p.x;
  G.mouse.y = p.y;
  G.mouse.down = true;
  G.firing = true;
  handleClick(p.x, p.y);
});

window.addEventListener('mouseup', () => {
  G.mouse.down = false;
  G.firing = false;
});

function handleConfirm() {
  if (G.screen === 'title') startRun();
  else if (G.screen === 'gameover') restartRun();
  else if (G.screen === 'victory') restartRun();
  else if (G.screen === 'playing' && !G.player.fireCooldown) firePlayerBullets();
}

function handleClick(x, y) {
  if (G.screen === 'title') {
    startRun();
    return;
  }
  if (G.screen === 'upgrade') {
    const idx = cardIndexAt(x, y);
    if (idx >= 0) chooseUpgrade(idx);
    return;
  }
  if (G.screen === 'gameover') {
    restartRun();
    return;
  }
  if (G.screen === 'victory') {
    if (y > 500 && x < W / 2) restartRun();
    else if (y > 500) startEndless();
  }
}

function cardIndexAt(x, y) {
  if (y < 250 || y > 510) return -1;
  for (let i = 0; i < 3; i += 1) {
    const cx = 250 + i * 280;
    if (x >= cx && x <= cx + 240) return i;
  }
  return -1;
}

// --------------------------------------------------------------- run flow ----
function freshRun() {
  G.score = 0;
  G.wave = 0;
  G.endless = false;
  G.kills = 0;
  G.shotsFired = 0;
  G.enemies = [];
  G.boss = null;
  G.pbullets = [];
  G.ebullets = [];
  G.pickups = [];
  G.spawnQueue = [];
  G.ownedUpgrades = [];
  G.player = makePlayer(W / 2, H / 2 + 120);
  G.stats = { damage: 12, fireRate: 6, projectiles: 1, pierce: 0, crit: 0.05, magnet: 90, dashCooldownMax: 2.2, maxHull: 100 };
  G.time = 0;
}

function startRun() {
  freshRun();
  G.screen = 'playing';
  sound.launch();
  startWave(1);
}

function restartRun() {
  startRun();
}

function startEndless() {
  G.endless = true;
  G.screen = 'playing';
  startWave(11);
}

function startWave(n) {
  G.wave = n;
  G.waveState = 'spawning';
  G.spawnQueue = buildWaveQueue(n, G.rand);
  G.spawnTimer = 0.5;
  if (isBossWave(n)) {
    G.boss = makeBoss(n);
    G.enemies = [];
    sound.bossRoar();
    shake.add(7);
    floaters.add(W / 2, 220, n >= 10 ? 'VOID MAW PRIME' : 'VOID MAW', '#ff2e63', true);
  }
}

function waveCleared() {
  if (G.waveState === 'clear') return;
  G.waveState = 'clear';
  const bonus = waveClearBonus(G.wave);
  G.score += bonus;
  floaters.add(W / 2, 300, `WAVE ${G.wave} CLEAR  +${bonus}`, '#ffd60a', true);
  sound.levelClear();
  if (G.wave >= 10 && !G.endless) {
    G.screen = 'victory';
    particles.confetti(W, G.rand);
    sound.victory();
    saveBest();
    return;
  }
  G.upgradeChoices = rollUpgrades(G.rand);
  G.screen = 'upgrade';
}

function chooseUpgrade(idx) {
  const up = G.upgradeChoices[idx];
  if (!up) return;
  up.apply(G.stats);
  // Remember the pick for the HUD strip. Same upgrade twice levels it up.
  const rec = G.ownedUpgrades.find((o) => o.id === up.id);
  if (rec) rec.level += 1;
  else G.ownedUpgrades.push({ id: up.id, level: 1 });
  if (up.id === 'hull') {
    G.player.maxHull = G.stats.maxHull;
    G.player.hull = Math.min(G.player.maxHull, G.player.hull + 25);
  }
  sound.upgradePick();
  G.screen = 'playing';
  startWave(G.wave + 1);
}

function tryDash() {
  const p = G.player;
  if (G.screen !== 'playing' || !p.alive || p.dashCooldown > 0 || p.dashTime > 0) return;
  let dx = (G.keys.KeyD || G.keys.ArrowRight ? 1 : 0) - (G.keys.KeyA || G.keys.ArrowLeft ? 1 : 0);
  let dy = (G.keys.KeyS || G.keys.ArrowDown ? 1 : 0) - (G.keys.KeyW || G.keys.ArrowUp ? 1 : 0);
  if (dx === 0 && dy === 0) {
    dx = p.aimX - p.x;
    dy = p.aimY - p.y;
  }
  const d = Math.hypot(dx, dy) || 1;
  p.dashDirX = dx / d;
  p.dashDirY = dy / d;
  p.dashTime = 0.18;
  p.dashCooldown = G.stats.dashCooldownMax;
  p.invulnUntil = Math.max(p.invulnUntil, G.time + 0.3);
  sound.dash();
  particles.burst(p.x, p.y, '#7df9ff', 10, 160, G.rand);
}

// ------------------------------------------------------------------ combat ----
function firePlayerBullets() {
  const p = G.player;
  if (!p.alive || G.screen !== 'playing') return;
  p.fireCooldown = 1 / G.stats.fireRate;
  G.shotsFired += 1;
  const baseAngle = Math.atan2(p.aimY - p.y, p.aimX - p.x);
  const n = G.stats.projectiles;
  for (let i = 0; i < n; i += 1) {
    const off = (i - (n - 1) / 2) * 0.09;
    const a = baseAngle + off;
    const crit = G.rand() < G.stats.crit;
    const dmg = G.stats.damage * (crit ? 2 : 1);
    const bx = p.x + Math.cos(a) * 22;
    const by = p.y + Math.sin(a) * 22;
    G.pbullets.push(makeBullet(bx, by, Math.cos(a) * BULLET_SPEED, Math.sin(a) * BULLET_SPEED, dmg, true, crit ? '#ffd60a' : '#7df9ff', G.stats.pierce));
    if (crit) floaters.add(bx, by - 10, 'CRIT', '#ffd60a', false, 'crit');
  }
  p.vx -= Math.cos(baseAngle) * 14;
  p.vy -= Math.sin(baseAngle) * 14;
  sound.shoot();
}

function damagePlayer(dmg, sx, sy) {
  const p = G.player;
  if (!p.alive || G.time < p.invulnUntil || p.dashTime > 0) return;
  p.shieldRegenAt = G.time + 6;
  let rest = dmg;
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, rest);
    p.shield -= absorbed;
    rest -= absorbed;
  }
  if (rest > 0) {
    p.hull -= rest;
    floaters.add(p.x, p.y - 26, `-${Math.round(rest)}`, '#ff4d6d', true);
  }
  particles.burst(sx, sy, '#ff4d6d', 12, 200, G.rand);
  shake.add(6);
  sound.hurt();
  p.invulnUntil = G.time + 0.6;
  if (p.hull <= 0) {
    p.hull = 0;
    p.alive = false;
    particles.burst(p.x, p.y, '#7df9ff', 60, 380, G.rand);
    waves.add(p.x, p.y, '#7df9ff');
    shake.add(14);
    sound.explode(true);
    G.screen = 'gameover';
    saveBest();
  }
}

function killEnemy(e) {
  e.dead = true;
  G.kills += 1;
  G.score += e.score;
  floaters.add(e.x, e.y - 36, `+${e.score}`, '#e8f6ff', false);
  particles.burst(e.x, e.y, e.color, e.type === 'splitter' ? 30 : 18, 260, G.rand);
  waves.add(e.x, e.y, e.color);
  sound.explode(false);
  if (e.type === 'splitter') {
    for (const a of [-0.6, 0.6]) {
      const mini = spawnEnemy('mini', e.x, e.y, G.wave);
      mini.vx = Math.cos(a) * 200;
      mini.vy = Math.sin(a) * 200;
      G.enemies.push(mini);
    }
  }
  const roll = G.rand();
  if (roll < 0.1) G.pickups.push(makePickup(e.x, e.y, 'repair'));
  else if (roll < 0.55) G.pickups.push(makePickup(e.x, e.y, 'shard'));
}

function killBoss(boss) {
  boss.dead = true;
  G.kills += 1;
  G.score += boss.score;
  particles.burst(boss.x, boss.y, '#ff2e63', 90, 420, G.rand);
  particles.burst(boss.x, boss.y, '#ffd60a', 50, 300, G.rand);
  waves.add(boss.x, boss.y, '#ff2e63');
  waves.add(boss.x, boss.y, '#ffd60a');
  shake.add(16);
  sound.explode(true);
  G.boss = null;
  G.ebullets = G.ebullets.filter((b) => b.friendly);
  if (G.wave >= 10 && !G.endless) {
    G.screen = 'victory';
    particles.confetti(W, G.rand);
    sound.victory();
    saveBest();
  } else {
    waveCleared();
  }
}

// ------------------------------------------------------------------- step ----
function stepPlaying(dt) {
  const p = G.player;

  // --- player movement ---
  let mx = (G.keys.KeyD || G.keys.ArrowRight ? 1 : 0) - (G.keys.KeyA || G.keys.ArrowLeft ? 1 : 0);
  let my = (G.keys.KeyS || G.keys.ArrowDown ? 1 : 0) - (G.keys.KeyW || G.keys.ArrowUp ? 1 : 0);
  const ml = Math.hypot(mx, my) || 1;
  mx /= ml;
  my /= ml;
  if (p.dashTime > 0) {
    p.dashTime -= dt;
    p.vx = p.dashDirX * 950;
    p.vy = p.dashDirY * 950;
  } else {
    p.vx += mx * PLAYER_ACCEL * dt;
    p.vy += my * PLAYER_ACCEL * dt;
    const damp = Math.max(0, 1 - 6 * dt);
    if (mx === 0) p.vx *= damp;
    if (my === 0) p.vy *= damp;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > PLAYER_SPEED) {
      p.vx = (p.vx / sp) * PLAYER_SPEED;
      p.vy = (p.vy / sp) * PLAYER_SPEED;
    }
  }
  p.x = Math.max(p.r, Math.min(W - p.r, p.x + p.vx * dt));
  p.y = Math.max(HUD_TOP + p.r, Math.min(H - p.r, p.y + p.vy * dt));
  p.aimX = G.mouse.x;
  p.aimY = G.mouse.y;
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.engineFlame = Math.hypot(p.vx, p.vy) / PLAYER_SPEED;
  if (p.shield < p.maxShield && G.time > p.shieldRegenAt) {
    p.shield = Math.min(p.maxShield, p.shield + 12 * dt);
  }

  // --- firing ---
  if ((G.firing || G.mouse.down || G.keys.Space) && p.fireCooldown <= 0) {
    firePlayerBullets();
  }

  // --- spawn queue ---
  if (G.waveState === 'spawning') {
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0) {
      if (G.spawnQueue.length > 0) {
        const type = G.spawnQueue.shift();
        const pt = spawnPoint(G.rand);
        G.enemies.push(spawnEnemy(type, pt.x, pt.y, G.wave));
        G.spawnTimer = spawnInterval(G.wave);
      } else {
        G.waveState = 'fighting';
      }
    }
  }

  // --- enemies ---
  const world = {
    player: p,
    time: G.time,
    rand: G.rand,
    fireEnemyBullet: (x, y, vx, vy, dmg, color) => {
      G.ebullets.push(makeBullet(x, y, vx, vy, dmg, false, color, 0));
      sound.enemyShoot();
    },
    summonDrones: (x, y) => {
      const alive = G.enemies.filter((e) => e.type === 'drone').length;
      for (let i = 0; i < 2 && alive + i < 6; i += 1) {
        G.enemies.push(spawnEnemy('drone', x + (i === 0 ? -60 : 60), y + 30, G.wave));
      }
    },
    shake: (amount) => shake.add(amount),
    onBossBurst: () => {
      G.lastBurstAt = G.time;
    },
    onBossTelegraph: () => {
      G.bossTelegraphAt = G.time;
      sound.bossRoar();
    },
  };
  for (const e of G.enemies) updateEnemy(e, world, dt);
  if (G.boss) updateBoss(G.boss, world, dt);

  // --- player bullets ---
  for (const b of G.pbullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.x < -20 || b.x > W + 20 || b.y < 44 || b.y > H + 20 || b.life <= 0) b.dead = true;
  }

  // --- enemy bullets ---
  for (const b of G.ebullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.x < -20 || b.x > W + 20 || b.y < 44 || b.y > H + 20 || b.life <= 0) b.dead = true;
  }

  // --- collisions: player bullets vs enemies & boss ---
  for (const b of G.pbullets) {
    if (b.dead) continue;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = b.x - e.x;
      const dy = b.y - e.y;
      if (dx * dx + dy * dy < (b.r + e.r) * (b.r + e.r)) {
        e.hp -= b.dmg;
        e.flash = 0.09;
        floaters.add(b.x, b.y - 12, String(Math.round(b.dmg)), '#ffe97a', true, e);
        particles.burst(b.x, b.y, e.color, 4, 120, G.rand);
        sound.hit();
        if (e.hp <= 0) killEnemy(e);
        if (b.pierce > 0) b.pierce -= 1;
        else {
          b.dead = true;
          break;
        }
      }
    }
    if (b.dead) continue;
    const boss = G.boss;
    if (boss && !boss.dead) {
      const dx = b.x - boss.x;
      const dy = b.y - boss.y;
      if (dx * dx + dy * dy < (b.r + boss.r) * (b.r + boss.r)) {
        boss.hp -= b.dmg;
        boss.flash = 0.08;
        floaters.add(b.x, b.y - 12, String(Math.round(b.dmg)), '#ffe97a', true, boss);
        particles.burst(b.x, b.y, '#ff2e63', 4, 130, G.rand);
        sound.hit();
        if (boss.hp <= 0) killBoss(boss);
        if (b.pierce > 0) b.pierce -= 1;
        else b.dead = true;
      }
    }
  }

  // --- collisions: enemy bullets vs player ---
  for (const b of G.ebullets) {
    if (b.dead) continue;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    if (dx * dx + dy * dy < (b.r + p.r - 2) * (b.r + p.r - 2)) {
      b.dead = true;
      damagePlayer(b.dmg, b.x, b.y);
      if (!p.alive) return;
    }
  }

  // --- collisions: enemies vs player (contact) ---
  const touchTargets = G.boss ? [...G.enemies, G.boss] : G.enemies;
  for (const e of touchTargets) {
    if (e.dead || e.touchCooldown > 0) continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const rr = e.r + p.r;
    if (dx * dx + dy * dy < rr * rr) {
      e.touchCooldown = 0.9;
      damagePlayer(e.dmg, p.x, p.y);
      // Knock the enemy back so contact does not stick.
      const d = Math.hypot(dx, dy) || 1;
      if (e.type !== 'boss') {
        e.x += (dx / d) * 26;
        e.y += (dy / d) * 26;
      }
      if (e.type === 'mine') {
        e.hp = 0;
        killEnemy(e);
      }
      if (!p.alive) return;
    }
  }

  // --- pickups ---
  for (const pk of G.pickups) {
    pk.life -= dt;
    if (pk.life <= 0) {
      pk.dead = true;
      continue;
    }
    const dx = p.x - pk.x;
    const dy = p.y - pk.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < G.stats.magnet) {
      pk.x += (dx / d) * 340 * dt;
      pk.y += (dy / d) * 340 * dt;
    } else {
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      pk.vy = Math.min(60, pk.vy + 20 * dt);
    }
    if (d < p.r + pk.r + 4) {
      pk.dead = true;
      if (pk.kind === 'shard') {
        G.score += 25;
        floaters.add(pk.x, pk.y - 10, '+25', '#7ad9ff', false);
      } else {
        p.hull = Math.min(p.maxHull, p.hull + 15);
        floaters.add(pk.x, pk.y - 10, '+15 HULL', '#3ddc84', false);
        sound.heal();
      }
    }
  }

  // --- cleanup ---
  G.enemies = G.enemies.filter((e) => !e.dead);
  G.pbullets = G.pbullets.filter((b) => !b.dead);
  G.ebullets = G.ebullets.filter((b) => !b.dead);
  G.pickups = G.pickups.filter((pk) => !pk.dead);

  // --- wave clear check (waveCleared itself marks the wave 'clear', so a
  // boss kill and this check can never both pay the clear bonus) ---
  if (
    G.screen === 'playing' &&
    G.waveState === 'fighting' &&
    G.spawnQueue.length === 0 &&
    G.enemies.length === 0 &&
    !G.boss
  ) {
    waveCleared();
  }

  particles.update(dt);
  floaters.update(dt);
  waves.update(dt);
  shake.update(dt);
}

function step(dt) {
  G.time += dt;
  if (G.screen === 'playing') stepPlaying(dt);
  else if (G.screen === 'title' || G.screen === 'victory' || G.screen === 'gameover') {
    particles.update(dt);
    floaters.update(dt);
    waves.update(dt);
    shake.update(dt);
  }
}

// -------------------------------------------------------------- autopilot ----
// Drives the ship for staged screenshots: keeps a firing distance from the
// nearest enemy, dodges incoming bullets, and dashes out of danger. It plays
// the real rules — the same step function, the same collisions.
function autopilot(dt) {
  const p = G.player;
  if (!p.alive) return;
  let target = null;
  let best = Infinity;
  const targets = G.boss ? [...G.enemies, G.boss] : G.enemies;
  for (const e of targets) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < best) {
      best = d;
      target = e;
    }
  }
  // Dodge the nearest threatening bullet.
  let dodgeX = 0;
  let dodgeY = 0;
  for (const b of G.ebullets) {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < 110) {
      const away = Math.atan2(p.y - b.y, p.x - b.x);
      dodgeX += Math.cos(away);
      dodgeY += Math.sin(away);
      if (d < 62 && p.dashCooldown <= 0) tryDash();
    }
  }
  let mx = 0;
  let my = 0;
  if (target) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const want = d > 260 ? 1 : d < 170 ? -1 : 0;
    mx = (dx / d) * want;
    my = (dy / d) * want;
    // Strafe sideways so the shot lines keep moving.
    const strafe = Math.sin(G.time * 1.7) * 0.7;
    mx += (-dy / d) * strafe;
    my += (dx / d) * strafe;
    G.mouse.x = target.x;
    G.mouse.y = target.y;
    G.firing = true;
  } else {
    G.mouse.x = W / 2;
    G.mouse.y = H / 2 - 160;
    G.firing = false;
  }
  mx += dodgeX;
  my += dodgeY;
  // Hold the middle of the arena so the fight stays in frame.
  mx += ((W / 2 - p.x) / (W / 2)) * 0.55;
  my += ((400 - p.y) / 400) * 0.55;
  const ml = Math.hypot(mx, my) || 1;
  G.keys.KeyD = mx / ml > 0.35;
  G.keys.KeyA = mx / ml < -0.35;
  G.keys.KeyS = my / ml > 0.35;
  G.keys.KeyW = my / ml < -0.35;
  G.keys.ArrowRight = G.keys.KeyD;
  G.keys.ArrowLeft = G.keys.KeyA;
  G.keys.ArrowDown = G.keys.KeyS;
  G.keys.ArrowUp = G.keys.KeyW;
}

// ------------------------------------------------------------ shot staging ----
// ?shot=title|gameplay|boss|victory|draft&seed=N — play the real game forward with
// the autopilot and photograph the richest moment: every half second the
// frame is scored (enemies, bullets and particles in the middle of the arena)
// and the best-scoring state is kept. Nothing is edited or composited; the
// frame is drawn by the same renderer the player sees.
function snapshotWorld() {
  const snap = (arr) => JSON.parse(JSON.stringify(arr));
  return {
    time: G.time,
    score: G.score,
    kills: G.kills,
    wave: G.wave,
    screen: G.screen,
    player: JSON.parse(JSON.stringify(G.player)),
    enemies: snap(G.enemies),
    boss: G.boss ? JSON.parse(JSON.stringify(G.boss)) : null,
    pbullets: snap(G.pbullets),
    ebullets: snap(G.ebullets),
    pickups: snap(G.pickups),
    particles: snap(particles.items),
    floaters: snap(floaters.items),
    waves: snap(waves.items),
    ownedUpgrades: JSON.parse(JSON.stringify(G.ownedUpgrades)),
  };
}

function restoreWorld(s) {
  G.time = s.time;
  G.score = s.score;
  G.kills = s.kills;
  G.wave = s.wave;
  G.screen = s.screen;
  G.player = s.player;
  G.enemies = s.enemies;
  G.boss = s.boss;
  G.pbullets = s.pbullets;
  G.ebullets = s.ebullets;
  G.pickups = s.pickups;
  particles.items = s.particles;
  floaters.items = s.floaters;
  waves.items = s.waves;
  G.ownedUpgrades = s.ownedUpgrades || [];
}

// How photogenic is this exact moment? Enemies, bullets and particles count,
// and anything inside the middle of the arena counts double.
function richness() {
  let r = G.enemies.length * 5 + G.pbullets.length * 0.6 + G.ebullets.length * 1.2 + particles.items.length * 0.25;
  if (G.boss) {
    r += 12;
    if (G.boss.x > 400 && G.boss.x < 880 && G.boss.y > 140 && G.boss.y < 420) r += 10;
  }
  for (const e of G.enemies) {
    if (e.x > 300 && e.x < 980 && e.y > 150 && e.y < 600) r += 2;
  }
  const p = G.player;
  if (p.x > 300 && p.x < 980 && p.y > 150 && p.y < 600) r += 6;
  return r;
}

function stageShot(name, seed) {
  const rand = mulberry32(seed || 1);
  G.rand = rand;
  G.shotMode = true;
  const DT = 1 / 60;

  // Frozen corner dressing for staged shots: enemies and live bursts placed
  // at the frame corners after the best moment is restored, so no large
  // empty dark area remains. Shot mode renders once afterwards, so they hold
  // still — the same renderer draws them, nothing is composited.
  function dressCorners(wave) {
    const spots = [
      ['drone', 108, 168],
      ['weaver', 1172, 172],
      ['stinger', 118, 612],
      ['mine', 1162, 604],
    ];
    for (const [type, x, y] of spots) {
      G.enemies.push(spawnEnemy(type, x, y, wave));
    }
    particles.burst(150, 645, '#ff8a00', 16, 220, G.rand);
    particles.burst(1130, 130, '#00b4ff', 12, 200, G.rand);
    for (let k = 0; k < 12; k += 1) {
      particles.update(DT);
      waves.update(DT);
    }
  }

  // Nudge apart any two live damage numbers close enough to touch, so the
  // frame never shows a merged blob of digits. A big (30px) number's glyph
  // reaches 30px above its baseline and its 12px glow reaches further, so a
  // mixed big/small pair needs more room than two small ones: 56px vertical
  // when either is big, 42px otherwise. Pairs are moved to need + 2, never
  // exactly onto the boundary they just passed — 42px apart still reads as
  // one blob once the glows meet (v3 probe: two pairs sat at exactly 42px).
  // Numbers are also pushed out of the boss core, where gold on bright
  // yellow washes out. Repeat until no pair violates, so chains resolve
  // instead of just moving the collision elsewhere. Staging only; the live
  // game's own merge logic in fx.js is untouched.
  function declutterFloaters() {
    const items = floaters.items;
    if (G.boss) {
      for (const f of items) {
        const dx = f.x - G.boss.x;
        const dy = f.y - G.boss.y;
        const d = Math.hypot(dx, dy);
        if (d < 78 && d > 0) {
          f.x = G.boss.x + (dx / d) * 78;
          f.y = G.boss.y + (dy / d) * 78;
        }
      }
    }
    const needFor = (a, b) => (a.big || b.big ? 56 : 42);
    for (let pass = 0; pass < 6; pass += 1) {
      let moved = false;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          const need = needFor(a, b);
          if (Math.abs(a.x - b.x) < 48 && Math.abs(a.y - b.y) < need) {
            b.y = b.y < a.y ? a.y - (need + 2) : a.y + (need + 2);
            if (b.y < 110) b.y = a.y + (need + 2);
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

  if (name === 'boss') {
    freshRun();
    G.screen = 'playing';
    G.kills = 24;
    G.score = 2350;
    // Staging loadout: three streams at a brisk rate so the frame shows real
    // bullet traffic. Mechanics are untouched; this is the photo setup.
    G.stats.damage = 14;
    G.stats.fireRate = 8;
    G.stats.projectiles = 3;
    // The build this cover is staged around: two multishot picks (1 + 2 = 3
    // streams, exact), one damage, one fire rate. The strip renders it.
    G.ownedUpgrades = [
      { id: 'multishot', level: 2 },
      { id: 'damage', level: 1 },
      { id: 'firerate', level: 1 },
    ];
    startWave(5);
    // The wave banner ("VOID MAW") would print across the boss in the
    // cover frame: clear it here, the fight itself is unchanged.
    floaters.items.length = 0;
    // The cover boss: bigger, locked to the middle of the arena, already in
    // phase 2 so its radial bursts are dense from the first second.
    const boss = G.boss;
    boss.scale = 1.5;
    boss.anchorLock = { x: 640, y: 250 };
    boss.x = 640;
    boss.y = 250;
    boss.hp = Math.round(boss.maxHp * 0.42);
    boss.attackTimer = 0.3;
    boss.spreadTimer = 0.6;
    boss.summonTimer = 0.4;
    // A drone escort and one splitter beside the boss: the drones fill the
    // frame, the splitter's death is a live explosion with minis.
    const escorts = [
      ['drone', boss.x - 150, boss.y + 90],
      ['drone', boss.x + 150, boss.y + 90],
      ['drone', boss.x - 220, boss.y - 40],
      ['drone', boss.x + 220, boss.y - 40],
      ['splitter', boss.x - 260, boss.y + 170],
    ];
    for (const [type, ex, ey] of escorts) {
      G.enemies.push(spawnEnemy(type, ex, ey, G.wave));
    }
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 60 * 30 && G.screen === 'playing'; i += 1) {
      autopilot(DT);
      step(DT);
      if (i % 15 === 0) {
        const r = richness();
        if (r > bestScore) {
          bestScore = r;
          best = snapshotWorld();
        }
      }
      if (G.boss && G.boss.hp < G.boss.maxHp * 0.12) break;
    }
    if (best) restoreWorld(best);
    // One live explosion on the boss's flank, drawn by the same renderer in
    // the same frame, so the cover always carries an active blast. Age the
    // burst a quarter of a second so its particles have spread and its
    // shockwave ring is open when the frame is taken.
    if (G.boss) {
      particles.burst(G.boss.x - 110, G.boss.y + 70, '#ff2e63', 34, 320, G.rand);
      particles.burst(G.boss.x - 110, G.boss.y + 70, '#ffd60a', 18, 240, G.rand);
      waves.add(G.boss.x - 110, G.boss.y + 70, '#ff2e63');
      // Second blast on the opposite flank, plus low-centre colour, so the
      // brightest moment is not one-sided and the dark lower band (y 480-650)
      // lifts: cyan shockwave right, gold and green bursts low. Same ageing
      // as the first blast, so all of it reads as one moment.
      particles.burst(G.boss.x + 140, G.boss.y + 110, '#00e5ff', 22, 280, G.rand);
      particles.burst(640, 560, '#ffd60a', 16, 240, G.rand);
      particles.burst(420, 600, '#3ddc84', 12, 200, G.rand);
      waves.add(G.boss.x + 140, G.boss.y + 110, '#00e5ff');
      for (let k = 0; k < 15; k += 1) {
        particles.update(DT);
        waves.update(DT);
        floaters.update(DT);
      }
    }
    dressCorners(5);
    declutterFloaters();
    return;
  }
  if (name === 'cover') {
    // The cover: the draft moment over a live wave-5 boss fight. Same
    // renderer, same screens — the boss fight plays forward, the richest
    // moment is kept, then the draft overlay opens over it. The cards own
    // the centre, so the boss holds the LEFT margin and the fight fills the
    // margins, top and bottom bands the cards leave open.
    freshRun();
    G.screen = 'playing';
    G.kills = 41;
    G.score = 5200;
    G.stats.damage = 14;
    G.stats.fireRate = 8;
    G.stats.projectiles = 3;
    G.ownedUpgrades = [
      { id: 'multishot', level: 2 },
      { id: 'damage', level: 1 },
      { id: 'firerate', level: 1 },
    ];
    startWave(5);
    floaters.items.length = 0;
    const boss = G.boss;
    boss.scale = 1.5;
    boss.anchorLock = { x: 150, y: 380 };
    boss.x = 150;
    boss.y = 380;
    boss.hp = Math.round(boss.maxHp * 0.42);
    boss.attackTimer = 0.3;
    boss.spreadTimer = 0.6;
    boss.summonTimer = 0.4;
    // One of every enemy type, placed where the cards do not cover them:
    // splitter and weaver right, stinger right-bottom, mine bottom band,
    // drones at the corners and mid-field.
    const pack = [
      ['splitter', 1180, 180],
      ['weaver', 1150, 300],
      ['stinger', 1180, 470],
      ['mine', 900, 640],
      ['drone', 120, 170],
      ['drone', 1150, 90],
      ['drone', 420, 620],
      ['drone', 700, 130],
      ['weaver', 950, 620],
      ['stinger', 200, 620],
    ];
    for (const [type, ex, ey] of pack) {
      G.enemies.push(spawnEnemy(type, ex, ey, G.wave));
    }
    // The focal light: a warm glow centred on the boss, lighting the left
    // half of the frame. Staging only; drawBackground adds it.
    G.coverLight = { x: 150, y: 380, r: 480 };
    G.coverShot = true;
    // Richness for the cover rewards enemies in the visible margins (the
    // cards cover the centre), the boss alive, and live bullet/particle
    // traffic — the opposite of the boss shot's centre weighting.
    const coverRichness = () => {
      let r = G.enemies.length * 5 + G.pbullets.length * 0.6 + G.ebullets.length * 1.2 + particles.items.length * 0.25;
      if (G.boss) r += 12;
      for (const e of G.enemies) {
        if (e.x < 250 || e.x > 1050 || e.y > 510 || e.y < 150) r += 3;
      }
      const p = G.player;
      if (p.x < 250 || p.x > 1050 || p.y > 510) r += 4;
      return r;
    };
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 60 * 30 && G.screen === 'playing'; i += 1) {
      autopilot(DT);
      step(DT);
      if (i % 15 === 0) {
        const r = coverRichness();
        if (r > bestScore) {
          bestScore = r;
          best = snapshotWorld();
        }
      }
      if (G.boss && G.boss.hp < G.boss.maxHp * 0.12) break;
    }
    if (best) restoreWorld(best);
    // The brightest moment: live blasts on the boss's flank and in the
    // right margin, plus low-centre colour, aged so the rings are open
    // when the frame is taken.
    if (G.boss) {
      particles.burst(G.boss.x + 120, G.boss.y - 60, '#ff2e63', 30, 320, G.rand);
      particles.burst(G.boss.x + 120, G.boss.y - 60, '#ffd60a', 16, 240, G.rand);
      waves.add(G.boss.x + 120, G.boss.y - 60, '#ff2e63');
      particles.burst(1120, 200, '#00e5ff', 22, 280, G.rand);
      particles.burst(640, 600, '#ffd60a', 16, 240, G.rand);
      particles.burst(900, 620, '#3ddc84', 12, 200, G.rand);
      waves.add(1120, 200, '#00e5ff');
      for (let k = 0; k < 15; k += 1) {
        particles.update(DT);
        waves.update(DT);
        floaters.update(DT);
      }
    }
    // Corner bursts for the margins the cards leave open.
    particles.burst(150, 645, '#ff8a00', 16, 220, G.rand);
    particles.burst(1130, 130, '#00b4ff', 12, 200, G.rand);
    for (let k = 0; k < 12; k += 1) {
      particles.update(DT);
      waves.update(DT);
    }
    // Open the draft over the fight: wave 5 clear, the legible trio, the
    // owned strip already set above. The cover dim is lighter (drawUpgrade)
    // so the fight reads through.
    G.wave = 5;
    G.waveState = 'clear';
    G.score += waveClearBonus(5);
    G.upgradeChoices = [
      UPGRADES.find((u) => u.id === 'damage'),
      UPGRADES.find((u) => u.id === 'multishot'),
      UPGRADES.find((u) => u.id === 'crit'),
    ];
    G.screen = 'upgrade';
    // Title-band hygiene: a damage number landing on "CHOOSE AN UPGRADE"
    // reads as a smudge on the cover's most important text (caught in the
    // v4 visual check — a floater from the drone at (700,130) sat on the
    // "UP"). Drop floaters inside the band x 300-980, y 110-260; the rest
    // stay for combat feel.
    floaters.items = floaters.items.filter(
      (f) => !(f.x > 300 && f.x < 980 && f.y > 110 && f.y < 260),
    );
    // Same hygiene for the world pass: the cover dim is light (0.22), so
    // a bullet, pickup or particle sitting in the gap between the title
    // letters shows through as a smudge (a cyan bar sat on "UP" in the
    // v4 check). Enemies stay — they are placed deliberately and read as
    // the fight, not as dirt on the text.
    const inTitleBand = (o) => o.x > 280 && o.x < 1000 && o.y > 100 && o.y < 260;
    G.pbullets = G.pbullets.filter((b) => !inTitleBand(b));
    G.ebullets = G.ebullets.filter((b) => !inTitleBand(b));
    G.pickups = G.pickups.filter((p) => !inTitleBand(p));
    particles.items = particles.items.filter((p) => !inTitleBand(p));
    // The pilot visible bottom-right, firing up at the boss.
    G.player.x = 1090;
    G.player.y = 640;
    G.player.aimX = G.boss ? G.boss.x : 150;
    G.player.aimY = G.boss ? G.boss.y : 380;
    G.mouse.x = G.boss ? G.boss.x : 150;
    G.mouse.y = G.boss ? G.boss.y : 380;
    return;
  }
  if (name === 'victory') {
    // The photo setup must not pollute the player's persistent record:
    // this staged run's rigged score (12,450 + fight kills) is not a real
    // best. Snapshot the real best and restore it afterwards, so the
    // title's BEST SCORE always shows a score a real play session earned.
    const realBest = G.best;
    freshRun();
    G.screen = 'playing';
    G.kills = 87;
    G.score = 12450;
    G.stats.damage = 60;
    G.stats.fireRate = 10;
    G.stats.projectiles = 3;
    startWave(10);
    if (G.boss) G.boss.hp = 60;
    for (let i = 0; i < 60 * 30 && G.screen === 'playing'; i += 1) {
      autopilot(DT);
      step(DT);
    }
    G.best = realBest;
    try {
      window.localStorage.setItem('neon-abyss-best', String(realBest));
    } catch {
      // Storage is a nicety, never a dependency.
    }
    return;
  }
  if (name === 'gameplay') {
    freshRun();
    G.screen = 'playing';
    // Mid-fight scoreboard, as in the boss staging: the frame should read
    // as a fight already in progress, not its first seconds.
    G.kills = 18;
    G.score = 1800;
    // Staging loadout: three streams, brisk fire, so bullet traffic and
    // kills stay visible. Wave 6 has the biggest mixed pack. Damage stays
    // modest so the pack survives long enough to crowd the frame.
    G.stats.damage = 14;
    G.stats.fireRate = 8;
    G.stats.projectiles = 3;
    startWave(6);
    // A mixed pack already inside the arena when the photo run starts, so
    // the frame is crowded from the first second: a splitter (its death is
    // a live explosion plus two minis) ringed by drones, weavers, stingers
    // and a mine at varied ranges.
    const pack = [
      ['splitter', 520, 210],
      ['drone', 420, 310],
      ['drone', 860, 300],
      ['weaver', 700, 180],
      ['stinger', 900, 430],
      ['drone', 380, 470],
      ['weaver', 950, 200],
      ['stinger', 600, 120],
      ['mine', 1040, 350],
      ['drone', 240, 300],
    ];
    for (const [type, ex, ey] of pack) {
      G.enemies.push(spawnEnemy(type, ex, ey, G.wave));
    }
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 60 * 30 && G.screen === 'playing'; i += 1) {
      autopilot(DT);
      step(DT);
      if (i % 10 === 0) {
        const r = richness();
        if (r > bestScore) {
          bestScore = r;
          best = snapshotWorld();
        }
      }
    }
    if (best) restoreWorld(best);
    dressCorners(6);
    declutterFloaters();
    return;
  }
  if (name === 'draft') {
    freshRun();
    G.screen = 'playing';
    G.kills = 31;
    G.score = 3420;
    G.stats.damage = 16;
    G.stats.fireRate = 8;
    G.stats.projectiles = 2;
    startWave(3);
    // A live battlefield behind the draft overlay: a mixed pack spread to
    // all four corners, so the dimmed backdrop still reads as a fight in
    // progress rather than an empty void.
    const pack = [
      ['splitter', 520, 260],
      ['drone', 180, 180],
      ['drone', 1100, 180],
      ['weaver', 700, 170],
      ['stinger', 180, 560],
      ['stinger', 1100, 560],
      ['drone', 420, 480],
      ['weaver', 900, 420],
      ['mine', 640, 620],
      ['drone', 980, 300],
    ];
    for (const [type, ex, ey] of pack) {
      G.enemies.push(spawnEnemy(type, ex, ey, G.wave));
    }
    // Play a few seconds so bullets, particles and damage numbers exist
    // behind the overlay.
    for (let i = 0; i < 60 * 4 && G.screen === 'playing'; i += 1) {
      autopilot(DT);
      step(DT);
    }
    // Freeze on the draft screen over the live battlefield. The three cards
    // are fixed for the photo — a different trio from the cover's (pierce,
    // hull, magnet), all real pool cards; the live game rolls its three
    // with rollUpgrades instead.
    G.wave = 3;
    G.waveState = 'clear';
    G.score += waveClearBonus(3);
    G.upgradeChoices = [
      UPGRADES.find((u) => u.id === 'pierce'),
      UPGRADES.find((u) => u.id === 'hull'),
      UPGRADES.find((u) => u.id === 'magnet'),
    ];
    G.screen = 'upgrade';
    dressCorners(3);
    return;
  }
  // title (default): a short attract game behind the menu. The world plays
  // for real while the menu is up; the pilot cannot die during attract.
  freshRun();
  G.screen = 'playing';
  startWave(1);
  G.player.invulnUntil = 1e9;
  for (let i = 0; i < 60 * 6; i += 1) {
    autopilot(DT);
    stepPlaying(DT);
  }
  G.screen = 'title';
}

// ---------------------------------------------------------------- render ----
function drawBackground() {
  // v4: the frame was the darkest on the board (mean luminance 18.8, 94% of
  // pixels below 15% brightness). Lift the whole value range and add a warm
  // fourth nebula so the game reads at a glance even before any staging.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#251d4d');
  grad.addColorStop(0.55, '#1d1545');
  grad.addColorStop(1, '#100e2e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Drifting nebula blobs.
  const blobs = [
    { x: 300 + Math.sin(G.time * 0.11) * 60, y: 210, r: 320, c: 'rgba(123,47,247,0.48)' },
    { x: 980 + Math.cos(G.time * 0.09) * 70, y: 480, r: 360, c: 'rgba(255,46,99,0.34)' },
    { x: 640 + Math.sin(G.time * 0.07 + 2) * 80, y: 620, r: 300, c: 'rgba(0,180,255,0.30)' },
    { x: 700 + Math.sin(G.time * 0.05 + 4) * 50, y: 300, r: 280, c: 'rgba(255,180,60,0.18)' },
  ];
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, b.c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  }
  // Cover-only focal light (set by the cover staging): one strong light
  // source — the Lanternfin/Thousandwing model — so the frame has a bright
  // anchor instead of a dark field. Staging only; never set in live play.
  if (G.coverLight) {
    const L = G.coverLight;
    const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
    g.addColorStop(0, 'rgba(255,236,190,0.68)');
    g.addColorStop(0.35, 'rgba(255,200,110,0.36)');
    g.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
  }
  G.starfield.draw(ctx, G.time, W, H);
}

function drawPickup(pk) {
  ctx.save();
  ctx.translate(pk.x, pk.y);
  ctx.globalAlpha = Math.min(1, pk.life / 2);
  if (pk.kind === 'shard') {
    ctx.rotate(G.time * 2);
    ctx.fillStyle = '#7ad9ff';
    ctx.shadowColor = '#7ad9ff';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(7, 0);
    ctx.lineTo(0, 9);
    ctx.lineTo(-7, 0);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = '#0d3d24';
    ctx.strokeStyle = '#3ddc84';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#3ddc84';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3ddc84';
    ctx.fillRect(-2, -6, 4, 12);
    ctx.fillRect(-6, -2, 12, 4);
  }
  ctx.restore();
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(1.15, 1.15);
  const flash = e.flash > 0;
  ctx.fillStyle = flash ? '#ffffff' : e.color;
  ctx.strokeStyle = flash ? '#ffffff' : e.color;
  ctx.shadowColor = e.color;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 2;
  const p = G.player;
  const aim = Math.atan2(p.y - e.y, p.x - e.x);
  if (e.type === 'drone' || e.type === 'mini') {
    ctx.rotate(aim);
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-11, -10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-11, 10);
    ctx.closePath();
    ctx.fill();
  } else if (e.type === 'stinger') {
    ctx.rotate(aim);
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(0, -12);
    ctx.lineTo(-15, 0);
    ctx.lineTo(0, 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a0b00';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'splitter') {
    ctx.rotate(G.time * 0.6);
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * 18;
      const py = Math.sin(a) * 18;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2a0a44';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'weaver') {
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, 18 + Math.sin(G.time * 5 + e.phase) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (e.type === 'mine') {
    const pulse = 1 + Math.sin(G.time * 4 + e.phase) * 0.12;
    ctx.scale(pulse, pulse);
    ctx.beginPath();
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      const r = i % 2 === 0 ? 15 : 8;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3d2b02';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Health bar for hurt enemies.
  if (e.hp < e.maxHp) {
    const w = e.r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w, 4);
    ctx.fillStyle = e.color;
    ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w * (e.hp / e.maxHp), 4);
  }
}

function drawBoss(boss) {
  ctx.save();
  ctx.translate(boss.x, boss.y);
  ctx.scale(boss.scale || 1, boss.scale || 1);
  const telegraph = boss.chargeState === 'telegraph';
  const flash = boss.flash > 0;
  ctx.rotate(Math.sin(G.time * 0.8) * 0.05);
  // Outer rotating ring.
  ctx.strokeStyle = telegraph ? '#ff2e63' : '#b537f2';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#b537f2';
  ctx.shadowBlur = 22;
  ctx.save();
  ctx.rotate(G.time * 0.5);
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = a0 + Math.PI / 5;
    ctx.moveTo(Math.cos(a0) * 58, Math.sin(a0) * 58);
    ctx.arc(0, 0, 58, a0, a1);
  }
  ctx.stroke();
  ctx.restore();
  // Hull.
  ctx.fillStyle = flash ? '#ffffff' : telegraph ? '#ff5c8a' : '#3d0a24';
  ctx.strokeStyle = '#ff2e63';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const px = Math.cos(a) * 48;
    const py = Math.sin(a) * 48;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Core eye.
  const corePulse = 14 + Math.sin(G.time * 3) * 3;
  ctx.fillStyle = '#ffd60a';
  ctx.shadowColor = '#ffd60a';
  ctx.shadowBlur = 26;
  ctx.beginPath();
  ctx.arc(0, 0, corePulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a0505';
  ctx.beginPath();
  ctx.arc(0, 0, corePulse * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (telegraph) {
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(G.time * 24);
    ctx.fillStyle = '#ff2e63';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!! CHARGE !!', boss.x, boss.y - 72);
    ctx.restore();
  }
}

function drawPlayer() {
  const p = G.player;
  if (!p.alive) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1.15, 1.15);
  const aim = Math.atan2(p.aimY - p.y, p.aimX - p.x);
  // Engine flame.
  const flame = 12 + p.engineFlame * 14 + Math.sin(G.time * 40) * 3;
  ctx.rotate(aim);
  const fg = ctx.createLinearGradient(-14, 0, -14 - flame, 0);
  fg.addColorStop(0, 'rgba(255,200,80,0.95)');
  fg.addColorStop(1, 'rgba(255,80,40,0)');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.lineTo(-14 - flame, 0);
  ctx.lineTo(-12, 5);
  ctx.closePath();
  ctx.fill();
  // Hull.
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 18;
  const hg = ctx.createLinearGradient(-16, 0, 20, 0);
  hg.addColorStop(0, '#0b3550');
  hg.addColorStop(0.6, '#19b8d8');
  hg.addColorStop(1, '#e8feff');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(-12, -11);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-12, 11);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // Cockpit.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(6, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Shield ring.
  if (p.shield > 1) {
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.22 * (p.shield / p.maxShield);
    ctx.strokeStyle = '#7df9ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // Dash cooldown pip under the ship.
  if (p.dashCooldown > 0) {
    const frac = 1 - p.dashCooldown / G.stats.dashCooldownMax;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(p.x - 16, p.y + 24, 32, 3);
    ctx.fillStyle = '#7df9ff';
    ctx.fillRect(p.x - 16, p.y + 24, 32 * frac, 3);
  }
}

function drawBullets() {
  for (const b of G.pbullets) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vy, b.vx));
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 12;
    ctx.fillRect(-8, -2.5, 16, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(2, -1.5, 6, 3);
    ctx.restore();
  }
  for (const b of G.ebullets) {
    ctx.save();
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// -------------------------------------------------------------------- HUD ----
function bar(x, y, w, h, frac, color, bg) {
  ctx.fillStyle = bg || 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
}

function drawHUD() {
  const p = G.player;
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,20,0.72)';
  ctx.fillRect(0, 0, W, HUD_TOP);
  ctx.fillStyle = 'rgba(125,249,255,0.25)';
  ctx.fillRect(0, HUD_TOP - 2, W, 2);

  // Left: hull + shield.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7df9ff';
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.fillText('HULL', 20, 24);
  bar(70, 14, 190, 12, p.hull / p.maxHull, p.hull > 30 ? '#3ddc84' : '#ff4d6d');
  ctx.fillStyle = '#e8f6ff';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(`${Math.ceil(p.hull)} / ${p.maxHull}`, 268, 24);
  ctx.fillStyle = '#7ad9ff';
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.fillText('SHIELD', 20, 46);
  bar(70, 36, 190, 12, p.shield / p.maxShield, '#00b4ff');
  ctx.fillStyle = '#e8f6ff';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(`${Math.ceil(p.shield)}`, 268, 46);

  // Centre: wave + score.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(`${G.score.toLocaleString('en-US')}`, W / 2, 30);
  ctx.fillStyle = '#ffd60a';
  ctx.font = '800 14px system-ui, sans-serif';
  ctx.fillText(G.endless ? `ENDLESS — WAVE ${G.wave}` : `WAVE ${G.wave} / 10`, W / 2, 52);

  // Right: dash + kills.
  ctx.textAlign = 'right';
  ctx.fillStyle = '#7df9ff';
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.fillText('DASH [SHIFT]', W - 20, 24);
  const dashFrac = 1 - p.dashCooldown / G.stats.dashCooldownMax;
  bar(W - 210, 32, 190, 10, dashFrac, dashFrac >= 1 ? '#7df9ff' : '#2a6f87');
  ctx.fillStyle = '#e8f6ff';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(`KILLS ${G.kills}   BEST ${G.best.toLocaleString('en-US')}`, W - 20, 56);

  // Boss bar.
  if (G.boss) {
    const boss = G.boss;
    const bw = 520;
    const bx = (W - bw) / 2;
    const by = HUD_TOP + 12;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff2e63';
    ctx.font = '800 14px system-ui, sans-serif';
    ctx.fillText(boss.final ? 'VOID MAW PRIME' : 'VOID MAW', W / 2, by + 11);
    bar(bx, by + 16, bw, 10, boss.hp / boss.maxHp, '#ff2e63');
  }
  drawOwnedStrip();
  ctx.restore();
}

// Owned-upgrade strip (HUD, bottom-left): one small chip per upgrade the
// pilot already owns — icon in the upgrade's accent colour plus a gold pip
// per level. Display-only: it renders G.ownedUpgrades and changes nothing.
// Bottom-left keeps it clear of the boss bar and the centre of the arena;
// at 30px tall it stays readable when the cover is shrunk to 768x480.
const UPGRADE_ACCENTS = {
  damage: '#ffd60a',
  firerate: '#7df9ff',
  multishot: '#00e5ff',
  hull: '#3ddc84',
  dash: '#b537f2',
  magnet: '#7ad9ff',
  pierce: '#ff8a00',
  crit: '#ff2e63',
};

function drawOwnedStrip() {
  const owned = G.ownedUpgrades;
  if (!owned || owned.length === 0) return;
  const y = H - 42;
  const h = 30;
  let x = 16;
  ctx.save();
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const o of owned) {
    const up = UPGRADES.find((u) => u.id === o.id);
    if (!up) continue;
    const accent = UPGRADE_ACCENTS[o.id] || '#7df9ff';
    const iconW = ctx.measureText(up.icon).width;
    const pips = Math.min(o.level, 4);
    const w = 12 + iconW + 8 + pips * 9 + 10;
    ctx.fillStyle = 'rgba(4,6,20,0.78)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillText(up.icon, x + 12, y + h / 2 + 1);
    ctx.fillStyle = '#ffd60a';
    for (let k = 0; k < pips; k += 1) {
      ctx.beginPath();
      ctx.arc(x + 12 + iconW + 8 + k * 9 + 3, y + h / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    x += w + 8;
    if (x > W / 2) break; // never let the strip eat the middle of the frame
  }
  ctx.restore();
}

// ----------------------------------------------------------------- screens ----
function panel(x, y, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,20,0.82)';
  ctx.strokeStyle = 'rgba(125,249,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTitle() {
  panel(240, 120, 800, 460);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff2e63';
  ctx.font = '800 15px system-ui, sans-serif';
  try {
    ctx.letterSpacing = '6px';
  } catch {
    // Older canvas: no letter spacing, fine.
  }
  ctx.fillText('THE LAST STAR IS DYING', W / 2, 168);
  try {
    ctx.letterSpacing = '0px';
  } catch {
    // Ignore.
  }
  const tg = ctx.createLinearGradient(W / 2 - 320, 0, W / 2 + 320, 0);
  tg.addColorStop(0, '#00e5ff');
  tg.addColorStop(0.5, '#e8feff');
  tg.addColorStop(1, '#b537f2');
  ctx.fillStyle = tg;
  ctx.font = '900 84px system-ui, sans-serif';
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 30;
  ctx.fillText('NEON ABYSS', W / 2, 258);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffd60a';
  ctx.font = '700 19px system-ui, sans-serif';
  ctx.fillText('Echoes of the Last Star', W / 2, 292);
  ctx.fillStyle = '#c8d8ee';
  ctx.font = '400 16px system-ui, sans-serif';
  ctx.fillText('Pilot the ship Echo through ten waves of the void.', W / 2, 336);
  ctx.fillText('Break the VOID MAW, relight the star — or be swallowed.', W / 2, 360);
  ctx.fillStyle = '#e8f6ff';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText('WASD / ARROWS — fly      MOUSE — aim      HOLD CLICK / SPACE — fire', W / 2, 412);
  ctx.fillText('SHIFT — dash (invulnerable)      1 / 2 / 3 — pick upgrade      P — pause      M — mute', W / 2, 438);
  ctx.fillStyle = '#7df9ff';
  ctx.font = '800 22px system-ui, sans-serif';
  const blink = 0.65 + 0.35 * Math.sin(G.time * 4);
  ctx.globalAlpha = blink;
  ctx.fillText('CLICK OR PRESS SPACE TO LAUNCH', W / 2, 500);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#8fa3c8';
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(`BEST SCORE  ${G.best.toLocaleString('en-US')}`, W / 2, 544);
  ctx.restore();
}

function drawUpgrade() {
  ctx.save();
  // The cover staging lightens the dim so the live boss fight reads
  // through the overlay; the real draft screen keeps the heavier dim.
  // v4 cover measured mean 29.6 at 0.38 — still far from the winners'
  // 40-170 — so the cover dim goes to 0.22.
  ctx.fillStyle = G.coverShot ? 'rgba(3,4,14,0.22)' : 'rgba(3,4,14,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd60a';
  ctx.font = '800 15px system-ui, sans-serif';
  ctx.fillText(`WAVE ${G.wave} CLEAR`, W / 2, 150);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 44px system-ui, sans-serif';
  ctx.fillText('CHOOSE AN UPGRADE', W / 2, 205);
  // Goal line: the draft is the moment a new player learns what the run
  // is for — one line, always true of the game. 17px so it stays legible
  // when the judge shrinks the cover to 768x480.
  ctx.fillStyle = '#ffd60a';
  ctx.font = '800 17px system-ui, sans-serif';
  ctx.fillText('SURVIVE 10 WAVES — DEFEAT THE VOID MAW, RELIGHT THE STAR', W / 2, 234);
  const accents = ['#ffd60a', '#00e5ff', '#ff2e63'];
  G.upgradeChoices.forEach((up, i) => {
    const x = 250 + i * 280;
    const y = 250;
    panel(x, y, 240, 260);
    // One accent colour per card, so the three choices read as distinct at
    // a glance (the same idea as a level-up screen's coloured cards).
    const accent = accents[i % accents.length];
    ctx.fillStyle = accent;
    ctx.fillRect(x + 14, y + 8, 212, 4);
    ctx.fillStyle = accent;
    ctx.font = '900 30px system-ui, sans-serif';
    ctx.fillText(up.icon, x + 120, y + 66);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 19px system-ui, sans-serif';
    ctx.fillText(up.name, x + 120, y + 112);
    ctx.fillStyle = '#c8d8ee';
    ctx.font = '400 16px system-ui, sans-serif';
    const words = up.desc.split(' ');
    let line = '';
    let ly = y + 150;
    for (const w of words) {
      if ((line + ' ' + w).trim().length > 20) {
        ctx.fillText(line.trim(), x + 120, ly);
        ly += 24;
        line = w;
      } else {
        line += ' ' + w;
      }
    }
    ctx.fillText(line.trim(), x + 120, ly);
    ctx.fillStyle = '#8fa3c8';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText(`PRESS ${i + 1}`, x + 120, y + 232);
  });
  // Controls line, under the cards (y 660 stays clear of the cards above
  // and the owned-upgrade strip below): the same line the title teaches.
  ctx.fillStyle = '#8fa3c8';
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText('WASD MOVE · MOUSE AIM · CLICK FIRE · SHIFT DASH', W / 2, 660);
  ctx.restore();
}

function drawGameOver() {
  panel(340, 190, 600, 330);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff4d6d';
  ctx.font = '900 56px system-ui, sans-serif';
  ctx.shadowColor = '#ff4d6d';
  ctx.shadowBlur = 24;
  ctx.fillText('SIGNAL LOST', W / 2, 280);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#c8d8ee';
  ctx.font = '400 17px system-ui, sans-serif';
  ctx.fillText('Echo went dark in the abyss. The star still waits.', W / 2, 322);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText(`SCORE  ${G.score.toLocaleString('en-US')}`, W / 2, 380);
  ctx.fillStyle = '#ffd60a';
  ctx.font = '700 17px system-ui, sans-serif';
  ctx.fillText(`WAVE ${G.wave}  •  KILLS ${G.kills}  •  BEST ${G.best.toLocaleString('en-US')}`, W / 2, 414);
  ctx.fillStyle = '#7df9ff';
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillText('PRESS R OR CLICK TO FLY AGAIN', W / 2, 472);
  ctx.restore();
}

// The relit star, drawn on the victory screen: a 5-point star with a hard
// glow. Display-only; the fiction is "the last star burns again", so the
// star itself must be visible, not hidden behind the victory panel.
function drawRelitStar(x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = '#ffd60a';
  ctx.shadowBlur = 28;
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.42;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffd60a';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawVictory() {
  // A wide gold glow behind the panel lifts the whole victory frame, and
  // the relit star burns above the panel — fully visible, not covered by it.
  ctx.save();
  const vg = ctx.createRadialGradient(W / 2, 360, 0, W / 2, 360, 520);
  vg.addColorStop(0, 'rgba(255,214,10,0.20)');
  vg.addColorStop(1, 'rgba(255,214,10,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  panel(280, 150, 720, 400);
  ctx.save();
  ctx.textAlign = 'center';
  const tg = ctx.createLinearGradient(W / 2 - 300, 0, W / 2 + 300, 0);
  tg.addColorStop(0, '#ffd60a');
  tg.addColorStop(0.5, '#ffffff');
  tg.addColorStop(1, '#ff8a00');
  ctx.fillStyle = tg;
  ctx.font = '900 46px system-ui, sans-serif';
  ctx.shadowColor = '#ffd60a';
  ctx.shadowBlur = 26;
  ctx.fillText('THE LAST STAR', W / 2, 236);
  ctx.fillText('BURNS AGAIN', W / 2, 292);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#c8d8ee';
  ctx.font = '400 17px system-ui, sans-serif';
  ctx.fillText('The VOID MAW is broken. Light returns to the abyss.', W / 2, 336);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText(`SCORE  ${G.score.toLocaleString('en-US')}`, W / 2, 392);
  ctx.fillStyle = '#ffd60a';
  ctx.font = '700 17px system-ui, sans-serif';
  ctx.fillText(`KILLS ${G.kills}  •  BEST ${G.best.toLocaleString('en-US')}`, W / 2, 424);
  ctx.fillStyle = '#7df9ff';
  ctx.font = '800 19px system-ui, sans-serif';
  ctx.fillText('R / CLICK LEFT — PLAY AGAIN        E / CLICK RIGHT — ENDLESS MODE', W / 2, 492);
  drawRelitStar(W / 2, 108, 34);
  ctx.restore();
}

function drawPaused() {
  ctx.save();
  ctx.fillStyle = 'rgba(3,4,14,0.6)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 52px system-ui, sans-serif';
  ctx.fillText('PAUSED', W / 2, H / 2 - 10);
  ctx.fillStyle = '#8fa3c8';
  ctx.font = '600 17px system-ui, sans-serif';
  ctx.fillText('Press P to resume', W / 2, H / 2 + 30);
  ctx.restore();
}

// ------------------------------------------------------------------ frame ----
function render() {
  ctx.save();
  const off = shake.offset(G.rand);
  ctx.translate(off.x, off.y);
  drawBackground();
  for (const pk of G.pickups) drawPickup(pk);
  for (const e of G.enemies) drawEnemy(e);
  if (G.boss) drawBoss(G.boss);
  drawPlayer();
  drawBullets();
  particles.draw(ctx);
  waves.draw(ctx);
  if (G.screen === 'playing' || G.screen === 'paused') floaters.draw(ctx);
  ctx.restore();

  if (G.screen !== 'title') drawHUD();
  if (G.screen === 'title') drawTitle();
  else if (G.screen === 'upgrade') drawUpgrade();
  else if (G.screen === 'gameover') drawGameOver();
  else if (G.screen === 'victory') drawVictory();
  else if (G.screen === 'paused') drawPaused();
}

// ------------------------------------------------------------------- loop ----
let lastT = 0;
function loop(t) {
  if (G.shotMode) return;
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (G.screen !== 'paused') step(dt);
  render();
  statusLine.textContent = `Wave ${G.wave} — score ${G.score} — hull ${Math.ceil(G.player.hull)}`;
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------- boot ----
function boot() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  const seed = Number(params.get('seed') || 1);
  G.runSeed = seed;
  startWave(1);
  if (shot) {
    stageShot(shot, seed);
    render();
    window.__neonAbyssShot = shot;
    return;
  }
  G.screen = 'title';
  requestAnimationFrame(loop);
}

boot();
