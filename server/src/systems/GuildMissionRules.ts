import { GUILD_MISSIONS, type GuildMission } from '../data/guilds';

/**
 * Сколько участников нужно, чтобы задание вообще открылось.
 *
 * Мусор в справочнике (0, -1, 'пять') не должен открывать задание «на
 * всех» или «никогда». 0 и отрицательное — это 1: задание существует, и
 * хоть кто-то в гильдии его берёт. Нечисло — 1 по той же причине.
 *
 * Порог не может превышать максимум гильдии: иначе задание не откроется
 * никогда, и игрок увидит «недоступно» без причины. Обрезается, а не
 * отвергается - задание остаётся играбельным.
 */
export function needMembers(mission: GuildMission, maxMembers: number): number {
  const заявлено = Number(mission.minMembers);
  const надо = Number.isFinite(заявлено) && заявлено > 0 ? Math.floor(заявлено) : 1;
  const потолок = Number.isFinite(maxMembers) && maxMembers > 0 ? Math.floor(maxMembers) : надо;
  return Math.min(надо, потолок);
}

/**
 * Открыто ли задание для этой гильдии.
 *
 * Принимается и строка, и Date: база отдаёт timestamptz как Date, а
 * собранное вручную значение из панели приходит строкой. Раньше сюда
 * приходилось подставлять тернарник, переводящий Date в строку, - и
 * вызов выглядел так, что в нём нельзя было разобраться.
 *
 * available === null значит «сейчас можно». Нечисло в available_at - это
 * мусор в базе, и трактовать его как «не открыто» значит навсегда
 * заблокировать задание без видимой причины. Поэтому нечисло считается
 * открытым: лучше лишний раз дать взять задание, чем показать вечную
 * блокировку.
 */
export function isOpen(availableAt: string | Date | null | undefined): boolean {
  if (availableAt === null || availableAt === undefined) return true;
  const время = availableAt instanceof Date
    ? availableAt.getTime()
    : Date.parse(availableAt);
  if (!Number.isFinite(время)) return true;
  return время <= Date.now();
}

/**
 * Почему задание не берётся. Пустая строка - причин нет.
 *
 * Отказ всегда с причиной, потому что «недоступно» без причины похоже на
 * поломку, а игрок не может ни понять, ни обойти.
 */
export function blockReason(
  mission: GuildMission,
  участников: number,
  maxMembers: number,
  availableAt: string | null | undefined,
  ужеЕсть: boolean,
): string {
  if (ужеЕсть) return 'MISSION_ALREADY_ACTIVE';
  if (!isOpen(availableAt)) return 'MISSION_ON_COOLDOWN';
  const надо = needMembers(mission, maxMembers);
  if (участников < надо) return 'MISSION_NEEDS_MEMBERS';
  return '';
}

/** Цели задания с номерами: порядковый номер — часть ключа в базе. */
export function objectiveIndexes(mission: GuildMission): number[] {
  return mission.objectives.map((_, i) => i);
}

/** Задание из справочника. null, если в справочнике такого нет. */
export function findMission(id: string): GuildMission | null {
  if (typeof id !== 'string' || id === '') return null;
  return GUILD_MISSIONS.find(м => м.id === id) ?? null;
}

/**
 * Все ли цели выполнены.
 *
 * Цели с required <= 0 считаются выполненными: ноль - это не задача, а
 * мусор в данных, и из-за него задание не должно вечно ждать.
 * Нечисло required считается выполненной по той же причине.
 */
export function allDone(
  mission: GuildMission,
  прогресс: Map<number, number>,
): boolean {
  if (mission.objectives.length === 0) return true;
  return mission.objectives.every((цель, i) => {
    const надо = Number(цель.required);
    if (!Number.isFinite(надо) || надо <= 0) return true;
    return (прогресс.get(i) ?? 0) >= надо;
  });
}

/**
 * Отметка времени: когда задание откроется снова.
 *
 * Отсчёт идёт от СЕЙЧАС, а не прибавляется к прошлому available_at. Иначе
 * после долгого отсутствия в игре отсчёт накапливался бы с каждой выдачей
 * и задание не открылось бы никогда: 24+24+24+... часов вместо 24.
 */
export function nextAvailable(cooldownHours: number, from = Date.now()): string {
  const часы = Number(cooldownHours);
  const сколько = Number.isFinite(часы) && часы > 0 ? часы : 0;
  return new Date(from + сколько * 3600_000).toISOString();
}
