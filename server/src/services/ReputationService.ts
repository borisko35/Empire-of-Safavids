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
      { name: 'Outsider', nameRu: 'Чужак', minRep: 0 },
      { name: 'Recruit', nameRu: 'Новобранец', minRep: 100 },
      { name: 'Warrior', nameRu: 'Воин', minRep: 300 },
      { name: 'Commander', nameRu: 'Командир', minRep: 700 },
      { name: 'Champion', nameRu: 'Чемпион', minRep: 1500 },
    ] },
  { id: 'sufi', name: 'Sufi Mystics', nameRu: 'Суфийские Мистики',
    description: 'Keepers of ancient wisdom and spiritual power', descriptionRu: 'Хранители древней мудрости и духовной силы',
    ranks: [
      { name: 'Seeker', nameRu: 'Искатель', minRep: 0 },
      { name: 'Adept', nameRu: 'Посвящённый', minRep: 100 },
      { name: 'Mystic', nameRu: 'Мистик', minRep: 300 },
      { name: 'Sage', nameRu: 'Мудрец', minRep: 700 },
      { name: 'Illuminated', nameRu: 'Просветлённый', minRep: 1500 },
    ] },
  { id: 'merchants', name: 'Silk Road Merchants', nameRu: 'Торговцы Шёлкового Пути',
    description: 'The wealthy merchant guild controlling trade routes', descriptionRu: ' Богатая купеческая гильдия, контролирующая торговые маршруты',
    ranks: [
      { name: 'Peddler', nameRu: 'Развозчик', minRep: 0 },
      { name: 'Trader', nameRu: 'Торговец', minRep: 100 },
      { name: 'Merchant', nameRu: 'Купец', minRep: 300 },
      { name: 'Magnate', nameRu: 'Магнат', minRep: 700 },
      { name: 'Trade Prince', nameRu: 'Торговый Князь', minRep: 1500 },
    ] },
  { id: 'assassins', name: 'Order of Assassins', nameRu: 'Орден Ассасинов',
    description: 'Shadowy killers operating from hidden fortresses', descriptionRu: 'Теневые убийцы, действующие из скрытых крепостей',
    ranks: [
      { name: 'Shadow', nameRu: 'Тень', minRep: 0 },
      { name: 'Blade', nameRu: 'Клинок', minRep: 100 },
      { name: 'Assassin', nameRu: 'Ассасин', minRep: 300 },
      { name: 'Master', nameRu: 'Мастер', minRep: 700 },
      { name: 'Phantom', nameRu: 'Фантом', minRep: 1500 },
    ] },
];

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

    const existing = await this.db.queryOne<{ reputation: number }>(
      'SELECT reputation FROM character_reputation WHERE character_id = $1 AND faction = $2',
      [charId, factionId]
    );

    const oldRep = existing?.reputation ?? 0;
    const newRep = Math.max(0, oldRep + amount);

    if (existing) {
      await this.db.query(
        'UPDATE character_reputation SET reputation = $1 WHERE character_id = $2 AND faction = $3',
        [newRep, charId, factionId]
      );
    } else {
      await this.db.query(
        'INSERT INTO character_reputation (character_id, faction, reputation) VALUES ($1, $2, $3)',
        [charId, factionId, newRep]
      );
    }

    // Проверяем, был ли ранг-ап
    const oldRank = this.getRankForRep(faction, oldRep);
    const newRank = this.getRankForRep(faction, newRep);
    const rankUp = newRank.nameRu !== oldRank.nameRu;

    if (rankUp) {
      await this.db.query(
        'UPDATE character_reputation SET rank_title = $1 WHERE character_id = $2 AND faction = $3',
        [newRank.nameRu, charId, factionId]
      );
    }

    return { newRep, rankUp, newRank: rankUp ? newRank.nameRu : undefined };
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
