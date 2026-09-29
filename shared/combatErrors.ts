/**
 * Причины отказа сервера.
 *
 * Сервер раньше слал英文-текст ('Dodge is on cooldown'), и клиент показывал
 * его дословно - игрок видел английскую фразу посреди русского интерфейса.
 * Теперь сервер шлёт код, а перевод берётся из локализации на языке игрока.
 */
export type CombatErrorCode =
  | 'attack_too_fast'
  | 'dodge_cooldown'
  | 'out_of_reach'
  | 'not_enough_stamina'
  | 'not_enough_mana'
  | 'skill_cooldown'
  | 'unknown_skill'
  | 'target_not_found'
  | 'wrong_shard'
  | 'not_in_group';

export const COMBAT_ERROR_KEYS: Record<CombatErrorCode, string> = {
  attack_too_fast: 'world.combat_error_attack_too_fast',
  dodge_cooldown: 'world.combat_error_dodge_cooldown',
  out_of_reach: 'world.combat_error_out_of_reach',
  not_enough_stamina: 'world.combat_error_not_enough_stamina',
  not_enough_mana: 'world.combat_error_not_enough_mana',
  skill_cooldown: 'world.combat_error_skill_cooldown',
  unknown_skill: 'world.combat_error_unknown_skill',
  target_not_found: 'world.combat_error_target_not_found',
  // Ниже двух кодов раньше не существовало: сообщения шли текстом
  // ('Target is on another game server', 'You are not in this dungeon
  // group') и показывались игроку по-английски.
  wrong_shard: 'world.combat_error_wrong_shard',
  not_in_group: 'world.combat_error_not_in_group',
};

/** Известен ли серверу этот код (неизвестные коды показываем как есть) */
export function isCombatErrorCode(value: string): value is CombatErrorCode {
  return value in COMBAT_ERROR_KEYS;
}
