// Приглашение в заход: кто может, кому, как долго и что с ним после.
//
// ЧТО ЗАМЕР ПОКАЗАЛ. Персональная доставка сообщений игроку уже есть
// (activePlayers + канал player:notification), join с проверками тоже. Не
// хватало кого приглашать и как ждать согласия.
//
// ПРИГЛАШАЕМ ДРУЗЕЙ: списка игроков рядом в проекте нет вообще, а друзья
// отдаются с именем, уровнем и онлайном.
//
// СУТЬ ОШИБКИ, КОТОРУЮ ПРИШЛОСЬ ОБОЙТИ. В списке друзей есть userId, но НЕТ
// characterId, а join требует персонажа. Персонаж ищется на сервере в момент
// приглашения — и обязательно в регионе захода, иначе при «первом попавшемся»
// персонаже приглашённый оказался бы не там, где идёт заход.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const сервис = код('server/src/systems/DungeonService.ts');
const маршруты = код('server/src/routes/game.ts');
const апи = код('client/src/app/api.ts');
const панель = код('client/src/app/panels.ts');
const мир = код('client/src/app/world.ts');

describe('Приглашение: отправляет только лидер своего захода', () => {
  it('приглашение привязано к заходу приглашающего', () => {
    must(/async inviteToRun\(\s*inviterId: string,\s*inviteeUserId: string/.test(сервис), 'метода inviteToRun нет');
    must(
      /this\.characterToSession\.get\(inviterId\)/.test(сервис),
      'заход берётся не из персонажа приглашающего: пригласить можно, не будучи в заходе'
    );
  });

  it('пригласить может только лидер', () => {
    must(/session\.leaderId !== inviterId/.test(сервис), 'пригласить может кто угодно из захода');
    must(/'dungeon_not_leader'/.test(сервис), 'нет внятного отказа не-лидеру');
  });

  it('в закрытый или полный заход не приглашают', () => {
    must(/session\.completedAt/.test(сервис), 'в завершённый заход можно пригласить');
    must(/'dungeon_full'/.test(сервис), 'нет отказа при полном заходе');
    must(/session\.members\.size >= \(DUNGEONS_DATABASE\[session\.dungeonId\]/.test(сервис), 'размер не сверяется с описанием данжа');
  });
});

describe('Приглашение: персонажа приглашённого ищем сами', () => {
  it('поиск идёт по userId и обязательно в регионе захода', () => {
    must(
      /WHERE user_id = \$1 AND region = \$2/.test(сервис),
      'персонаж ищется без учёта региона: приглашённый может оказаться на другом краю мира'
    );
    must(/'dungeon_invitee_not_here'/.test(сервис), 'нет отказа, когда персонажа в регионе нет');
  });

  it('уже вошедшего зовут не второй раз', () => {
    must(/session\.members\.has\(персонаж\.id\)/.test(сервис), 'участник захода может получить приглашение повторно');
  });

  it('поиск не роняет игру', () => {
    const начало = сервис.indexOf('async inviteToRun(');
    const тело = сервис.slice(начало, начало + 2000);
    must(/catch\(\(e: unknown\) =>/.test(тело), 'падение поиска персонажа не гасится');
  });
});

describe('Приглашение: одноразовое и с коротким сроком', () => {
  it('срок — 60 секунд, и он задан числом', () => {
    must(/expiresAt: Date\.now\(\) \+ 60 \* 1000/.test(сервис), 'срок приглашения не задан или задан неверно');
  });

  it('приглашение удаляется после ответа', () => {
    // Ищется в теле answerInvite: та же строка есть в чистке просроченных,
    // и поиск по всему сервису цеплял именно её — ломка проходила на зелёном.
    const начало = сервис.indexOf('async answerInvite(');
    must(начало > 0, 'метод answerInvite не найден');
    const конец = сервис.indexOf('dropInvites(', начало);
    const тело = сервис.slice(начало, конец > начало ? конец : начало + 1200);
    must(
      /this\.invites\.delete\(inviteId\)/.test(тело),
      'приглашение не одноразовое: старый клик втянет в закрытый заход'
    );
  });

  it('просроченное приглашение не принимается', () => {
    must(/Date\.now\(\) > invite\.expiresAt/.test(сервис), 'срок приглашения не проверяется');
    must(/'dungeon_invite_expired'/.test(сервис), 'нет отказа по сроку');
  });

  it('чужое приглашение принять нельзя', () => {
    must(/invite\.inviteeCharacterId !== characterId/.test(сервис), 'приглашение можно принять не тому, кому оно адресовано');
    must(/'dungeon_invite_not_yours'/.test(сервис), 'нет отказа на чужое приглашение');
  });

  it('при согласии вход идёт через join, а не мимо проверок', () => {
    must(
      /await this\.join\(characterId, invite\.sessionId\)/.test(сервис),
      'принявший входит в заход в обход join: минуют уровень, регион, шард и лимит попыток'
    );
  });

  it('приглашения снимаются вместе с заходом', () => {
    must(/this\.dropInvites\(session\.id\)/.test(сервис), 'приглашения переживают заход, к которому относятся');
    must(/dropExpiredInvites\(/.test(сервис), 'просроченные приглашения не убираются: память растёт вечно');
  });
});

describe('Приглашение: доходит до игрока', () => {
  it('уведомление идёт через существующий персональный канал', () => {
    must(/REDIS_CHANNELS\.PLAYER_NOTIFICATION/.test(маршруты), 'уведомление идёт не персональным каналом');
    must(/type: 'dungeon_invite'/.test(маршруты), 'тип уведомления не помечен');
    must(/characterId: result\.inviteeCharacterId/.test(маршруты), 'уведомление уходит не тому персонажу');
  });

  it('уведомление не роняет ответ на приглашение', () => {
    // Приглашение уже создано; если уведомление не ушло, игрок просто не
    // узнает. Ронять ответ из-за этого нельзя.
    must(
      /logger\.warn/.test(маршруты),
      'падение публикации не логируется: потерянное приглашение не заметят'
    );
  });

  it('маршруты приглашения и ответа есть и защищены', () => {
    must(маршруты.includes("'/dungeons/invite'"), 'маршрута приглашения нет');
    must(маршруты.includes("'/dungeons/invite/:inviteId/answer'"), 'маршрута ответа нет');
    for (const адрес of ["'/dungeons/invite'", "'/dungeons/invite/:inviteId/answer'"]) {
      const начало = маршруты.indexOf(адрес);
      const конец = маршруты.indexOf('gameRouter.', начало + 10);
      const блок = маршруты.slice(начало, конец > начало ? конец : начало + 500);
      must(блок.includes('secureMiddleware'), `${адрес} открыт без проверки владения`);
      must(блок.includes('requireCharacterOwnership()'), `${адрес} не проверяет владение персонажем`);
    }
  });
});

describe('Приглашение: клиент', () => {
  it('вызовы объявлены и идут по правильным адресам', () => {
    must(/dungeonInvite: \(characterId: string, friendUserId: string\)/.test(апи), 'вызова приглашения нет');
    must(
      /dungeonInviteAnswer: \(characterId: string, inviteId: string, accept: boolean\)/.test(апи),
      'вызова ответа нет'
    );
    must(/\/api\/game\/dungeons\/invite/.test(апи), 'адрес приглашения не тот');
    must(/\/api\/game\/dungeons\/invite\/\$\{inviteId\}\/answer/.test(апи), 'адрес ответа не тот');
  });

  it('кнопка зовёт только принятых друзей онлайн', () => {
    must(/api\.friends\(\)/.test(панель), 'список друзей не берётся');
    // Две отдельные проверки, а не одна регуляркой с `||`: экранирование
    // pipes потерялось при записи файла, и получилась пустая альтернатива —
    // регулярка совпадала «с чем угодно», и ломка удаления фильтра проходила
    // на зелёном.
    must(/друг\.status !== 'accepted'/.test(панель), 'пригласить можно непринятого друга');
    must(
      /друг\.online !== true/.test(панель),
      'пригласить можно офлайн-друга: приглашение уйдёт в пустоту'
    );
    must(/api\.dungeonInvite\(cid\(\), друг\.friendId\)/.test(панель), 'кнопка не вызывает приглашение');
  });

  it('приглашение видно только тому, кому оно адресовано', () => {
    must(/n\.characterId !== me\.id/.test(мир), 'уведомление обрабатывается и для чужих приглашений');
    must(/n\.type !== 'dungeon_invite'/.test(мир), 'нет фильтра по типу уведомления');
  });

  it('принятие приглашения входит в заход, отказ понятен игроку', () => {
    // Блок — от вызова ответа до следующего socket.on, а не весь файл: в world.ts
    // сотни catch, и поиск по файлу цеплял чужие. На этом ломка удаления показа
    // отказа проходила на зелёном.
    const начало = мир.indexOf('dungeonInviteAnswer(');
    must(начало > 0, 'ответ на приглашение не вызывается в клиенте');
    const конец = мир.indexOf('socket.on(', начало + 10);
    const блокОтвета = мир.slice(начало, конец > начало ? конец : начало + 700);
    must(/\.catch\(/.test(блокОтвета), 'отказ сервера проглатывается: игрок не поймёт, что произошло');
    must(/invite_expired/.test(блокОтвета), 'отказ не показывается игроку текстом');
  });

  it('тексты переведены во всех трёх языках', () => {
    for (const язык of ['ru', 'en', 'az']) {
      const словарь = JSON.parse(читать(`shared/locales/${язык}.json`));
      for (const ключ of ['invite', 'invite_friend', 'invite_sent', 'dungeon_invited', 'invite_expired']) {
        must(
          typeof словарь.panels?.[ключ] === 'string' && словарь.panels[ключ].length > 0,
          `в ${язык}.json нет текста panels.${ключ}`
        );
      }
    }
  });

  it('у друга действительно нет characterId — иначе поиск лишний', () => {
    // Если бы в Friend был characterId, поиск по userId был бы лишним
    // обращением. Проверка следит за этим: смысл найденного обхода измерим.
    const друзья = читать('server/src/services/FriendsService.ts');
    must(/interface Friend \{/.test(друзья), 'нет типа Friend');
    must(!/characterId: string;/.test(друзья.slice(друзья.indexOf('interface Friend {'), друзья.indexOf('interface Friend {') + 600)), 'у друга появился characterId: обход больше не нужен');
  });
});
