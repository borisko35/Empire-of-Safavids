// Проверка HDRI-окружения числами, до всякого рендеринга.
//
// Карта требует «проверку читаемости силуэтов в бою». Это про яркости, а не
// про вызовы WebGL, поэтому проверка живёт здесь и считает то, что считает
// сам модуль: тот же buildEquirect, те же стили.
//
// ЧТО ЗДЕСЬ ВАЖНО. Пороги НЕ ВЫДУМАНЫ: сначала печатаются измеренные
// значения, и только потом ставится проверка. Порог, взятый «на глаз», был бы
// ещё одной проверкой, которая ничего не значит.
//
// ЗАПУСК: из client/ →  npx tsx tools/check-sky-environment.ts
import {
  ISFAHAN_DESERT,
  buildEquirect,
  equirectStats,
  type SkyState,
} from '../src/app/game3d/skyEnvironmentMath';

type Vec3 = [number, number, number];

const солнце = (высота: number, азимут = 0): Vec3 => {
  const горизонтальный = Math.sqrt(Math.max(0, 1 - высота * высота));
  return [горизонтальный * Math.cos(азимут), высота, горизонтальный * Math.sin(азимут)];
};

const нормализовать = (v: Vec3): Vec3 => {
  const d = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / d, v[1] / d, v[2] / d];
};

const состояние = (высота: number, ночь: number, пасмурность: number, азимут = 0): SkyState => {
  const s = солнце(высота, азимут);
  const m = нормализовать([-s[0], -s[1], -s[2]]);
  return { sun: s, moon: m, sunHeight: высота, night: ночь, overcast: пасмурность };
};

const СЛУЧАИ = [
  ['полдень, ясно', состояние(0.95, 0, 0)],
  ['полдень, пасмурно', состояние(0.95, 0, 0.9)],
  ['закат', состояние(0.12, 0.35, 0)],
  ['сумерки', состояние(-0.05, 0.75, 0.1)],
  ['ночь', состояние(-0.5, 1, 0)],
  ['полдень, гроза', состояние(0.95, 0, 1)],
  ['рассвет', состояние(0.2, 0.2, 0, 1.2)],
] as const;

console.log('СТИЛЬ: ' + ISFAHAN_DESERT.name);
console.log('');
console.log('момент            небо     песок    пик     небо-без-солнца  пик/небо  небо/песок');
for (const [имя, состояниеСейчас] of СЛУЧАИ) {
  const s = equirectStats(buildEquirect(ISFAHAN_DESERT, состояниеСейчас));
  console.log(
    `${имя.padEnd(16)} ${s.sky.toFixed(3).padStart(6)} ${s.ground.toFixed(3).padStart(8)}`
    + ` ${s.peak.toFixed(1).padStart(7)} ${s.skyHigh.toFixed(3).padStart(16)}`
    + ` ${s.peakRatio.toFixed(1).padStart(9)} ${(s.sky / s.ground).toFixed(2).padStart(10)}`,
  );
}

console.log('');
console.log('--- что означают эти числа ---');
const полдень = equirectStats(buildEquirect(ISFAHAN_DESERT, состояние(0.95, 0, 0)));
const ночь = equirectStats(buildEquirect(ISFAHAN_DESERT, состояние(-0.5, 1, 0)));
const буря = equirectStats(buildEquirect(ISFAHAN_DESERT, состояние(0.95, 0, 1)));

const проверки: { имя: string; ок: boolean; текст: string }[] = [];
const проверь = (имя: string, ок: boolean, текст: string) => {
  проверки.push({ имя, ок, текст });
  console.log(`  ${ок ? 'ДА' : 'НЕТ'}  ${имя}: ${текст}`);
};

проверь(
  'фон резко отличается от земли днём и ночью',
  полдень.sky / полдень.ground >= 2 && ночь.sky / ночь.ground >= 2,
  `днём ${(полдень.sky / полдень.ground).toFixed(1)}, ночью ${(ночь.sky / ночь.ground).toFixed(1)} — ниже 2 фигура режется в обоих фона`,
);
проверь(
  'небо без солнца не пересвечено',
  полдень.skyHigh < 4,
  `99.5-й процентиль неба ${полдень.skyHigh.toFixed(2)} (приближение тонмаппинга) — срез был бы уже около 1.0–1.5`,
);
проверь(
  'солнце осталось пятном, а не заливкой',
  полдень.peakRatio >= 8,
  `пик в ${полдень.peakRatio.toFixed(0)} раз выше неба без солнца`,
);
проверь(
  'ночь темнее дня',
  ночь.sky < полдень.sky * 0.2,
  `ночью небо ${ночь.sky.toFixed(3)} против дневного ${полдень.sky.toFixed(3)}`,
);
проверь(
  'буря гасит солнце и выравнивает небо',
  буря.peak < полдень.peak * 0.2 && буря.skyHigh < полдень.skyHigh,
  `пик ${буря.peak.toFixed(1)} против дневного ${полдень.peak.toFixed(1)}`,
);
проверь(
  'все значения конечны и неотрицательны',
  (() => {
    const d = buildEquirect(ISFAHAN_DESERT, состояние(0.4, 0.2, 0.3)).data;
    for (let i = 0; i < d.length; i++) {
      if (!Number.isFinite(d[i]) || d[i] < 0) return false;
    }
    return true;
  })(),
  'ни NaN, ни отрицательных значений в карте',
);

// Силуэт в сумерках и в буре держит ключевой свет. Проверяется на самом
// трудном моменте: полдень с плотной облачностью, где солнце гасится
// сильнее всего. Если и тут пик выше неба в разы, фигура не слипнется.
проверь(
  'в самую плотную облачность ключевой свет остаётся',
  буря.peakRatio >= 3,
  `пик ${буря.peakRatio.toFixed(1)} раз выше неба без солнца`,
);
const сумерки = equirectStats(buildEquirect(ISFAHAN_DESERT, состояние(-0.05, 0.75, 0.1)));
проверь(
  'в сумерках есть направленный свет',
  сумерки.peakRatio >= 10,
  `пик ${сумерки.peakRatio.toFixed(0)} раз выше неба`,
);

const всеОк = проверки.every((п) => п.ок);
console.log('');
console.log(всеОк ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(всеОк ? 0 : 1);