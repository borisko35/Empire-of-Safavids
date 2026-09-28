// Шесть поломок из отчёта об охоте за мёртвым кодом.
//
// Общее у всех шести одно: код был написан целиком и корректен, и при этом
// не вызывался. Каждая выглядела в интерфейсе как работающая, пока игрок не
// пытался ею воспользоваться.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const authService = stripComments(read('server/src/services/AuthService.ts'));
const authTypes = stripComments(read('shared/auth.types.ts'));
const validation = read('shared/auth.validation.ts');
const npcRoutes = stripComments(read('server/src/routes/npc.ts'));
const npcMemory = stripComments(read('server/src/services/NpcMemoryService.ts'));
const dialogue = stripComments(read('client/src/app/dialogue.ts'));
const endgame = stripComments(read('server/src/services/EndGameService.ts'));
const gameRoutes = stripComments(read('server/src/routes/game.ts'));
const panels = stripComments(read('client/src/app/panels.ts'));
const auction = stripComments(read('server/src/services/AuctionService.ts'));
const gameLoop = stripComments(read('server/src/systems/GameLoop.ts'));
const guildPanel = stripComments(read('client/src/app/guild.ts'));
const guildRoutes = stripComments(read('server/src/routes/guilds.ts'));
const guildService = stripComments(read('server/src/services/GuildService.ts'));

const LOCALES = ['ru', 'en', 'az'] as const;
const locale = (lang: string): Record<string, unknown> =>
  JSON.parse(read(`shared/locales/${lang}.json`));

describe('Регистрация: игроку говорят, что именно не так', () => {
  it('каждая проверка формы имеет свой код ошибки', () => {
    // ГЛАВНОЕ. Раньше карта из девяти ошибок сворачивалась в один код
    // weak_password, и несовершеннолетнему регистрация отвечала «Пароль
    // слишком простой (мин 8 символов)»
    const fields = [...validation.matchAll(/errors\.(\w+)\s*=/g)].map(m => m[1]);
    const mapped = [...authService.matchAll(/^\s{2}(\w+):\s*'/gm)].map(m => m[1]);
    const declared = (authService.slice(
      authService.indexOf('REGISTER_ERROR_CODES'),
      authService.indexOf('};', authService.indexOf('REGISTER_ERROR_CODES'))
    ).match(/(\w+):\s*'/g) ?? []).map(s => s.replace(/\s*:\s*'/, ''));
    const unmapped = fields.filter(f => !declared.includes(f));
    expect({
      проверок_в_форме: fields.length,
      без_кода: unmapped,
    }).toEqual({ проверок_в_форме: expect.any(Number), без_кода: [] });
    void mapped;
  });

  it('weak_password больше не отдаётся на пустом месте', () => {
    expect(authService).not.toMatch(/authError\('weak_password', firstError/);
    expect(authService).toMatch(/REGISTER_ERROR_CODES\[field\] \?\? 'weak_password'/);
  });

  it('коды underage и terms_not_accepted наконец отдаются', () => {
    // Оба ключа были написаны во всех трёх переводах и не отдавались сервером
    // НИКОГДА. Теперь до них можно дойти
    for (const code of ['underage', 'terms_not_accepted']) {
      const block = authService.slice(
        authService.indexOf('REGISTER_ERROR_CODES'),
        authService.indexOf('};', authService.indexOf('REGISTER_ERROR_CODES'))
      );
      expect({ code, есть_в_таблице: block.includes(`'${code}'`) })
        .toEqual({ code, есть_в_таблице: true });
    }
  });

  it('новые коды переведены во всех трёх языках', () => {
    for (const lang of LOCALES) {
      const errors = (locale(lang).errors ?? {}) as Record<string, string>;
      for (const code of ['username_invalid', 'email_invalid', 'password_mismatch', 'underage', 'terms_not_accepted']) {
        expect({ lang, code, есть: typeof errors[code] === 'string' && errors[code].length > 0 })
          .toEqual({ lang, code, есть: true });
      }
    }
  });

  it('код объявлен в типе AuthError, а не только в таблице', () => {
    for (const code of ['username_invalid', 'email_invalid', 'password_mismatch']) {
      expect(authTypes).toContain(`'${code}'`);
    }
  });
});

describe('Дружба NPC: растёт и не пропадает', () => {
  it('дружба растёт в одном месте, а не в двух', () => {
    // Раньше addCompletedQuest прибавлял единицу, и маршрут complete-quest
    // прибавлял ещё единицу сверху — выходило по два очка за один квест
    const grow = (npcMemory.match(/friendshipLevel = Math\.min/g) ?? []).length;
    expect({ прибавок_в_советниках: grow }).toEqual({ прибавок_в_советниках: 0 });
    expect(npcMemory).toMatch(/async growFriendship\(/);
  });

  it('growFriendship вызывается, когда NPC сдал квест', () => {
    // Единственный вызов был в маршруте, который не звал никто
    expect(npcRoutes).toMatch(/memoryService\.growFriendship\(/);
  });

  it('маршрут диалога знает, что квест закрылся, и растит дружбу', () => {
    expect(npcRoutes).toMatch(/const questsCompleted = await questService\.recordTalk/);
    expect(npcRoutes).toMatch(/if \(questsCompleted\.length\)/);
  });

  it('addCompletedQuest больше не трогает дружбу', () => {
    const i = npcMemory.indexOf('async addCompletedQuest');
    const body = npcMemory.slice(i, npcMemory.indexOf('async growFriendship'));
    expect({ трогает_дружбу: body.includes('friendshipLevel') }).toEqual({ трогает_дружбу: false });
  });

  it('заголовок диалога не обнуляется после первого ответа', () => {
    // currentNpc пересобирался без поля memory, и «Lv.N» пропадал
    const fn = dialogue.slice(dialogue.indexOf('async function handleChoice'));
    expect(fn.slice(0, 1600)).toMatch(/memory: data\.memory/);
  });

  it('игрока уведомляют о новой дружбе', () => {
    expect(dialogue).toMatch(/data\.friendshipUp/);
    for (const lang of LOCALES) {
      const d = locale(lang) as { dialogue?: Record<string, string> };
      expect({ lang, есть: typeof d.dialogue?.friendship_up === 'string' })
        .toEqual({ lang, есть: true });
    }
  });
});

describe('Башня: этаж можно пройти', () => {
  it('прогресс башни ищется по персонажу, а не по аккаунту', () => {
    // ЧЕТВЁРТОЕ повторение той же поломки: endless_tower keyed по
    // character_id, а маршруты передавали req.userId
    const block = gameRoutes.slice(
      gameRoutes.indexOf('const towerCharacterId'),
      gameRoutes.indexOf('gameRouter.get(\'/tower/leaderboard\'')
    );
    expect(block).not.toMatch(/endgameService\.\w+\(req\.userId/);
    expect(block).toMatch(/endgameService\.getProgress\(characterId\)/);
  });

  it('персонаж проверяется на принадлежность', () => {
    const block = gameRoutes.slice(
      gameRoutes.indexOf('const towerCharacterId'),
      gameRoutes.indexOf("gameRouter.get('/tower/leaderboard'")
    );
    expect(block).toMatch(/character\.userId !== req\.userId/);
  });

  it('кнопка «Пройти этаж» вызывает сервер', () => {
    // api.towerCompleteFloor был написан и не вызывался ни разу
    expect(panels).toMatch(/api\.towerCompleteFloor\(/);
  });

  it('этаж нельзя закрыть, не пройдя предыдущий', () => {
    // Без проверки можно было отправить floor: 999 и получить награды за все
    // этажи разом — единственный способ набить золото через башню
    expect(endgame).toMatch(/if \(floor > current \+ 1\)/);
    expect(endgame).toMatch(/already cleared/);
  });

  it('время этажа не может быть выдуманным', () => {
    // Время приходит из тела запроса, но рекорд в рейтинге не должен
    // становиться равным нулю
    expect(endgame).toMatch(/const MIN_FLOOR_SECONDS = 10/);
    expect(endgame).toMatch(/const time = Math\.max\(MIN_FLOOR_SECONDS/);
  });

  it('панель башни переведена', () => {
    // 14 ключей были при первой вычитке, ещё 2 добавились, когда в
    // panels.ts убрали хардкод: строка этажа «⚔ N · ур.M» и заглушка
    // «Башня недоступна».
    for (const lang of LOCALES) {
      const d = locale(lang) as { tower?: Record<string, string> };
      expect({ lang, ключей: Object.keys(d.tower ?? {}).length })
        .toEqual({ lang, ключей: 16 });
    }
  });
});

describe('Аукцион: лот можно снять, предмет возвращается', () => {
  it('уборка просроченных лотов существует и вызывается', () => {
    // createListing забирает предмет в эскроу сразу. Возврата не было НИГДЕ:
    // через сутки вещь просто исчезала
    expect(auction).toMatch(/async returnExpiredListings\(/);
    expect(gameLoop).toMatch(/AUCTION_SWEEP_EVERY/);
    expect(gameLoop).toMatch(/this\.auction\.returnExpiredListings\(\)/);
  });

  it('возврат и удаление лота — одна транзакция', () => {
    // Иначе есть окно «предмет вернули, лот остался» или наоборот
    const i = auction.indexOf('async returnExpiredListings');
    const body = auction.slice(i, auction.indexOf('async getSellerListings', i));
    expect(body).toMatch(/this\.db\.transaction/);
    // Возврат предмета идёт ДО удаления лота: обратный порядок при падении
    // строки потерял бы вещь продавца
    expect(body.indexOf('INSERT INTO character_items'))
      .toBeLessThan(body.indexOf('DELETE FROM auction_listings'));
  });

  it('лоты не вернутся дважды двумя тиками подряд', () => {
    expect(auction).toMatch(/FOR UPDATE SKIP LOCKED/);
  });

  it('маршрут «мои лоты» и кнопка «Снять лот» есть', () => {
    expect(gameRoutes).toMatch(/gameRouter\.get\('\/auction\/mine'/);
    expect(panels).toMatch(/api\.auctionMine\(/);
    expect(panels).toMatch(/api\.auctionCancel\(/);
  });

  it('маршрут «мои лоты» проверяет персонажа', () => {
    const block = gameRoutes.slice(
      gameRoutes.indexOf("gameRouter.get('/auction/mine'"),
      gameRoutes.indexOf("gameRouter.get('/auction/mine'") + 900
    );
    expect(block).toMatch(/character\.userId !== req\.userId/);
  });
});

describe('Склад гильдии: наполняется и опустошается', () => {
  it('depositItem вызывается', () => {
    // Единственный писатель в guild_bank не вызывался нигде: маршрут звал
    // depositGold, у которого похожее имя
    expect(guildRoutes).toMatch(/guilds\.depositItem\(/);
    expect(guildPanel).toMatch(/api\.guildDepositItem\(/);
  });

  it('есть и выдача — склад «положить, но не забрать» был бы ловушкой', () => {
    expect(guildRoutes).toMatch(/guilds\.withdrawItem\(/);
    expect(guildPanel).toMatch(/api\.guildWithdrawItem\(/);
  });

  it('вклад предметов проверяет членство в гильдии', () => {
    // Без проверки любой персонаж складывал бы вещи в чужой склад
    expect(guildService).toMatch(/private async requireMember\(/);
  });

  it('списание и пополнение склада — одна транзакция', () => {
    expect(guildService).toMatch(/async withdrawItem[\s\S]{0,400}this\.db\.transaction/);
  });

  it('на складе видно название предмета, а не внутренний ключ', () => {
    // Раньше панель показывала «mat_dragon_scale»
    expect(guildService).toMatch(/nameRu: ITEMS_DATABASE/);
  });
});
