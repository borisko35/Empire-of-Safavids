// ============================================================
// Горожане — Empire of Safavids
// ============================================================
// "Не квестовые" NPC: гуляют по Исфахану, стоят, разговаривают
// друг с другом (пара встаёт лицом друг к другу + облачко реплики).
// Некликабельны, дают городу жизнь. Коллайдеры — динамические,
// как у фауны (CIV_COLLIDERS в terrain.ts).

import * as THREE from 'three';
import { CITY, CIV_COLLIDERS, COLLIDERS, groundHeight, waterMask } from './terrain';

interface Civilian {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  bubble: THREE.Sprite;
  bubbleUntil: number;
  state: 'idle' | 'walk' | 'talk';
  target: { x: number; z: number };
  speed: number;
  stateUntil: number;
  talkWith: Civilian | null;
  phase: number;
  /** Расстояние до цели в прошлом кадре — по нему видно, что горожанин
   *  реально буксует, а не просто подошёл ближе */
  lastDist: number;
  /** Сколько секунд подряд не приближается к цели */
  stuckFor: number;
  /** Позиция в начале кадра — по ней ограничиваем суммарный сдвиг (pushLimit) */
  frameStartX: number | undefined;
  frameStartZ: number | undefined;
  /**
   * Кадр, до которого горожанин невидим.
   *
   * Нужно для переноса к игроку: перенос на 200+ м БЫЛ ВИДЕН. Комментарий
   * в коде объяснял это «за пределами видимости», но камера у нас видит до
   * 1600 м, а туман прячет на 240-850 м (зависит от качества и погоды) — то
   * есть на 200 м человек ещё отчётливо виден. Игрок видел, как фигурка
   * исчезает с холма и появляется у него под боком.
   *
   * Теперь перенос происходит при group.visible = false, и горожанин
   * проявляется за полсекунды уже на новом месте.
   */
  hiddenUntil: number;
  /**
   * Свой дом горожанина — точка в городе, вокруг которой он ходит.
   *
   * ТУТ БЫЛА ПОЛОМКА, ИЗ-ЗА КОТОРОЙ ГОРОЖАНЕ ХОДИЛИ ЗА ИГРОКОМ. Цель
   * блуждания выбиралась функцией freeSpot, куда передавались координаты
   * ИГРОКА как «дом». То есть каждый раз, когда горожанин решал, куда пойти,
   * он выбирал точку вокруг игрока. Итог: стоило игроку выйти из города — за
   * ним шли все двадцать два, стоило пойти бить мобов — они были рядом.
   * В комментарии это называлось «дом там, где игрок: иначе в поле горожане
   * шли обратно в город». Проблема была не в горожанах, а в том, что дом
   * менялся: у них не было своего дома вообще.
   *
   * Теперь дом выдаётся один раз при создании и больше не меняется.
   */
  homeX: number;
  homeZ: number;
}

export interface CiviliansHandle {
  /** playerX/playerZ — чтобы горожане обходили и игрока, а не шли сквозь него */
  update(dt: number, now: number, playerX?: number, playerZ?: number): void;
  dispose(): void;
}

const PHRASES = [
  'Салам!',
  'Как торговля?',
  'Слава шаху!',
  'Жаркий день…',
  'Слышал новости?',
  'Хвала небесам!',
  'Хорошая цена!',
  'Дорогу, дорогу…',
];

const TUNICS = [0x8b6f4e, 0x4e6f8b, 0x7a4e6e, 0x4e8b6f, 0x9c8a5a, 0x6e4e8b, 0x8b4e5a, 0x5a7a8b];

/**
 * Предел сдвига горожанина, В СЕКУНДУ, как доля от его обычной скорости.
 *
 * Раньше предел задавался в метрах НА КАДР, и это была ошибка: реальная
 * скорость оказывалась равной «метры × число кадров в секунду». На быстром
 * компьютере (240 fps) 0,12 м на кадр — это 104 км/ч, а 0,3 м — 260 км/ч.
 * Пользователь видел «450 км/с», потом «220 км/с»: соотношение 450/220 = 2,
 * и ровно во столько же я уменьшил предел (0,3 → 0,12). Ограничитель работал
 * правильно, но величина была задана не в тех единицах.
 *
 * Теперь предел умножается на dt, то есть задаёт скорость в м/с и от частоты
 * кадров не зависит: 2 × 1,4 м/с = 2,8 м/с (10 км/ч) — это быстрый толчок,
 * когда горожанина расталкивают или выталкивают из стены.
 */
const PUSH_SPEED_K = 2;

/**
 * Сколько реплик горожан видно одновременно.
 *
 * Пузыри — спрайты с depthTest: false, то есть перекрывают друг друга в
 * порядке появления. Показывать их все нельзя: в толпе на экране оказывается
 * сразу полтора десятка прямоугольников, и реплики прочитать невозможно.
 * Три — столько, что толпа выглядит живой, но текст ещё читается.
 */
const MAX_VISIBLE_BUBBLES = 3;

/**
 * Дальность, за которой горожанин переносится к игроку.
 *
 * Раньше это число просто стояло в коде как 200, а комментарий рядом
 * объяснял его «за пределами видимости, дальность прорисовки ~150 м».
 * Проверил по коду: camera.far = 1600, а туман прячет на 240-850 м. То есть
 * 200 м — это как раз видимая зона, и перенос было видно своими глазами.
 * Теперь число вынесено сюда, а сам перенос невидим.
 */
/**
 * Дальность, за которой горожанин просто не рисуется.
 *
 * ТУТ БЫЛО 200, и по этому числу горожан ПЕРЕНОСИЛИ к игроку. Теперь переноса
 * нет: горожане живут в городе, и если игрок ушёл, их рядом просто не
 * становится.
 *
 * 900 м — не «на глаз», а дальше самого тумана: туман прячет на 240-850 м в
 * зависимости от качества и погоды, поэтому в 900 м фигурку уже не видно и
 * её исчезновение заметить нельзя. Прежние 200 м были видны отчётливо —
 * на таком расстоянии человек ещё читается, и прятать его — значит
 * заставить игрока смотреть на исчезающие и появляющиеся фигурки.
 */
const LEASH = 900;

/** Предельный сдвиг за этот кадр для данного горожанина, в метрах */
function pushLimit(c: Civilian, dt: number): number {
  return c.speed * dt * PUSH_SPEED_K;
}
const SKIN = [0xe4b284, 0xc89878, 0xa87858];
const HAIR = [0x2a2018, 0x4a3220, 0x6e563a, 0x8a8a8a];
const PANTS = [0x3a3630, 0x4a4438, 0x2e3a4a];

function makeBubble(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2.6, 1.0, 1);
  sp.visible = false;
  (sp as THREE.Sprite & { setText?: (t: string) => void }).setText = (t: string) => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(245, 240, 232, 0.95)';
    g.beginPath();
    g.roundRect(6, 6, 244, 62, 14);
    g.fill();
    g.beginPath();
    g.moveTo(108, 68); g.lineTo(128, 90); g.lineTo(148, 68);
    g.fill();
    g.fillStyle = '#2a2018';
    g.font = 'bold 24px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const short = t.length > 14 ? t.slice(0, 13) + '…' : t;
    g.fillText(short, 128, 38);
    tex.needsUpdate = true;
  };
  return sp;
}

/**
 * Радиус блуждания вокруг дома.
 *
 * ТУТ БЫЛО 85 — весь город (радиус стен 116 м). Горожанин выбирал цель в
 * 85 м от дома, а дом выдавался один раз, случайной точкой в городе. Двадцать
 * два горожанина на 42 000 м² — один на 1 922 м², то есть один на квадрат
 * 44×44 м. Замер: в радиусе 40 м от игрока в среднем 4,5 горожанина,
 * ближайший — в 21,8 м. Город выглядел вымершим, и игрок написал ровно
 * это: «в городе нет граждан».
 *
 * Теперь блуждание идёт вокруг ДОМА, а дома лежат в РАЙОНАХ (см. DISTRICTS).
 */
const WANDER_R = 20;

/**
 * Районы, где в Исфахане есть жизнь.
 *
 * Город — не поле. Люди ходят по делу: в базар, к торговцу, к стражнику на
 * воротах, к мечети. Если разложить их равномерно по 42 000 м², получится
 * одинокого человека на каждые 44×44 м — толпы нет нигде, и город читается
 * пустым. Если собрать их там, где люди правда собираются, то же самое
 * количество горожан читается как оживлённый базар.
 *
 * Координаты — от центра города, как у NPC в npc.ts. Процент свободного
 * места в круге радиуса r посчитан по тем же правилам, что и freeSpot:
 *   базар   (14,  6) r=20 — 64% свободно, торговец Джафар (15, 2), аукционист
 *   запад   (-10, 20) r=18 — 77%, глашатай (−8, 10), караван-баши Юсуф (−4, 22)
 *   восток  (20, 14) r=18 — 86%, стражник Рустам (20, 16), привратник (26, 6)
 *   мечеть  (-5, -25) r=16 — 70%, Суфий Мевлана (2, −26) с золотым «!»
 *
 * Первый вариант мечети был (-18, −8) — свободно там всего 34%, и пятеро
 * горожан попадали в запасную точку вместо района.
 */
const DISTRICTS: readonly { x: number; z: number; r: number }[] = [
  { x: 14, z: 6, r: 20 },
  { x: -10, z: 20, r: 18 },
  { x: 20, z: 14, r: 18 },
  { x: -5, z: -25, r: 16 },
];

/**
 * Кому какой район. Шесть слотов: базар достаётся трем — он и есть главное
 * людное место города, и именно мимо него игрок ходит чаще всего.
 */
const DISTRICT_PICK: readonly number[] = [0, 0, 1, 2, 0, 3];

/**
 * Выталкивание из препятствий. Раньше учитывались только постройки —
 * горожане свободно проходили друг сквозь друга и сквозь игрока.
 * Теперь учитываются и другие горожане (CIV_COLLIDERS, который раньше
 * заполнялся, но никогда не читался), и сам игрок.
 *
 * Обход — скольжение вдоль препятствия, а не отказ от цели: пока
 * горожанин скользит, он выглядит так, будто обходит стену.
 *
 * ПОМЕЧЕНО: в конце делается отдельный проход ТОЛЬКО по постройкам.
 * Без него толкачка от соседа (она применяется последней) успевала
 * засунуть горожанина в стену: при раскачке «стена ↔ сосед» после трёх
 * проходов оставалось положение внутри стены (замер: 0.76 м). Стены —
 * единственное жёсткое ограничение, они должны побеждать всегда.
 */

/** Суммарная глубина вхождения точки в постройки (0 — чисто) */
function staticsOverlap(x: number, z: number, r: number): number {
  let sum = 0;
  for (const c of COLLIDERS) {
    const d = Math.hypot(x - c.x, z - c.z);
    const min = c.r + r;
    if (d < min) sum += min - d;
  }
  return sum;
}

/**
 * Выносит точку из построек.
 *
 * Перебираем НЕСКОЛЬКО направлений выхода и берём то, где суммарное
 * вхождение в постройки минимально. Одного «вытолкнуть из самого глубокого»
 * мало: два перекрывающихся дома образуют ловушку, где выход из одного — это
 * вход в другой, и цикл раскачивается, не сходясь (замер: горожанин оставался
 * на 0.42 м внутри дома, а телепорт расталкивания давал сдвиг 0.98 м за кадр).
 * Выбор лучшего из кандидатов гарантирует, что значение не растёт, поэтому
 * цикл сходится.
 *
 * maxMove — ЖЁСТКИЙ предел сдвига за один вызов, в метрах. Без него вынос
 * из стены городской стены (радиус 4.1 м) за 6 проходов уносил горожанина
 * на 27 м за кадр — при 60 кадрах это 1600 м/с, то есть телепорт (пользователь
 * увидел «450 км/с»). Вынос — это страховка от застревания, а не ходьба:
 * оставшееся вхождение доберётся за следующие кадры.
 */
function pushOutOfStatics(x: number, z: number, r: number, maxMove: number): { x: number; z: number } {
  let cx = x, cz = z;
  let best = staticsOverlap(cx, cz, r);
  if (best <= 0) return { x: cx, z: cz };

  for (let pass = 0; pass < 6 && best > 0; pass++) {
    // Самое глубокое нарушение задаёт радиус, из которого выбираем направления
    let deepX = 0, deepZ = 0, deepMin = 0, deepOver = 0;
    for (const c of COLLIDERS) {
      const d = Math.hypot(cx - c.x, cz - c.z);
      const min = c.r + r;
      if (d >= min) continue;
      if (deepOver === 0 || min - d > deepOver) {
        deepOver = min - d;
        deepX = c.x; deepZ = c.z; deepMin = min;
      }
    }
    if (deepOver === 0) break;

    const dd = Math.hypot(cx - deepX, cz - deepZ);
    // Запас 1 мм обязателен: при выходе ровно на границу из-за округления
    // расстояние пересчитывается как 2.0999… против 2.1, и цикл «зависает».
    const reach = deepMin + 0.001;
    const base = dd > 1e-4 ? Math.atan2(cz - deepZ, cx - deepX) : 0;
    let foundBetter = false;
    // 0 — прямо от центра постройки, далье с поворотами: вдоль стены и по диагоналям
    for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6, Math.PI]) {
      const ang = base + a;
      const tx = deepX + Math.cos(ang) * reach;
      const tz = deepZ + Math.sin(ang) * reach;
      const over = staticsOverlap(tx, tz, r);
      if (over < best - 1e-6) {
        best = over;
        cx = tx; cz = tz;
        foundBetter = true;
        if (best <= 0) break;
      }
    }
    // Ни одно направление не улучшило — дальше крутить бессмысленно
    if (!foundBetter) break;
    // Дальше сдвигать нельзя: предел за этот вызов достигнут, остаток
    // вхождения доберётся за следующие кадры
    if (Math.hypot(cx - x, cz - z) >= maxMove) break;
  }
  // Страховка: даже если цикл успел пройти дальше лимита, подрезаем сдвиг
  const shift = Math.hypot(cx - x, cz - z);
  if (shift > maxMove) {
    const k = maxMove / shift;
    cx = x + (cx - x) * k;
    cz = z + (cz - z) * k;
  }
  return { x: cx, z: cz };
}

function resolveStatic(x: number, z: number, r: number, self: Civilian, dt: number, px?: number, pz?: number): { x: number; z: number } {
  let cx = x, cz = z;
  for (let pass = 0; pass < 3; pass++) {
    let pushed = false;

    // Дома, стены, фонтан
    for (const c of COLLIDERS) {
      const dx = cx - c.x, dz = cz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + r;
      if (d < min) {
        if (d > 1e-4) { cx = c.x + (dx / d) * min; cz = c.z + (dz / d) * min; }
        else { cx = c.x + min; }
        pushed = true;
      }
    }

    // Другие горожане: расталкиваемся, но не наезжаем на себя.
    // Как и с игроком — толчок отменяется, если он заводит в стену.
    for (const c of CIV_COLLIDERS) {
      if (Math.abs(c.x - self.group.position.x) < 1e-6 && Math.abs(c.z - self.group.position.z) < 1e-6) continue;
      const dx = cx - c.x, dz = cz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + r;
      if (d < min) {
        const bx = cx, bz = cz;
        if (d > 1e-4) { cx = c.x + (dx / d) * min; cz = c.z + (dz / d) * min; }
        else { cx = c.x + min; }
        if (staticsOverlap(cx, cz, r) > 0) { cx = bx; cz = bz; }
        else pushed = true;
      }
    }

    // Игрок: обходим, но не отталкиваемся от него как от стены.
    // Толчок МЯГКИЙ: если он заводит горожанина в стену — отменяем его.
    // Раньше толчок применялся безусловно, и когда игрок стоял у дома,
    // горожанин вдавливался в стену каждый кадр: вынос из стены сдвигает
    // максимум на pushLimit, столько же заталкивало обратно — получался
    // затор, и горожанин уезжал вглубь дома (замер: 0.97 м).
    // Сквозь стену человека не выталкивают — если не выходит, стоит на месте.
    if (px !== undefined && pz !== undefined) {
      const dx = cx - px, dz = cz - pz;
      const d = Math.hypot(dx, dz);
      const min = r + 0.9;
      if (d < min) {
        const bx = cx, bz = cz;
        if (d > 1e-4) { cx = px + (dx / d) * min; cz = pz + (dz / d) * min; }
        else { cx = px + min; }
        if (staticsOverlap(cx, cz, r) > 0) { cx = bx; cz = bz; }
        else pushed = true;
      }
    }

    if (!pushed) break;
  }

  // Финальный проход ТОЛЬКО по постройкам: после него горожанин гарантированно
  // не внутри стены, даже если его туда засунула толкачка соседей или игрок.
  // Сдвиг ограничен по скорости (см. PUSH_SPEED_K), поэтому за кадр горожанин
  // не «улетает» и результат не зависит от частоты кадров.
  const out = pushOutOfStatics(cx, cz, r, pushLimit(self, dt));
  return { x: out.x, z: out.z };
}

/**
 * Свободное место для прогулки.
 *
 * ЗАЧЕМ ЭТА ФУНКЦИЯ. Она выбирает горожанину точку, куда идти, и точку,
 * в которой он живёт.
 *
 * ЧТО БЫЛО РАНЬШЕ, ДВА РАЗА. Сначала центр прогулки был жёстко зашит на
 * CITY, а «перенос населения к игроку» ставил горожанина рядом с игроком —
 * тогда выходило, что все двадцать два шли за игроком через всё поле. Потом
 * перенос убрали, но радиус остался 85 м от ДОМА, а дом выдавался один раз
 * случайной точкой в городе. Итог: город на 42 000 м² с двадцатью двумя
 * горожанами — одиноким человеком на квадрат 44×44 м.
 *
 * Замер, который всё это вскрыл: обход города в 96 точках дал 4,5 горожанина
 * в радиусе 40 м и ближайшего в 21,8 м. Игрок написал «в городе нет
 * граждан» — и был прав.
 *
 * Теперь дом — это РАЙОН города (DISTRICTS), выданный один раз при
 * создании, а блуждание идёт вокруг него на 16-20 м (DISTRICTS[].r).
 * Тем же количеством людей базар читается как базар.
 *
 * cx/cz — точка, к которой горожанин не подходит вплотную (иначе он лезет
 * под ноги тому, кто его вызывает), homeX/homeZ — центр, вокруг которого он
 * бродит, wanderR — насколько далеко.
 */
function freeSpot(
  cx: number,
  cz: number,
  homeX = CITY.x,
  homeZ = CITY.z,
  wanderR = WANDER_R,
): { x: number; z: number } {
  candidates: for (let tries = 0; tries < 12; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * (wanderR - 3);
    const x = homeX + Math.cos(a) * r;
    const z = homeZ + Math.sin(a) * r;
    // Не в фонтане, не в мечети, не в воде, не внутри построек
    if (Math.hypot(x - (CITY.x + 6), z - (CITY.z + 6)) < 7) continue;
    if (Math.abs(x - CITY.x) < 14 && Math.abs(z - (CITY.z - 8)) < 11) continue;
    if (waterMask(x, z) > 0.2) continue;
    // Слишком близко к игроку: иначе горожане лезут под ноги и толкаются
    if (Math.hypot(x - cx, z - cz) < 6) continue;
    for (const c of COLLIDERS) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + 1.2) continue candidates;
    }
    return { x, z };
  }
  return { x: cx, z: cz };
}

/**
 * Вернуть горожанина в строй, если его координаты стали нечисловыми.
 *
 * NaN НЕ ЛЕЧИТСЯ САМ. Один битый кадр — и позиция уже никогда не конечна:
 * resolveStatic и pushOutOfStatics возвращают вход как есть, а hypot с NaN
 * даёт NaN. Матрица мира горожанина становится NaN, GPU выбрасывает каждый
 * такой меш, и при этом горожанин по-прежнему в сцене и visible: он есть,
 * но его не видно. Город выглядит мёртвым до перезагрузки — ровно то, что
 * описал игрок: «граждан в игре не видны».
 *
 * Вызывается в начале каждого кадра, поэтому порча прошлого кадра снимается
 * в следующем: максимум один кадр невидимости вместо всей сессии.
 */
function revive(c: Civilian, now: number): void {
  if (Number.isFinite(c.group.position.x) && Number.isFinite(c.group.position.z)) return;
  c.group.position.set(c.homeX, groundHeight(c.homeX, c.homeZ), c.homeZ);
  c.target = { x: c.homeX, z: c.homeZ };
  c.state = 'idle';
  c.stateUntil = now + 1000;
  c.stuckFor = 0;
  c.lastDist = 0;
  c.frameStartX = c.homeX;
  c.frameStartZ = c.homeZ;
}

export function createCivilians(scene: THREE.Scene): CiviliansHandle {
  const all = new THREE.Group();
  scene.add(all);
  const civs: Civilian[] = [];
  // 8 горожан на город радиусом 116 м — почти пусто: редко находились пары
  // рядом, и перекрёстки выглядели вымершими. 16 всё ещё дёшево по
  // геометрии (примитивы без текстур), а теперь ещё и переносятся к игроку,
  // так что в кадре всегда есть кто-то. 22 — заметно оживлённее.
  const COUNT = 30;

  for (let i = 0; i < COUNT; i++) {
    const g = new THREE.Group();
    const tunic = TUNICS[i % TUNICS.length];
    const skin = SKIN[i % SKIN.length];
    const hairC = HAIR[i % HAIR.length];
    const pantsC = PANTS[i % PANTS.length];
    const tunicMat = new THREE.MeshStandardMaterial({ color: tunic, roughness: 1 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.9 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairC, roughness: 1 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: pantsC, roughness: 1 });

    // Туловище: халат + пояс
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 1.0, 8), tunicMat);
    body.position.y = 1.05;
    body.castShadow = true;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 8), pantsMat);
    belt.position.y = 0.72;
    g.add(body, belt);

    // Ноги на шарнирах в бёдрах (для походки)
    const mkLeg = (sx: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.13, 0.55, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.15), pantsMat);
      leg.position.y = -0.27;
      leg.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.24), hairMat);
      shoe.position.set(0, -0.52, 0.04);
      pivot.add(leg, shoe);
      g.add(pivot);
      return pivot;
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);

    // Руки на шарнирах в плечах
    const mkArm = (sx: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.36, 1.42, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.58, 0.12), tunicMat);
      arm.position.y = -0.27;
      arm.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), skinMat);
      hand.position.y = -0.58;
      pivot.add(arm, hand);
      g.add(pivot);
      return pivot;
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);

    // Голова + лицо: глаза, рот, волосы, борода у каждого второго
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skinMat);
    head.position.y = 1.72;
    head.castShadow = true;
    g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1410 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), eyeMat);
      eye.position.set(sx * 0.075, 1.75, 0.185);
      g.add(eye);
    }
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.022, 0.012),
      new THREE.MeshBasicMaterial({ color: 0x7a3a2a }),
    );
    mouth.position.set(0, 1.64, 0.2);
    g.add(mouth);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
    hair.position.y = 1.74;
    g.add(hair);
    if (i % 2 === 0) {
      const beard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.06), hairMat);
      beard.position.set(0, 1.56, 0.17);
      g.add(beard);
    } else {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.14, 8), hairMat);
      cap.position.y = 1.9;
      g.add(cap);
    }
    const bubble = makeBubble();
    bubble.position.y = 2.45;
    g.add(bubble);
    // Дом — в РАЙОНЕ, а не в случайной точке города.
    //
    // ТУТ БЫЛО freeSpot(CITY.x, CITY.z): случайная точка в 85 м от центра.
    // Город занимает 42 000 м², и двадцать два горожанина раскидало по нему
    // ровно на одного человека на квадрат 44×44 м. Замер: в радиусе 40 м от
    // игрока — 4,5 горожанина, ближайший в 21,8 м. Город читался пустым, и
    // игрок написал: «в городе нет граждан».
    //
    // Теперь дом выдаётся в одном из районов (DISTRICTS), а блуждание идёт
    // вокруг него на 16-20 м. Тем же количеством людей толпа в базаре
    // читается как толпа, а не как случайные фигурки по всей степи.
    const dist = DISTRICTS[DISTRICT_PICK[i % DISTRICT_PICK.length]];
    const dcx = CITY.x + dist.x;
    const dcz = CITY.z + dist.z;
    const p = freeSpot(dcx, dcz, dcx, dcz, dist.r);
    g.position.set(p.x, groundHeight(p.x, p.z), p.z);
    g.rotation.y = Math.random() * Math.PI * 2;
    all.add(g);
    civs.push({
      group: g, body, head, legL, legR, armL, armR, bubble, bubbleUntil: 0,
      state: 'idle', target: { x: p.x, z: p.z },
      speed: 1.1 + Math.random() * 0.7,
      stateUntil: 0, talkWith: null, phase: Math.random() * 10,
      lastDist: Math.hypot(p.x, p.z), stuckFor: 0,
      frameStartX: p.x, frameStartZ: p.z,
      hiddenUntil: 0,
      homeX: p.x, homeZ: p.z,
    });
  }

  let talkTimer = 5000;

  /**
   * Повернуть горожанина к точке.
   *
   * dt обязателен: раньше доля поворота была фиксированной на кадр (0.15),
   * и на слабой машине при 30 fps поворот был втрое медленнее, чем на 90.
   * Со стороны это читалось как «ходит боком» — модель ещё доворачивалась,
   * а ноги уже шли вперёд. Теперь скорость поворота одинакова при любой
   * частоте кадров.
   */
  function face(a: Civilian, x: number, z: number, dt: number): void {
    const want = Math.atan2(x - a.group.position.x, z - a.group.position.z);
    let d = want - a.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // 9 в секунду вместо доли на кадр: одинаково быстро при 30 и при 90 fps
    a.group.rotation.y += d * Math.min(1, dt * 9);
  }

  function update(dt: number, now: number, playerX?: number, playerZ?: number): void {
    // SAFETY: one non-finite frame must not blind the crowd for a whole
    // session. NaN never recovers here — every citizen stayed in the scene
    // and visible, but their world matrices went NaN and the GPU dropped
    // every one of them, so the city looked dead until a reload.
    if (!Number.isFinite(dt)) dt = 1 / 60;
    if (!Number.isFinite(now)) now = performance.now();
    if (playerX !== undefined && !Number.isFinite(playerX)) playerX = undefined;
    if (playerZ !== undefined && !Number.isFinite(playerZ)) playerZ = undefined;
    CIV_COLLIDERS.length = 0;

    // Разговоры. Раньше требовалось, чтобы ОБА стояли без дела и ждали не
    // больше одной пары за 6-10 с. При восьми горожанах на город радиусом
    // 116 м это почти никогда не случалось — город был безмолвным. Теперь
    // разговор может начаться и с идущим мимо, проверка чаще и за один
    // раз набирается несколько пар.
    talkTimer -= dt * 1000;
    if (talkTimer <= 0) {
      talkTimer = 3000 + Math.random() * 3500;
      // Уже занятые разговором не трогаем
      const free = civs.filter(c => c.state !== 'talk');
      // Сначала те, кто и так стоит: разговор с прохожим на полпути к цели
      // замораживал его посреди улицы, и город наполовину замирал
      // (замер: 44% времени все горожане болтали вместо ~20%).
      const idle = free.filter(c => c.state === 'idle');
      const walking = free.filter(c => c.state === 'walk');
      const claimed = new Set<Civilian>();
      for (const pool of [idle, walking]) {
        for (let i = 0; i < pool.length; i++) {
          if (claimed.has(pool[i])) continue;
          for (let j = i + 1; j < pool.length; j++) {
            if (claimed.has(pool[j])) continue;
            const a = pool[i], b = pool[j];
            const d = Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);
            if (d > 11) continue;
            claimed.add(a); claimed.add(b);
            const dur = 3500 + Math.random() * 3000;
            // Оба собеседника разговаривают, но пузырь рисует только ОДИН.
            //
            // ТУТ БЫЛО ДВА ПУЗЫРЯ НА КАЖДУЮ ПАРУ. В толпе это давало
            // десятки прямоугольников, и главное — все они спрайты с
            // depthTest: false, то есть рисуются в порядке появления и
            // ПЕРЕКРЫВАЮТ ДРУГ ДРУГА. На снимке один пузырь наезжал на
            // другой, и от реплики оставался только обрывок («...цаху!»
            // вместо «Слава шаху!»). Второй пузырь в паре ничего не добавлял:
            // реплику одного человека в двух местах прочитать невозможно.
            for (const [me, you] of [[a, b], [b, a]] as const) {
              me.state = 'talk';
              me.talkWith = you;
              me.stateUntil = now + dur;
            }
            const speaker = Math.random() < 0.5 ? a : b;
            speaker.bubbleUntil = now + dur;
            (speaker.bubble as THREE.Sprite & { setText?: (t: string) => void }).setText?.(
              PHRASES[Math.floor(Math.random() * PHRASES.length)],
            );
            break;
          }
        }
      }
    }

    for (const c of civs) {
      revive(c, now);
      CIV_COLLIDERS.push({ x: c.group.position.x, z: c.group.position.z, r: 0.5 });
      c.frameStartX = c.group.position.x;
      c.frameStartZ = c.group.position.z;

      if (c.state === 'talk') {
        if (c.talkWith) face(c, c.talkWith.group.position.x, c.talkWith.group.position.z, dt);
        c.body.position.y = 1.05 + Math.sin(now / 300 + c.phase) * 0.02;
        // Жестикуляция: правая рука поднята
        c.armR.rotation.x = -0.9 + Math.sin(now / 250 + c.phase) * 0.25;
        c.armL.rotation.x *= 0.9;
        c.legL.rotation.x *= 0.9;
        c.legR.rotation.x *= 0.9;
        if (now >= c.stateUntil) {
          c.state = 'idle';
          c.talkWith = null;
          c.armR.rotation.x = 0;
          c.stateUntil = now + 1000 + Math.random() * 3000;
        }
      } else if (c.state === 'idle') {
        c.body.position.y = 1.05 + Math.sin(now / 500 + c.phase) * 0.015;
        c.armL.rotation.x *= 0.9;
        c.armR.rotation.x *= 0.9;
        c.legL.rotation.x *= 0.9;
        c.legR.rotation.x *= 0.9;
        if (now >= c.stateUntil) {
          // Дом — СВОЙ, выданный при создании. Раньше сюда передавались
          // координаты игрока, и все двадцать два горожанина ходили за ним
          // по всему миру. Теперь они блуждают вокруг своей точки в городе.
          const t = freeSpot(c.group.position.x, c.group.position.z, c.homeX, c.homeZ);
          c.target = t;
          c.state = 'walk';
        }
      } else {
        const dx = c.target.x - c.group.position.x;
        const dz = c.target.z - c.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          c.state = 'idle';
          c.stateUntil = now + 2000 + Math.random() * 5000;
          c.stuckFor = 0;
        } else {
          // Обход препятствий поворотом направления. Раньше позиция
          // выталкивалась из коллайдера радиально: при прямом желании идти
          // в стену горожанин упирался в неё и стоял, не скользя вдоль —
          // выглядело как «не обходит». Теперь пробуем прямо, потом с
          // поворотами влево/вправо: это обычный обход угла.
          const step = Math.min(d, c.speed * dt);
          let placed = false;
          for (const turn of [0, 0.9, -0.9, 1.7, -1.7, 2.5, -2.5]) {
            const ct = Math.cos(turn), st = Math.sin(turn);
            const dirX = (dx / d) * ct - (dz / d) * st;
            const dirZ = (dx / d) * st + (dz / d) * ct;
            const wantX = c.group.position.x + dirX * step;
            const wantZ = c.group.position.z + dirZ * step;
            const fixed = resolveStatic(wantX, wantZ, 0.5, c, dt, playerX, playerZ);
            // Вытолкнуло обратно — этот поворот не годится, пробуем следующий
            if (Math.hypot(fixed.x - wantX, fixed.z - wantZ) > step * 0.5) continue;
            c.group.position.x = fixed.x;
            c.group.position.z = fixed.z;
            face(c, wantX, wantZ, dt);
            placed = true;
            break;
          }
          if (!placed) {
            // Упёрся со всех сторон: остаёмся на месте, лишь выдавливаемся
            // из препятствия, если всё же оказались внутри
            const fixed = resolveStatic(c.group.position.x, c.group.position.z, 0.5, c, dt, playerX, playerZ);
            c.group.position.x = fixed.x;
            c.group.position.z = fixed.z;
          }

          // Буксует ли горожанин? Смотрим на реальное сближение с целью,
          // а не на величину сдвига.
          const newDist = Math.hypot(c.target.x - c.group.position.x, c.target.z - c.group.position.z);
          if (newDist >= c.lastDist - step * 0.25) c.stuckFor += dt;
          else c.stuckFor = 0;
          c.lastDist = newDist;

          if (c.stuckFor > 3) {
            // Реально застрял (упёрся в глухую стену) — ищем другую цель.
            // Тут домом тоже был игрок, это второй источник «хождения следом».
            c.target = freeSpot(c.group.position.x, c.group.position.z, c.homeX, c.homeZ);
            c.stuckFor = 0;
            c.lastDist = Math.hypot(c.target.x - c.group.position.x, c.target.z - c.group.position.z);
          }
          // Походка: ноги и руки в противофазе
          const swing = Math.sin(now / 130 + c.phase) * 0.55;
          c.legL.rotation.x = swing;
          c.legR.rotation.x = -swing;
          c.armL.rotation.x = -swing * 0.7;
          c.armR.rotation.x = swing * 0.7;
          c.body.position.y = 1.05 + Math.abs(Math.sin(now / 130 + c.phase)) * 0.05;
        }
      }

      const gy = groundHeight(c.group.position.x, c.group.position.z);
      c.group.position.y += (gy - c.group.position.y) * Math.min(1, dt * 6);

      // Проверка «не занимать чужое место» для ВСЕХ состояний. Выше
      // выталкивание вызывалось только в ветке walk, поэтому стоящий
      // (idle) или болтающий (talk) горожанин не отодвигался, когда к нему
      // подходил игрок: тот мог стоять вплотную по 2-7 секунд, пока тот не
      // дошёл до следующей цели (замер: до −0.95 м). Здесь срабатывает
      // только если кто-то действительно внутри, поэтому стоящие не
      // скользят сами по себе.
      const safe = resolveStatic(c.group.position.x, c.group.position.z, 0.5, c, dt, playerX, playerZ);
      // ТУТ БЫЛО «СКОЛЬЗЕНИЕ». Итоговое выталкивание двигало горожанина, но
      // не поворачивало: тот ехал в одну сторону, а смотрел в другую — со
      // стороны это выглядело как ходьба боком или задом. Поворачиваем по
      // ФАКТИЧЕСКОМУ сдвигу: сдвиг и есть реальное движение.
      if (Math.hypot(safe.x - c.group.position.x, safe.z - c.group.position.z) > 1e-3) {
        face(c, safe.x, safe.z, dt);
      }
      c.group.position.x = safe.x;
      c.group.position.z = safe.z;

      if (c.bubbleUntil === 0) c.bubble.visible = false;
    }

    // ПУЗЫРИ: держим их немного и разносим по высоте.
    //
    // Показываем реплику у ограниченного числа самых близких горожан, а
    // остальных гасим. В толпе иначе на экране было бы сразу полтора
    // десятка прямоугольников — читать нечего, и выглядит как поломка.
    // Высота ступенчатая, чтобы соседние пузыри не ложились друг на друга.
    const px = playerX ?? 0;
    const pz = playerZ ?? 0;
    const dist2 = (c: Civilian): number => {
      const dx = c.group.position.x - px;
      const dz = c.group.position.z - pz;
      return dx * dx + dz * dz;
    };
    const talking = civs.filter(c => c.bubbleUntil > now).sort((a, b) => dist2(a) - dist2(b));
    for (let i = 0; i < talking.length; i++) {
      const c = talking[i];
      c.bubble.visible = i < MAX_VISIBLE_BUBBLES;
      c.bubble.position.y = 2.45 + (i % 3) * 0.42;
    }

    // Расталкивание парное и ПОСЛЕ обновления всех позиций. В resolveStatic
    // каждый горожанин расталкивается по вчерашним координатам остальных
    // (CIV_COLLIDERS заполняется в этом же проходе), и когда двое сходятся
    // лоб в лоб, толкачки друг друга «переезжают» — пара слипалась почти
    // в ноль (замер: −0.99 м).
    //
    // Двигаем того, кому ничего не мешит, и только если не выходит никого —
    // делим толчок пополам. Сдвиг всегда МЕЛКИЙ (pushLimit): раздвинуться на
    // целый метр за кадр — это 60 м/с, то есть заметный телепорт. Мелкими
    // шагами пара расходится за несколько кадров и выглядит как толкотня.
    const place = (c: Civilian, tx: number, tz: number): boolean => {
      const f = pushOutOfStatics(tx, tz, 0.5, pushLimit(c, dt));
      // Нас отбросило — значит путь перекрыт, этот вариант не годится
      if (Math.hypot(f.x - tx, f.z - tz) > 0.02) return false;
      c.group.position.x = f.x;
      c.group.position.z = f.z;
      return true;
    };

    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let i = 0; i < civs.length; i++) {
        for (let j = i + 1; j < civs.length; j++) {
          const a = civs[i], b = civs[j];
          const dx = b.group.position.x - a.group.position.x;
          const dz = b.group.position.z - a.group.position.z;
          const d = Math.hypot(dx, dz);
          const min = 1.0; // 0.5 + 0.5 — сумма радиусов
          if (d >= min) continue;
          // Совпали точно — разводим по произвольной оси, иначе деление на ноль
          const ux = d > 1e-4 ? dx / d : 1;
          const uz = d > 1e-4 ? dz / d : 0;
          // Шаг за проход ограничен: полное раздвижение на метр за кадр —
          // это телепорт (60 м/с). За несколько проходов пара разойдётся.
          const away = Math.min(pushLimit(a, dt), min - d + 0.01);
          if (place(a, a.group.position.x - ux * away, a.group.position.z - uz * away)) { moved = true; continue; }
          if (place(b, b.group.position.x + ux * away, b.group.position.z + uz * away)) { moved = true; continue; }
          // Оба упираются (зажаты в проёме) — сдвигаем обоих понемногу.
          // Полный толчок тут невозможен: любой сильный сдвиг упирается в
          // стену и отбрасывается обратно. Мелкий шаг за несколько проходов
          // набирает нужное расстояние, тогда как деление пополам оставляло
          // пару слипшейся (замер: −1.00 м, то есть полное совпадение точек).
          const stepOut = Math.min(0.15, away);
          const aFix = pushOutOfStatics(a.group.position.x - ux * stepOut, a.group.position.z - uz * stepOut, 0.5, pushLimit(a, dt));
          const bFix = pushOutOfStatics(b.group.position.x + ux * stepOut, b.group.position.z + uz * stepOut, 0.5, pushLimit(b, dt));
          a.group.position.x = aFix.x;
          a.group.position.z = aFix.z;
          b.group.position.x = bFix.x;
          b.group.position.z = bFix.z;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Последний рубеж: суммарный сдвиг за кадр не может превысить
    // pushLimit(c, dt) — то есть 2× обычной скорости в м/с, независимо от
    // частоты кадров. Сколько бы раз ни сработали вынос и расталкивание,
    // горожанин физически не может переместиться быстрее быстрого шага.
    for (const c of civs) {
      const sx = c.frameStartX, sz = c.frameStartZ;
      if (sx === undefined || sz === undefined) continue;
      const dx = c.group.position.x - sx, dz = c.group.position.z - sz;
      const shift = Math.hypot(dx, dz);
      const limit = pushLimit(c, dt);
      if (shift > limit) {
        const k = limit / shift;
        c.group.position.x = sx + dx * k;
        c.group.position.z = sz + dz * k;
      }
    }

    // Граждане живут своей жизнью и НЕ ХОДЯТ ЗА ИГРОКОМ.
    //
    // ТУТ БЫЛО «ПЕРЕНОС НАСЕЛЕНИЯ К ИГРОКУ». Логика была такой: если
    // горожанин дальше 200 м, спрятать его и поставить в случайную точку
    // рядом с игроком. Смысл — «чтобы в кадре всегда был кто-то живой».
    // Но игрок видел ровно то, что описал: вышел из города — они за ним,
    // пошёл бить мобов — они рядом. Двадцать два горожанина шли за игроком
    // через всё поле. Это выглядит так, будто они привязаны к игроку, и
    // ломает ощущение живого города: толпа должна оставаться в городе,
    // а за её пределами её нет.
    //
    // Плюс это ломало и производительность по смыслу: «всегда кто-то в кадре»
    // значит всегда отрисовывать 22 горожанина, где угодно.
    //
    // Теперь переноса нет вообще. Горожанин ушёл из города — значит
    // горожан рядом нет, и это правильно. Прятать их имеет смысл только
    // за пределами видимости, а не на 200 м: на 200 м фигурки ещё хорошо
    // видно, и прятать их — значит заставить игрника смотреть, как
    // Population исчезает и появляется. Поэтому порог — 900 м, дальше
    // тумана при любом качестве и погоде (240-850 м), то есть исчезновения
    // не видно.
    if (playerX !== undefined && playerZ !== undefined) {
      for (const c of civs) {
        const dist = Math.hypot(c.group.position.x - playerX, c.group.position.z - playerZ);
        const visible = dist < LEASH && now >= c.hiddenUntil;
        if (c.group.visible === visible) continue;
        c.group.visible = visible;
        // Скрытого горожанина не должно быть видно «призраком» в тумане:
        // реплика гаснет вместе с ним.
        if (!visible) {
          c.bubble.visible = false;
          c.bubbleUntil = 0;
        }
      }
    }

    // Проявление тех, кто вернулся в поле зрения.
    for (const c of civs) {
      if (c.group.visible) continue;
      if (now < c.hiddenUntil) continue;
      c.group.visible = true;
    }
  }

  function dispose(): void {
    all.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        g?.dispose?.();
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        (m as THREE.Material | undefined)?.dispose?.();
      }
    });
    scene.remove(all);
    CIV_COLLIDERS.length = 0;
  }

  // Debug hook: live citizens from the browser console (`window.__civ`).
  (window as unknown as { __civ?: unknown }).__civ = civs;

  return { update, dispose };
}
