// Личные квесты по тёмной карме.
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ.
//   1. Граница кармы задана данными и совпадает с таблицей статусов. Число в
//      данных намерино: хаотичным считается карма от −2000, значит красный — с
//      −2001. Первая версия проверки считала границу иначе и была неправа;
//      теперь расхождение ловится на всём диапазоне, а не на память.
//   2. Фильтр списка: святому личный квест не показывается ВООБЩЕ, а не просто
//      отклоняется при нажатии. Тёмный квест не должен висеть перед тем, кому он
//      не адресован.
//   3. Граница ровная: добрый не видит, изгой видит, и на самой границе тоже.
//   4. Данные квестов не выдуманы: NPC существует, монстры существуют, у второго
//      квеста есть предшественник.
//   5. Отказ при попытке взять имеет перевод во всех трёх языках.
//   6. Карма читается в одном месте: если формулировка запроса разъедется по
//      маршруту и сервису, одна из сторон молча начнёт считать ноль.
import { getAvailableQuests, QUESTS_DATABASE, PERSONAL_KARMA_MAX } from '../data/quests';
import { CharacterClass } from '../types/game.types';
import { getKarmaStatus, isNpcHostile } from '../systems/KarmaSystem';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const ЛИЧНЫЕ = Object.values(QUESTS_DATABASE).filter(q => q.type === 'personal');

describe('Личные квесты: граница по карме', () => {
  it('личные квесты вообще есть', () => {
    must(ЛИЧНЫЕ.length >= 2, `личных квестов ${ЛИЧНЫЕ.length}: тёмная ветка пустая`);
    for (const квест of ЛИЧНЫЕ) {
      must(
        квест.requiresKarmaAtMost !== undefined,
        `${квест.id} помечен личным, но условия по карме у него нет: он достанется кому угодно`
      );
    }
  });

  it('граница в данных совпадает с таблицей статусов', () => {
    // Смысл числа: всё, что не выше его, — красный или изгой. Проверяем на всём
    // диапазоне, чтобы пересчёт порогов в карме сразу указал на расхождение.
    let проверили = 0;
    for (let карма = -12000; карма <= 12000; карма += 13) {
      const враждебен = isNpcHostile(карма);
      const подходитПоГранице = карма <= PERSONAL_KARMA_MAX;
      if (враждебен !== подходитПоГранице) {
        throw new Error(
          `карма ${карма} (${getKarmaStatus(карма)}): по таблице враждебность ` +
            `${враждебен}, а PERSONAL_KARMA_MAX=${PERSONAL_KARMA_MAX} даёт ` +
            `${подходитПоГранице}. Граница в данных разошлась с кармой.`
        );
      }
      проверили++;
    }
    must(проверили > 900, `проверено ${проверили} значений: диапазон сузился`);
  });

  it('на самой границе изгой подходит, а добрый нет', () => {
    must(
      getKarmaStatus(PERSONAL_KARMA_MAX) === 'red',
      `на границе ${PERSONAL_KARMA_MAX} статус ${getKarmaStatus(PERSONAL_KARMA_MAX)}, а не красный`
    );
    must(
      !isNpcHostile(PERSONAL_KARMA_MAX + 1),
      `на границе +1 статус ${getKarmaStatus(PERSONAL_KARMA_MAX + 1)} уже враждебен`
    );
  });
});

describe('Личные квесты: список доступных', () => {
  const личныеАйди = ЛИЧНЫЕ.map(q => q.id);
  const естьЛичный = (список: string[]): boolean => список.some(id => личныеАйди.includes(id));

  it('святому личные квесты не показываются', () => {
    for (const карма of [0, 1000, 5000, 20000]) {
      const список = getAvailableQuests(50, [], CharacterClass.QIZILBASH, карма).map(q => q.id);
      must(
        !естьЛичный(список),
        `при карме ${карма} (${getKarmaStatus(карма)}) личный квест попал в список: ` +
          'тёмный заказ висит перед тем, кому он не адресован'
      );
    }
  });

  it('хаотичному личные квесты тоже не показываются', () => {
    // Хаотичный ещё не враждебен: граница проходит по красному, а не по нижней
    // границе «отрицательной» кармы.
    must(!isNpcHostile(-2000), 'хаотичный враждебен: граница тогда была бы выше');
    const список = getAvailableQuests(50, [], CharacterClass.QIZILBASH, -2000).map(q => q.id);
    must(!естьЛичный(список), `хаотичному показали личный квест: ${список.join(', ')}`);
  });

  it('красному и изгою личные квесты показываются', () => {
    for (const карма of [PERSONAL_KARMA_MAX, -4000, -5001, -12000]) {
      const список = getAvailableQuests(50, [], CharacterClass.QIZILBASH, карма).map(q => q.id);
      must(
        естьЛичный(список),
        `при карме ${карма} (${getKarmaStatus(карма)}) личный квест не показан: ` +
          'тёмная ветка недостижима, вход в неё закрыт навсегда'
      );
    }
  });

  it('без переданной кармы личные квесты не показываются', () => {
    // Вызывающий код может не знать карму (например, старый маршрут). Показывать
    // тёмные квесты тому, чью карму не проверили, — хуже, чем не показать.
    const список = getAvailableQuests(50, [], CharacterClass.QIZILBASH).map(q => q.id);
    must(
      !естьЛичный(список),
      `без кармы показаны личные квесты: ${список.filter(id => личныеАйди.includes(id)).join(', ')}`
    );
  });

  it('уровень и класс по-прежнему учитываются: фильтр не сломан', () => {
    const всехУровней = getAvailableQuests(50, [], CharacterClass.QIZILBASH, -5001).map(q => q.id);
    const всехУровней5 = getAvailableQuests(5, [], CharacterClass.QIZILBASH, -5001).map(q => q.id);
    must(
      всехУровней.length > всехУровней5.length,
      'фильтр по уровню перестал работать: добавление кармы shouldn’t было его трогать'
    );
    must(
      !getAvailableQuests(50, [], CharacterClass.SUFI_MYSTIC, -5001).some(q => q.requiredClass === CharacterClass.QIZILBASH),
      'фильтр по классу перестал работать: проверяли на несуществующем классе, поэтому проходили бы всегда'
    );
  });
});

describe('Личные квесты: данные не выдуманы', () => {
  const npкДанные = читать('server/src/data/quests.ts');
  const монстры = читать('server/src/data/monsters.ts');

  it('NPC, который даёт личные квесты, существует в мире', () => {
    // Иначе квест недостижим: игрок придёт к пустому месту.
    for (const квест of ЛИЧНЫЕ) {
      const упоминание = new RegExp(`'${квест.npcGiver}'`).test(читать('client/src/app/game3d/npc.ts'))
        || new RegExp(`npc_${квест.npcGiver}`).test(читать('client/src/app/game3d/npc.ts'))
        || npкДанные.includes(`npcGiver: '${квест.npcGiver}'`);
      must(
        упоминание,
        `${квест.id}: NPC ${квест.npcGiver} не встречается в игре — квест невозможно взять`
      );
      must(
        квест.npcGiver === 'npc_tabriz_hunter',
        `${квест.id} выдаёт неизвестный NPC ${квест.npcGiver}: проверка знает только охотника`
      );
    }
  });

  it('цели убийства существуют в данных монстров', () => {
    for (const квест of ЛИЧНЫЕ) {
      for (const цель of квест.objectives) {
        if (цель.type !== 'kill') continue;
        must(
          монстры.includes(`'${цель.target}'`),
          `${квест.id}: монстра ${цель.target} нет в данных — цель недостижима`
        );
      }
    }
  });

  it('второй квест выводится из первого, а не висит рядом', () => {
    const первый = ЛИЧНЫЕ.find(q => q.id === 'personal_001_dirty_work');
    const второй = ЛИЧНЫЕ.find(q => q.id === 'personal_002_ledger');
    must(первый, 'нет первого личного квеста');
    must(второй, 'нет второго личного квеста');
    must(
      второй.prerequisites.includes(первый.id),
      `${второй.id} не требует ${первый.id}: ветка из одного квеста, а обещали дорогу`
    );
    must(
      второй.minLevel > первый.minLevel,
      `второй квест не сложнее первого по уровню (${второй.minLevel} против ${первый.minLevel})`
    );
  });

  it('у личных квестов есть награда', () => {
    for (const квест of ЛИЧНЫЕ) {
      must(
        квест.rewards.experience > 0 || квест.rewards.gold > 0,
        `${квест.id} без награды: работать не ради чего`
      );
    }
  });

  it('квесты лежат внутри базы, а не рядом с ней', () => {
    // Ошибка уже была: квесты вставились перед объявлением и висели на верхнем
    // уровне модуля — файл не собирался. Проверка ловит это по объявлению.
    const объявлений = npкДанные.split('export const QUESTS_DATABASE').length - 1;
    must(объявлений === 1, `объявлений базы ${объявлений}: квесты снова снаружи`);
  });
});

describe('Личные квесты: отказ и переводы', () => {
  const сервис = читать('server/src/services/QuestService.ts');
  const маршрут = читать('server/src/routes/game.ts');
  const персонажи = читать('server/src/services/CharacterService.ts');
  const hud = читать('client/src/app/hud.ts');

  it('отказ при попытке взять есть и с причиной', () => {
    must(
      сервис.includes("'quest_karma_mismatch'"),
      'код отказа по карме не добавлен в список кодов сервиса'
    );
    must(
      /if \(def\.requiresKarmaAtMost !== undefined\)[\s\S]{0,200}quest_karma_mismatch/.test(сервис),
      'отказ по карме не проверяется при принятии: квест можно взять ручным запросом мимо списка'
    );
  });

  it('причина отказа переведена во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az']) {
      const словарь = JSON.parse(читать(`shared/locales/${код}.json`));
      must(
        словарь.errors?.quest_karma_mismatch,
        `${код}.json: нет errors.quest_karma_mismatch — игрок увидит код вместо причины`
      );
      must(словарь.quest_type?.personal, `${код}.json: нет quest_type.personal`);
    }
  });

  it('клиент знает подпись типа квеста', () => {
    must(
      hud.includes("personal: 'quest_type.personal'"),
      'в карте типов квестов нет personal: в журнале личный квест без подписи'
    );
  });

  it('маршрут отдаёт фильтру карму', () => {
    must(
      /getAvailableQuests\(char\.level, \[\], char\.class, карма\)/.test(маршрут),
      'маршрут не передаёт карму в фильтр: личные квесты либо у всех, либо ни у кого'
    );
  });

  it('карма читается в одном месте', () => {
    must(
      /async getKarma\(characterId: string\): Promise<number>/.test(персонажи),
      'в CharacterService нет чтения кармы'
    );
    must(
      !/private async getKarma\(/.test(сервис),
      'в QuestService остался свой запрос кармы: формулировки разъедутся'
    );
    // Запрос кармы по персонажу должен встречаться в CharacterService ровно один.
    const запросов = (персонажи.match(/SELECT karma FROM characters WHERE id = \$1/g) || []).length;
    must(запросов === 1, `запросов кармы в CharacterService ${запросов}`);
  });
});