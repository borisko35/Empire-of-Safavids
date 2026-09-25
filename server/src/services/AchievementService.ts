// ============================================================
// Achievement Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface AchievementDef {
  id: string; title: string; title_ru: string;
  description: string; description_ru: string;
  category: string; icon: string;
  reward_gold: number; reward_experience: number;
  reward_title?: string; reward_item_id?: string;
  hidden: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── БОЙ ──────────────────────────────────────────────
  { id: 'ach_first_blood', title: 'First Blood', title_ru: 'Первая Кровь',
    description: 'Kill your first monster', description_ru: 'Убить первого монстра',
    category: 'combat', icon: '⚔️', reward_gold: 50, reward_experience: 100, hidden: false },
  { id: 'ach_monster_hunter_10', title: 'Monster Hunter', title_ru: 'Охотник на Монстров',
    description: 'Kill 10 monsters', description_ru: 'Убить 10 монстров',
    category: 'combat', icon: '🗡️', reward_gold: 100, reward_experience: 200, hidden: false },
  { id: 'ach_monster_hunter_100', title: 'Monster Slayer', title_ru: 'Истребитель Монстров',
    description: 'Kill 100 monsters', description_ru: 'Убить 100 монстров',
    category: 'combat', icon: '💀', reward_gold: 500, reward_experience: 1000, reward_title: 'Истребитель', hidden: false },
  { id: 'ach_monster_hunter_1000', title: 'Legendary Slayer', title_ru: 'Легендарный Истребитель',
    description: 'Kill 1000 monsters', description_ru: 'Убить 1000 монстров',
    category: 'combat', icon: '👑', reward_gold: 5000, reward_experience: 10000, reward_title: 'Легенда Боя', hidden: false },
  { id: 'ach_combo_5', title: 'Combo Master', title_ru: 'Мастер Комбо',
    description: 'Land a 5-hit combo', description_ru: 'Нанести комбо из 5 ударов',
    category: 'combat', icon: '🔥', reward_gold: 100, reward_experience: 150, hidden: false },
  { id: 'ach_perfect_block', title: 'Perfect Block', title_ru: 'Идеальный Блок',
    description: 'Perform 10 perfect blocks', description_ru: 'Выполнить 10 идеальных блоков',
    category: 'combat', icon: '🛡️', reward_gold: 200, reward_experience: 300, hidden: false },
  { id: 'ach_boss_slayer', title: 'Boss Slayer', title_ru: 'Убийца Боссов',
    description: 'Kill your first world boss', description_ru: 'Убить первого мирового босса',
    category: 'combat', icon: '🐉', reward_gold: 2000, reward_experience: 5000, reward_title: 'Охотник на Драконов', hidden: false },

  // ── ИССЛЕДОВАНИЕ ─────────────────────────────────────
  { id: 'ach_explorer_tabriz', title: 'Discoverer of Tabriz', title_ru: 'Первооткрыватель Тебриза',
    description: 'Visit Tabriz', description_ru: 'Посетить Тебриз',
    category: 'exploration', icon: '🗺️', reward_gold: 50, reward_experience: 50, hidden: false },
  { id: 'ach_explorer_all', title: 'Master of Maps', title_ru: 'Повелитель Карт',
    description: 'Visit all 7 regions', description_ru: 'Посетить все 7 регионов',
    category: 'exploration', icon: '🌍', reward_gold: 1000, reward_experience: 2000, reward_title: 'Странник Миров', hidden: false },
  { id: 'ach_dungeon_first', title: 'Dungeon Delver', title_ru: 'Исследователь Подземелий',
    description: 'Complete your first dungeon', description_ru: 'Пройти первое подземелье',
    category: 'exploration', icon: '🏰', reward_gold: 200, reward_experience: 400, hidden: false },

  // ── СОЦИАЛЬНОЕ ───────────────────────────────────────
  { id: 'ach_first_friend', title: 'Friendly', title_ru: 'Дружелюбный',
    description: 'Add your first friend', description_ru: 'Добавить первого друга',
    category: 'social', icon: '👥', reward_gold: 50, reward_experience: 50, hidden: false },
  { id: 'ach_guild_member', title: 'Guild Member', title_ru: 'Член Гильдии',
    description: 'Join a guild', description_ru: 'Вступить в гильдию',
    category: 'social', icon: '🏴', reward_gold: 100, reward_experience: 100, hidden: false },
  { id: 'ach_pvp_first', title: 'Gladiator', title_ru: 'Гладиатор',
    description: 'Win your first PvP match', description_ru: 'Выиграть первый PvP-бой',
    category: 'social', icon: '🏟️', reward_gold: 200, reward_experience: 300, hidden: false },

  // ── КРАФТ / ТОРГОВЛЯ ─────────────────────────────────
  { id: 'ach_first_craft', title: 'Apprentice Crafter', title_ru: 'Ученик Кузнеца',
    description: 'Craft your first item', description_ru: 'Скрафтить первый предмет',
    category: 'crafting', icon: '🔨', reward_gold: 50, reward_experience: 50, hidden: false },
  { id: 'ach_craft_master', title: 'Master Crafter', title_ru: 'Мастер Крафта',
    description: 'Craft 50 items', description_ru: 'Скрафтить 50 предметов',
    category: 'crafting', icon: '⚒️', reward_gold: 500, reward_experience: 1000, reward_title: 'Мастер Ремесла', hidden: false },
  { id: 'ach_trader', title: 'Silk Road Trader', title_ru: 'Торговец Шёлкового Пути',
    description: 'Complete 10 trade contracts', description_ru: 'Выполнить 10 торговых контрактов',
    category: 'crafting', icon: '💰', reward_gold: 300, reward_experience: 500, hidden: false },

  // ── КВЕСТЫ ───────────────────────────────────────────
  { id: 'ach_quest_10', title: 'Adventurer', title_ru: 'Авантюрист',
    description: 'Complete 10 quests', description_ru: 'Выполнить 10 квестов',
    category: 'questing', icon: '📜', reward_gold: 200, reward_experience: 500, hidden: false },
  { id: 'ach_quest_50', title: 'Hero of the Empire', title_ru: 'Герой Империи',
    description: 'Complete 50 quests', description_ru: 'Выполнить 50 квестов',
    category: 'questing', icon: '🏆', reward_gold: 1000, reward_experience: 3000, reward_title: 'Герой Империи', hidden: false },

  // ── СЕКРЕТНЫЕ ────────────────────────────────────────
  { id: 'ach_chess_master', title: 'Chess Master', title_ru: 'Шахматный Гений',
    description: 'Win 10 chess games', description_ru: 'Выиграть 10 шахматных партий',
    category: 'minigames', icon: '♟️', reward_gold: 500, reward_experience: 500, reward_title: 'Шахматный Гений', hidden: true },
  { id: 'ach_poet', title: 'Poet of Shiraz', title_ru: 'Поэт Шираза',
    description: 'Complete all poetry challenges', description_ru: 'Выполнить все поэтические задания',
    category: 'minigames', icon: '📜', reward_gold: 1000, reward_experience: 1000, reward_title: 'Поэт Шираза', hidden: true },
  { id: 'ach_no_death', title: 'Untouchable', title_ru: 'Неприкосновенный',
    description: 'Complete a dungeon without dying', description_ru: 'Пройти подземелье без смертей',
    category: 'combat', icon: '✨', reward_gold: 1000, reward_experience: 2000, reward_title: 'Неприкосновенный', hidden: true },
];

export class AchievementService {
  private db = DatabaseService.getInstance();

  async getUnlocked(charId: string): Promise<AchievementDef[]> {
    const rows = await this.db.query<{ achievement_id: string }>(
      'SELECT achievement_id FROM character_achievements WHERE character_id = $1',
      [charId]
    );
    const ids = new Set(rows.map(r => r.achievement_id));
    return ACHIEVEMENTS.filter(a => ids.has(a.id));
  }

  async getAll(): Promise<AchievementDef[]> {
    return ACHIEVEMENTS;
  }

  async checkAndUnlock(charId: string, achievementId: string): Promise<boolean> {
    const existing = await this.db.queryOne(
      'SELECT 1 FROM character_achievements WHERE character_id = $1 AND achievement_id = $2',
      [charId, achievementId]
    );
    if (existing) return false;

    const def = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!def) return false;

    await this.db.query(
      'INSERT INTO character_achievements (character_id, achievement_id) VALUES ($1, $2)',
      [charId, achievementId]
    );
    // Выдаём награды
    if (def.reward_gold > 0) {
      await this.db.query(
        'UPDATE characters SET gold = gold + $1 WHERE id = $2',
        [def.reward_gold, charId]
      );
    }
    if (def.reward_experience > 0) {
      await this.db.query(
        'UPDATE characters SET experience = experience + $1 WHERE id = $2',
        [def.reward_experience, charId]
      );
    }
    logger.info(`[Achievement] ${charId} unlocked: ${achievementId}`);
    return true;
  }

  async unlock(charId: string, achievementId: string): Promise<boolean> {
    return this.checkAndUnlock(charId, achievementId);
  }

  async getProgress(charId: string, achievementId: string): Promise<{ unlocked: boolean }> {
    const row = await this.db.queryOne(
      'SELECT 1 FROM character_achievements WHERE character_id = $1 AND achievement_id = $2',
      [charId, achievementId]
    );
    return { unlocked: !!row };
  }
}
