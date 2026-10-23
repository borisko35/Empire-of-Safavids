// ============================================================
// Реестр реальных моделей персонажей (GLB) для NPC, монстров, жителей, животных
// ============================================================
// Использует инфраструктуру realRig: загрузитьСцену / загрузитьКлип.
// Процедурный buildHumanoid остаётся фолбэком, если модель не загрузилась.

import { загрузитьСцену, загрузитьКлип, RealRig } from './realRig';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { THREE } from './three-imports';
import type { Rig } from './rig';

// Карта: тип сущности -> файл модели (без .glb, лежит в /game/models/)

/** Humanoid NPCs -- переиспользуем существующие модели классов игрока + citizen* */
export const HUMANOID_MODEL_MAP: Record<string, string> = {
  // Стражи / солдаты
  'guard': 'guard-qizilbash',
  'guard-qizilbash': 'guard-qizilbash',
  'region_guard': 'guard-qizilbash',
  'city_guard': 'guard-qizilbash',
  'gate_guard': 'guard-qizilbash',
  'watch_guard': 'guard-qizilbash',
  'warden': 'guard-qizilbash',
  'sentry': 'guard-qizilbash',

  // Торговцы / ремесленники
  'merchant': 'market-vendor',
  'trader': 'market-vendor',
  'vendor': 'market-vendor',
  'shopkeeper': 'market-vendor',
  'blacksmith': 'market-vendor',
  'artisan': 'market-vendor',

  // Обычные жители (citizen, citizen2, citizen3 -- по очереди)
  'citizen': 'citizen',
  'citizen2': 'citizen2',
  'citizen3': 'citizen3',
  'townfolk': 'citizen',
  'villager': 'citizen',
  'peasant': 'citizen',
  'commoner': 'citizen',

  // Квестодатели / особые NPC
  'crier': 'court-diplomat',
  'herald': 'court-diplomat',
  'diplomat': 'court-diplomat',
  'noble': 'court-diplomat',
  'official': 'court-diplomat',
  'scholar': 'sufi-mystic',
  'mystic': 'sufi-mystic',
  'sufi': 'sufi-mystic',

  // Лучники / разведчики
  'archer': 'archer-of-persian',
  'scout': 'archer-of-persian',
  'ranger': 'archer-of-persian',
  'persian_archer': 'archer-of-persian',

  // Воители / наемники
  'warrior': 'paladin',
  'knight': 'paladin',
  'paladin': 'paladin',
  'champion': 'paladin',
  'veteran': 'paladin',

  // Бандиты / разбойники (гуманоидные -- переиспользуем citizen/guard с другим цветом)
  'bandit': 'citizen',
  'bandit_scout': 'citizen',
  'bandit_warrior': 'guard-qizilbash',
  'bandit_king': 'paladin',
  'raider': 'citizen',
  'reaver': 'citizen',
  'highwayman': 'citizen',
  'outlaw': 'citizen',

  // Османские / восточные
  'janissary': 'guard-qizilbash',
  'ottoman_janissary': 'guard-qizilbash',
  'pasha': 'paladin',
  'ottoman_pasha': 'paladin',

  // Монголо-татары / степные
  'mongol': 'archer-of-persian',
  'mongol_raider': 'archer-of-persian',
  'steppe_raider': 'archer-of-persian',

  // Некромантия / нежить
  'undead': 'citizen',
  'undead_guardian': 'guard-qizilbash',
  'skeleton': 'citizen',
  'zombie': 'citizen',
  'ghost': 'citizen',
  'spirit': 'sufi-mystic',

  // Элементали / духи
  'fire_spirit': 'sufi-mystic',
  'rain_spirit': 'sufi-mystic',
  'sand_elemental': 'sufi-mystic',
  'storm_djinn': 'sufi-mystic',
  'sand_div': 'sufi-mystic',

  // Демоны / дивы (buildDemon фолбэк -- нужен отдельный скелет)
  'demon': 'paladin',
  'div': 'paladin',
  'div_fire': 'paladin',
  'div_arzhang': 'paladin',
  'dust_lord': 'paladin',
  'horizon_terror': 'paladin',
  'limit_stalker': 'paladin',

  // Ассасины / убийцы
  'assassin': 'citizen',
  'assassin_acolyte': 'citizen',
  'fog_assassin': 'citizen',

  // Кавказ / восточные окраины
  'caucasus_guard': 'guard-qizilbash',
  'ridge_watch': 'guard-qizilbash',
  'border_warden': 'guard-qizilbash',

  // Пустынные / оазисные
  'oasis_lynx': 'citizen',
  'desert_scorpion': 'citizen',
  'caravan_raider': 'citizen',
  'corsair': 'citizen',
  'harbor_brute': 'guard-qizilbash',

  // Герат
  'herat_gate_guard': 'guard-qizilbash',
  'herat_road_reaver': 'citizen',
  'herat_dust_lord': 'paladin',

  // Дальние края
  'east_ridge_watch': 'guard-qizilbash',
  'east_road_reaver': 'citizen',
  'east_horizon_terror': 'paladin',
  'west_plain_stalker': 'citizen',
  'west_border_warden': 'guard-qizilbash',
  'west_limit_stalker': 'paladin',

  // Залив -- рыбы (нужны отдельные модели)
  'gulf_reef_raider': 'citizen',
  'gulf_depth_lurker': 'citizen',
  'gulf_leviathan_cub': 'citizen',

  // Озеро -- рыбы (нужны отдельные модели)
  'lake_piranha': 'citizen',
  'lake_sturgeon_horror': 'citizen',
  'lake_ghost_fish': 'citizen',
  'lake_leviathan': 'citizen',

  // Мировые боссы
  'simurgh': 'paladin',
  'rustam_reborn': 'paladin',

  // Дорожные бандиты
  'road_bandit': 'citizen',
};

/**
 * Монстры-гуманоиды -> настоящая GLB-модель.
 *
 * Сюда входят только те монстры, у которых процедурная сборка была
 * промежуточным решением: бандиты, стражи, янычары, монголы — люди, для
 * которых есть настоящие фигуры. Особые тела (скорпион, дивы, джинны,
 * симург, рыбы, волк с рысью) НЕ в списке: их процедурная форма — не
 * заглушка, а облик, и заменять её случайной человеческой моделью нельзя.
 * Волк, рысь и рыбы попадут сюда же, когда у них появятся свои модели
 * (QUADRUPED_MODEL_MAP / FISH_MODEL_MAP).
 */
export const MONSTER_REAL_MODEL: Record<string, string> = {
  // Монголы: модели из Enemies and monsters (конвертированы Blender-ом)
  'mob_bandit_scout': 'mongol-scout',
  'mob_bandit_warrior': 'mongol-bandit',
  'mob_mongol_raider': 'mongol-raider',

  // Османы
  'mob_ottoman_janissary': 'ottoman-janissary',
  'boss_ottoman_pasha': 'ottoman-soldier',

  // Дорожные и портые: обычные люди в халатах
  'mob_road_bandit': 'citizen',
  'mob_caravan_raider': 'citizen',
  'mob_corsair': 'citizen',
  'mob_assassin_acolyte': 'citizen',
  'mob_fog_assassin': 'citizen',
  'mob_herat_road_reaver': 'citizen',
  'mob_east_road_reaver': 'citizen',
  'mob_west_plain_stalker': 'citizen',

  // Бронированные: стражи и боссы-люди
  'mob_undead_guardian': 'guard-qizilbash',
  'mob_herat_gate_guard': 'guard-qizilbash',
  'mob_east_ridge_watch': 'guard-qizilbash',
  'mob_west_border_warden': 'guard-qizilbash',
  'boss_bandit_king': 'paladin',
  'world_boss_rustam_reborn': 'paladin',

  // Духи и стихии: халат мистика читается лучше голого гуманоида
  'mob_rain_spirit': 'sufi-mystic',
  'mob_sand_elemental': 'sufi-mystic',
};

/** Монстры-животные/четвероногие -- нужны свои модели */
export const QUADRUPED_MODEL_MAP: Record<string, string> = {
  'wolf': 'wolf',
  'lynx': 'lynx',
  'oasis_lynx': 'lynx',
  'bear': 'bear',
  'boar': 'boar',
  'deer': 'deer',
  'horse': 'horse',
  'sheep': 'sheep',
  'goat': 'goat',
  'cow': 'cow',
  'chicken': 'chicken',
};

/** Водные существа / рыбы */
export const FISH_MODEL_MAP: Record<string, string> = {
  'piranha': 'piranha',
  'sturgeon': 'sturgeon',
  'ghost_fish': 'ghost-fish',
  'leviathan': 'leviathan',
  'reef_raider': 'piranha',
  'depth_lurker': 'sturgeon',
  'leviathan_cub': 'leviathan',
};

/** Ключи клипов анимаций (файлы в /game/models/) */
export const ANIMATION_CLIPS = {
  // Базовые
  idle: 'standing-idle',
  walk: 'walking',
  run: 'running',
  crouchIdle: 'crouch-idle',
  crouchWalk: 'crouch-walk-forward',
  attack: 'sword-shield-attack',
  jump: 'jumping',
  jumpUp: 'jumping-up',
  jumpDown: 'jumping-down',
  death: 'death-fall-forward',
  deathBack: 'death-fall-back',
  block: 'block',
  blockCrouch: 'block-crouch',
  blockCrouchIdle: 'block-crouch-idle',
  swim: 'swim',
  swimIdle: 'swim-idle',
  hurt: 'hurt-flinch',
  dodgeForward: 'dodge-forward',
  dodgeBack: 'dodge-back',
  dodgeLeft: 'dodge-left',
  dodgeRight: 'dodge-right',
  // Дополнительные
  sitIdle: 'sit-idle',
  sitTalk: 'sit-talk',
  stopWalk: 'stop-walking',
  startWalk: 'start-walking',
  walkBack: 'walk-backward',
  runBack: 'running-backward',
  runSlide: 'running-slide',
  cheer: 'cheer-victory',
  swimToEdge: 'swim-to-edge',
} as const;

// Внутренний кэш загруженных сцен и клипов

const modelCache = new Map<string, Promise<THREE.Group | null>>();
const clipCache = new Map<string, Promise<THREE.AnimationClip | null>>();

/** Получить имя файла модели для типа сущности */
export function getModelName(entityType: string, fallback?: string): string {
  // Сначала пробуем humanoid map
  if (HUMANOID_MODEL_MAP[entityType]) {
    return HUMANOID_MODEL_MAP[entityType];
  }
  // Потом quadruped
  if (QUADRUPED_MODEL_MAP[entityType]) {
    return QUADRUPED_MODEL_MAP[entityType];
  }
  // Потом fish
  if (FISH_MODEL_MAP[entityType]) {
    return FISH_MODEL_MAP[entityType];
  }
  return fallback ?? 'citizen';
}

/** Загрузить сцену модели персонажа (с кэшированием) */
export async function loadCharacterModel(entityType: string, fallback?: string): Promise<THREE.Group | null> {
  const modelName = getModelName(entityType, fallback);
  let promise = modelCache.get(modelName);
  if (!promise) {
    promise = загрузитьСцену(modelName);
    modelCache.set(modelName, promise);
  }
  return promise;
}

/** Загрузить клип анимации (с кэшированием) */
export async function loadAnimationClip(clipKey: keyof typeof ANIMATION_CLIPS): Promise<THREE.AnimationClip | null> {
  const clipName = ANIMATION_CLIPS[clipKey];
  let promise = clipCache.get(clipName);
  if (!promise) {
    promise = загрузитьКлип(clipName);
    clipCache.set(clipName, promise);
  }
  return promise;
}

/** Загрузить несколько клипов сразу */
export async function loadAnimationClips(keys: (keyof typeof ANIMATION_CLIPS)[]): Promise<Map<keyof typeof ANIMATION_CLIPS, THREE.AnimationClip | null>> {
  const results = new Map<keyof typeof ANIMATION_CLIPS, THREE.AnimationClip | null>();
  await Promise.all(keys.map(async (k) => {
    const clip = await loadAnimationClip(k);
    results.set(k, clip);
  }));
  return results;
}

/** Предзагрузить модели для списка типов (для быстрого появления) */
export function preloadModels(types: string[]): void {
  for (const type of types) {
    const modelName = getModelName(type);
    if (!modelCache.has(modelName)) {
      modelCache.set(modelName, загрузитьСцену(modelName));
    }
  }
}

/** Очистить кэш (на выходе из зоны/меню) */
export function clearCharacterModelCache(): void {
  modelCache.clear();
  clipCache.clear();
}

/** Проверить, загружена ли модель в кэше */
export function isModelCached(entityType: string): boolean {
  const modelName = getModelName(entityType);
  return modelCache.has(modelName);
}

/** Получить все доступные имена моделей */
export function getAvailableModelNames(): string[] {
  const set = new Set<string>(
    ...Object.values(HUMANOID_MODEL_MAP),
    ...Object.values(MONSTER_REAL_MODEL),
    ...Object.values(QUADRUPED_MODEL_MAP),
    ...Object.values(FISH_MODEL_MAP)
  );
  return Array.from(set);
}

/**
 * Настоящий риг монстра, если у типа есть модель и клип покоя доехал.
 *
 * Возвращает RealRig — тот же интерфейс Rig, что у процедурных сборок:
 * вызывающий код подменяет риг целиком и больше ничего знать не обязан,
 * а переключение idle/ходьба/атака/смерть уезжает в общий механизм.
 * null означает «модели нет или она не разобралась» — монстр остаётся
 * на процедурной сборке, игра не падает.
 */
export async function loadRealMonsterRig(monsterId: string): Promise<Rig | null> {
  const modelName = MONSTER_REAL_MODEL[monsterId];
  if (!modelName) return null;
  const [scene, idle] = await Promise.all([
    загрузитьСцену(modelName),
    загрузитьКлип(ANIMATION_CLIPS.idle),
  ]);
  if (!scene || !idle) return null;
  try {
    // Скелет клонируется под каждого монстра: Object3D.clone оставил бы кости
    // общими с кешем, и миксер одного монстра двигал бы всех одинаковых.
    const clone = cloneSkeleton(scene) as THREE.Group;
    return new RealRig(clone, idle, modelName, null);
  } catch (e) {
    console.warn(`[monster] настоящий риг ${monsterId} не собрался:`, e);
    return null;
  }
}