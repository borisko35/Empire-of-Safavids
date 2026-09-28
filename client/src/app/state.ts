// ============================================================
// Состояние сессии — Empire of Safavids
// ============================================================

export interface Vec3 { x: number; y: number; z: number }

export interface CharacterStats {
  strength: number; agility: number; intelligence: number; endurance: number; charisma: number;
}

export interface Character {
  id: string;
  userId: string;
  name: string;
  class: string;
  level: number;
  experience: number;
  stats: CharacterStats;
  hp: number; maxHp: number;
  mana: number; maxMana: number;
  stamina: number; maxStamina: number;
  position: Vec3;
  region: string;
  zone?: string;
  serverId: string;
  gold: number;
  azens?: number;
  isfahanSilver?: number;
  syrianGold?: number;
}

export interface SkillDef {
  id: string;
  name: string;
  nameRu: string;
  manaCost: number;
  staminaCost: number;
  cooldown: number;
  damageMultiplier: number;
  range: number;
  aoe: boolean;
}

export interface RegionInfo {
  id: string;
  name: string;
  nameRu: string;
  minLevel: number;
  description: string;
  onlinePlayers: number;
}

export interface QuestObjectiveDef {
  id: string;
  type: string;
  description: string;
  target: string;
  required: number;
  optional: boolean;
  /** Точки спавна монстров для навигации (используются когда монстры ещё не появились в мире) */
  spawnPoints?: { x: number; z: number }[];
}

export interface QuestDef {
  id: string;
  title: string;
  titleRu: string;
  description: string;
  type: string;
  minLevel: number;
  requiredRegion?: string;
  objectives: QuestObjectiveDef[];
  /** id квестодателя (из server/src/data/quests.ts) — цель сдачи квеста */
  npcGiver?: string;
  npcGiverRegion: string;
  rewards: { experience: number; gold: number; items?: { itemId: string; quantity: number }[] };
}

/** Живое состояние игровой сессии */
export const session = {
  token: localStorage.getItem('eos_token') ?? '',
  userId: localStorage.getItem('eos_user_id') ?? '',
  username: localStorage.getItem('eos_username') ?? '',
  isAdmin: false,
  isAdminRole: 'gm',
  /** true — вход без регистрации: аккаунт живёт в браузере, его надо предложить сохранить */
  isGuest: localStorage.getItem('eos_guest') === '1',
  character: null as Character | null,
  skills: [] as SkillDef[],
  /** Локальные ресурсы (сервер их не стримит — поддерживаем сами, ресинк по событиям) */
  hp: 0, maxHp: 0, mana: 0, maxMana: 0, stamina: 0, maxStamina: 0,
  /** Бонусы экипировки для воды: снимают замедление и экономят выносливость */
  waterBonus: { waterSpeed: 0, swimStamina: 0 },
  /**
   * Позиция персонажа прямо сейчас, обновляется каждый кадр.
   * character.position приходит с сервера раз в несколько секунд —
   * для рыбалки (где важно, стоишь ли ты в воде) такая задержка означала бы
   * промах: удочка улетела бы туда, где игрок был полминуты назад.
   */
  selfPos: { x: 0, z: 0 },
  /**
   * Счётчик непрочитанных уведомлений для красной цифры.
   * Уведомления пишутся сервером в таблицу, а прочитать их было нечем:
   * панели не существовало, а тост исчезал через пару секунд.
   */
  notifications: { unread: 0 },
  /** Активная лодка (из панели рыбалки); null — игрок на суше */
  boat: null as null | { id: string; nameRu: string; waterSpeed: number; swimSpeed: number; fishingBonus: number; catchLimit: number },
  /**
   * Активный скакун: скорость приходит с сервера, потому что считается по
   * таблице скакунов и уровню в character_mounts. null — игрок пешком.
   */
  mount: null as null | { id: string; nameRu: string; speed: number; level: number },
  level: 0, experience: 0,
  /**
   * Персонаж мёртв: открыт экран смерти, ходить и бить нельзя.
   * Флаг, а не проверка класса оверлея в DOM: экран смерти строит
   * deathScreen, и 3D-слой не должен знать, как он выглядит.
   */
  dead: false,
  /**
   * Экипировка для 3D-аватара: вид оружия и цвет брони.
   * null — сервер ещё не ответил, до тех пор показываем вид класса.
   */
  gear: null as null | { weapon: boolean; armorColor: number | null },
  /** Убийства за сессию: monsterId -> количество (для прогресса квестов) */
  kills: {} as Record<string, number>,
  /** Прогресс квестов с сервера: questId -> { status, progress } */
  questState: {} as Record<string, { status: string; progress: Record<string, number> }>,
  worldTime: '' as string,
};

export function persistAuth(token: string, userId: string, username: string, isGuest = false): void {
  session.token = token;
  session.userId = userId;
  session.username = username;
  session.isGuest = isGuest;
  localStorage.setItem('eos_token', token);
  localStorage.setItem('eos_user_id', userId);
  localStorage.setItem('eos_username', username);
  if (isGuest) localStorage.setItem('eos_guest', '1');
  else localStorage.removeItem('eos_guest');
}

export function clearAuth(): void {
  session.token = '';
  session.userId = '';
  session.username = '';
  session.isAdmin = false;
  session.isAdminRole = 'gm';
  session.isGuest = localStorage.getItem('eos_guest') === '1';
  session.character = null;
  session.skills = [];
  localStorage.removeItem('eos_token');
  localStorage.removeItem('eos_user_id');
  localStorage.removeItem('eos_username');
}
