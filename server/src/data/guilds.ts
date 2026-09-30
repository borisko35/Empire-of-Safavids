// ============================================================
// Система гильдий — Empire of Safavids
// ============================================================

import { Region } from '../types/game.types';

export type GuildRank = 'leader' | 'officer' | 'veteran' | 'member' | 'recruit';

export interface GuildRankDefinition {
  rank: GuildRank;
  nameRu: string;
  permissions: {
    invite: boolean;
    kick: boolean;
    promote: boolean;
    manageTreasury: boolean;
    declareWar: boolean;
    manageTerritories: boolean;
  };
}

export interface GuildSkill {
  id: string;
  name: string;
  nameRu: string;
  description: string;
  maxLevel: number;
  costPerLevel: number;  // золото гильдии
  effect: string;
}

export interface GuildMission {
  id: string;
  name: string;
  nameRu: string;
  description: string;
  objectives: { type: string; target: string; required: number }[];
  rewards: { guildExp: number; gold: number; memberExp: number };
  cooldown: number; // часы
  minMembers: number;
}

export interface TerritoryDefinition {
  id: string;
  name: string;
  nameRu: string;
  region: Region;
  bonuses: { type: string; value: number }[];
  capturePoints: number;
  defensePoints: number;
  siegeSchedule: string; // время осады
}

export const GUILD_RANKS: GuildRankDefinition[] = [
  {
    rank: 'leader',
    nameRu: 'Глава Гильдии',
    permissions: { invite: true, kick: true, promote: true, manageTreasury: true, declareWar: true, manageTerritories: true },
  },
  {
    rank: 'officer',
    nameRu: 'Офицер',
    permissions: { invite: true, kick: true, promote: false, manageTreasury: false, declareWar: false, manageTerritories: false },
  },
  {
    rank: 'veteran',
    nameRu: 'Ветеран',
    permissions: { invite: true, kick: false, promote: false, manageTreasury: false, declareWar: false, manageTerritories: false },
  },
  {
    rank: 'member',
    nameRu: 'Член',
    permissions: { invite: false, kick: false, promote: false, manageTreasury: false, declareWar: false, manageTerritories: false },
  },
  {
    rank: 'recruit',
    nameRu: 'Новичок',
    permissions: { invite: false, kick: false, promote: false, manageTreasury: false, declareWar: false, manageTerritories: false },
  },
];

export const GUILD_SKILLS: GuildSkill[] = [
  {
    id: 'guild_exp_boost',
    name: 'Scholar\'s Blessing',
    nameRu: 'Благословение Учёного',
    description: '+2% к опыту за каждый уровень',
    maxLevel: 10,
    costPerLevel: 5000,
    effect: 'exp_multiplier',
  },
  {
    id: 'guild_gold_boost',
    name: 'Merchant\'s Fortune',
    nameRu: 'Удача Торговца',
    description: '+3% к золоту с монстров за каждый уровень',
    maxLevel: 10,
    costPerLevel: 5000,
    effect: 'gold_multiplier',
  },
  {
    id: 'guild_hp_boost',
    name: 'Warrior\'s Endurance',
    nameRu: 'Выносливость Воина',
    description: '+5% к максимальному здоровью за каждый уровень',
    maxLevel: 10,
    costPerLevel: 8000,
    effect: 'max_hp_bonus',
  },
  {
    id: 'guild_craft_speed',
    name: 'Master Craftsman',
    nameRu: 'Мастер Крафта',
    description: '-5% к времени крафтинга за каждый уровень',
    maxLevel: 10,
    costPerLevel: 6000,
    effect: 'craft_speed',
  },
  {
    id: 'guild_siege_power',
    name: 'Siege Masters',
    nameRu: 'Мастера Осады',
    description: '+10% к урону во время осады за каждый уровень',
    maxLevel: 5,
    costPerLevel: 15000,
    effect: 'siege_damage',
  },
];

export const GUILD_MISSIONS: GuildMission[] = [
  {
    id: 'gm_bandit_purge',
    name: 'Bandit Purge',
    nameRu: 'Искоренение Разбойников',
    description: 'Гильдия должна уничтожить 100 разбойников.',
    objectives: [{ type: 'kill', target: 'mob_bandit_scout', required: 100 }],
    rewards: { guildExp: 5000, gold: 2000, memberExp: 1000 },
    cooldown: 24,
    minMembers: 5,
  },
  {
    id: 'gm_silk_trade',
    name: 'Silk Road Trade',
    nameRu: 'Торговля по Шёлковому Пути',
    description: 'Гильдия должна доставить 500 единиц шёлка.',
    objectives: [{ type: 'collect', target: 'mat_silk', required: 500 }],
    rewards: { guildExp: 8000, gold: 5000, memberExp: 1500 },
    cooldown: 48,
    minMembers: 10,
  },
  {
    id: 'gm_dungeon_clear',
    name: 'Dungeon Conquest',
    nameRu: 'Покорение Данжа',
    description: 'Гильдия должна пройти данж в режиме «Героический».',
    objectives: [{ type: 'dungeon', target: 'dungeon_tabriz_catacombs', required: 3 }],
    rewards: { guildExp: 15000, gold: 8000, memberExp: 3000 },
    cooldown: 72,
    minMembers: 15,
  },
];

export const TERRITORIES: TerritoryDefinition[] = [
  {
    id: 'territory_tabriz_market',
    name: 'Tabriz Grand Bazaar',
    nameRu: 'Большой Базар Тебриза',
    region: Region.TABRIZ,
    bonuses: [
      { type: 'trade_tax', value: 0.05 },
      { type: 'gold_income', value: 1000 },
    ],
    capturePoints: 10000,
    defensePoints: 5000,
    siegeSchedule: 'Saturday 20:00 UTC',
  },
  {
    id: 'territory_isfahan_palace',
    name: 'Isfahan Palace District',
    nameRu: 'Дворцовый Квартал Исфахана',
    region: Region.ISFAHAN,
    bonuses: [
      { type: 'exp_bonus', value: 0.10 },
      { type: 'gold_income', value: 3000 },
      { type: 'craft_speed', value: 0.15 },
    ],
    capturePoints: 50000,
    defensePoints: 25000,
    siegeSchedule: 'Sunday 20:00 UTC',
  },
  {
    id: 'territory_caucasus_fortress',
    name: 'Caucasus Mountain Fortress',
    nameRu: 'Кавказская Горная Крепость',
    region: Region.CAUCASUS,
    bonuses: [
      { type: 'pvp_damage', value: 0.05 },
      { type: 'defense_bonus', value: 0.20 },
      { type: 'gold_income', value: 2000 },
    ],
    capturePoints: 80000,
    defensePoints: 40000,
    siegeSchedule: 'Friday 20:00 UTC',
  },
  {
    id: 'territory_persian_gulf_port',
    name: 'Persian Gulf Trade Port',
    nameRu: 'Торговый Порт Персидского Залива',
    region: Region.PERSIAN_GULF,
    bonuses: [
      { type: 'trade_tax', value: 0.10 },
      { type: 'gold_income', value: 5000 },
      { type: 'sea_speed', value: 0.20 },
    ],
    capturePoints: 120000,
    defensePoints: 60000,
    siegeSchedule: 'Saturday 18:00 UTC',
  },
];

export function getGuildRankPermissions(rank: GuildRank) {
  return GUILD_RANKS.find(r => r.rank === rank)?.permissions;
}

export function canPromote(promoterRank: GuildRank, targetRank: GuildRank): boolean {
  const rankOrder: GuildRank[] = ['recruit', 'member', 'veteran', 'officer', 'leader'];
  const promoterIdx = rankOrder.indexOf(promoterRank);
  const targetIdx = rankOrder.indexOf(targetRank);
  return promoterIdx > targetIdx + 1;
}
