// ============================================================
// Засада на караван — Шёлковый путь
// ============================================================
//
// ЗАЧЕМ. Пункт 4 очереди идей карты (ROADMAP §3): «Шёлковый путь» —
// грабёж караванов другими игроками. Торговля уже была: контракт, груз,
// караван в пути, срок, сдача. Но караван шёл в одиночку и в безопасности,
// и весь риск был на том, кто его принял. На дороге не было никого, кроме
// разбойников.
//
// ЧТО ЗДЕСЬ. Когда игрок принимает контракт, его караван становится виден
// всем, кто смотрит в торговлю. Другой игрок может заплатить гонорар и
// поднять конвой охраны на дороге. Победа — часть груза; поражение —
// потерянный гонорар и время.
//
// ПОЧЕМУ НЕ КАРАВАН-СУЩНОСТЬ, КОТОРЫЙ ЕДЕТ ПО МИРУ. Нужен был бы и пропуск
// пути, и вещание позиции, и модель верблюда — её в проекте нет, есть
// только trade-tent. Отрисовка потребовала бы художника, а игровая
// часть обошлась бы тем же боем. Поэтому засада поднимает конвой там,
// где игрок может сразу вступить в бой, а выигрыш забирается из груза.
//
// ПОЧЕМУ КОНВОЙ, А НЕ ОДИН МОНСТР. Один сильный страж — это не засада, а
// проверка удара: поймал или нет. Конвой из трёх-четырёх даёт ту самую
// картину, ради которой идея и стояла в очереди: дорога, толпа, отход.
//
// УРОВНИ. Подобраны под контракты, а не взяты с потолка: у `mob_bandit_scout`
// третий уровень, у `mob_road_bandit` восьмой, у `mob_caravan_raider`
// семидесятый. Пятидесятиуровневый караван на восьмиуровневом разбойнике
// выглядел бы как «засада невозможна», и идея молча умерла бы вместе с
// первым же контрактом низкого уровня.
import { Region } from '../types/game.types';

export interface EscortDef {
  monsterId: string;
  /** Сколько таких в конвое. */
  count: number;
  /** Смещение от точки засады. Конвой стоит вокруг, а не в одной точке. */
  offsetX: number;
  offsetZ: number;
}

export interface AmbushDef {
  /** Договор, чей караван охраняет этот конвой. */
  contractId: string;
  /** Гонорар за поднятую засаду. Списывается ДО боя. */
  bounty: number;
  /** Доля груза, доставшаяся победителю. Остальное — сгорело. */
  cargoShare: number;
  /** Сколько времени конвой стоит, пока игрок не победил или не сбежал. */
  durationSeconds: number;
  escorts: EscortDef[];
}

/**
 * Где происходит засада для каждого договора.
 *
 * Точка — караван-сарай у дороги, а не середина маршрута: игрок должен
 * добраться до неё пешком, и за это время он не может быть в другом
 * регионе, то есть логистика засады не рассыпается от того, что игрок
 * уехал.
 */
export const AMBUSH_POINTS: Partial<Record<Region, { x: number; z: number }>> = {
  [Region.ISFAHAN]: { x: 505, z: 55 },
  [Region.TABRIZ]: { x: 60, z: -250 },
  [Region.SHIRAZ]: { x: -60, z: 380 },
  [Region.CAUCASUS]: { x: 200, z: 545 },
  [Region.MESOPOTAMIA]: { x: 120, z: 750 },
  [Region.KHORASAN]: { x: -100, z: 1000 },
  [Region.HERAT]: { x: 60, z: 1300 },
};

/**
 * Точка засады для региона.
 *
 * Карта на семь регионов из десяти, и это не опечатка: дорожная засада
 * ставится у караван-сарая, а сараи есть не везде. Для остальных берётся
 * караван-сарай Исфахана — засада всё равно состоится, просто не там.
 *
 * Partial, а не Record с приведением: Record с `as unknown as` прошёл бы
 * типы с любым числом регионов и молча упал бы в рантайме на первом же
 * новом регионе — а Partial заставляет компилятор сказать об этом сразу.
 */
export function ambushPoint(region: Region): { x: number; z: number } {
  return AMBUSH_POINTS[region] ?? AMBUSH_POINTS[Region.ISFAHAN]!;
}

/**
 * Конвои по договорам.
 *
 * Гонорар — примерно шестая часть награды за контракт: засада опаснее
 * доставки и требует силы, но караван надо ещё поймать на дороге.
 */
export const AMBUSHES: AmbushDef[] = [
  {
    contractId: 'trade_tabriz_isfahan_silk',
    bounty: 120,
    cargoShare: 0.6,
    durationSeconds: 180,
    escorts: [
      { monsterId: 'mob_bandit_scout', count: 2, offsetX: -4, offsetZ: 3 },
      { monsterId: 'mob_desert_scorpion', count: 2, offsetX: 5, offsetZ: -3 },
    ],
  },
  {
    contractId: 'trade_isfahan_shiraz_saffron',
    bounty: 220,
    cargoShare: 0.6,
    durationSeconds: 180,
    escorts: [
      { monsterId: 'mob_bandit_scout', count: 2, offsetX: -5, offsetZ: 4 },
      { monsterId: 'mob_bandit_warrior', count: 2, offsetX: 5, offsetZ: -4 },
    ],
  },
  {
    contractId: 'trade_shiraz_caucasus_turquoise',
    bounty: 400,
    cargoShare: 0.65,
    durationSeconds: 240,
    escorts: [
      { monsterId: 'mob_road_bandit', count: 3, offsetX: -6, offsetZ: 3 },
      { monsterId: 'mob_bandit_warrior', count: 2, offsetX: 6, offsetZ: -4 },
    ],
  },
  {
    contractId: 'trade_caucasus_meso_ore',
    bounty: 700,
    cargoShare: 0.65,
    durationSeconds: 240,
    escorts: [
      { monsterId: 'mob_bandit_warrior', count: 3, offsetX: -6, offsetZ: 4 },
      { monsterId: 'mob_caravan_raider', count: 1, offsetX: 4, offsetZ: -6 },
    ],
  },
  {
    contractId: 'trade_isfahan_khorasan_scale',
    bounty: 1400,
    cargoShare: 0.7,
    durationSeconds: 300,
    escorts: [
      { monsterId: 'mob_caravan_raider', count: 2, offsetX: -7, offsetZ: 4 },
      { monsterId: 'mob_bandit_warrior', count: 3, offsetX: 7, offsetZ: -4 },
    ],
  },
];

export function ambushFor(contractId: string): AmbushDef | undefined {
  return AMBUSHES.find((a) => a.contractId === contractId);
}

/** Всего врагов в конвое — панели нужно знать, сколько их убивать. */
export function escortCount(def: AmbushDef): number {
  return def.escorts.reduce((n, e) => n + e.count, 0);
}