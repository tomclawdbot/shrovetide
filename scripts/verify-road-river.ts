/**
 * One-off check: no road centerline sample should fall inside the river
 * unless it's on a bridge deck. Run: node --import tsx scripts/verify-road-river.ts
 */
import { ASHBOURNE_TOWN, isInRiver, isOnBridge } from '../sim/maps.ts';

const map = ASHBOURNE_TOWN;
let violations = 0;

for (const road of map.roads) {
  for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i]!;
    const b = road.points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / 4));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (isInRiver(p, map) && !isOnBridge(p, map)) {
        violations++;
        if (violations <= 20) {
          console.log(
            `VIOLATION road(${road.kind}, w=${road.width}) seg ${i}->${i + 1} t=${t.toFixed(2)} p=(${p.x.toFixed(1)},${p.y.toFixed(1)})`,
          );
        }
      }
    }
  }
}

console.log(`\nTotal violating samples: ${violations}`);
process.exit(violations > 0 ? 1 : 0);
