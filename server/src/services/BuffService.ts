// ============================================================
// Временные бонусы — Empire of Safavids
// ============================================================
// Расходники обещают эффект на время («+5% к урону на 10 минут»,
// «+3 к силе», «+50% к опыту на 1 час»), но до этого момента выполнялась
// только мгновенная часть: восстановление HP/маны/стамины. Бонусная
// часть описания не работала ни для одного предмета, а Свиток Учёного
// нельзя было использовать вообще — useItem бросал «Item has no usable effect».
//
// Хранение — таблица character_buffs (миграция 030), составной ключ
// (character_id, buff_id). Повторный приём продлевает эффект до
// max(прежнее, новое): съеденный кебаб не должен обнулять 9 минут
// оставшегося бонуса, но должен продлевать до полных пяти.

import { DatabaseService } from './DatabaseService';
import { CharacterStats } from '../types/game.types';

export type BuffStat = 'damagePct' | 'takenPct' | 'expPct' | 'strength' | 'agility' | 'endurance' | 'intelligence' | 'charisma';

export interface BuffDef {
  id: string;
  /** Что усиливает */
  stat: BuffStat;
  /** Величина: проценты для damagePct/takenPct/expPct, единицы стата для остальных */
  magnitude: number;
  /** Длительность, секунды */
  durationSec: number;
  /** Подпись в интерфейсе: короткая, плашка в HUD узкая */
  nameRu: string;
  icon: string;
}

/**
 * Каталог эффектов. Урон и опыт — множители, а не характеристики:
 * так они не попадают в панель «Бонус характеристик» и не искажают
 * броню, крит и отображение силы.
 */
export const BUFFS: Record<string, BuffDef> = {
  buff_damage_5: {
    id: 'buff_damage_5',
    stat: 'damagePct',
    magnitude: 5,
    durationSec: 600,
    nameRu: '+5% урон',
    icon: 'sword',
  },
  buff_strength_3: {
    id: 'buff_strength_3',
    stat: 'strength',
    magnitude: 3,
    durationSec: 300,
    nameRu: '+3 сила',
    icon: 'fist',
  },
  buff_speed_10: {
    id: 'buff_speed_10',
    stat: 'agility',
    magnitude: 10,
    durationSec: 300,
    nameRu: '+10 ловк.',
    icon: 'boot',
  },
  buff_endurance_5: {
    id: 'buff_endurance_5',
    stat: 'endurance',
    magnitude: 5,
    durationSec: 300,
    nameRu: '+5 вынос.',
    icon: 'shield',
  },
  // Зикр дервиша: во время транса удары бьют сильнее. Идентификатор
  // начинается с buff_damage_, поэтому подхватывается уже готовым
  // запросом getDamageMultiplier - отдельной ветки кода не нужно.
  buff_damage_zikr: {
    id: 'buff_damage_zikr',
    stat: 'damagePct',
    magnitude: 25,
    durationSec: 30,
    nameRu: 'Зикр: +25% урона',
    icon: 'flame',
  },
  // Тадж дервиша: корона, прикрывающая своим кругом. Снижает входящий
  // урон, поэтому у него отдельный вид эффекта takenPct и отдельный
  // множитель ниже: перепутать их нельзя, иначе корона стала бы
  // увеличивать получаемый урон вместо уменьшения.
  buff_protect_taj: {
    id: 'buff_protect_taj',
    stat: 'takenPct',
    magnitude: 20,
    durationSec: 30,
    nameRu: 'Тадж: −20% получаемого урона',
    icon: 'crown',
  },
  // Свиток Учёного: «+50% к получаемому опыту на 1 час».
  buff_exp_50: {
    id: 'buff_exp_50',
    stat: 'expPct',
    magnitude: 50,
    durationSec: 3600,
    nameRu: '+50% опыт',
    icon: 'scroll',
  },
};

/**
 * Какой бонус выдаёт предмет. Записи взяты ровно из описаний предметов —
 * тест целостности проверяет, что у каждого расходника есть хоть какой-то
 * эффект, иначе описание снова станет ложью.
 */
export const ITEM_BUFFS: Record<string, string> = {
  con_stamina_food: 'buff_damage_5',
  food_kebab: 'buff_strength_3',
  con_exp_scroll: 'buff_exp_50',
};

export interface ActiveBuff {
  id: string;
  nameRu: string;
  icon: string;
  stat: BuffStat;
  magnitude: number;
  /** Осталось секунд */
  remainingSec: number;
}

const STAT_KEYS: BuffStat[] = ['strength', 'agility', 'intelligence', 'endurance', 'charisma'];

export class BuffService {
  private db = DatabaseService.getInstance();

  /**
   * Выдать эффект. Время пересчитывается как max(прежнее, новое):
   * повторный приём не обнуляет остаток и не укорачивает его.
   */
  async grant(characterId: string, buffId: string): Promise<ActiveBuff | null> {
    const def = BUFFS[buffId];
    if (!def) return null;
    const now = new Date();
    const until = new Date(now.getTime() + def.durationSec * 1000);
    await this.db.query(
      `INSERT INTO character_buffs (character_id, buff_id, magnitude, expires_at, applied_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (character_id, buff_id) DO UPDATE
         SET magnitude = EXCLUDED.magnitude,
             expires_at = GREATEST(character_buffs.expires_at, EXCLUDED.expires_at),
             applied_at = EXCLUDED.applied_at`,
      [characterId, buffId, def.magnitude, until, now]
    );
    return this.toActive(def, def.durationSec);
  }

  /** Активные эффекты персонажа; протухшие попутно подчищаются */
  async getActive(characterId: string): Promise<ActiveBuff[]> {
    const now = new Date();
    await this.db.query(
      'DELETE FROM character_buffs WHERE character_id = $1 AND expires_at <= $2',
      [characterId, now]
    ).catch(() => undefined);
    const rows = await this.db.query<{ buff_id: string; magnitude: number; expires_at: string }>(
      'SELECT buff_id, magnitude, expires_at FROM character_buffs WHERE character_id = $1 AND expires_at > $2',
      [characterId, now]
    ).catch(() => []);
    const out: ActiveBuff[] = [];
    for (const r of rows) {
      const def = BUFFS[r.buff_id];
      if (!def) continue;
      // pg отдаёт timestamptz строкой, а не объектом Date
      const left = new Date(r.expires_at).getTime() - now.getTime();
      const remaining = Math.max(0, Math.round(left / 1000));
      out.push(this.toActive(def, remaining, Number(r.magnitude)));
    }
    return out;
  }

  /** Сбросить все эффекты (смена персонажа, выход — по вызову) */
  async clear(characterId: string): Promise<void> {
    await this.db.query('DELETE FROM character_buffs WHERE character_id = $1', [characterId])
      .catch(() => undefined);
  }

  /**
   * Множитель исходящего урона: 1 + сумма процентов.
   * Считается на каждый удар, поэтому ошибки БД глотаются — отсутствие
   * таблицы не должно ронять бой.
   */
  async getDamageMultiplier(characterId: string): Promise<number> {
    const now = new Date();
    const rows = await this.db.query<{ magnitude: number }>(
      `SELECT magnitude FROM character_buffs
        WHERE character_id = $1 AND expires_at > $2 AND buff_id LIKE 'buff_damage_%'`,
      [characterId, now]
    ).catch(() => []);
    const pct = rows.reduce((sum, r) => sum + Number(r.magnitude), 0);
    return 1 + pct / 100;
  }

  /**
   * Множитель получаемого опыта: 1 + сумма процентов.
   */
  /**
   * Множитель входящего урона: 1 − сумма процентов.
   *
   * Знак именно такой: уменьшать должен множитель, а не начисление.
   * Проверка на ненулевой остаток обязательна - при защите в 100% персонаж
   * стал бы неуязвимым, и с кругом дервиша можно было бы стоять и смотреть.
   * Нижняя граница 0.1, а не 0: полная неуязвимость ломала бы бой.
   */
  async getDamageTakenMultiplier(characterId: string): Promise<number> {
    const now = new Date();
    const rows = await this.db.query<{ magnitude: number }>(
      `SELECT magnitude FROM character_buffs
        WHERE character_id = $1 AND expires_at > $2 AND buff_id LIKE 'buff_protect_%'`,
      [characterId, now]
    ).catch(() => []);
    const pct = rows.reduce((sum, r) => sum + Number(r.magnitude), 0);
    return Math.max(0.1, 1 - pct / 100);
  }

  async getExpMultiplier(characterId: string): Promise<number> {
    const now = new Date();
    const rows = await this.db.query<{ magnitude: number }>(
      `SELECT magnitude FROM character_buffs
        WHERE character_id = $1 AND expires_at > $2 AND buff_id LIKE 'buff_exp_%'`,
      [characterId, now]
    ).catch(() => []);
    const pct = rows.reduce((sum, r) => sum + Number(r.magnitude), 0);
    return 1 + pct / 100;
  }

  /** Прибавка к характеристикам от активных эффектов */
  async getStatBonuses(characterId: string): Promise<Partial<CharacterStats>> {
    const now = new Date();
    const rows = await this.db.query<{ buff_id: string; magnitude: number }>(
      'SELECT buff_id, magnitude FROM character_buffs WHERE character_id = $1 AND expires_at > $2',
      [characterId, now]
    ).catch(() => []);
    const out: Partial<CharacterStats> = {};
    for (const r of rows) {
      const def = BUFFS[r.buff_id];
      if (!def) continue;
      if (!STAT_KEYS.includes(def.stat)) continue;
      const key = def.stat as keyof CharacterStats;
      out[key] = (out[key] ?? 0) + Number(r.magnitude);
    }
    return out;
  }

  /** Влить бонусы в копию статов персонажа (как это делает EquipmentCache) */
  async mergeInto(character: { id: string; stats: CharacterStats }): Promise<CharacterStats> {
    const bonus = await this.getStatBonuses(character.id);
    return {
      strength: character.stats.strength + (bonus.strength ?? 0),
      agility: character.stats.agility + (bonus.agility ?? 0),
      intelligence: character.stats.intelligence + (bonus.intelligence ?? 0),
      endurance: character.stats.endurance + (bonus.endurance ?? 0),
      charisma: character.stats.charisma + (bonus.charisma ?? 0),
    };
  }

  private toActive(def: BuffDef, remainingSec: number, magnitude = def.magnitude): ActiveBuff {
    return {
      id: def.id,
      nameRu: def.nameRu,
      icon: def.icon,
      stat: def.stat,
      magnitude,
      remainingSec,
    };
  }
}

let instance: BuffService | null = null;
export function getBuffService(): BuffService {
  if (!instance) instance = new BuffService();
  return instance;
}
