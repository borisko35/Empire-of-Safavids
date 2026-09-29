// ============================================================
// Рыбалка — Empire of Safavids
// ============================================================
// Игрок забрасывает удочку, ждёт поклёвку и должен подсечь вовремя.
//
// Ключевое решение: ВРЕМЯ РЕАКЦИИ СЧИТАЕТ СЕРВЕР, по своим часам.
// Клиент присылает только факт «подсёк», а реакция считается как
// Date.now() - biteAt. Иначе любой желающий отправлял бы reel с
// задержкой 0 мс и вылавливал редкую рыбу пачками.
//
// Весь улов приходит серверу, а не клиенту: клиент лишь рисует
// поплавок и показывает добычу.

import { CharacterService } from '../services/CharacterService';
import { DailyTaskService } from '../services/DailyTaskService';
import { isWater, isDeepWater } from '../utils/spawn';
import { BoatSystem, getBoatDef } from './BoatSystem';
import { logger } from '../utils/logger';

export type FishRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface FishDefinition {
  id: string;              // id предмета в ITEMS_DATABASE
  name: string;
  nameRu: string;
  rarity: FishRarity;
  /** Вес в условных граммах — определяет размер улова в описании */
  weightKg: number;
  /** Базовый вес в таблице (шанс выбора) */
  weight: number;
  /** Требуется глубина: с берега ловится только то, что мелкое */
  deepOnly?: boolean;
  minLevel: number;
}

export const FISH_TABLE: FishDefinition[] = [
  // ── Мелководье: ловятся с берега ──
  { id: 'fish_sprat',     name: 'Sprat',         nameRu: 'Мелкая Рыбка',     rarity: 'common',    weightKg: 0.15, weight: 100, minLevel: 1 },
  { id: 'fish_crucian',   name: 'Crucian Carp',  nameRu: 'Карп',             rarity: 'common',    weightKg: 0.9,  weight: 70,  minLevel: 1 },
  { id: 'fish_pike',      name: 'Pike',          nameRu: 'Щука',             rarity: 'uncommon',  weightKg: 4.5,  weight: 34,  minLevel: 5 },
  { id: 'fish_sturgeon',  name: 'Sturgeon',      nameRu: 'Осётр',            rarity: 'uncommon',  weightKg: 11,   weight: 20,  minLevel: 8 },
  { id: 'fish_catfish',   name: 'Catfish',       nameRu: 'Сом',              rarity: 'common',    weightKg: 8,    weight: 18,  minLevel: 3 },

  // ── Только с лодки: уходят туда, где глубоко ──
  { id: 'fish_belly_sole', name: 'Belly Sole',   nameRu: 'Камбала',          rarity: 'uncommon',  weightKg: 2.2,  weight: 40, deepOnly: true, minLevel: 6 },
  { id: 'fish_sea_bass',   name: 'Sea Bass',     nameRu: 'Морской Окунь',     rarity: 'rare',      weightKg: 6.5,  weight: 14, deepOnly: true, minLevel: 14 },
  { id: 'fish_tuna',       name: 'Tuna',         nameRu: 'Тунец',            rarity: 'rare',      weightKg: 42,   weight: 7,  deepOnly: true, minLevel: 20 },
  { id: 'fish_hamour',     name: 'Hamour',       nameRu: 'Хамор',            rarity: 'epic',      weightKg: 70,   weight: 3,  deepOnly: true, minLevel: 28 },
  { id: 'fish_gulf_sawray',name: 'Gulf Sawray',  nameRu: 'Пила-рыба Залива', rarity: 'epic',      weightKg: 130,  weight: 1.5, deepOnly: true, minLevel: 35 },
  { id: 'fish_moon_fish',  name: 'Moon Fish',    nameRu: 'Лунная Рыба',      rarity: 'legendary', weightKg: 190,  weight: 0.4, deepOnly: true, minLevel: 45 },
];

/** Окна реакции в миллисекундах — считаются на сервере */
export const REEL_WINDOWS = {
  /** Успех: поймал */
  GOOD_MS: 1200,
  /** Успех, но рыба ушла с пустым крючком: «сорвалась» */
  LATE_MS: 3000,
} as const;

export type CastPhase = 'waiting' | 'bite' | 'reeling' | 'caught' | 'lost';

export interface CastState {
  castId: string;
  characterId: string;
  phase: CastPhase;
  /** Когда забросили */
  castAt: number;
  /** Когда ждём поклёвку */
  biteAt: number;
  /** Серверное время последнего действия игрока */
  lastActionAt: number;
  /** Что поймалось (после подсечки) */
  fishId?: string;
  fishName?: string;
  fishNameRu?: string;
  rarity?: FishRarity;
  weightKg?: number;
  /** Сколько секунд осталось ждать поклёвку — для «идёт ожидание…» */
  waitTotalMs: number;
  /** Как глубоко заброшено: с лодки можно достать глубоководных */
  deep: boolean;
  /** Множитель удачи от лодки */
  luck: number;
}

export interface CatchResult {
  ok: boolean;
  code?: string;
  cast?: CastState;
  /** Улов, если поймали */
  fish?: { itemId: string; nameRu: string; quantity: number; weightKg: number; rarity: FishRarity };
  experience?: number;
  gold?: number;
  /** Сообщение для игрока */
  messageRu?: string;
}

const CAST_TTL_MS = 5 * 60_000;
const BITE_MIN_MS = 2500;
const BITE_MAX_MS = 11_000;

export class FishingSystem {
  private characters = new CharacterService();
  private boats = new BoatSystem();
  private casts = new Map<string, CastState>();

  private static instance: FishingSystem;
  static getInstance(): FishingSystem {
    if (!FishingSystem.instance) FishingSystem.instance = new FishingSystem();
    return FishingSystem.instance;
  }

  /** Убрать протухшие забросы, чтобы карта не росла бесконечно */
  private sweep(): void {
    const now = Date.now();
    for (const [id, c] of this.casts) {
      if (now - c.lastActionAt > CAST_TTL_MS) this.casts.delete(id);
    }
  }

  /** Активный заброс игрока (для восстановления панели после переподключения) */
  getActiveCast(characterId: string): CastState | null {
    this.sweep();
    for (const c of this.casts.values()) {
      if (c.characterId === characterId && (c.phase === 'waiting' || c.phase === 'bite')) return c;
    }
    return null;
  }

  /**
   * Забросить удочку.
   * Проверяем на сервере: есть ли вода под игроком, не занята ли лодка,
   * и хватает ли снастей. Если стоишь на суше — ловить нечего.
   */
  async cast(
    characterId: string,
    position: { x: number; z: number }
  ): Promise<CatchResult> {
    this.sweep();

    if (this.getActiveCast(characterId)) {
      return { ok: false, code: 'fishing_already_cast' };
    }
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
      return { ok: false, code: 'fishing_no_position' };
    }
    if (!isWater(position.x, position.z)) {
      return { ok: false, code: 'fishing_not_near_water' };
    }

    const boatRow = await this.boats.getActiveBoat(characterId);
    const boat = getBoatDef(boatRow?.boatId);
    // С берега ловится только мелководье; чтобы достать до глубоководных,
    // нужна лодка. Иначе игрок стоял бы на дне озера и ловил тунца.
    const deep = isDeepWater(position.x, position.z);
    if (deep && !boat) {
      return { ok: false, code: 'fishing_need_boat' };
    }
    // Лодка устаёт: после catchLimit рыб нужно сойти на берег и
    // разогнать её заново. Без этого лодка была бы вечным фармом.
    if (boat && boatRow) {
      if (boatRow.fatigue >= boat.catchLimit) {
        return { ok: false, code: 'fishing_boat_tired' };
      }
    }

    const luck = boat?.fishingBonus ?? 1.0;
    // Приманка сокращает ожидание: чем удачливее снасти, тем быстрее клёв
    const waitTotalMs = Math.round(
      (BITE_MAX_MS - (BITE_MAX_MS - BITE_MIN_MS) * (luck - 1) / 1.4) * (0.85 + Math.random() * 0.3)
    );
    const now = Date.now();

    const cast: CastState = {
      castId: `fish_${characterId}_${now}`,
      characterId,
      phase: 'waiting',
      castAt: now,
      biteAt: now + Math.max(900, waitTotalMs),
      lastActionAt: now,
      waitTotalMs: Math.max(900, waitTotalMs),
      deep,
      luck,
    };
    this.casts.set(cast.castId, cast);
    logger.info(`[Fishing] ${characterId} забросил (глубоко=${deep}, лодка=${boat?.id ?? 'нет'})`);
    return { ok: true, cast };
  }

  /**
   * Подсечь. Реакцию считаем по своим часам: клиент не может прислать
   * «я подсёк мгновенно» — разница считается здесь.
   */
  async reel(characterId: string, castId: string): Promise<CatchResult> {
    this.sweep();
    const cast = this.casts.get(castId);
    if (!cast) return { ok: false, code: 'fishing_no_cast' };
    if (cast.characterId !== characterId) return { ok: false, code: 'fishing_not_your_cast' };
    if (cast.phase !== 'waiting' && cast.phase !== 'bite') {
      return { ok: false, code: 'fishing_already_reeled', cast };
    }

    const now = Date.now();

    // Подсёк раньше, чем клюнуло — пустая удочка
    if (now < cast.biteAt) {
      cast.phase = 'lost';
      cast.lastActionAt = now;
      this.casts.delete(castId);
      return {
        ok: false, code: 'fishing_too_early', cast,
        messageRu: 'Поплавок ещё не дёргался — рыба не клюнула.',
      };
    }

    const reaction = now - cast.biteAt;
    const tooLate = reaction > REEL_WINDOWS.LATE_MS;
    const perfect = !tooLate && reaction <= REEL_WINDOWS.GOOD_MS;

    if (tooLate) {
      cast.phase = 'lost';
      cast.lastActionAt = now;
      this.casts.delete(castId);
      return {
        ok: false, code: 'fishing_too_late', cast,
        messageRu: 'Рыба ушла с крючка — слишком долго тянул.',
      };
    }

    // Рыба выбирается по весу; редкая — тем реже. Точный подсек сдвигает
    // выбор в сторону крупной рыбы.
    const character = await this.characters.getCharacterById(characterId).catch(() => null);
    const fish = this.pickFish(cast, perfect, character?.level ?? 1);
    if (!fish) {
      cast.phase = 'lost';
      cast.lastActionAt = now;
      this.casts.delete(castId);
      return { ok: false, code: 'fishing_empty_hook', cast, messageRu: 'Пустой крючок — рыба сошла.' };
    }

    const rarityMult = RARITY_REWARD[fish.rarity] ?? 1;
    const perfectMult = perfect ? 1.5 : 1;
    const experience = Math.round(
      (12 + fish.weightKg * 1.6) * rarityMult * perfectMult * (1 + (cast.luck - 1) * 0.6)
    );
    const gold = Math.round(
      (6 + fish.weightKg * 0.9) * rarityMult * perfectMult * (1 + (cast.luck - 1) * 0.5)
    );

    await this.characters.addItems(characterId, [{ itemId: fish.id, qty: 1 }]).catch(() => {});
    await this.characters.addExperience(characterId, experience).catch(() => null);
    await this.characters.addGoldReward(characterId, gold).catch(() => {});
    // Задача дня «Рыбак Дня». Раньше задачи дня не засчитывались НИГДЕ
    void new DailyTaskService().updateProgress(characterId, 'fish', 'any').catch(() => null);

    const boat = await this.boats.getActiveBoat(characterId);
    if (boat) await this.boats.addCatch(characterId, boat.boatId).catch(() => 0);

    cast.phase = 'caught';
    cast.fishId = fish.id;
    cast.fishName = fish.name;
    cast.fishNameRu = fish.nameRu;
    cast.rarity = fish.rarity;
    cast.weightKg = fish.weightKg;
    cast.lastActionAt = now;

    return {
      ok: true,
      cast,
      fish: { itemId: fish.id, nameRu: fish.nameRu, quantity: 1, weightKg: fish.weightKg, rarity: fish.rarity },
      experience,
      gold,
      messageRu: perfect
        ? `Идеальная подсечка! ${fish.nameRu} — ${formatWeight(fish.weightKg)}.`
        : `${fish.nameRu} — ${formatWeight(fish.weightKg)}.`,
    };
  }

  /** Сорвать удочку: забрасывает заново, ничего не теряя */
  cancel(characterId: string, castId?: string): boolean {
    const cast = castId ? this.casts.get(castId) : this.getActiveCast(characterId);
    if (!cast || cast.characterId !== characterId) return false;
    this.casts.delete(cast.castId);
    return true;
  }

  /**
   * Выбор рыбы. Вес — обратная «редкость»: чем больше вес записи,
   * тем реже она выпадает. Глубоководные доступны только с лодки,
   * а крупные — по уровню игрока.
   */
  private pickFish(cast: CastState, perfect: boolean, level: number): FishDefinition | null {
    const pool = FISH_TABLE.filter(f => {
      if (f.deepOnly && !cast.deep) return false;
      if (f.minLevel > level) return false;
      return true;
    });
    if (!pool.length) return null;

    // Точная подсечка тянет вверх по редкости: вес — обратная частота,
    // поэтому возведение в степень < 1 поднимает именно редкую рыбу
    // (было f.weight / sqrt(kg) — это наоборот выбирало мелкую рыбу)
    const weights = pool.map(f =>
      perfect ? Math.pow(Math.max(0.01, f.weight), 0.35) : f.weight
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /** Рыбы, доступные игроку уровня (для подсказок в интерфейсе) */
  listAvailable(level: number, deep: boolean): FishDefinition[] {
    return FISH_TABLE.filter(f => f.minLevel <= level && (!f.deepOnly || deep));
  }
}

const RARITY_REWARD: Record<FishRarity, number> = {
  common: 1, uncommon: 1.8, rare: 3.4, epic: 7, legendary: 16,
};

function formatWeight(kg: number): string {
  return kg < 1 ? `${Math.round(kg * 1000)} г` : `${kg.toFixed(1).replace('.', ',')} кг`;
}
