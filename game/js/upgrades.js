// NEON ABYSS upgrades: after every cleared wave the pilot picks one of three
// cards. Each upgrade mutates the pilot's combat stats (held in main.js) and
// is described in one line the card can show. The pool is small on purpose:
// every card is always useful, so the choice is about build, not about luck.

export const UPGRADES = [
  {
    id: 'damage',
    icon: 'DMG',
    name: 'OVERCHARGE ROUNDS',
    desc: '+25% bullet damage',
    apply: (s) => {
      s.damage *= 1.25;
    },
  },
  {
    id: 'firerate',
    icon: 'RPM',
    name: 'RAPID CYCLER',
    desc: '+20% fire rate',
    apply: (s) => {
      s.fireRate *= 1.2;
    },
  },
  {
    id: 'multishot',
    icon: 'x3',
    name: 'SPLIT CANNON',
    desc: '+1 projectile per shot',
    apply: (s) => {
      s.projectiles += 1;
    },
  },
  {
    id: 'hull',
    icon: 'HULL',
    name: 'REINFORCED HULL',
    desc: '+25 max hull, repair 25',
    apply: (s) => {
      s.maxHull += 25;
    },
  },
  {
    id: 'dash',
    icon: 'DASH',
    name: 'PHASE DASH',
    desc: 'Dash recharges 30% faster',
    apply: (s) => {
      s.dashCooldownMax *= 0.7;
    },
  },
  {
    id: 'magnet',
    icon: 'MAG',
    name: 'TRACTOR WEB',
    desc: '+60% pickup magnet radius',
    apply: (s) => {
      s.magnet *= 1.6;
    },
  },
  {
    id: 'pierce',
    icon: 'PIERCE',
    name: 'LANCE ROUNDS',
    desc: 'Bullets pierce +1 enemy',
    apply: (s) => {
      s.pierce += 1;
    },
  },
  {
    id: 'crit',
    icon: 'CRIT',
    name: 'DEADEYE CORE',
    desc: '+10% critical chance (2x damage)',
    apply: (s) => {
      s.crit += 0.1;
    },
  },
];

// Draw three distinct cards. `taken` is the set of ids already owned this run
// (multishot and pierce may repeat; the rest may appear again too — every
// card stays useful, so no exclusion is needed).
export function rollUpgrades(rand) {
  const pool = UPGRADES.slice();
  const picks = [];
  while (picks.length < 3 && pool.length > 0) {
    const i = Math.floor(rand() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  return picks;
}
