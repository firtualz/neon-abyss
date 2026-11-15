// NEON ABYSS wave director: what spawns, in what order, on each wave.
// Waves 5 and 10 are boss waves (VOID MAW, then the final VOID MAW PRIME);
// every other wave is a mixed pack whose size and mix grow with the wave.
// After victory the game continues in endless mode: waves keep scaling.

export function isBossWave(n) {
  return n === 5 || n === 10;
}

// Build the spawn queue for a wave: an array of enemy type names, in the
// order they enter the arena. Boss waves return an empty queue (the boss is
// spawned directly) plus a small drone trickle while the boss lives.
export function buildWaveQueue(n, rand) {
  if (isBossWave(n)) return [];
  const queue = [];
  const add = (type, count) => {
    for (let i = 0; i < count; i += 1) queue.push(type);
  };
  add('drone', 5 + n * 2);
  add('weaver', n >= 2 ? 3 + n : 0);
  add('stinger', n >= 3 ? 2 + Math.floor(n / 2) : 0);
  add('splitter', n >= 4 ? 1 + Math.floor(n / 2) : 0);
  add('mine', n >= 6 ? 2 + Math.floor(n / 3) : 0);
  // Shuffle with the wave's rng so the order is never a fixed line.
  for (let i = queue.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = queue[i];
    queue[i] = queue[j];
    queue[j] = tmp;
  }
  return queue;
}

// Seconds between spawns: faster as waves climb, never below the floor.
export function spawnInterval(n) {
  return Math.max(0.4, 1.05 - n * 0.08);
}

// Where a new enemy enters: a random point just outside the arena edge.
export function spawnPoint(rand) {
  const edge = Math.floor(rand() * 4);
  const m = 30;
  if (edge === 0) return { x: m + rand() * (1280 - m * 2), y: 76 + m };
  if (edge === 1) return { x: m + rand() * (1280 - m * 2), y: 720 - m };
  if (edge === 2) return { x: m, y: 90 + rand() * 600 };
  return { x: 1280 - m, y: 90 + rand() * 600 };
}

// Wave clear bonus: a flat reward plus a per-wave step.
export function waveClearBonus(n) {
  return 100 * n;
}
