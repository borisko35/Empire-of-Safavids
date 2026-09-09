// ============================================================
// Система достижений — Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

export type AchievementCategory =
  | 'combat'    // Боевые
  | 'exploration' // Исследование
  | 'crafting'  // Крафтинг
  | 'social'    // Социальные
  | 'trade'     // Торговля
  | 'story'     // Сюжетные
  | 'pvp';      // PvP

export interface Achievement {
  id: string;
  name: string;
  nameRu: string;
  description: string;
  category: AchievementCategory;
  points: number;
  hidden: boolean;
  reward?: { itemId?: string; title?: string; gold?: number };
  condition: { type: string; target: string; required: number };
}

export const ACHIEVEMENTS: Achievement[] = [
  // ── БОЕВЫЕ
  { id: 'ach_first_kill',    name: 'First Blood',         nameRu: 'Первая Кровь',       description: 'Убийте первого монстра',       category: 'combat',    points: 10,  hidden: false, condition: { type: 'kill_monster', target: 'any',              required: 1     } },
  { id: 'ach_100_kills',     name: 'Warrior',             nameRu: 'Воин',              description: 'Убейте 100 монстров',          category: 'combat',    points: 25,  hidden: false, condition: { type: 'kill_monster', target: 'any',              required: 100   } },
  { id: 'ach_1000_kills',    name: 'Veteran',             nameRu: 'Ветеран',            description: 'Убейте 1000 монстров',         category: 'combat',    points: 50,  hidden: false, condition: { type: 'kill_monster', target: 'any',              required: 1000  }, reward: { title: 'Ветеран Боёв' } },
  { id: 'ach_boss_slayer',   name: 'Boss Slayer',         nameRu: 'Убийца Боссов',    description: 'Убейте 10 боссов данжей',    category: 'combat',    points: 100, hidden: false, condition: { type: 'kill_boss',    target: 'any',              required: 10    }, reward: { title: 'Убийца Боссов' } },
  { id: 'ach_simurgh',       name: 'Simurgh Slayer',      nameRu: 'Убийца Симурга',  description: 'Победите Великого Симурга',   category: 'combat',    points: 500, hidden: true,  condition: { type: 'kill_boss',    target: 'world_boss_simurgh', required: 1 }, reward: { title: 'Убийца Симурга', gold: 10000 } },
  // ── ИССЛЕДОВАНИЕ
  { id: 'ach_all_regions',   name: 'World Traveler',      nameRu: 'Путешественник',    description: 'Посетите все 7 регионов',      category: 'exploration', points: 100, hidden: false, condition: { type: 'visit_region', target: 'all',             required: 7     }, reward: { title: 'Странник' } },
  { id: 'ach_all_dungeons',  name: 'Dungeon Crawler',     nameRu: 'Исследователь',    description: 'Пройдите все данжи',            category: 'exploration', points: 150, hidden: false, condition: { type: 'clear_dungeon', target: 'all',            required: 3     } },
  // ── КРАФТИНГ
  { id: 'ach_first_craft',   name: 'Apprentice',          nameRu: 'Ученик',            description: 'Создайте первый предмет',       category: 'crafting',  points: 10,  hidden: false, condition: { type: 'craft_item',   target: 'any',              required: 1     } },
  { id: 'ach_master_smith',  name: 'Master Blacksmith',   nameRu: 'Мастер-Кузнец',   description: 'Создайте 500 предметов',        category: 'crafting',  points: 200, hidden: false, condition: { type: 'craft_item',   target: 'blacksmithing',    required: 500   }, reward: { title: 'Мастер-Кузнец' } },
  { id: 'ach_max_enhance',   name: 'Perfection',          nameRu: 'Совершенство',    description: 'Улучшите предмет до +20',        category: 'crafting',  points: 500, hidden: true,  condition: { type: 'enhance_item', target: 'any',              required: 20    }, reward: { title: 'Совершенство', gold: 50000 } },
  // ── СОЦИАЛЬНЫЕ
  { id: 'ach_guild_found',   name: 'Guild Founder',       nameRu: 'Основатель Гильдии', description: 'Создайте гильдию',           category: 'social',    points: 50,  hidden: false, condition: { type: 'create_guild', target: 'any',              required: 1     } },
  { id: 'ach_100_members',   name: 'Great Leader',        nameRu: 'Великий Лидер',    description: 'Достигните 100 членов в гильдии', category: 'social',    points: 200, hidden: false, condition: { type: 'guild_members', target: 'any',             required: 100   }, reward: { title: 'Великий Лидер' } },
  // ── ТОРГОВЛЯ
  { id: 'ach_millionaire',   name: 'Millionaire',         nameRu: 'Миллионер',          description: 'Накопите 1 000 000 золота',    category: 'trade',     points: 300, hidden: false, condition: { type: 'earn_gold',    target: 'any',              required: 1000000 }, reward: { title: 'Миллионер' } },
  // ── PvP
  { id: 'ach_pvp_100',       name: 'Duelist',             nameRu: 'Дуэлянт',            description: 'Победите в 100 PvP-боях',       category: 'pvp',       points: 100, hidden: false, condition: { type: 'pvp_win',      target: 'any',              required: 100   }, reward: { title: 'Дуэлянт' } },
  { id: 'ach_siege_win',     name: 'Siege Master',        nameRu: 'Мастер Осады',    description: 'Захватите территорию',         category: 'pvp',       points: 200, hidden: false, condition: { type: 'capture_territory', target: 'any',         required: 1     }, reward: { title: 'Мастер Осады' } },
  // ── СЮЖЕТ
  { id: 'ach_main_complete', name: 'Hero of the Empire',  nameRu: 'Герой Империи',   description: 'Завершите основной сюжет',    category: 'story',     points: 1000,hidden: false, condition: { type: 'complete_quest', target: 'main_final',     required: 1     }, reward: { title: 'Герой Империи', gold: 100000 } },
];

export class AchievementSystem {
  private db = DatabaseService.getInstance();

  async checkAndGrant(characterId: string, eventType: string, target: string, value: number): Promise<Achievement[]> {
    const granted: Achievement[] = [];

    const eligible = ACHIEVEMENTS.filter(
      a => a.condition.type === eventType &&
           (a.condition.target === 'any' || a.condition.target === target) &&
           a.condition.required <= value
    );

    for (const ach of eligible) {
      const already = await this.db.queryOne(
        'SELECT 1 FROM character_achievements WHERE character_id = $1 AND achievement_id = $2',
        [characterId, ach.id]
      );
      if (already) continue;

      await this.db.transaction(async (client) => {
        await client.query(
          'INSERT INTO character_achievements (character_id, achievement_id, earned_at) VALUES ($1, $2, NOW())',
          [characterId, ach.id]
        );
        if (ach.reward?.gold) {
          await client.query('UPDATE characters SET gold = gold + $1 WHERE id = $2', [ach.reward.gold, characterId]);
        }
        if (ach.reward?.title) {
          await client.query(
            'INSERT INTO character_titles (character_id, title) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [characterId, ach.reward.title]
          );
        }
      });

      granted.push(ach);
      logger.info(`Achievement unlocked: ${characterId} earned "${ach.nameRu}"`);
    }

    return granted;
  }

  async getCharacterAchievements(characterId: string): Promise<{ achievement: Achievement; earnedAt: Date }[]> {
    const rows = await this.db.query<{ achievement_id: string; earned_at: Date }>(
      'SELECT achievement_id, earned_at FROM character_achievements WHERE character_id = $1 ORDER BY earned_at DESC',
      [characterId]
    );
    return rows
      .map(r => ({ achievement: ACHIEVEMENTS.find(a => a.id === r.achievement_id)!, earnedAt: r.earned_at }))
      .filter(r => r.achievement);
  }

  getTotalPoints(achievements: Achievement[]): number {
    return achievements.reduce((sum, a) => sum + a.points, 0);
  }
}
