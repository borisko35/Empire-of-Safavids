// Ошибки партий возвращались как 500.
//
// ЧТО ЗДЕСЬ БЫЛО. PartySystem выражает обычные правила игры бросанием:
// createParty кидает Error('Already in a party'), inviteToParty — ещё четыре
// (партия полна, не лидер, уже в партии, партии нет). asyncHandler передаёт
// бросок в next, общий обработчик отдаёт 500, и клиент получал «Внутренняя
// ошибка. Попойробуйте позже» на ответ «ты уже в партии».
//
// ПОЧЕМУ ЭТО ЗАМЕТИЛИ ТОЛЬКО СЕЙЧАС. Партия создавалась один раз за сессию,
// и человек просто не повторял попытку — 500 был не виден. Рейд создаёт
// партию сам (PartySystem.createRaid), и повторное нажатие стало обычным
// делом. Проверка на рейд-маршрутах это не поймала бы: она смотрит на
// коды, которые рейд возвращает сам, а бросок летел мимо маршрута.
//
// ЧТО ЗАЩИЩАЕТСЯ. Четыре маршрута партий обязаны отвечать 400 с текстом
// ошибки, а createRaid — кодом, а не бросоком наружу.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const маршруты = код('server/src/routes/game.ts');
const партии = код('server/src/systems/PartySystem.ts');
const обёртка = код('server/src/utils/asyncHandler.ts');

describe('Партии: ошибка правила не должна быть 500', () => {
  it('все три маршрута партий ловят бросок', () => {
    const маршрутыПартий: { путь: string; метод: 'post' }[] = [
      { путь: '/parties', метод: 'post' },
      { путь: '/parties/:partyId/invite', метод: 'post' },
      { путь: '/parties/:partyId/leave', метод: 'post' },
    ];
    for (const { путь } of маршрутыПартий) {
      const начало = маршруты.indexOf(`gameRouter.post('${путь}'`);
      must(начало >= 0, `маршрута ${путь} нет`);
      // Блок — до следующего объявления маршрута. Окно в символах однажды
      // захватило соседний маршрут, и проверка осталась зелёной на том,
      // который бросок не ловит.
      const блок = маршруты.slice(начало, маршруты.indexOf('gameRouter.', начало + 10));
      must(
        /catch\s*\(err\)/.test(блок),
        `маршрут ${путь} не ловит бросок: «уже в партии» уйдёт клиенту как 500`,
      );
      must(
        /errorResponse\(res, err\)/.test(блок),
        `маршрут ${путь} ловит бросок, но не отвечает им — 500 остаётся`,
      );
    }
  });

  it('ответ именно 400, а не 200 с ошибкой', () => {
    // errorResponse по умолчанию даёт 400. Если у него поменяют дефолт,
    // проверка обязана заметить: ошибка правила, отданная как успех,
    // хуже 500 — клиент решит, что партия создалась.
    must(
      /export function errorResponse\(res: Response, err: unknown, status = 400\)/.test(обёртка),
      'errorResponse перестал отдавать 400 по умолчанию',
    );
  });

  it('партийные маршруты пользуются тем же helper, а не своим ответом', () => {
    must(
      /import \{ asyncHandler, errorResponse \} from '\.\.\/utils\/asyncHandler'/.test(маршруты),
      'errorResponse не импортирован в маршруты',
    );
  });
});

describe('Рейд: бросок партии не уходит наружу', () => {
  it('createRaid перехватывает бросок создания партии', () => {
    const начало = партии.indexOf('async createRaid');
    must(начало >= 0, 'createRaid нет');
    const блок = партии.slice(начало, начало + 2400);
    must(
      /this\.createParty\(leaderId\)/.test(блок),
      'createRaid больше не создаёт партию лидера',
    );
    must(
      /catch\s*\{[\s\S]{0,120}raid_party_create_failed/.test(блок),
      'createRaid не ловит бросок createParty: маршрут ответит 500',
    );
  });

  it('все коды createRaid отдаются объектом, а не бросаются', () => {
    const начало = партии.indexOf('async createRaid');
    const блок = партии.slice(начало, начало + 2400);
    const кодов = блок.match(/return \{ ok: false, code:/g) ?? [];
    must(кодов.length >= 4, `отказов с кодом ${кодов.length}: часть путей всё ещё бросает`);
  });
});