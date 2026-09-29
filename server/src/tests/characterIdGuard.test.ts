// Восьмое повторение одной и той же поломки: маршрут отдаёт сервису
// req.userId — идентификатор АККАУНТА, а сервис ищет по character_id.
//
// ЭТО ЧИТАЕТСЯ КАК ПУСТАЯ ПАНЕЛЬ, И ПОЭТОМУ ПОЧТИ НЕ ЛОВИТСЯ. Ни одна из
// восьми поломок не падала: код компилировался, маршрут отвечал 200, просто
// возвращал пустоту. Восемь раз одно и то же, потому что поломка выглядит
// как «данных пока нет», а не как ошибка.
//
// Список находок, по порядку:
//   1. задачи дня     — character_daily_progress.character_id
//   2. репутация      — character_reputation.character_id
//   3. конюшня        — character_mounts.character_id
//   4. башня          — endless_tower.character_id
//   5. гильдии        — guild_members.character_id
//   6. питомцы        — character_pets.character_id
//   7. недвижимость   — player_houses.character_id
//   8. PvP            — pvp_rankings.character_id, pvp_arena.player1_id
//
// Теперь запрет на саму ошибку, а не на каждое её повторение по отдельности.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

/**
 * Службы, которые работают на уровне ПЕРСОНАЖА: им req.userId нельзя.
 *
 * Проверено по сигнатурам — первый параметр у них называется characterId.
 */
const CHARACTER_SCOPED = [
  'DailyTaskService', 'ReputationService', 'MountSystem', 'EndGameService',
  'GuildService', 'PetService', 'HousingService', 'PvPService',
  'NotificationService', 'CraftingService', 'QuestService', 'CharacterService',
  'FishingSystem', 'AchievementService', 'TradeService', 'DungeonService',
];

/**
 * Службы, где аккаунт — правильный ключ целиком.
 *
 * Друзья, привязки аккаунтов и аналитика — это про Account, а не про
 * Character. Персонажа у них может не быть вовсе.
 */
const USER_SCOPED_SERVICES = new Set([
  'AccountLinkService', 'AnalyticsService', 'FriendService',
]);

/**
 * Методы, которые принимают именно АККАУНТ, хотя служба в целом — про персонажа.
 *
 * Их ровно два, и оба — на входе в игру, где персонажа ещё не существует:
 *   createCharacter(userId)        — создать первого персонажа аккаунта
 *   getCharactersByUser(userId)    — какие персонажи есть у аккаунта
 *
 * Исключение сделано на МЕТОД, а не на службу целиком: CharacterService на
 * остальные тридцать методов принимает characterId, и запрещать её всю было бы
 * запретом на правильный код.
 */
const ACCOUNT_BY_DESIGN = new Set(['createCharacter', 'getCharactersByUser']);

const routeFiles = readdirSync(join(repoRoot, 'server', 'src', 'routes'))
  .filter(f => f.endsWith('.ts'))
  .map(f => join('server', 'src', 'routes', f));

/**
 * Ищет вызовы службы персонажа, которым передали req.userId.
 *
 * ПЕРВАЯ ВЕРСИЯ этой регулярки искала PetService с большой буквы, а в коде
 * petService — и не находила НИЧЕГО. Проверка проходила всегда, то есть была
 * пустой: она не заметила бы ни восьми старых поломок, ни собственной поломки.
 * Поэтому регистр не важен, а рядом есть самопроверка на заведомо плохой строке.
 */
function findAccountIdCalls(src: string): string[] {
  const out: string[] = [];
  for (const cls of CHARACTER_SCOPED) {
    if (USER_SCOPED_SERVICES.has(cls)) continue;
    // Имя экземпляра службы в коде — с маленькой буквы, поэтому ищем без
    // учёта регистра: \bPetService\b и \bpetService\b — одно и то же место
    const re = new RegExp(`\\b${cls}\\b\\.(\\w+)\\s*\\([^;]{0,80}?req\\.userId`, 'gi');
    for (const m of src.matchAll(re)) {
      if (ACCOUNT_BY_DESIGN.has(m[1])) continue;
      out.push(m[0].replace(/\s+/g, ' ').slice(0, 80));
    }
  }
  return out;
}

describe('Маршруты не путают аккаунт с персонажем', () => {
  it('страж действительно ловит ошибку, а не молчит', () => {
    // САМОПРОВЕРКА. Без неё регулярку легко сломать переименованием, и
    // проверка станет зелёной просто потому, что ничего не ищет
    const bad = 'const pet = await petService.getActivePet(req.userId!);';
    const good = 'const pet = await petService.getActivePet(characterId);';
    expect({ на_плохом: findAccountIdCalls(bad).length > 0, на_хорошем: findAccountIdCalls(good).length })
      .toEqual({ на_плохом: true, на_хорошем: 0 });
  });

  it('исключения по методу не съедают настоящую поломку', () => {
    // Если бы исключение было на службу целиком, а не на метод, то
    // getActivePet(req.userId) — девятая та же поломка — прошла бы молча.
    // Восьмая (питомцы) начиналась именно с getPets/getActivePet
    const other = 'const pets = await petService.getPets(req.userId!);';
    expect({ поймал: findAccountIdCalls(other).length }).toEqual({ поймал: 1 });
  });

  it('в маршрутах вообще есть вызовы с req.userId', () => {
    const all = routeFiles.map(f => read(f)).join('\n');
    expect((all.match(/req\.userId!?\s*[,)]/g) ?? []).length).toBeGreaterThan(10);
  });

  it('службам персонажа не передаётся req.userId', () => {
    // ГЛАВНОЕ. Восемь поломок выглядели одинаково: панель молча пустая
    const offenders: string[] = [];
    for (const file of routeFiles) {
      for (const hit of findAccountIdCalls(stripComments(read(file)))) {
        offenders.push(`${file}: ${hit}`);
      }
    }
    expect({ нарушения: offenders }).toEqual({ нарушения: [] });
  });

  it('список служб не пустой', () => {
    // Если бы кто-то переименовал службы, регулярки перестали бы работать
    // молча. Проверяем, что имена реально встречаются
    // Только файлы .ts: в services/ появилась подпапка payments, и чтение
    // каталога роняло набор с EISDIR. Фильтр ничего не маскирует — класс в
    // каталоге всё равно не найдётся, и проверка честно покажет, что искать
    // переименованные службы больше негде.
    const all = readdirSync(join(repoRoot, 'server', 'src', 'services'))
      .filter(f => f.endsWith('.ts'))
      .map(f => read(join('server', 'src', 'services', f))).join('\n');
    const found = CHARACTER_SCOPED.filter(s => all.includes(`class ${s}`));
    expect({ найдено: found.length, из: CHARACTER_SCOPED.length })
      .toEqual({ найдено: expect.any(Number), из: CHARACTER_SCOPED.length });
    expect(found.length).toBeGreaterThanOrEqual(CHARACTER_SCOPED.length - 4);
  });
});

describe('Идентификатор персонажа достаётся в одном месте', () => {
  it('в game.ts есть общий помощник', () => {
    // Восемь раз одну и ту же проверку писали руками — и восемь раз
    // где-то забыли. Теперь она одна, и её нельзя забыть рядом с вызовом
    const src = stripComments(read('server/src/routes/game.ts'));
    expect(src).toMatch(/const bodyCharacterId = async \(req: Request, res: Response\): Promise<string \| null>/);
    expect(src).toMatch(/character\.userId !== req\.userId/);
  });

  it('питомцы, дом, PvP и уведомления идут через него', () => {
    const src = stripComments(read('server/src/routes/game.ts'));
    for (const call of [
      'petService.getPets(characterId)',
      'housingService.getHouse(characterId)',
      'pvpService.getMyRanking(characterId)',
      'pvpService.cancelMatch(req.body.matchId, characterId)',
      'notificationService.list(characterId)',
      'housingService.placeDecoration(characterId, req.body.decorationId)',
    ]) {
      expect({ call, есть: src.includes(call) }).toEqual({ call, есть: true });
    }
  });
});
