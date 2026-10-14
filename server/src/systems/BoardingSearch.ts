// Поиск целей абордажа: ОДНА точка для маршрута и для сокета.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Список целей собирался прямо в маршруте
// GET /boarding/targets. Сокету, который начинает заход, нужен ТОТ ЖЕ список:
// иначе клиент показал бы одну картину, а сервер решал бы по другой, и игрок
// получил бы «цель не найдена» на цели, которую только что видел. Два места с
// одной логикой — это две правды об одном числе, и разъедутся они при первой
// же правке фильтра.
//
// ГЛАВНОЕ ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ЖИВЁТ. Цель ищется ПОИСКОМ, а не берётся из
// пакета. Клиент присылает только ИД и режим; уровень, позиция, регион и
// годность цели вычисляются здесь. Если бы сервер доверял присланным полям,
// игрок отправлял бы `{ level: 1 }` и абордажил бы рейд без боя.
import { BoatSystem } from './BoatSystem';
import { RedisService } from '../services/RedisService';
import { CharacterService } from '../services/CharacterService';
import type { AISystem } from './AISystem';
import type { Character } from '../types/game.types';
import {
  boardTargets,
  type BoardSearchInput,
} from './BoardingTargets';
import { BOARD_RANGE, type BoardErrorCode, type BoardMode, type BoardTarget } from './BoardingTypes';

export interface BoardSearchDeps {
  boats: BoatSystem;
  redis: RedisService;
  characters: CharacterService;
  ai: AISystem;
}

/** Сколько чужих лодок проверяем за раз. */
const ОГРАНИЧЕНИЕ_ПРОВЕРКИ = 50;

export interface BoardSearchResult {
  ok: boolean;
  /** Почему не вышло — код для интерфейса, а не текст для лога. */
  code?: BoardErrorCode;
  targets: BoardTarget[];
  /**
   * Вход, которым искали. Отдаётся наружу не для удобства, а потому что из
   * него потом собирается боец: атакующий обязан получить ровно ту силу,
   * которую имел в момент поиска, а не пересчитанную по новым данным.
   */
  вход: BoardSearchInput | null;
}

/**
 * Собрать цели для атакующего.
 *
 * Лодка — обязательное условие: без неё абордажировать нечего. Водная зона
 * проверяется тем же фактом наличия активной лодки: лодку можно активировать
 * только выйдя в воду, поэтому «есть активная лодка» и «мы в воде» — одно и то
 * же утверждение, и вторую проверку добавлять было бы второй правдой.
 */
export async function найтиЦелиАбордажа(
  deps: BoardSearchDeps,
  атакующий: Character,
  mode: BoardMode,
): Promise<BoardSearchResult> {
  const лодка = await deps.boats.getActiveBoat(атакующий.id).catch(() => null);
  if (!лодка) return { ok: false, code: 'board_no_boat', targets: [], вход: null };

  const вход: BoardSearchInput = {
    attackerId: атакующий.id,
    attackerLevel: атакующий.level,
    attackerRegion: атакующий.region,
    attackerShard: атакующий.serverId ?? 'isfahan',
    x: атакующий.position?.x ?? 0,
    z: атакующий.position?.z ?? 0,
    mode,
  };

  // PvP: чужие лодки той же зоны. PvE: водные монстры рядом, и список игроков
  // не нужен вовсе — он и не запрашивается.
  const игроки: { id: string; nameRu: string; level: number; boatId: string; x: number; z: number }[] = [];
  if (mode === 'pvp') {
    const вРегионе = await deps.redis
      .getPlayersInRegion(вход.attackerShard, вход.attackerRegion)
      .catch(() => [] as string[]);
    for (const id of (вРегионе as string[]).slice(0, ОГРАНИЧЕНИЕ_ПРОВЕРКИ)) {
      if (id === атакующий.id) continue;
      const чужой = await deps.characters.getCharacterById(id).catch(() => null);
      const чужаяЛодка = await deps.boats.getActiveBoat(id).catch(() => null);
      if (!чужой || !чужаяЛодка) continue;
      игроки.push({
        id,
        nameRu: чужой.name,
        level: чужой.level,
        boatId: чужаяЛодка.boatId,
        x: чужой.position?.x ?? 0,
        z: чужой.position?.z ?? 0,
      });
    }
  }

  return {
    ok: true,
    targets: boardTargets(deps.ai, вход, игроки, BOARD_RANGE),
    вход,
  };
}
