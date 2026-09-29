// Рыбалка: главное здесь — что тайминг считает сервер.
// Клиент присылает только факт «подсек», а задержка считается как
// Date.now() - biteAt. Если бы клиент присылал свою задержку, любой
// желающий ловил бы легендарную рыбу пачками за 0 мс.
import { FishingSystem, REEL_WINDOWS, FISH_TABLE } from '../systems/FishingSystem';
import { isWater, isDeepWater, canFloatAt } from '../utils/spawn';

const LAKE = { x: -420, z: -160 };    // глубокая вода (центр озера, r=170)
const SHORE = { x: -420, z: 7 };      // кромка: вода есть, глубины для плавания нет
const FIELD = { x: 0, z: 0 };         // суша в городе
const BRIDGE = { x: -100, z: 130 };   // мост через реку

interface Cast {
  characterId: string;
  castId: string;
  phase: 'waiting' | 'bite';
  biteAt: number;
  waitTotalMs: number;
  deep: boolean;
  luck: number;
}

interface ReelResult {
  ok: boolean;
  code?: string;
  fish?: { itemId: string; weightKg: number; rarity: string };
  experience?: number;
  gold?: number;
}

interface Harness {
  fishing: FishingSystem;
  casts: Map<string, Cast>;
  given: { itemId: string; qty: number }[];
  xp: number;
  gold: number;
}

function makeHarness(opts: { boat?: boolean; level?: number } = {}): Harness {
  const casts = new Map<string, Cast>();
  const given: { itemId: string; qty: number }[] = [];
  const state = { xp: 0, gold: 0, level: opts.level ?? 30 };

  const fishing = new FishingSystem() as unknown as {
    casts: Map<string, Cast>;
    characters: unknown;
    boats: unknown;
  };
  fishing.casts = casts;
  fishing.characters = {
    getCharacterById: jest.fn(async () => ({ id: 'c1', level: state.level })),
    addItems: jest.fn(async (_c: string, list: { itemId: string; qty: number }[]) => { given.push(...list); }),
    addExperience: jest.fn(async (_c: number | string, n: number) => { state.xp += n; return null; }),
    addGold: jest.fn(async (_c: string, n: number) => { state.gold += n; }),
    // Улов — награда, поэтому идёт через addGoldReward. Подделка обязана
    // знать про оба метода: иначе проверка падает на «не функция» и
    // сообщает об этом TypeError, а не о смысле.
    addGoldReward: jest.fn(async (_c: string, n: number) => { state.gold += n; }),
  };
  fishing.boats = {
    getActiveBoat: jest.fn(async () => (opts.boat
      ? { characterId: 'c1', boatId: 'boat_caravel', isActive: true, fatigue: 0, totalCatches: 0 }
      : null)),
    getActiveBoatDef: jest.fn(async () => null),
    addCatch: jest.fn(async () => ({ total: 1, fatigue: 1 })),
  };

  return {
    fishing: fishing as unknown as FishingSystem,
    casts, given,
    get xp() { return state.xp; },
    get gold() { return state.gold; },
  };
}

/** Заброс, которым управляет тест: biteAt выставляется вручную */
function armed(h: Harness, castId = 'fish_test_1', deep = false): string {
  h.casts.set(castId, {
    characterId: 'c1', castId,
    // phase обязателен: сервер отвергает заброс без него как уже вынутый
    phase: 'waiting',
    biteAt: 0, waitTotalMs: 5000, deep, luck: 1,
  });
  return castId;
}

/** «Рыба клюнула N миллисекунд назад» — тест двигает серверные часы */
function bitAgo(h: Harness, castId: string, msAgo: number): void {
  const cast = h.casts.get(castId);
  if (cast) cast.biteAt = Date.now() - msAgo;
}

function reel(h: Harness, castId: string): Promise<ReelResult> {
  return h.fishing.reel('c1', castId) as Promise<ReelResult>;
}

describe('Границы воды', () => {
  it('озеро и пруд — вода, город — суша', () => {
    expect(isWater(LAKE.x, LAKE.z)).toBe(true);
    expect(isWater(620, 300)).toBe(true);
    expect(isWater(FIELD.x, FIELD.z)).toBe(false);
  });

  it('в центре озера глубоко, у кромки — мелко', () => {
    expect(isDeepWater(LAKE.x, LAKE.z)).toBe(true);
    // Кромка воды: вода есть, но глубины для плавания не хватает
    expect(isWater(SHORE.x, SHORE.z)).toBe(true);
    expect(isDeepWater(SHORE.x, SHORE.z)).toBe(false);
  });

  it('лодку нельзя поставить на мосту, хотя вода под ним есть', () => {
    // isWater отвечает «есть ли тут вода», мост её не отменяет —
    // под мостом как раз река. А вот плыть под мостом нельзя.
    expect(isWater(BRIDGE.x, BRIDGE.z)).toBe(true);
    expect(canFloatAt(BRIDGE.x, BRIDGE.z)).toBe(false);
    expect(canFloatAt(LAKE.x, LAKE.z)).toBe(true);
  });
});

describe('Заброс', () => {
  it('на суше ловить нечего', async () => {
    const h = makeHarness();
    const res = await h.fishing.cast('c1', FIELD);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('fishing_not_near_water');
  });

  it('в глубокой воде без лодки — отказ', async () => {
    const h = makeHarness({ boat: false });
    const res = await h.fishing.cast('c1', LAKE);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('fishing_need_boat');
  });

  it('на мелководье ловится и без лодки', async () => {
    const h = makeHarness({ boat: false });
    const res = await h.fishing.cast('c1', SHORE);
    expect(res.ok).toBe(true);
    expect(res.cast!.deep).toBe(false);
  });

  it('с лодкой заброс идёт в глубокую воду и повышает удачу', async () => {
    const h = makeHarness({ boat: true });
    const res = await h.fishing.cast('c1', LAKE);
    expect(res.ok).toBe(true);
    expect(res.cast!.deep).toBe(true);
    expect(res.cast!.luck).toBeGreaterThan(1);
  });

  it('второй заброс, пока первый не вынут, невозможен', async () => {
    const h = makeHarness({ boat: true });
    expect((await h.fishing.cast('c1', LAKE)).ok).toBe(true);
    const again = await h.fishing.cast('c1', LAKE);
    expect(again.ok).toBe(false);
    expect(again.code).toBe('fishing_already_cast');
  });

  it('выдуманная координата отклоняется', async () => {
    const h = makeHarness();
    const res = await h.fishing.cast('c1', { x: NaN, z: 0 });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('fishing_no_position');
  });

  it('уставшая лодка требует отдыха на берегу', async () => {
    const h = makeHarness({ boat: true });
    (h.fishing as unknown as { boats: { getActiveBoat: jest.Mock } })
      .boats.getActiveBoat.mockResolvedValue({
        characterId: 'c1', boatId: 'boat_caravel', isActive: true, fatigue: 25, totalCatches: 90,
      });
    const res = await h.fishing.cast('c1', LAKE);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('fishing_boat_tired');
  });
});

describe('Подсечка считается по серверным часам', () => {
  it('подсел раньше клева — пустая удочка', async () => {
    const h = makeHarness();
    const id = armed(h);
    bitAgo(h, id, -5000); // клюнет только через 5 секунд
    const res = await reel(h, id);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('fishing_too_early');
  });

  it('успел в окно — рыба поймана и выдана', async () => {
    const h = makeHarness();
    const id = armed(h);
    bitAgo(h, id, 200);
    const res = await reel(h, id);
    expect(res.ok).toBe(true);
    expect(res.fish).toBeDefined();
    expect(h.given).toHaveLength(1);
    expect(h.given[0].itemId).toBe(res.fish!.itemId);
    expect(h.xp).toBeGreaterThan(0);
    expect(h.gold).toBeGreaterThan(0);
  });

  it('опоздал за окно — рыба ушла, улова нет', async () => {
    const h = makeHarness();
    const id = armed(h);
    bitAgo(h, id, REEL_WINDOWS.LATE_MS + 500);
    const res = await reel(h, id);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('fishing_too_late');
    expect(h.given).toHaveLength(0);
  });

  it('подсечку нельзя провернуть повторно', async () => {
    const h = makeHarness();
    const id = armed(h);
    bitAgo(h, id, 100);
    expect((await reel(h, id)).ok).toBe(true);
    // Заброс помечен пойманным — второй reel ничего не принесёт
    const again = await reel(h, id);
    expect(again.ok).toBe(false);
    expect(['fishing_already_reeled', 'fishing_no_cast']).toContain(again.code);
    // Главное — награда не начисляется дважды
    expect(h.given).toHaveLength(1);
    const xpAfterFirst = h.xp;
    await reel(h, id);
    expect(h.xp).toBe(xpAfterFirst);
  });

  it('точная подсечка выгоднее обычной', async () => {
    // Улов случайный, поэтому сравниваем статистику на большой выборке:
    // «идеальная» подсечка тянет вверх по размеру рыбы и по награде.
    let обычныйXp = 0, обычныйРыба = 0, обычныйВес = 0;
    let точныйXp = 0, точныйРыба = 0, точныйВес = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const a = makeHarness();
      const ia = armed(a, `f_a_${i}`);
      bitAgo(a, ia, REEL_WINDOWS.GOOD_MS + 100);
      const ra = await reel(a, ia);
      if (ra.ok && ra.fish) { обычныйXp += ra.experience!; обычныйРыба++; обычныйВес += ra.fish.weightKg; }

      const b = makeHarness();
      const ib = armed(b, `f_b_${i}`);
      bitAgo(b, ib, 50);
      const rb = await reel(b, ib);
      if (rb.ok && rb.fish) { точныйXp += rb.experience!; точныйРыба++; точныйВес += rb.fish.weightKg; }
    }
    // Поимки не зависят от точности — окно одинаковое. Разница в размере
    expect(обычныйРыба).toBeGreaterThan(N * 0.95);
    expect(точныйРыба).toBeGreaterThan(N * 0.95);
    // ...и в награде за неё
    expect(точныйВес / точныйРыба).toBeGreaterThan(обычныйВес / обычныйРыба);
    expect(точныйXp / точныйРыба).toBeGreaterThan(обычныйXp / обычныйРыба);
  });

  it('чужой заброс не вытащить', async () => {
    const h = makeHarness();
    const id = armed(h);
    h.casts.get(id)!.characterId = 'someone-else';
    bitAgo(h, id, 100);
    const res = await reel(h, id);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('fishing_not_your_cast');
  });

  it('вынуть удочку можно, и это ничего не стоит', () => {
    const h = makeHarness();
    const id = armed(h);
    expect(h.fishing.cancel('c1', id)).toBe(true);
    expect(h.casts.size).toBe(0);
  });
});

describe('Кто ловится', () => {
  it('у каждой рыбы корректные параметры', () => {
    for (const f of FISH_TABLE) {
      expect(f.id.startsWith('fish_')).toBe(true);
      expect(f.weightKg).toBeGreaterThan(0);
      expect(f.weight).toBeGreaterThan(0);
      expect(f.minLevel).toBeGreaterThanOrEqual(1);
    }
  });

  it('глубоководная рыба помечена deepOnly и требует уровня', () => {
    const deep = FISH_TABLE.filter(f => f.deepOnly);
    expect(deep.length).toBeGreaterThan(0);
    for (const f of deep) expect(f.minLevel).toBeGreaterThanOrEqual(6);
  });

  it('с берега глубоководная рыба не выпадает (40 забросов)', async () => {
    const h = makeHarness({ level: 60 });
    for (let i = 0; i < 40; i++) {
      const id = `fish_shore_${i}`;
      armed(h, id, false);
      bitAgo(h, id, 100);
      const res = await reel(h, id);
      if (res.ok && res.fish) {
        const def = FISH_TABLE.find(f => f.id === res.fish!.itemId);
        expect({ id: res.fish.itemId, deep: def?.deepOnly ?? false })
          .toEqual({ id: res.fish.itemId, deep: false });
      }
    }
  });

  it('рыба выше уровня игрока не выпадает', async () => {
    const h = makeHarness({ level: 2 });
    for (let i = 0; i < 40; i++) {
      const id = `fish_low_${i}`;
      armed(h, id, true);
      bitAgo(h, id, 100);
      const res = await reel(h, id);
      if (res.ok && res.fish) {
        const def = FISH_TABLE.find(f => f.id === res.fish!.itemId);
        expect(def!.minLevel).toBeLessThanOrEqual(2);
      }
    }
  });
});
