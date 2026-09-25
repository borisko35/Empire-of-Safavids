// Проверка расстановки домов: минимальные дистанции до занятых зон города.
// Дома: кольцо r=72 (interiors.ts SPOTS). Стена/башни: r=116.
const CITY = { x: 34, z: 26, radius: 116 };
const gateAngle = Math.atan2(-CITY.z, -CITY.x);

const occupied = [
  { n: 'mosque', x: 0, z: -8, r: 13.5 },
  { n: 'fountain', x: 6, z: 6, r: 5.5 },
];
for (let i = 0; i < 7; i++) { // market stalls
  const a = Math.PI * 0.6 + (i / 7) * Math.PI * 0.8;
  occupied.push({ n: `market${i}`, x: Math.cos(a) * 20, z: -8 + Math.sin(a) * 20, r: 2.6 });
}
for (let i = 1; i <= 5; i++) { // street stalls
  const t = -i * 7.5;
  occupied.push({ n: `street${i}`, x: Math.cos(gateAngle) * t * 0.4, z: Math.sin(gateAngle) * t * 0.4 + 26, r: 5 });
}
for (const [x, z] of [[-8, 10], [20, 16], [-24, -6], [12, -2], [16, -10], [-14, -14], [-4, 22], [6, -20], [26, 6], [2, -26]]) {
  occupied.push({ n: `npc${x},${z}`, x, z, r: 2 });
}
for (let k = 0; k < 8; k++) { // wall towers
  const a = k * Math.PI / 4;
  occupied.push({ n: `tower${k}`, x: Math.cos(a) * 116, z: Math.sin(a) * 116, r: 4 });
}
occupied.push({ n: 'gate', x: Math.cos(gateAngle) * 116, z: Math.sin(gateAngle) * 116, r: 9 });

function check(spots, houseR, label) {
  console.log(`--- ${label} (houseR=${houseR}) ---`);
  let bad = 0;
  for (const s of spots) {
    let best = null;
    for (const o of occupied) {
      const d = Math.hypot(s.lx - o.x, s.lz - o.z) - o.r - houseR;
      if (!best || d < best.d) best = { d, o: o.n };
    }
    for (const t of spots) {
      if (t === s) continue;
      const d = Math.hypot(s.lx - t.lx, s.lz - t.lz) - houseR * 2;
      if (d < best.d) best = { d, o: `house:${t.id}` };
    }
    const dw = 116 - Math.hypot(s.lx, s.lz) - houseR;
    if (dw < best.d) best = { d: dw, o: 'wall' };
    const flag = best.d < 3 ? '  <-- STUCK' : '';
    if (best.d < 3) bad++;
    console.log(`${s.id}: gap ${best.d.toFixed(1)} vs ${best.o}${flag}`);
  }
  console.log(bad ? `BAD: ${bad}` : 'ALL CLEAR');
}

// NB: процедурные дома (seed 7, r 18-96) избегают этих точек через placed[] в buildCity.
check(
  [
    { id: 'stable', lx: -18.6, lz: -69.5 },
    { id: 'barracks', lx: 36.0, lz: -62.4 },
    { id: 'workshop', lx: 67.7, lz: -24.6 },
    { id: 'tavern', lx: 67.7, lz: 24.6 },
    { id: 'observatory', lx: 24.6, lz: 67.7 },
    { id: 'science', lx: -65.2, lz: 30.4 },
  ],
  6, 'new ring r=72'
);
