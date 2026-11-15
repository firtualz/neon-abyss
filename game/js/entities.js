// NEON ABYSS entities: the player ship Echo, five enemy types, the VOID MAW
// boss, bullets and pickups. Factories only build plain objects; the movement
// and attack behaviour lives in the update functions below, which take a small
// `world` handle so this file never reaches for globals.

export function makePlayer(x, y) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    r: 14,
    hull: 100,
    maxHull: 100,
    shield: 50,
    maxShield: 50,
    shieldRegenAt: 0,
    aimX: x + 100,
    aimY: y,
    fireCooldown: 0,
    dashCooldown: 0,
    dashTime: 0,
    dashDirX: 1,
    dashDirY: 0,
    invulnUntil: 0,
    engineFlame: 0,
    alive: true,
  };
}

// Base stats per enemy type. Wave scaling is applied in spawnEnemy.
let nextEnemyId = 1;

export const ENEMY_TYPES = {
  drone: { r: 13, hp: 20, speed: 125, dmg: 10, score: 50, color: '#ff4d6d' },
  stinger: { r: 13, hp: 26, speed: 95, dmg: 8, score: 80, color: '#ff8a00' },
  splitter: { r: 17, hp: 34, speed: 82, dmg: 12, score: 90, color: '#b537f2' },
  weaver: { r: 12, hp: 22, speed: 155, dmg: 10, score: 80, color: '#00e5c7' },
  mine: { r: 12, hp: 16, speed: 42, dmg: 18, score: 70, color: '#ffd60a' },
  mini: { r: 8, hp: 8, speed: 175, dmg: 8, score: 25, color: '#d89bff' },
};

export function spawnEnemy(type, x, y, wave) {
  const base = ENEMY_TYPES[type];
  const scale = 1 + (wave - 1) * 0.09;
  return {
    // A stable per-enemy id (0 is the boss): damage numbers use it to spread
    // sideways, so one target's numbers never print on another's.
    id: nextEnemyId++,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    r: base.r,
    hp: Math.round(base.hp * scale),
    maxHp: Math.round(base.hp * scale),
    speed: base.speed * (1 + Math.min(0.35, (wave - 1) * 0.02)),
    dmg: base.dmg,
    score: base.score,
    color: base.color,
    fireTimer: 1.2 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,
    touchCooldown: 0,
    flash: 0,
    dead: false,
  };
}

export function makeBoss(wave) {
  const final = wave >= 10;
  const hp = final ? 2800 : 1600;
  return {
    id: 0,
    type: 'boss',
    x: 640,
    y: 150,
    vx: 0,
    vy: 0,
    r: 48,
    hp,
    maxHp: hp,
    speed: 55,
    dmg: 20,
    score: final ? 3000 : 1500,
    color: '#ff2e63',
    final,
    flash: 0,
    dead: false,
    attackTimer: 2.2,
    spreadTimer: 1.1,
    summonTimer: 7,
    chargeTimer: 9,
    chargeState: 'idle', // idle | telegraph | charging
    chargeTime: 0,
    chargeDirX: 0,
    chargeDirY: 0,
    anchorX: 640,
    anchorY: 150,
    // Staging-only presentation: scale multiplies the drawn sprite (the
    // hitbox radius stays r), anchorLock pins the drift anchor to one spot
    // so a staged boss sits in the middle of the frame. Real play leaves
    // both at their defaults (scale 1, no lock).
    scale: 1,
    anchorLock: null,
    touchCooldown: 0,
  };
}

export function makeBullet(x, y, vx, vy, dmg, friendly, color, pierce) {
  return {
    x,
    y,
    vx,
    vy,
    dmg,
    friendly: !!friendly,
    color: color || (friendly ? '#7df9ff' : '#ff5c5c'),
    r: friendly ? 4 : 6,
    pierce: pierce || 0,
    dead: false,
    life: 3,
  };
}

export function makePickup(x, y, kind) {
  return {
    x,
    y,
    kind, // 'shard' | 'repair'
    r: 9,
    vx: (Math.random() - 0.5) * 30,
    vy: 26,
    life: 14,
    dead: false,
  };
}

function distToPlayer(e, player) {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  return { dx, dy, d: Math.hypot(dx, dy) || 1 };
}

// One behaviour step for a normal enemy. `world` gives it the player, the
// clock, a seeded-or-live rng, and callbacks to fire bullets / spawn minis.
export function updateEnemy(e, world, dt) {
  const { player } = world;
  const { dx, dy, d } = distToPlayer(e, player);
  const nx = dx / d;
  const ny = dy / d;
  e.flash = Math.max(0, e.flash - dt);
  e.touchCooldown = Math.max(0, e.touchCooldown - dt);

  if (e.type === 'drone' || e.type === 'mini') {
    e.vx += nx * e.speed * 3.2 * dt;
    e.vy += ny * e.speed * 3.2 * dt;
  } else if (e.type === 'stinger') {
    if (d > 300) {
      e.vx += nx * e.speed * 3 * dt;
      e.vy += ny * e.speed * 3 * dt;
    } else if (d < 210) {
      e.vx -= nx * e.speed * 2.4 * dt;
      e.vy -= ny * e.speed * 2.4 * dt;
    } else {
      e.vx *= 1 - 3 * dt;
      e.vy *= 1 - 3 * dt;
    }
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && d < 560) {
      e.fireTimer = 2.1 + world.rand() * 0.7;
      const speed = 250;
      world.fireEnemyBullet(e.x, e.y, nx * speed, ny * speed, e.dmg, '#ffb35c');
    }
  } else if (e.type === 'splitter') {
    e.vx += nx * e.speed * 2.6 * dt;
    e.vy += ny * e.speed * 2.6 * dt;
  } else if (e.type === 'weaver') {
    e.phase += dt * 3.4;
    const px = -ny;
    const py = nx;
    e.vx = nx * e.speed + px * Math.sin(e.phase) * 150;
    e.vy = ny * e.speed + py * Math.sin(e.phase) * 150;
  } else if (e.type === 'mine') {
    e.vx += nx * e.speed * 1.4 * dt;
    e.vy += ny * e.speed * 1.4 * dt;
    e.phase += dt * 2;
  }

  const maxV = e.speed * 1.25;
  const v = Math.hypot(e.vx, e.vy);
  if (v > maxV) {
    e.vx = (e.vx / v) * maxV;
    e.vy = (e.vy / v) * maxV;
  }
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  e.x = Math.max(e.r, Math.min(1280 - e.r, e.x));
  e.y = Math.max(76 + e.r, Math.min(720 - e.r, e.y));
}

// One behaviour step for the VOID MAW boss. Phase 2 (hp < 50%) attacks faster
// and fires denser radial bursts.
export function updateBoss(boss, world, dt) {
  const { player } = world;
  const phase2 = boss.hp < boss.maxHp * 0.5;
  const haste = phase2 ? 0.62 : 1;
  boss.flash = Math.max(0, boss.flash - dt);
  boss.touchCooldown = Math.max(0, boss.touchCooldown - dt);

  if (boss.chargeState === 'telegraph') {
    boss.chargeTime -= dt;
    boss.x += Math.sin(world.time * 30) * 14 * dt;
    if (boss.chargeTime <= 0) {
      boss.chargeState = 'charging';
      boss.chargeTime = 0.85;
      const dx = player.x - boss.x;
      const dy = player.y - boss.y;
      const d = Math.hypot(dx, dy) || 1;
      boss.chargeDirX = dx / d;
      boss.chargeDirY = dy / d;
      world.shake(9);
    }
    return;
  }
  if (boss.chargeState === 'charging') {
    boss.chargeTime -= dt;
    boss.x += boss.chargeDirX * 520 * dt;
    boss.y += boss.chargeDirY * 520 * dt;
    boss.x = Math.max(boss.r, Math.min(1280 - boss.r, boss.x));
    boss.y = Math.max(76 + boss.r, Math.min(720 - boss.r, boss.y));
    if (boss.chargeTime <= 0) {
      boss.chargeState = 'idle';
      boss.chargeTimer = 8 * haste;
    }
    return;
  }

  // Drift back toward its anchor above the player — or toward a locked
  // staging anchor when one is set.
  if (boss.anchorLock) {
    boss.anchorX = boss.anchorLock.x;
    boss.anchorY = boss.anchorLock.y;
  } else {
    boss.anchorX = 640 + Math.sin(world.time * 0.35) * 320;
    boss.anchorY = 150 + Math.sin(world.time * 0.5) * 42;
  }
  boss.x += (boss.anchorX - boss.x) * 0.55 * dt;
  boss.y += (boss.anchorY - boss.y) * 0.55 * dt;

  // Radial burst.
  boss.attackTimer -= dt;
  if (boss.attackTimer <= 0) {
    boss.attackTimer = (phase2 ? 2.4 : 3.4) * haste;
    const count = phase2 ? 18 : 13;
    const offset = world.rand() * Math.PI * 2;
    for (let i = 0; i < count; i += 1) {
      const a = offset + (i / count) * Math.PI * 2;
      world.fireEnemyBullet(boss.x, boss.y, Math.cos(a) * 205, Math.sin(a) * 205, 12, '#ff5c8a');
    }
    world.onBossBurst();
  }

  // Aimed three-shot spread.
  boss.spreadTimer -= dt;
  if (boss.spreadTimer <= 0) {
    boss.spreadTimer = 1.5 * haste;
    const dx = player.x - boss.x;
    const dy = player.y - boss.y;
    const d = Math.hypot(dx, dy) || 1;
    const base = Math.atan2(dy, dx);
    for (const off of [-0.22, 0, 0.22]) {
      const a = base + off;
      world.fireEnemyBullet(boss.x, boss.y, Math.cos(a) * 300, Math.sin(a) * 300, 10, '#ffb35c');
    }
  }

  // Summon drones.
  boss.summonTimer -= dt;
  if (boss.summonTimer <= 0) {
    boss.summonTimer = 8.5 * haste;
    world.summonDrones(boss.x, boss.y);
  }

  // Charge attack.
  boss.chargeTimer -= dt;
  if (boss.chargeTimer <= 0) {
    boss.chargeState = 'telegraph';
    boss.chargeTime = 0.85;
    world.onBossTelegraph();
  }
}
