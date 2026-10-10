// ============================================================
// Spawn System — Empire of Safavids
// ============================================================
// Точки спавна на каждый игровой сервер (шард). Монстры шарда
// заспавнены, только пока на нём есть игроки (ленивый спавн):
// первый вошедший активирует шард, опустевший — выгружается.

import { Region } from '../types/game.types';
import { MONSTERS_DATABASE } from '../data/monsters';
import { AISystem, TargetPlayer } from './AISystem';
import { WorldTimeSystem, Weather, WEATHER_EFFECTS } from './WorldTimeSystem';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';
import { ShardLease } from './ShardLease';

export interface SpawnPoint {
  id: string;
  monsterId: string;
  region: Region;
  position: { x: number; y: number; z: number };
  maxCount: number;
  /** Текущее число живых монстров точки, по шардам */
  counts: Map<string, number>;
  /**
   * Срок воскресения точки, в секундах. Необязательное поле.
   *
   * ЧТО ЗДЕСЬ БЫЛО. Срок жил в двух местах, и одно из них было выдумкой:
   * MonsterDefinition.respawnTime заполнен у 41 монстра (от 30 секунд до двух
   * недель) и не читался НИГДЕ, а это поле было обязательным у всех 53 точек.
   * Чтобы изменить срок появления монстра, надо было найти и править каждую
   * его точку, а значение прямо на монстре ничего не значило.
   *
   * Теперь поле - исключение (своя погода, свой лагерь), а монстр основной
   * источник. Не задано - берётся у монстра; нет и у него - запас.
   */
  respawnTime?: number;
  lastDeath: Record<string, number>; // shardId -> момент смерти
  weatherBonus: Partial<Record<Weather, number>>; // модификатор спавна
}

function makePoint(p: Omit<SpawnPoint, 'counts' | 'lastDeath'>): SpawnPoint {
  return { ...p, counts: new Map(), lastDeath: {} };
}

// Исфахан (столица): мобы внутри стен не спавнятся.
// Координаты продублированы из клиента (game3d/terrain.ts CITY) намеренно:
// сервер не тянет клиентский модуль, а стены двигаются редко.
const ISFAHAN = { x: 34, z: 26, radius: 116 };

// Точки спавна (шаблон; экземпляры создаются на каждый активный шард)
//
// ЧТО БЫЛО. Точки лежали одной кучей у столицы (z от -230 до 230), а
// объявляли при этом семь разных регионов. Из 20 точек только 4 стояли
// в своём регионе; Великий Симург, квест про которого говорит «в горах
// Хорасана», стоял в Тебризе (0, 0). Это молчало: монстр появлялся,
// объявлялся в канал своего региона и стоял за 600 метров от игроков
// этого региона.
//
// ХУЖЕ. Регион читался в ДВУХ местах, и это были разные поля:
// объявление спавна шло по sp.region (регион точки), а ИИ искал игроков
// по ctx.definition.region (регион МОНСТРА). У mob_bandit_scout регион
// объявлен TABRIZ, а спавнился он в точке, объявленной SHIRAZ. То есть
// Ширазу показывали «вот монстр», а бить этот монстр шёл в Тебриз:
// видно одному, достаётся другому. Ни то ни другое не падало.
//
// Теперь: точка стоит в зоне своего региона, регион точки совпадает с
// регионом монстра, и обе вещи проверяются тестом.
const SPAWN_POINTS: SpawnPoint[] = [
  // ─ Исфахан (столица). Внутри стен не спавним: точки вынесены за
  // ISFAHAN.radius + 15, и spawnMonster дополнительно отсекает их.
  // isfahan_center (z -50..33) - безопасная зона, поэтому монстры стоят
  // в outskirts (33..117) и north (117..200), как и зоны по уровню:
  // тут 3-8 уровень.
  makePoint({ id: 'sp_isf_out_01',  monsterId: 'mob_bandit_scout',      region: Region.ISFAHAN, position: { x: 280,  y: 0, z: 60  }, maxCount: 5, respawnTime: 60,  weatherBonus: {} }),
  makePoint({ id: 'sp_isf_out_02',  monsterId: 'mob_desert_scorpion', region: Region.ISFAHAN, position: { x: -380, y: 0, z: 75  }, maxCount: 4, respawnTime: 45,  weatherBonus: { sandstorm: 2.0 } }),
  makePoint({ id: 'sp_isf_out_03',  monsterId: 'mob_road_bandit',     region: Region.ISFAHAN, position: { x: 350,  y: 0, z: 105 }, maxCount: 4, respawnTime: 75,  weatherBonus: {} }),
  makePoint({ id: 'sp_isf_nth_01',  monsterId: 'mob_wolf',            region: Region.ISFAHAN, position: { x: 200,  y: 0, z: 150 }, maxCount: 3, respawnTime: 60,  weatherBonus: { fog: 1.5 } }),
  makePoint({ id: 'sp_isf_nth_02',  monsterId: 'mob_bandit_scout',    region: Region.ISFAHAN, position: { x: -300, y: 0, z: 160 }, maxCount: 5, respawnTime: 60,  weatherBonus: {} }),
  makePoint({ id: 'sp_isf_nth_03',  monsterId: 'mob_bandit_warrior',  region: Region.ISFAHAN, position: { x: 150,  y: 0, z: 190 }, maxCount: 3, respawnTime: 90,  weatherBonus: { fog: 1.5 } }),
  makePoint({ id: 'sp_isf_nth_04',  monsterId: 'mob_wolf',            region: Region.ISFAHAN, position: { x: -330, y: 0, z: 195 }, maxCount: 3, respawnTime: 60,  weatherBonus: {} }),

  // ─ Тебриз (z -350..-150, 20-25 уровень). Озеро на (-420,-160) r=170
  // физически лежит в этой полосе, поэтому подводные существа стоят
  // внутри LAKE - иначе ИИ не удержит их в воде и они «зависнут» на
  // берегу. Сухопутные точки от lake держатся подальше: радиус 170.
  makePoint({ id: 'sp_tab_baz_rain', monsterId: 'mob_rain_spirit',     region: Region.TABRIZ, position: { x: -100, y: 0, z: -320 }, maxCount: 3, respawnTime: 120, weatherBonus: { rain: 2.0 } }),
  makePoint({ id: 'sp_lake_piranha',  monsterId: 'mob_lake_piranha',          region: Region.TABRIZ, position: { x: -420, y: 0, z: -300 }, maxCount: 3, respawnTime: 40,  weatherBonus: {} }),
  makePoint({ id: 'sp_lake_sturgeon', monsterId: 'mob_lake_sturgeon_horror', region: Region.TABRIZ, position: { x: -480, y: 0, z: -250 }, maxCount: 2, respawnTime: 75,  weatherBonus: { fog: 1.4 } }),
  makePoint({ id: 'sp_tab_gate_king',  monsterId: 'boss_bandit_king',          region: Region.TABRIZ, position: { x: 60,   y: 0, z: -250 }, maxCount: 1, respawnTime: 3600, weatherBonus: {} }),
  makePoint({ id: 'sp_tab_gate_acol',  monsterId: 'mob_assassin_acolyte',      region: Region.TABRIZ, position: { x: -150, y: 0, z: -240 }, maxCount: 4, respawnTime: 120, weatherBonus: { fog: 1.3 } }),
  makePoint({ id: 'sp_lake_ghost',    monsterId: 'mob_lake_ghost_fish',       region: Region.TABRIZ, position: { x: -380, y: 0, z: -200 }, maxCount: 1, respawnTime: 150, weatherBonus: { storm: 1.6 } }),
  makePoint({ id: 'sp_lake_leviathan', monsterId: 'mob_lake_leviathan',       region: Region.TABRIZ, position: { x: -450, y: 0, z: -180 }, maxCount: 1, respawnTime: 900, weatherBonus: {} }),
  makePoint({ id: 'sp_tab_sou_elem',  monsterId: 'mob_sand_elemental',       region: Region.TABRIZ, position: { x: 120,  y: 0, z: -170 }, maxCount: 3, respawnTime: 240, weatherBonus: { sandstorm: 2.0 } }),

  // ─ Шираз (z 350..500, 40-45 уровень). Монстры 35-45.
  // ─ Шираз (z 350..500, 40-45 уровень). Джинн и янычар - 35 уровня,
  // разрыв с зоной от 40 равен 5.
  makePoint({ id: 'sp_shir_gar_dji', monsterId: 'mob_storm_djinn',     region: Region.SHIRAZ, position: { x: -60,  y: 0, z: 380 }, maxCount: 3, respawnTime: 180, weatherBonus: { storm: 2.0 } }),
  makePoint({ id: 'sp_shir_gar_01',  monsterId: 'mob_fog_assassin',    region: Region.SHIRAZ, position: { x: 80,   y: 0, z: 395 }, maxCount: 2, respawnTime: 240, weatherBonus: { fog: 2.0 } }),
  makePoint({ id: 'sp_shir_wal_01',  monsterId: 'mob_undead_guardian', region: Region.SHIRAZ, position: { x: -120, y: 0, z: 425 }, maxCount: 3, respawnTime: 300, weatherBonus: {} }),
  makePoint({ id: 'sp_shir_wal_jan', monsterId: 'mob_ottoman_janissary', region: Region.SHIRAZ, position: { x: 40, y: 0, z: 440 }, maxCount: 4, respawnTime: 300, weatherBonus: { sandstorm: 1.3 } }),
  makePoint({ id: 'sp_shir_eas_01',  monsterId: 'mob_fog_assassin',    region: Region.SHIRAZ, position: { x: 150,  y: 0, z: 470 }, maxCount: 2, respawnTime: 240, weatherBonus: { fog: 2.0 } }),
  makePoint({ id: 'sp_shir_eas_02',  monsterId: 'mob_undead_guardian', region: Region.SHIRAZ, position: { x: -60,  y: 0, z: 490 }, maxCount: 3, respawnTime: 300, weatherBonus: {} }),

  // ─ Кавказ (z 500..700, 50-60 уровень). Монстры 55 уровня: разрыв
  // с зоной от 60 равен 5.
  makePoint({ id: 'sp_cauc_pas_div', monsterId: 'mob_sand_div',        region: Region.CAUCASUS, position: { x: -150, y: 0, z: 530 }, maxCount: 3, respawnTime: 600, weatherBonus: { sandstorm: 2.0 } }),
  makePoint({ id: 'sp_cauc_pas_mon', monsterId: 'mob_mongol_raider',   region: Region.CAUCASUS, position: { x: 200,  y: 0, z: 545 }, maxCount: 3, respawnTime: 600, weatherBonus: { snow: 1.4 } }),
  makePoint({ id: 'sp_cauc_for_01',  monsterId: 'mob_sand_div',        region: Region.CAUCASUS, position: { x: 150,  y: 0, z: 600 }, maxCount: 3, respawnTime: 600, weatherBonus: { storm: 1.6 } }),
  makePoint({ id: 'sp_cauc_pek_01',  monsterId: 'mob_mongol_raider',   region: Region.CAUCASUS, position: { x: 60,   y: 0, z: 660 }, maxCount: 3, respawnTime: 600, weatherBonus: { snow: 1.6 } }),

  // ─ Месопотамия (z -550..-350, 60-70 уровень). Огненный див - 65.
  // Русло RIVER_A идёт по x примерно -350..-412, точки от него отведены.
  makePoint({ id: 'sp_meso_riv_01', monsterId: 'mob_div_fire',          region: Region.MESOPOTAMIA, position: { x: 140,  y: 0, z: -515 }, maxCount: 3, respawnTime: 1800, weatherBonus: { storm: 2.0 } }),
  makePoint({ id: 'sp_meso_run_01', monsterId: 'mob_div_fire',          region: Region.MESOPOTAMIA, position: { x: -80,  y: 0, z: -450 }, maxCount: 3, respawnTime: 1800, weatherBonus: { storm: 2.0 } }),
  makePoint({ id: 'sp_meso_fro_pasha', monsterId: 'boss_ottoman_pasha',  region: Region.MESOPOTAMIA, position: { x: 200,  y: 0, z: -380 }, maxCount: 1, respawnTime: 7200, weatherBonus: {} }),

  // ─ Хорасан (z 700..1050, 70-80 уровень).
  // Раньше oasis (70) стоял пустым: обычных монстров 70-80 уровня в базе
  // не было вообще. Теперь есть - налётчик (70) и рысь (72).
  makePoint({ id: 'sp_khor_oas_raid', monsterId: 'mob_caravan_raider', region: Region.KHORASAN, position: { x: -150, y: 0, z: 750 }, maxCount: 3, respawnTime: 1200, weatherBonus: {} }),
  makePoint({ id: 'sp_khor_oas_lynx', monsterId: 'mob_oasis_lynx',    region: Region.KHORASAN, position: { x: 200,  y: 0, z: 780 }, maxCount: 3, respawnTime: 1500, weatherBonus: { fog: 1.4 } }),
  // Караван-сарай (75) наполнен боссом Арзхангом - зона не пустая.
  makePoint({ id: 'sp_khor_car_arzh', monsterId: 'boss_div_arzhang',   region: Region.KHORASAN, position: { x: 180,  y: 0, z: 870  }, maxCount: 1, respawnTime: 10800, weatherBonus: {} }),
  makePoint({ id: 'sp_khor_eas_arzh', monsterId: 'boss_div_arzhang',   region: Region.KHORASAN, position: { x: 250,  y: 0, z: 980 }, maxCount: 1, respawnTime: 10800, weatherBonus: {} }),
  // Симург - 90 уровень, и теперь действительно в Хорасане.
  makePoint({ id: 'sp_khor_eas_simurgh', monsterId: 'world_boss_simurgh', region: Region.KHORASAN, position: { x: 0, y: 100, z: 1450 }, maxCount: 1, respawnTime: 604800, weatherBonus: {} }),

  // ─ Персидский залив (z -1100..-550, 80-90 уровень).
  // ОСТОРОЖНО, и это не опечатка: моря в мире НЕТ. В terrain.ts вода -
  // только LAKE (-420,-160), POND и русла RIVER_A/RIVER_B. Зона
  // «Залив — воды» стоит на суше. Монстр залива поэтому наземный, и
  // поставить его в воду нельзя: он там утонет (или будет стоять в
  // воздухе над сушей).
  makePoint({ id: 'sp_gulf_isl_rustam', monsterId: 'world_boss_rustam_reborn', region: Region.PERSIAN_GULF, position: { x: 40, y: 0, z: -620 }, maxCount: 1, respawnTime: 1209600, weatherBonus: {} }),
  // Гавань (80) тоже была пустой - добавлены корсар (80) и головорез (80).
  makePoint({ id: 'sp_gulf_har_cors',  monsterId: 'mob_corsair',       region: Region.PERSIAN_GULF, position: { x: -55, y: 0, z: -985 }, maxCount: 4, respawnTime: 1800, weatherBonus: { storm: 1.4 } }),
  makePoint({ id: 'sp_gulf_har_brute', monsterId: 'mob_harbor_brute',  region: Region.PERSIAN_GULF, position: { x: 60,  y: 0, z: -1010 }, maxCount: 2, respawnTime: 2100, weatherBonus: {} }),
  // Вода залива (85-90). Точки стоят там, где маска моря высокая, - иначе
  // ИИ вытащил бы подводных монстров на берег, а они там зависли бы.
  makePoint({ id: 'sp_gulf_wat_reef',  monsterId: 'mob_gulf_reef_raider',    region: Region.PERSIAN_GULF, position: { x: -140, y: 0, z: -790 }, maxCount: 4, respawnTime: 900,  weatherBonus: { storm: 1.4 } }),
  makePoint({ id: 'sp_gulf_wat_lurk',  monsterId: 'mob_gulf_depth_lurker',   region: Region.PERSIAN_GULF, position: { x: 180,  y: 0, z: -840 }, maxCount: 2, respawnTime: 1500, weatherBonus: {} }),
      // ── Герат: восьмой регион ────────────────────────────────────────
      makePoint({ id: 'sp_herat_gate_watch', monsterId: 'mob_herat_gate_guard',  region: Region.HERAT, position: { x: -500, y: 0, z: 1900 }, maxCount: 3, respawnTime: 900, weatherBonus: {} }),
      makePoint({ id: 'sp_herat_road_ambush', monsterId: 'mob_herat_road_reaver', region: Region.HERAT, position: { x: -300, y: 0, z: 2450 }, maxCount: 3, respawnTime: 900, weatherBonus: {} }),
      makePoint({ id: 'sp_herat_dust_lord',  monsterId: 'mob_herat_dust_lord',   region: Region.HERAT, position: { x: -900, y: 0, z: 2850 }, maxCount: 1, respawnTime: 3600, weatherBonus: {} }),
  // ── Дальние края: девятый и десятый регионы ──────────────────────────
  // Точки лежат внутри своих зон, иначе монстр, помеченный регионом
  // востока, стоял бы в регионе Исфахана. Координаты взяты под границы
  // полос: восток x 2350..3175, запад x -3175..-2350.
  makePoint({ id: 'sp_east_outpost_gate',  monsterId: 'mob_east_ridge_watch',    region: Region.EAST_FRONTIER, position: { x: 2500, y: 0, z: 300 }, maxCount: 3, respawnTime: 900, weatherBonus: {} }),
  makePoint({ id: 'sp_east_road_ambush',  monsterId: 'mob_east_road_reaver',    region: Region.EAST_FRONTIER, position: { x: 2900, y: 0, z: 500 }, maxCount: 3, respawnTime: 1000, weatherBonus: {} }),
  makePoint({ id: 'sp_east_road_pass',    monsterId: 'mob_east_road_reaver',    region: Region.EAST_FRONTIER, position: { x: 2700, y: 0, z: 1500 }, maxCount: 2, respawnTime: 1100, weatherBonus: {} }),
  makePoint({ id: 'sp_east_horizon',      monsterId: 'mob_east_horizon_terror', region: Region.EAST_FRONTIER, position: { x: 2600, y: 0, z: 2400 }, maxCount: 1, respawnTime: 3600, weatherBonus: {} }),
  makePoint({ id: 'sp_east_horizon_deep', monsterId: 'mob_east_horizon_terror', region: Region.EAST_FRONTIER, position: { x: 2900, y: 0, z: 2900 }, maxCount: 1, respawnTime: 3600, weatherBonus: {} }),
  makePoint({ id: 'sp_west_outpost_gate', monsterId: 'mob_west_plain_stalker',   region: Region.WEST_FRONTIER, position: { x: -2500, y: 0, z: 200 }, maxCount: 3, respawnTime: 900, weatherBonus: {} }),
  makePoint({ id: 'sp_west_plain_hunt',   monsterId: 'mob_west_plain_stalker',   region: Region.WEST_FRONTIER, position: { x: -2900, y: 0, z: 900 }, maxCount: 3, respawnTime: 1000, weatherBonus: {} }),
  makePoint({ id: 'sp_west_road_ambush',  monsterId: 'mob_west_border_warden',   region: Region.WEST_FRONTIER, position: { x: -2600, y: 0, z: 1700 }, maxCount: 2, respawnTime: 1100, weatherBonus: {} }),
  makePoint({ id: 'sp_west_road_warden',  monsterId: 'mob_west_border_warden',   region: Region.WEST_FRONTIER, position: { x: -2900, y: 0, z: 2200 }, maxCount: 2, respawnTime: 1200, weatherBonus: {} }),
  makePoint({ id: 'sp_west_limit',        monsterId: 'mob_west_limit_stalker',   region: Region.WEST_FRONTIER, position: { x: -2700, y: 0, z: 2700 }, maxCount: 1, respawnTime: 3600, weatherBonus: {} }),
  makePoint({ id: 'sp_west_limit_deep',   monsterId: 'mob_west_limit_stalker',   region: Region.WEST_FRONTIER, position: { x: -2900, y: 0, z: 3000 }, maxCount: 1, respawnTime: 3600, weatherBonus: {} }),
  makePoint({ id: 'sp_gulf_wat_cub',   monsterId: 'mob_gulf_leviathan_cub', region: Region.PERSIAN_GULF, position: { x: -40,  y: 0, z: -760 }, maxCount: 1, respawnTime: 2400, weatherBonus: {} }),
  // Зона persian_gulf_waters (от 85) остаётся пустой: ей нужен залив, а
  // моря в мире нет. Это зафиксировано в spawnPlacement.test.ts как
  // известная дыра, чтобы она не росла молча.
];

export class SpawnSystem {
  private ai          = new AISystem();
  private worldTime   = new WorldTimeSystem();
  private redis       = RedisService.getInstance();
  private spawnPoints = new Map<string, SpawnPoint>();
  /** instanceId -> { shardId, spawnPointId } */
  private instanceIndex = new Map<string, { shardId: string; spawnPointId: string }>();
  /** Активные шарды: на них заспавнены монстры и идёт тик */
  private activeShards = new Set<string>();

  constructor() {
    for (const sp of SPAWN_POINTS) {
      this.spawnPoints.set(sp.id, sp);
    }
  }

  // ── Управление шардами ─────────────────────────────────────

  /** Первый игрок вошёл в шард — заселить монстров */
  /**
   * Активировать шард — но только если он НАШ.
   *
   * ЧТО ЗДЕСЬ БЫЛО. Метод клал shardId в локальный Set безусловно, и при
   * двух инстансах оба активировали каждый шард. Два процесса спавнили бы
   * одних и техых монстров: два набора с разными instanceId, объявленных
   * всем, но бить можно только своего. Снаружи это видно как двойная толпа,
   * одна из которой невосприимчивы.
   *
   * Теперь шард берётся в аренду. Не взял — не активируем: чужой спавн и
   * чужой бой. Это шаг B масштабирования: бой остался локальным (перенос
   * контекста в Redis — шаг A), но перестал двоиться.
   */
  async activateShard(shardId: string, аренда?: ShardLease): Promise<boolean> {
    if (this.activeShards.has(shardId)) return true;
    const моя = аренда ? await аренда.acquire(shardId) : true;
    if (!моя) return false;
    this.activeShards.add(shardId);
    logger.info(`[Spawn] Shard activated: ${shardId}`);
    return true;
  }

  /** Шард опустел — убрать его монстров из мира */
  deactivateShard(shardId: string): void {
    if (!this.activeShards.has(shardId)) return;
    const ai = this.ai;
    for (const ctx of ai.getAllInstances()) {
      if (ctx.shardId === shardId) {
        ai.removeInstance(ctx.instanceId);
        this.instanceIndex.delete(ctx.instanceId);
        for (const sp of this.spawnPoints.values()) sp.counts.delete(shardId);
      }
    }
    this.activeShards.delete(shardId);
    logger.info(`[Spawn] Shard deactivated: ${shardId}`);
  }

  getActiveShards(): string[] {
    return [...this.activeShards];
  }

  isShardActive(shardId: string): boolean {
    return this.activeShards.has(shardId);
  }

  // ── Тик системы спавна (1 раз в секунду) ───────────────────
  tick(): void {
    const now = Date.now();
    const worldTime = this.worldTime.getCurrentWorldTime();

    for (const sid of this.activeShards) {
      for (const sp of this.spawnPoints.values()) {
        const current = sp.counts.get(sid) ?? 0;
        if (current >= sp.maxCount) continue;

        // Запас, если ни точка, ни монстр не задали срок. Час - давно
        // устоявшееся значение: дольше ждать скучно, короче - толпа.
        const ЗАПАС_РЕСПАВНА = 3600;
        const elapsed = (now - (sp.lastDeath[sid] ?? 0)) / 1000;
        // Срок берётся у точки, а если точка не задала - у монстра.
        //
        // ЧТО ЗДЕСЬ БЫЛО. Срок жил в двух местах и одно из них было выдумкой:
        // MonsterDefinition.respawnTime заполнен у 41 монстра (от 30 секунд до
        // двух недель) и не читался НИГДЕ, а SpawnPoint.respawnTime задан у
        // всех 53 точек. То есть чтобы изменить срок появления монстра, надо
        // было найти и править каждую его точку, а значение, лежащее прямо на
        // монстре, ничего не значило.
        //
        // Теперь монстр - основной источник, точка - исключение (своя погода,
        // свой лагерь). Настройка в одном месте перестаёт быть поиском по
        // всему файлу.
        const определение = MONSTERS_DATABASE[sp.monsterId];
        let respawnTime =
          sp.respawnTime ?? определение?.respawnTime ?? ЗАПАС_РЕСПАВНА;

        // Погодный модификатор точки (у точки свой список погод).
        const weatherMod = sp.weatherBonus[worldTime.weather] ?? 1.0;
        respawnTime = respawnTime / weatherMod;

        // ОБЩИЙ МНОЖИТЕЛЬ ПОГОДЫ. WEATHER_EFFECTS объявлял spawnMod
        // («сколько монстров появляется в эту погоду»), и его не читал
        // никто: погода меняла картинку в небе и скорость респавна у
        // точек с weatherBonus, а больше ни на что не влияла.
        const effect = WEATHER_EFFECTS[worldTime.weather];

        // ПОГОДНЫЕ МОНСТРЫ. WEATHER_EFFECTS[...].specialMobs перечислял
        // монстров «уникальных в эту погоду», и этот список не читался
        // нигде: ни одним поиском по репозиторию. Теперь монстр из
        // списка в своей погоде появляется заметно чаще.
        //
        // Дополнительный множитель - тот же объявленный spawnMod, а не
        // новая константа: придумывать число рядом с уже объявленным
        // нечем. Итог в буре, где spawnMod = 1.5: обычный монстр в 1.5
        // раза быстрее, погодный - в 2.25 раза.
        //
        // Это НЕ «только в эту погоду»: джинн и туманный убийца стоят в
        // обычных точках и в ясную погоду тоже. Делать их исчезающими -
        // решение о балансе, а не починка мёртвого поля.
        if (effect.specialMobs.includes(sp.monsterId)) {
          respawnTime = respawnTime / effect.spawnMod;
        }

        // Ночью монстры респят быстрее
        if (worldTime.timeOfDay === 'night' || worldTime.timeOfDay === 'midnight') {
          respawnTime *= 0.7;
        }

        if (elapsed >= respawnTime) {
          this.spawnMonster(sp, sid);
        }
      }
    }
  }

  // ── Спавн монстра ───────────────────────────────────────────
  private spawnMonster(sp: SpawnPoint, shardId: string): void {
    const def = MONSTERS_DATABASE[sp.monsterId];
    if (!def) return;

    // Страховка от расширения города: не спавнить внутри стен Исфахана.
    // (точки уже вынесены, это защита от будущих правок данных)
    if (Math.hypot(sp.position.x - ISFAHAN.x, sp.position.z - ISFAHAN.z) < ISFAHAN.radius + 15) {
      logger.debug(`[Spawn] skipped ${sp.id}: inside city walls`);
      return;
    }

    // Случайный разброс позиции
    const jitter = 5;
    const pos = {
      x: sp.position.x + (Math.random() - 0.5) * jitter,
      y: sp.position.y,
      z: sp.position.z + (Math.random() - 0.5) * jitter,
    };

    const ctx = this.ai.spawnMonster(def, pos, shardId);
    sp.counts.set(shardId, (sp.counts.get(shardId) ?? 0) + 1);
    this.instanceIndex.set(ctx.instanceId, { shardId, spawnPointId: sp.id });

    // Уведомляем игроков шарда в регионе
    this.redis.publish(`region:${shardId}:${sp.region}:spawn`, {
      instanceId: ctx.instanceId,
      monsterId: def.id,
      nameRu: def.nameRu,
      position: pos,
      hp: def.hp,
      type: def.type,
      // Клиенту нужно знать, кого рисовать на поверхности: подводное
      // существо торчит из воды спиной, а не висит на SWIM_FEET под ней,
      // иначе его не видно и не в кого бить
      aquatic: def.aquatic === true,
      aquaticSize: def.aquaticSize,
    }).catch(() => {});

    logger.debug(`[Spawn] ${def.nameRu} spawned at ${sp.region} on ${shardId} (${sp.id})`);
  }

  // ── Смерть монстра ──────────────────────────────────────────
  onMonsterDeath(instanceId: string, spawnPointId: string, shardId: string): void {
    const sp = this.spawnPoints.get(spawnPointId);
    if (sp) {
      sp.counts.set(shardId, Math.max(0, (sp.counts.get(shardId) ?? 0) - 1));
      sp.lastDeath[shardId] = Date.now();
    }
    this.instanceIndex.delete(instanceId);
    logger.debug(`[Spawn] Monster ${instanceId} died on ${shardId}, respawn in ${sp?.respawnTime}s`);
  }

  /**
   * Смерть монстра по instanceId (убит игроком через сокет).
   */
  onInstanceDeath(instanceId: string): void {
    const info = this.instanceIndex.get(instanceId);
    if (!info) return;
    this.onMonsterDeath(instanceId, info.spawnPointId, info.shardId);
  }

  // ── Тик ИИ ──────────────────────────────────────────────────
  /**
   * Тик ИИ всех активных монстров. Игроки передаются по ключу
   * «шард:регион» — монстр видит только игроков своего шарда.
   */
  tickAI(nearbyPlayers: Map<string, TargetPlayer[]>): {
    shardId: string; region: Region; instanceId: string; targetId?: string; skillId?: string; type: string;
  }[] {
    const attacks: { shardId: string; region: Region; instanceId: string; targetId?: string; skillId?: string; type: string }[] = [];
    for (const ctx of this.ai.getAllInstances()) {
      const players = nearbyPlayers.get(`${ctx.shardId}:${ctx.definition.region}`) ?? [];
      const action = this.ai.tick(ctx.instanceId, players);
      if (action.type !== 'idle') {
        this.redis.publish(`region:${ctx.shardId}:${ctx.definition.region}:ai_action`, {
          instanceId: ctx.instanceId,
          action,
        }).catch(() => {});
      }
      if ((action.type === 'attack' || action.type === 'skill') && action.targetId) {
        attacks.push({
          shardId: ctx.shardId,
          region: ctx.definition.region,
          instanceId: ctx.instanceId,
          targetId: action.targetId,
          skillId: action.skillId,
          type: action.type,
        });
      }
    }
    return attacks;
  }

  getAI(): AISystem { return this.ai; }
}
