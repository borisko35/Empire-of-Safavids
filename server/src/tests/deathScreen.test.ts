// Экран смерти: раньше он был написан, но не работал.
//
// ЧТО БЫЛО. client/src/app/deathScreen.ts (105 строк) создавал оверлей с
// двумя кнопками и отсчётом, но initDeathScreen не вызывался НИ ОТКУДА:
// модуль целиком был мёртвым кодом. Сервер в тот же момент держал другое
// поведение: handlePlayerDeath СРАЗУ вызывал characterService.respawn и
// в том же выдохе слал PLAYER_RESPAWNED. Состояния «мёртв» не
// существовало, экрана с выбором не было, событие 'respawn' сервер не
// слушал. Итог: игрок видел #overlay-death с двумя строчками текста,
// который показывался и мгновенно пропадал — успеть нажать было нельзя.
//
// ГЛАВНОЕ, ЧТО ЗАЩИЩАЕТ ФАЙЛ. Теперь смерть — состояние, и у игрока
// есть выбор. Выбор без страховки опасен: если клиент не пришлёт 'respawn'
// (обрыв связи, закрытая вкладка, читер), персонаж остался бы мёртвым
// навсегда. Поэтому таймер автореспавна держит сервер, и проверки ниже
// падают, если его уберут.
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { DEATH, spotRespawnCost } from '../../../shared/constants';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

/** Без комментариев: иначе проверки «в коде не должно быть X» ловят
 *  само слово X из пояснения рядом (так уже ломалось в этом проекте). */
const handler = stripComments(read('server/src/socket/GameSocketHandler.ts'));
const service = stripComments(read('server/src/services/CharacterService.ts'));
const screen = stripComments(read('client/src/app/deathScreen.ts'));
const world = stripComments(read('client/src/app/world.ts'));
const world3d = stripComments(read('client/src/app/game3d/world3d.ts'));
const constants = stripComments(read('shared/constants.ts'));
const html = read('client/src/app/index.html');
const css = stripComments(read('client/src/app/styles.css'));

/**
 * Тело метода/функции по имени — чтобы проверка не цеплялась за соседний код.
 * Разбирать приходится типы: у половины методов параметры объявлены
 * объектами (`data: { type?: string }`), а тип возврата бывает
 * `Promise<{ ok: true; ... } | { ok: false; ... }>` — и обычный подсчёт
 * фигурных скобок обрывался бы на типе, а не на теле.
 */
function body(source: string, signature: string): string {
  const at = source.indexOf(signature);
  if (at < 0) return '';
  let i = at + signature.length;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== '(') return '';           // не начало списка параметров
  let parens = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') parens++;
    else if (source[i] === ')') { parens--; if (parens === 0) { i++; break; } }
  }
  // Дальше может идти тип возврата: пропускаем вложенные объектные типы
  // внутри дженериков, а первую «голую» фигурную скобку считаем телом
  let angle = 0;
  let skip = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (skip > 0) { if (ch === '}') skip--; continue; }
    if (ch === '<') angle++;
    else if (ch === '>') angle--;
    else if (ch === '{') {
      if (angle > 0) { skip++; continue; }
      break;
    } else if (ch === ';' && angle === 0) return '';   // тела нет (объявление)
  }
  if (source[i] !== '{') return '';
  let braces = 0;
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') braces++;
    else if (source[j] === '}') {
      braces--;
      if (braces === 0) return source.slice(at, j + 1);
    }
  }
  return source.slice(at);
}

const death = body(handler, 'private async handlePlayerDeath');
const complete = body(handler, 'private async completeRespawn');
const onRespawn = body(handler, 'private async handleRespawn');
const onMove = body(handler, 'private async handlePlayerMove');
const onCombat = body(handler, 'private async handleCombatAction');
const onPvp = body(handler, 'private async combatPlayerVsPlayer');
const regen = body(handler, 'private async regenTick');
const onDisconnect = body(handler, 'private async handleDisconnect');
const clearDead = body(handler, 'private clearDeadState');
const reject = body(screen, 'function onRespawnRejected');

type Dict = Record<string, unknown>;
const LOCALES = ['ru', 'en', 'az'] as const;
const dicts: Record<string, Dict> = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(read(`shared/locales/${l}.json`)) as Dict]),
);
const lookup = (d: Dict, path: string): unknown =>
  path.split('.').reduce<unknown>((node, p) => (node == null ? undefined : (node as Dict)[p]), d);

describe('Смерть: состояние появилось и снимается', () => {
  it('handlePlayerDeath больше не воскрешает сам', () => {
    // ГЛАВНАЯ ПОЛОМКА. Раньше тут стоял respawn() + PLAYER_RESPAWNED —
    // игрок не успевал не то что нажать, а прочитать текст.
    expect(death).not.toMatch(/characterService\.respawn\(/);
    expect(death).not.toMatch(/PLAYER_RESPAWNED/);
  });

  it('смерть кладёт игрока в состояние смерти', () => {
    expect(death).toMatch(/this\.deadPlayers\.set\(dead\.id/);
    expect(death).toMatch(/SOCKET_EVENTS\.PLAYER_DIED/);
  });

  it('точка смерти берётся живая из Redis, а не из БД', () => {
    // В БД позиция записывается раз в 5 секунд: респавн «на месте» уводил
    // бы игрока на пару метров от того места, где он упал
    expect(death).toMatch(/getPlayerPosition\(dead\.id\)/);
  });

  it('повторная смерть не перезапускает состояние и таймер', () => {
    // Два урона в одном кадре или добивание трупа не должны плодить таймеры
    expect(death).toMatch(/if \(this\.deadPlayers\.has\(dead\.id\)\) return;/);
  });

  it('состояние снимается только через clearDeadState', () => {
    expect(clearDead).toMatch(/clearTimeout\(dead\.timer\)/);
    expect(clearDead).toMatch(/this\.deadPlayers\.delete\(characterId\)/);
    // Никто не удаляет запись в обход: без снятия таймера он сработает
    // повторно и воскресит уже живого персонажа второй раз
    const deletes = handler.match(/deadPlayers\.delete\(/g) ?? [];
    expect(deletes).toHaveLength(1);
  });

  it('состояние объявлено как карта с таймером', () => {
    expect(handler).toMatch(/private deadPlayers = new Map<string, DeadState>\(\)/);
    expect(handler).toMatch(/interface DeadState \{[\s\S]*?timer\?: ReturnType<typeof setTimeout>/);
    expect(handler).toMatch(/interface DeadState \{[\s\S]*?busy: boolean/);
  });

  it('зашедший в мир трупом воскресает', () => {
    // Страховка от падения сервера между смертью и респавном: в БД остался
    // hp = 0, и игрок зашёл бы в мир без единого шанса что-то сделать
    const auth = body(handler, 'private async handleAuth');
    expect(auth).toMatch(/if \(character\.hp <= 0\)/);
    expect(auth).toMatch(/characterService\.respawn\(character\.id\)/);
  });

  it('обрыв связи не отменяет страховку', () => {
    // Если снять состояние здесь, вышедший посреди смерти вернулся бы в
    // трупе: в БД hp = 0, а таймер, который должен был воскресить, убран
    expect(onDisconnect).not.toMatch(/clearDeadState/);
  });
});

describe('Возрождение: сервер слушает выбор игрока', () => {
  it('событие зарегистрировано', () => {
    expect(handler).toMatch(/socket\.on\(SOCKET_EVENTS\.RESPAWN, async \(data: \{ type\?: string \}\)/);
  });

  it('имя события живёт только в общих константах', () => {
    // Строковый литерал 'respawn' в коде — рассинхон после переименования
    expect(constants).toMatch(/RESPAWN: 'respawn'/);
    expect(handler).not.toMatch(/socket\.on\('respawn'/);
    expect(screen).not.toMatch(/socket\.emit\('respawn'/);
    expect(screen).toMatch(/socket\.emit\(SOCKET_EVENTS\.RESPAWN, \{ type \}\)/);
  });

  it('тип приходит из RESPAWN_TYPES, постороннее значение — отказ', () => {
    expect(onRespawn).toMatch(/type !== RESPAWN_TYPES\.CITY && type !== RESPAWN_TYPES\.SPOT/);
    expect(onRespawn).toMatch(/RESPAWN_REJECT\.INVALID_TYPE/);
  });

  it('живому игроку респавн не выдаётся', () => {
    expect(onRespawn).toMatch(/if \(!this\.deadPlayers\.has\(socket\.characterId\)\)/);
    expect(onRespawn).toMatch(/RESPAWN_REJECT\.NOT_DEAD/);
  });

  it('без аутентификации — отказ, а не респавн', () => {
    expect(onRespawn).toMatch(/RESPAWN_REJECT\.NOT_AUTH/);
  });

  it('город: возрождение на стартовой точке и без золота', () => {
    // goldCost и spot наполняются только в ветке SPOT
    const spotBranch = complete.slice(complete.indexOf('if (type === RESPAWN_TYPES.SPOT)'));
    expect(spotBranch).toMatch(/goldCost = spotRespawnCost\(character\.gold\)/);
    expect(spotBranch).toMatch(/spot = \{ x: dead\.position\.x, z: dead\.position\.z \}/);
    const beforeSpot = complete.slice(0, complete.indexOf('if (type === RESPAWN_TYPES.SPOT)'));
    expect(beforeSpot).toMatch(/let goldCost = 0;/);
    expect(beforeSpot).not.toMatch(/goldCost = spotRespawnCost/);
  });

  it('точка смерти и цена уходят в сервис одной операцией', () => {
    expect(complete).toMatch(/respawn\(characterId, \{ spot, goldCost \}\)/);
  });

  it('в глубокой воде на месте не воскрешают', () => {
    // Иначе игрок возродился бы там, где не может выбраться без стамины
    expect(complete).toMatch(/isDeepWater\(dead\.position\.x, dead\.position\.z\)/);
    expect(complete).toMatch(/RESPAWN_REJECT\.SPOT_BLOCKED/);
  });

  it('клиенту уходит цена респавна на месте', () => {
    // Экран смерти показывает «5% золота», и игрок должен знать сумму
    expect(death).toMatch(/spotCostGold: spotRespawnCost\(dead\.gold\)/);
    expect(death).toMatch(/respawnInSec: DEATH\.AUTO_RESPAWN_SEC/);
  });
});

describe('Золото: 5% списывается, при нехватке — отказ', () => {
  it('цена — 5% от золота', () => {
    // Ровно проектная цифра: кнопка обещает 5%
    expect(constants).toMatch(/SPOT_COST_GOLD_RATE: 0\.05/);
    expect(spotRespawnCost(1000)).toBe(50);
    expect(spotRespawnCost(1234)).toBe(61);
  });

  it('минимум — 1 золота, иначе респавн на месте бесплатный', () => {
    // При 0 золота 5% = 0, и «оплата» превращалась бы в подарок
    expect(constants).toMatch(/SPOT_COST_MIN_GOLD: 1/);
    expect(spotRespawnCost(0)).toBe(1);
    expect(spotRespawnCost(19)).toBe(1);
  });

  it('отрицательный баланс не превращается в кредит', () => {
    expect(spotRespawnCost(-50)).toBe(1);
  });

  it('списание и восстановление — один UPDATE с проверкой баланса', () => {
    // Две отдельные операции оставляли бы окно, где персонаж уже живой,
    // а золото ещё не списано
    const respawn = body(service, 'async respawn');
    expect(respawn).toMatch(/gold = gold - \$3/);
    expect(respawn).toMatch(/WHERE id = \$1 AND gold >= \$3/);
  });

  it('не хватило золота — отказ, а не бесплатное место', () => {
    // ГЛАВНОЕ. Продавать респавн за 5% золота, не списывая их, — значит
    // отдать самый дорогой вариант бесплатно всем, у кого 0 золота
    expect(service).toMatch(/reason: 'not_found' \| 'no_gold'/);
    const noGold = complete.slice(complete.indexOf("result.reason === 'no_gold'"));
    expect(noGold).toMatch(/RESPAWN_REJECT\.NO_GOLD/);
    expect(noGold).toMatch(/cost: goldCost/);
    expect(noGold).toMatch(/return;/);
  });

  it('отказ приходит ДО подтверждения респавна', () => {
    const rejectAt = complete.indexOf('RESPAWN_REJECT.NO_GOLD');
    const okAt = complete.indexOf('SOCKET_EVENTS.PLAYER_RESPAWNED');
    expect(rejectAt).toBeGreaterThan(-1);
    expect(okAt).toBeGreaterThan(rejectAt);
  });

  it('игроку сообщается, сколько именно не хватило', () => {
    // «Недостаточно золота» без суммы — игрок не понимает, хватит ли ему
    // накопить или проще возродиться в городе
    expect(complete).toMatch(/gold: character\.gold/);
  });
});

describe('Страховочный таймер: сервер воскресит сам', () => {
  it('таймер взводится при смерти', () => {
    expect(death).toMatch(/this\.armAutoRespawn\(dead\.id\)/);
    const arm = body(handler, 'private armAutoRespawn');
    expect(arm).toMatch(/dead\.timer = setTimeout\(/);
    expect(arm).toMatch(/DEATH\.AUTO_RESPAWN_SEC \* 1000/);
  });

  it('таймер воскрешает в городе', () => {
    // На месте без решения игрока брать деньги нельзя: это не его выбор
    expect(handler).toMatch(/completeRespawn\(characterId, RESPAWN_TYPES\.CITY, 'auto'\)/);
  });

  it('таймер перевзводится, а не сгорает', () => {
    // Страховка, которая сгорает впустую, хуже отсутствия: игрок остался
    // бы мёртвым навсегда, а проверить это вручную почти невозможно
    const arm = body(handler, 'private armAutoRespawn');
    expect(arm).toMatch(/clearTimeout\(dead\.timer\)/);
    expect(arm).toMatch(/this\.armAutoRespawn\(characterId\)/);
    expect(complete).toMatch(/if \(dead\.busy\) \{[\s\S]*?this\.armAutoRespawn\(characterId\)/);
  });

  it('таймер перевзводится и когда база ответила ошибкой', () => {
    // ГЛАВНОЕ. На этот случай страховки не было, и проверка выше его
    // пропускала: она смотрела только на флаг занятости.
    //
    // Когда респавн вызывает сам таймер, таймер к этому моменту УЖЕ
    // израсходован — он и привёл нас в completeRespawn. База может кратко
    // ответить ошибкой, и если в этот момент не перевзвести таймер, он
    // сгорает: запись остаётся в deadPlayers, повтора нет, игрок мёртв
    // навсегда. Единственный выход — перезайти.
    const failStart = complete.indexOf('if (!result) {');
    expect(failStart).toBeGreaterThan(-1);
    const failBranch = complete.slice(failStart, failStart + 300);
    expect(failBranch).toMatch(/dead\.busy = false;/);
    expect(failBranch).toMatch(/this\.armAutoRespawn\(characterId\)/);
  });

  it('таймер снимается на любом респавне', () => {
    expect(clearDead).toMatch(/clearTimeout/);
    // Вызовы после respawn: снятие после успеха — страховка от повторного
    expect(complete).toMatch(/this\.clearDeadState\(characterId\)/);
  });

  it('повторный запрос не списывает золото дважды', () => {
    // Два пакета подряд (клик плюс таймер) проходят проверку «игрок мёртв»
    // почти одновременно; без флага платный респавн брался бы дважды
    expect(complete).toMatch(/if \(dead\.busy\) \{/);
    expect(complete).toMatch(/dead\.busy = true;/);
    // Отказ снимает флаг: иначе следующая попытка (в т.ч. по таймеру)
    // была бы отброшена, и игрок остался бы мёртвым
    const noGold = complete.slice(complete.indexOf("result.reason === 'no_gold'"));
    expect(noGold.slice(0, 200)).toMatch(/dead\.busy = false;/);
  });

  it('состояние снимается только ПОСЛЕ успешного респавна', () => {
    // Иначе отказ из-за нехватки золота снёс бы состояние, и игрок остался
    // бы мёртвым без экрана и без таймера
    const respawnAt = complete.indexOf('.respawn(characterId, { spot, goldCost })');
    const clearAt = complete.lastIndexOf('this.clearDeadState(characterId)');
    expect(respawnAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(respawnAt);
  });

  it('срок задан константой и он не нулевой', () => {
    expect(DEATH.AUTO_RESPAWN_SEC).toBeGreaterThanOrEqual(5);
    expect(constants).toMatch(/AUTO_RESPAWN_SEC: \d+/);
  });

  it('клиентский отсчёт — только удобство, решение принимает сервер', () => {
    // Клиентский таймер не страхует: его можно не дослать, страницу можно
    // перезагрузить, а скрипт — не выполнить
    expect(screen).toMatch(/respawnInSec/);
    expect(screen).toMatch(/DEATH\.AUTO_RESPAWN_SEC/);
  });
});

describe('Мёртвый не играет', () => {
  it('пакеты движения игнорируются', () => {
    // ГЛАВНОЕ ПРО ДВИЖЕНИЕ. Пакеты мёртвого иначе смывали бы состояние
    // смерти: позиция попадала бы в Redis и в БД, и монстры видели бы
    // живого игрока на месте трупа
    expect(onMove).toMatch(/if \(this\.deadPlayers\.has\(characterId\)\) return;/);
  });

  it('античит не сломан: частота пакетов считается и для мёртвого', () => {
    // Проверка смерти стоит ПОСЛЕ ограничения частоты: флуд в состоянии
    // смерти проходил бы без санкций
    const rateAt = onMove.indexOf('validatePacketRate');
    const deadAt = onMove.indexOf('deadPlayers.has');
    expect(rateAt).toBeGreaterThan(-1);
    expect(deadAt).toBeGreaterThan(rateAt);
  });

  it('мёртвый не бьёт', () => {
    expect(onCombat).toMatch(/if \(this\.deadPlayers\.has\(socket\.characterId\)\) return;/);
  });

  it('мёртвая цель не принимает урон', () => {
    // Иначе добавленный по сети удар снова «убивал» бы труп и перезапускал
    // таймер автореспавна: игрок мог бесконечно продлевать себе смерть
    expect(onPvp).toMatch(/if \(this\.deadPlayers\.has\(target\.id\)\) return;/);
  });

  it('мёртвому не идёт регенерация', () => {
    // Иначе hp > 0 появлялся бы у трупа через 5 секунд: выход и повторный
    // вход давали бы жизнь бесплатно, без всяких 5% золота
    expect(regen).toMatch(/if \(this\.deadPlayers\.has\(socket\.characterId\)\) continue;/);
  });

  it('монстры про погибшего забывают', () => {
    // Существовало и раньше — не потерять при переработке смерти
    expect(death).toMatch(/clearThreatAndReturn\(dead\.id\)/);
  });
});

describe('Клиент: экран смерти один и подключён', () => {
  it('модуль вызывается при входе в мир', () => {
    // Раньше initDeathScreen не вызывался НИ ОТКУДА — весь файл был мёртвым
    expect(world).toMatch(/import \{ initDeathScreen/);
    expect(world).toMatch(/initDeathScreen\(\)/);
  });

  it('вызывается после socket.off(), иначе подписки слетят', () => {
    // wireSocket() снимает ВСЕ подписки сокета — слушатели экрана смерти
    // должны пересоздаваться при каждом входе в мир
    const wire = body(world, 'function wireSocket');
    expect(wire.indexOf('initDeathScreen()')).toBeGreaterThan(wire.indexOf('socket.off()'));
  });

  it('старый #overlay-death удалён: один экран, а не два', () => {
    // Два оверлея смерти = два наложенных экрана. Раньше один был в
    // разметке, второй строил модуль
    expect(html).not.toMatch(/id="overlay-death"/);
    expect(world).not.toMatch(/overlay-death/);
    expect(world3d).not.toMatch(/overlay-death/);
  });

  it('оверлей создаётся один раз, а не на каждый вход', () => {
    expect(screen).toMatch(/if \(!overlayEl\) \{/);
    expect(screen).toMatch(/document\.getElementById\('death-overlay'\)/);
    const creates = screen.match(/createElement\('div'\)/g) ?? [];
    expect(creates).toHaveLength(1);
  });

  it('экран закрывается по player:respawned', () => {
    // Страховка от залипшего оверлея, который закрыл бы пол-экрана
    // навсегда: пришёл респавн — экран закрыт в любом случае
    expect(screen).toMatch(/socket\.on\(SOCKET_EVENTS\.PLAYER_RESPAWNED/);
    expect(screen).toMatch(/hideDeathScreen\(\)/);
  });

  it('при отказе сервера экран остаётся', () => {
    // Кнопка «возродиться на месте» без золота: игрок должен увидеть
    // причину и выбрать город, а не пустой экран
    expect(reject).not.toMatch(/classList\.add\('hidden'\)/);
    expect(reject).toMatch(/setButtonsEnabled\(true\)/);
    expect(reject).toMatch(/setError\(/);
  });

  it('повторный запрос не отправляется, пока ждём сервер', () => {
    expect(screen).toMatch(/if \(awaitingServer\) return;/);
    expect(screen).toMatch(/setButtonsEnabled\(false\)/);
  });

  it('без ответа сервера кнопки оживают сами', () => {
    // Ответ может не прийти вовсе (сеть, рестарт сервера). Кнопки,
    // заблокированные навсегда, — это экран смерти без выхода: игрок
    // обязан либо получить респавн, либо уйти с экрана
    expect(screen).toMatch(/REPLY_GRACE_MS = \d+/);
    const request = body(screen, 'function requestRespawn');
    expect(request).toMatch(/retryTimer = setTimeout\(/);
    expect(request).toMatch(/setButtonsEnabled\(true\)/);
    // Смена состояния гасит ожидание, иначе оно выстрелит поверх ответа
    expect(body(screen, 'function setAwaiting')).toMatch(/clearTimeout\(retryTimer\)/);
  });

  it('заведомо живой респавн закрывает экран', () => {
    // Клик по кнопке плюс автореспавн по таймеру = два запроса; второй
    // приходит с not_dead, и экран обязан закрыться
    expect(reject).toMatch(/RESPAWN_REJECT\.NOT_DEAD[\s\S]{0,120}hideDeathScreen\(\)/);
  });

  it('зашитого русского текста нет', () => {
    // Все надписи — через t(...). Проверяем код БЕЗ комментариев:
    // комментарии в этом проекте русские, и они ничего не показывают
    const cyrillic = screen.match(/[\u0400-\u04FF]+/g) ?? [];
    expect(cyrillic).toEqual([]);
  });

  it('все надписи берутся из переводов', () => {
    for (const key of [
      'panels.death_city', 'panels.death_spot', 'panels.death_cost',
      'panels.death_killer', 'panels.death_killer_unknown', 'panels.death_auto',
      'panels.death_respawning', 'panels.death_err_no_gold',
      'panels.death_err_spot_blocked', 'panels.death_err_generic', 'world.died',
    ]) {
      expect({ key, used: screen.includes(`t('${key}')`) })
        .toEqual({ key, used: true });
    }
  });

  it('у каждого ключа есть перевод во всех трёх языках', () => {
    // Иначе игрок увидит вместо надписи путь к ключу. \b — чтобы в выборку
    // не попали createElement('div') и прочие похожие вызовы
    const used = [...screen.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(8);
    for (const lang of LOCALES) {
      const missing = used.filter((k) => lookup(dicts[lang], k) === undefined);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });

  it('подстановки как в referral.stats', () => {
    expect(screen).toMatch(/t\('panels\.death_auto'\)\.replace\('\{sec\}'/);
    expect(screen).toMatch(/t\('panels\.death_killer'\)\.replace\('\{name\}'/);
    expect(screen).toMatch(/t\('panels\.death_err_no_gold'\)\.replace\('\{gold\}'/);
  });

  it('игрок не двигается, пока мёртв', () => {
    expect(world).toMatch(/me\.moving && !isDead\(\)/);
    expect(world3d).toMatch(/if \(session\.dead\) \{ ix = 0; iz = 0; \}/);
  });

  it('игрок не атакует, пока мёртв', () => {
    const combat = body(world, 'function emitCombat');
    expect(combat).toMatch(/if \(isDead\(\)\) return;/);
  });

  it('3D-слой берёт «труп» из состояния, а не из класса оверлея', () => {
    expect(world3d).toMatch(/if \(isMe\) dead = session\.dead;/);
  });

  it('экран смерти не переживает выход из мира', () => {
    // Иначе оверлей (z-index выше экранов) закрыл бы выбор персонажа
    expect(world).toMatch(/hideDeathScreen\(\)/);
    expect(body(world, 'export function leaveWorld')).toMatch(/hideDeathScreen/);
  });

  it('золото после оплаченного респавна обновляется в HUD', () => {
    // Иначе панель продолжала бы показывать баланс до списания
    expect(world).toMatch(/if \(d\.gold !== undefined && session\.character\) session\.character\.gold = d\.gold;/);
  });
});

describe('Стили экрана смерти', () => {
  it('классы оверлея описаны', () => {
    for (const sel of ['.death-overlay', '.death-content', '.death-btn']) {
      expect(css).toMatch(new RegExp(sel.replace('.', '\\.')));
    }
  });

  it('ошибка отказа на экране видна', () => {
    // Новый блок причины: без него «не хватает золота» было бы пустотой
    expect(css).toMatch(/\.death-error/);
  });

  it('заблокированные кнопки выглядят заблокированными', () => {
    expect(css).toMatch(/\.death-btn:disabled/);
  });
});

describe('Переводы: смерть', () => {
  const DEATH_KEYS = [
    'death_auto', 'death_city', 'death_cost', 'death_err_generic', 'death_err_no_gold',
    'death_err_spot_blocked', 'death_karma_drop', 'death_killer', 'death_killer_unknown',
    'death_respawned_spot', 'death_respawning', 'death_spot',
  ];

  it('ключи экрана смерти есть во всех языках', () => {
    for (const lang of LOCALES) {
      for (const key of DEATH_KEYS) {
        const value = lookup(dicts[lang], `panels.${key}`);
        expect({ lang, key, ok: typeof value === 'string' && value.length > 0 })
          .toEqual({ lang, key, ok: true });
      }
    }
  });

  it('наборы ключей ru = en = az', () => {
    for (const lang of ['en', 'az']) {
      const other = Object.keys((dicts[lang] as Dict).panels as Dict)
        .filter((k) => k.startsWith('death_')).sort();
      expect({ lang, keys: other }).toEqual({ lang, keys: DEATH_KEYS });
    }
  });

  it('в подставляемых надписях есть все плейсхолдеры', () => {
    // Пустой {name} или без {sec} — надпись без смысла
    const ru = dicts.ru.panels as Record<string, string>;
    expect(ru.death_killer).toContain('{name}');
    expect(ru.death_auto).toContain('{sec}');
    expect(ru.death_err_no_gold).toContain('{gold}');
  });

  it('подпись про стартовую точку больше не обещает респавн на месте', () => {
    // world.respawned остался только для города — клиент выбирает надпись
    // по типу респавна из события
    expect(world).toMatch(/d\.type === 'spot' \? t\('panels\.death_respawned_spot'\) : t\('world\.respawned'\)/);
  });
});
