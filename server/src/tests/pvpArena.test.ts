// PvP-арена.
//
// ТУТ БЫЛО ТРИ ПОЛОМКИ ПОДРЯД, И КАЖДАЯ УБИВАЛА ФИЧУ ЦЕЛИКОМ:
//
//  1. findMatch(req.userId) — сервис ждёт character_id. Матчмейкинг
//     падал на внешнем ключе: pvp_arena.player1_id ссылается на characters,
//     а туда приходил id аккаунта. Кнопка «Найти бой» молча ничего не делала.
//
//  2. Соперник не уведомлялся. Он лежал в таблице и ждал, пока кто-нибудь
//     посмотрит. Игрок не знал даже, кто соперник.
//
//  3. pvpComplete в клиенте не вызывался НИ РАЗУ. Бой нельзя было
//     завершить, рейтинг не менялся.
//
// Плюс отсутствовало самого боя: ни урона, ни интерфейса, ни таймера.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const arenaSvc = read('server/src/systems/PvpArenaService.ts');
const flow = read('server/src/systems/PvpArenaFlow.ts');
const socket = read('server/src/socket/GameSocketHandler.ts');
const game = read('server/src/routes/game.ts');
const pvpSvc = read('server/src/services/PvPService.ts');
const charSvc = read('server/src/services/CharacterService.ts');
const client = read('client/src/app/pvp.ts');
const clientWorld = read('client/src/app/world.ts');
const clientPanels = read('client/src/app/panels.ts');

describe('PvP: матчмейкинг работает', () => {
  it('передаётся characterId, а не userId', () => {
    // ТУТ БЫЛА ОШИБКА: findMatch ждёт character_id, а передавали user_id
    expect(game).toMatch(/pvpService\.findMatch\(characterId\)/);
    expect(game).not.toMatch(/pvpService\.findMatch\(req\.userId/);
  });

  it('владельчество персонажа проверяется', () => {
    expect(game).toMatch(/pvp\/find-match', secureMiddleware, requireCharacterOwnership\(\)/);
  });

  it('соперник узнаёт о матче так же, как инициатор', () => {
    // Раньше он просто лежал в таблице
    expect(flow).toMatch(/pvp:match_found/);
    // Событие уходит обоим: и первому, и второму
    expect(flow).toMatch(/\{ me: a, foe: b \}[\s\S]*\{ me: b, foe: a \}/);
    expect(flow).toMatch(/for \(const \{ me, foe \} of pairs\)/);
  });

  it('в приглашении есть всё, что нужно игроку', () => {
    expect(flow).toMatch(/opponent: \{ id:/);
    expect(flow).toMatch(/charClass/);
    expect(flow).toMatch(/endsAt/);
  });
});

describe('PvP: бой идёт и заканчивается', () => {
  it('арена помнит, кто с кем бьётся', () => {
    expect(arenaSvc).toMatch(/arenaOf\(characterId: string\)/);
    expect(arenaSvc).toMatch(/opponentOf\(characterId: string\)/);
  });

  it('урон в бою идёт по общему пути боя', () => {
    // Отдельной боевой системы не создавали: урон по игроку уже считается
    expect(socket).toMatch(/combatPlayerVsPlayer/);
    expect(socket).toMatch(/pvpArena\.knockout\(target\.id\)/);
  });

  it('нокаут заканчивает бой, а не убивает игрока в мире', () => {
    // Иначе проигравший остался бы лежать и не мог бы выйти из города
    expect(socket).toMatch(/announceArenaEnd\(arena\.matchId, arena\.winnerId, 'hp'\)/);
    expect(socket).toMatch(/restoreHp/);
  });

  it('здоровье после боя восстанавливается', () => {
    expect(charSvc).toMatch(/async restoreHp\(characterId: string\)/);
    expect(charSvc).toMatch(/SET hp = max_hp/);
  });

  it('есть таймер и победа по времени', () => {
    // Иначе бой длился бы, пока соперник не выйдет, а «победа по большему
    // HP» никогда не срабатывала бы
    expect(arenaSvc).toMatch(/ARENA_DURATION_SEC = \d+/);
    expect(arenaSvc).toMatch(/checkTimeout\(\)/);
    expect(arenaSvc).toMatch(/const pa = a\.maxHp > 0/);
  });

  it('таймер реально тикает на сервере', () => {
    expect(socket).toMatch(/setInterval\(\(\) => \{[\s\S]*?pvpArena\.checkTimeout\(\)/);
  });
});

describe('PvP: результат подтверждают оба', () => {
  it('после боя клиент сам отправляет подтверждение', () => {
    // Раньше pvpComplete не вызывался НИ РАЗУ — бой нельзя было завершить
    expect(client).toMatch(/api\.pvpComplete\(/);
    expect(clientWorld).toMatch(/socket\.on\('pvp:ended'/);
  });

  it('клиент ждёт, если соперник ещё не подтвердил', () => {
    expect(client).toMatch(/res\.status === 'pending'/);
    expect(client).toMatch(/pollStatus/);
  });

  it('победа не запрашивается у игрока, а сообщается сервером', () => {
    // Иначе можно было бы солгать. Мы не спрашиваем «ты победил?» —
    // сервер знает, чей HP ушёл в ноль
    expect(client).toMatch(/data\.youWon/);
    expect(client).toMatch(/data\.winnerId \?\? ''/);
  });

  it('рейтинг меняется только после подтверждения обоих', () => {
    expect(pvpSvc).toMatch(/async reportResult\(/);
    expect(pvpSvc).toMatch(/if \(p1 && p2 && p1 === p2\)/);
  });
});

describe('PvP: интерфейс боя', () => {
  it('экран боя рисует обе полосы и таймер', () => {
    expect(client).toMatch(/pvp-timer/);
    expect(client).toMatch(/pvp-me-hp/);
    expect(client).toMatch(/pvp-foe-hp/);
  });

  it('экран не перекрывает обзор — бой идёт в мире', () => {
    // pointer-events: none на контейнере: видно, но можно играть
    expect(read('client/src/app/styles.css')).toMatch(/\.pvp-arena \{[\s\S]*?pointer-events: none/);
  });

  it('кнопка «Найти бой» показывает поиск, а не молчит', () => {
    expect(clientPanels).toMatch(/onPvpSearching\(\)/);
  });

  it('здоровье в бое обновляет полосу', () => {
    expect(clientWorld).toMatch(/onPvpMyHpChanged\(r\.hp\)/);
  });

  it('таймер краснеет в последние секунды', () => {
    // Игрок должен успеть закончить бой
    expect(client).toMatch(/pvp-timer--low/);
  });
});

describe('PvP: переводы', () => {
  const keys = [
    'pvp.searching', 'pvp.not_found', 'pvp.fight_hint',
    'pvp.you_won', 'pvp.you_lost', 'pvp.draw', 'pvp.wait_opponent',
  ];
  for (const lang of ['ru', 'en', 'az']) {
    it(`в ${lang} есть все строки PvP`, () => {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, unknown>;
      for (const k of keys) {
        const val = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], json);
        expect({ key: k, present: !!val }).toEqual({ key: k, present: true });
      }
    });
  }
});
