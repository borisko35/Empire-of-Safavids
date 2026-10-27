// ============================================================
// Reputation Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';

export interface Faction {
  id: string; name: string; nameRu: string; description: string; descriptionRu: string;
  ranks: { name: string; nameRu: string; minRep: number }[];
}

export const FACTIONS: Faction[] = [
  { id: 'qizilbash', name: 'Qizilbash Order', nameRu: 'Орден Кызылбашей',
    description: 'The red-capped warriors who founded the empire', descriptionRu: 'Красноголовые воины, основавшие империю',
    ranks: [
      { name: 'Enemy of the Order', nameRu: 'Враг Ордена', minRep: -300 },
      { name: 'Outsider', nameRu: 'Чужак', minRep: 0 },
      { name: 'Recruit', nameRu: 'Новобранец', minRep: 100 },
      { name: 'Warrior', nameRu: 'Воин', minRep: 300 },
      { name: 'Commander', nameRu: 'Командир', minRep: 700 },
      { name: 'Champion', nameRu: 'Чемпион', minRep: 1500 },
    ] },
  { id: 'sufi', name: 'Sufi Mystics', nameRu: 'Суфийские Мистики',
    description: 'Keepers of ancient wisdom and spiritual power', descriptionRu: 'Хранители древней мудрости и духовной силы',
    ranks: [
      { name: 'Fallen from the Path', nameRu: 'Сошедший с Пути', minRep: -300 },
      { name: 'Seeker', nameRu: 'Искатель', minRep: 0 },
      { name: 'Adept', nameRu: 'Посвящённый', minRep: 100 },
      { name: 'Mystic', nameRu: 'Мистик', minRep: 300 },
      { name: 'Sage', nameRu: 'Мудрец', minRep: 700 },
      { name: 'Illuminated', nameRu: 'Просветлённый', minRep: 1500 },
    ] },
  { id: 'merchants', name: 'Silk Road Merchants', nameRu: 'Торговцы Шёлкового Пути',
    description: 'The wealthy merchant guild controlling trade routes', descriptionRu: ' Богатая купеческая гильдия, контролирующая торговые маршруты',
    ranks: [
      { name: 'Guild Enemy', nameRu: 'Враг Гильдии', minRep: -300 },
      { name: 'Peddler', nameRu: 'Развозчик', minRep: 0 },
      { name: 'Trader', nameRu: 'Торговец', minRep: 100 },
      { name: 'Merchant', nameRu: 'Купец', minRep: 300 },
      { name: 'Magnate', nameRu: 'Магнат', minRep: 700 },
      { name: 'Trade Prince', nameRu: 'Торговый Князь', minRep: 1500 },
    ] },
  { id: 'assassins', name: 'Order of Assassins', nameRu: 'Орден Ассасинов',
    description: 'Shadowy killers operating from hidden fortresses', descriptionRu: 'Теневые убийцы, действующие из скрытых крепостей',
    ranks: [
      { name: 'Marked by the Shadow', nameRu: 'Помеченный Тенью', minRep: -300 },
      { name: 'Shadow', nameRu: 'Тень', minRep: 0 },
      { name: 'Blade', nameRu: 'Клинок', minRep: 100 },
      { name: 'Assassin', nameRu: 'Ассасин', minRep: 300 },
      { name: 'Master', nameRu: 'Мастер', minRep: 700 },
      { name: 'Phantom', nameRu: 'Фантом', minRep: 1500 },
    ] },
];

/** Фракции нужны за пределами сервиса: подписчику показываем, где ранг вырос. */
export const FACTION_NAMES_RU: Record<string, string> = Object.fromEntries(
  FACTIONS.map(f => [f.id, f.nameRu]),
);

/**
 * Враждебные пары (§363): рост у одной фракции — потеря у соперницы.
 *
 * ВЫБОР пар, не измерение, но не с потолка:
 *   кызылбаши ↔ ассасины — меч и тень: орден, основавший империю, и орден,
 *   живущий её тенями;
 *   торговцы ↔ суфии — стяжание и отречение: гильдия считает мистиков
 *   бездельниками, мистики считают купцов стяжателями.
 *
 * Зеркало один-к-одному: +5 ассасинам = −5 кызылбашам. Сложные коэффициенты
 * добавили бы баланс, который нечем измерить.
 */
export const FACTION_RIVALS: Record<string, string> = {
  qizilbash: 'assassins',
  assassins: 'qizilbash',
  merchants: 'sufi',
  sufi: 'merchants',
};

/**
 * Пол враждебности (§363).
 *
 * ВЫБОР: до −300 добираешься за сотню-другую действий в пользу соперницы —
 * враждебность надо заслужить так же, как первый ранг (100) заслуживают.
 * Ниже падать некуда: глубже — уже не репутация, а приговор.
 */
export const REP_HOSTILE_FLOOR = -300;

/** Насколько дороже платит тот, кого гильдия считает врагом (§363). ВЫБОР:
 *  на шамшире (6000) это +900 — заметно, но не грабёж. */
export const HOSTILE_PRICE_MULT = 1.15;

export class ReputationService {
  private db = DatabaseService.getInstance();

  async getReputation(charId: string): Promise<{ faction: string; reputation: number; rank_title: string }[]> {
    const rows = await this.db.query<{ faction: string; reputation: number; rank_title: string }>(
      'SELECT faction, reputation, rank_title FROM character_reputation WHERE character_id = $1',
      [charId]
    );
    // Добавляем фракции, у которых ещё нет записей
    const existing = new Set(rows.map(r => r.faction));
    for (const f of FACTIONS) {
      if (!existing.has(f.id)) {
        rows.push({ faction: f.id, reputation: 0, rank_title: f.ranks[0].nameRu });
      }
    }
    return rows;
  }

  async addReputation(charId: string, factionId: string, amount: number): Promise<{ newRep: number; rankUp: boolean; newRank?: string }> {
    const faction = FACTIONS.find(f => f.id === factionId);
    if (!faction) throw new Error('Unknown faction');

    const итог = await this.applyRep(charId, faction, amount);

    // Обратная сторона медали (§363): рост у одной фракции — потеря у
    // соперницы. Только на ПОЛОЖИТЕЛЬНЫХ начислениях: потеря не возвращает
    // сопернице ничего, иначе mirror-war качал бы обе стороны в ноль.
    // Зеркало не зеркалит в ответ: applyRep, а не addReputation.
    if (amount > 0) {
      const rivalId = FACTION_RIVALS[factionId];
      if (rivalId) {
        const rival = FACTIONS.find(f => f.id === rivalId);
        if (rival) await this.applyRep(charId, rival, -amount);
      }
    }

    return итог;
  }

  /**
   * Ядро начисления: одна запись, один пересчёт ранга.
   *
   * Ранг пересчитывается по лестнице в обе стороны: заголовок в базе
   * обновляется и при падении во враждебные ранги, а не только при росте.
   */
  private async applyRep(charId: string, faction: Faction, amount: number): Promise<{ newRep: number; rankUp: boolean; newRank?: string }> {
    const existing = await this.db.queryOne<{ reputation: number }>(
      'SELECT reputation FROM character_reputation WHERE character_id = $1 AND faction = $2',
      [charId, faction.id]
    );

    const oldRep = existing?.reputation ?? 0;
    const newRep = Math.max(REP_HOSTILE_FLOOR, oldRep + amount);

    if (existing) {
      await this.db.query(
        'UPDATE character_reputation SET reputation = $1 WHERE character_id = $2 AND faction = $3',
        [newRep, charId, faction.id]
      );
    } else {
      await this.db.query(
        'INSERT INTO character_reputation (character_id, faction, reputation) VALUES ($1, $2, $3)',
        [charId, faction.id, newRep]
      );
    }

    // Проверяем, был ли сдвиг ранга (вверх или вниз)
    const oldRank = this.getRankForRep(faction, oldRep);
    const newRank = this.getRankForRep(faction, newRep);
    const rankUp = newRank.nameRu !== oldRank.nameRu;

    if (rankUp) {
      await this.db.query(
        'UPDATE character_reputation SET rank_title = $1 WHERE character_id = $2 AND faction = $3',
        [newRank.nameRu, charId, faction.id]
      );
    }

    return { newRep, rankUp, newRank: rankUp ? newRank.nameRu : undefined };
  }

  /**
   * Множитель цен лавок для персонажа (§363): враг Гильдии платит больше.
   *
   * Единственное следствие первого куска — пример владельца «рост цен».
   * Купцы помнят врага: и в каталоге, и в оплате должен стоять один
   * множитель, иначе витрина врала бы о цене.
   */
  /**
   * Враждебна ли фракция персонажу (§363): репутация ниже нуля.
   *
   * Единственное место, где «ниже нуля» превращается в «враждебна»: свои
   * запросы в каждом следствии разъехались бы при смене порога.
   */
  async isHostile(characterId: string, factionId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ reputation: number }>(
      'SELECT reputation FROM character_reputation WHERE character_id = $1 AND faction = $2',
      [characterId, factionId]
    );
    return (row?.reputation ?? 0) < 0;
  }

  async shopPriceMultiplier(characterId: string): Promise<number> {
    return (await this.isHostile(characterId, 'merchants')) ? HOSTILE_PRICE_MULT : 1;
  }

  private getRankForRep(faction: Faction, rep: number): { name: string; nameRu: string } {
    let rank = faction.ranks[0];
    for (const r of faction.ranks) {
      if (rep >= r.minRep) rank = r;
    }
    return rank;
  }

  async getFactionInfo(factionId: string): Promise<Faction | undefined> {
    return FACTIONS.find(f => f.id === factionId);
  }

  getAllFactions(): Faction[] {
    return FACTIONS;
  }
}
