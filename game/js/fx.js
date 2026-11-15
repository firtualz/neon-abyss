// LUMENFALL juice: particles, floating score text, shockwave rings and screen
// shake. Pure canvas drawing, no assets. Everything here is deterministic
// given the same calls in the same order.

// A tiny seeded RNG so staged screenshots reproduce exactly.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ParticleBurst {
  constructor() {
    this.items = [];
  }

  burst(x, y, color, count, speed, rand) {
    const rng = rand || Math.random;
    for (let i = 0; i < count; i += 1) {
      const angle = rng() * Math.PI * 2;
      const vel = speed * (0.35 + rng() * 0.65);
      this.items.push({
        x,
        y,
        vx: Math.cos(angle) * vel,
        vy: Math.sin(angle) * vel - 40,
        life: 0.55 + rng() * 0.5,
        age: 0,
        size: 2 + rng() * 3.5,
        color,
      });
    }
  }

  trail(x, y, color) {
    this.items.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      life: 0.28,
      age: 0,
      size: 2.5,
      color,
    });
  }

  confetti(width, rand) {
    const rng = rand || Math.random;
    const colors = ['#ff3b6b', '#ff8a00', '#ffd60a', '#3ddc84', '#00b4ff', '#b537f2'];
    for (let i = 0; i < 130; i += 1) {
      this.items.push({
        x: rng() * width,
        y: -20 - rng() * 160,
        vx: (rng() - 0.5) * 60,
        vy: 90 + rng() * 160,
        life: 2.2 + rng(),
        age: 0,
        size: 3 + rng() * 4,
        color: colors[i % colors.length],
      });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const p = this.items[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.items.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.vx *= 1 - 1.6 * dt;
    }
  }

  draw(ctx) {
    for (const p of this.items) {
      const alpha = 1 - p.age / p.life;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

export class FloatingTexts {
  constructor() {
    this.items = [];
  }

  // add(x, y, text, color, big, mergeKey): hits on one target within a short
  // window fold into a single growing number instead of a pile of small ones.
  // mergeKey is the target itself (or a stable string tag): a numeric hit on
  // a target with a live floater adds to it while that floater is still in
  // its folding window (half a second of game time), then a fresh floater
  // starts at a jittered spot so the feed stays readable. A non-numeric
  // label with a key (like CRIT) just refreshes in place.
  add(x, y, text, color, big, mergeKey) {
    if (mergeKey !== undefined && mergeKey !== null) {
      for (const f of this.items) {
        if (f.mergeKey === mergeKey && (f.foldAge || 0) < 0.5) {
          const amount = Number(text);
          if (Number.isFinite(amount) && f.merges < 12) {
            f.amount += amount;
            f.text = String(Math.round(f.amount));
            f.x = (f.x + x) / 2;
            f.y = Math.min(f.y, y);
            f.age = 0;
            f.life = 0.75;
            f.merges += 1;
          } else if (!Number.isFinite(amount)) {
            f.x = x;
            f.y = y;
            f.age = 0;
          } else {
            // This floater already folded in its share: keep looking for a
            // younger one for this target instead of starting a pile.
            continue;
          }
          return;
        }
      }
      // Spread one target's numbers sideways from another's: the seed is
      // the target's own id (0 for the boss), so a splitter and its minis
      // no longer print on top of each other.
      const seed = mergeKey && typeof mergeKey === 'object' && Number.isFinite(mergeKey.id) ? mergeKey.id : 0;
      const jitter = ((seed * 37) % 44) - 22;
      const numeric = Number.isFinite(Number(text));
      this.items.push({ x: x + jitter, y, text, color, big: !!big, age: 0, foldAge: 0, life: numeric ? 0.75 : (big ? 1.1 : 0.8), mergeKey, amount: Number(text) || 0, merges: 0 });
      return;
    }
    this.items.push({ x, y, text, color, big: !!big, age: 0, foldAge: 0, life: big ? 1.1 : 0.8, mergeKey: null, amount: 0, merges: 0 });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const f = this.items[i];
      f.age += dt;
      f.foldAge = (f.foldAge || 0) + dt;
      f.y -= 46 * dt;
      if (f.age >= f.life) this.items.splice(i, 1);
    }
  }

  draw(ctx) {
    ctx.textAlign = 'center';
    for (const f of this.items) {
      const alpha = 1 - f.age / f.life;
      ctx.globalAlpha = alpha;
      ctx.font = f.big ? '800 30px system-ui, sans-serif' : '800 20px system-ui, sans-serif';
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 12;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

export class Shockwaves {
  constructor() {
    this.items = [];
  }

  add(x, y, color) {
    this.items.push({ x, y, color, age: 0, life: 0.45, radius: 10 });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const r = this.items[i];
      r.age += dt;
      r.radius = 10 + (r.age / r.life) * 74;
      if (r.age >= r.life) this.items.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const r of this.items) {
      const alpha = 1 - r.age / r.life;
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.shadowColor = r.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

export class ScreenShake {
  constructor() {
    this.strength = 0;
  }

  add(amount) {
    this.strength = Math.min(16, this.strength + amount);
  }

  update(dt) {
    this.strength = Math.max(0, this.strength - 34 * dt);
  }

  offset(rand) {
    if (this.strength <= 0.2) return { x: 0, y: 0 };
    const rng = rand || Math.random;
    return {
      x: (rng() - 0.5) * 2 * this.strength,
      y: (rng() - 0.5) * 2 * this.strength,
    };
  }
}

// A slow parallax starfield for the backdrop. Stars are placed once per level
// from a seed so the background is stable frame to frame.
export class Starfield {
  constructor(width, height, seed) {
    const rand = mulberry32(seed || 7);
    this.stars = [];
    for (let i = 0; i < 190; i += 1) {
      this.stars.push({
        x: rand() * width,
        y: rand() * height,
        size: 0.6 + rand() * 1.8,
        depth: 0.25 + rand() * 0.75,
        twinkle: rand() * Math.PI * 2,
      });
    }
  }

  draw(ctx, time, width, height) {
    for (const s of this.stars) {
      const tw = 0.45 + 0.55 * Math.sin(time * 1.4 + s.twinkle);
      ctx.globalAlpha = tw * s.depth;
      ctx.fillStyle = '#cfe8ff';
      ctx.fillRect(s.x, (s.y + time * 6 * s.depth) % height, s.size, s.size);
    }
    ctx.globalAlpha = 1;
  }
}
