// Личное поручение (§367): наблюдение превращается в предложение.
//
// ЗА ЧТО БОРЕТСЯ. Слой наблюдений (§365) отвечал на вопрос «что игрок
// делает чаще», но не предлагал ничего — инфраструктура без потребителя,
// та самая ловушка карты. Поручение — первый настоящий потребитель: НПС,
// привязанный к верхнему делу, просит работу, и прогресс считается тем же
// счётчиком наблюдений.
//
// ГЛАВНАЯ ГАРАНТИЯ — ЛЕНИВЫЙ ПРОГРЕСС. Поручение хранит базовую линию на
// момент принятия, прогресс = текущий счётчик минус база. Никакого кэша
// прогресса в строке: он разошёлся бы с наблюдением при первом же тике.
// И никакой второй точки записи: наблюдение уже считает всё в едином месте.
//
// ВТОРАЯ ГАРАНТИЯ — НАГРАДА ПО ПРАВИЛАМ. Золото через addGoldReward
// (сезонный множитель — правило проекта: прямая награда запрещена), опыт
// через addExperience. Сдача не по цели отказывает ДО выдачи и ДО удаления
// строки: не бывает «забрал и потерял».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERRAND_TEMPLATES } from '../systems/PersonalErrands';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const сервис = читать('server/src/systems/PersonalErrands.ts');
const маршруты = читать('server/src/routes/game.ts');
const клиент = читать('client/src/app/panels.ts');
const api = читать('client/src/app/api.ts');
const миграция = читать('database/migrations/083_personal_errands.sql');

describe('Шаблоны: покрыты все шесть дел наблюдений', () => {
  it('по шаблону на каждый kind, числа в рамках задач дня', () => {
    const kinds = new Set(ERRAND_TEMPLATES.map((t) => t.kind));
    for (const k of ['monsterKill', 'dungeonClear', 'questDone', 'pvpWin', 'auctionSale', 'tradeDone']) {
      must(kinds.has(k as never), `шаблона для ${k} нет: наблюдение этого дела не превращается в предложение`);
    }
    for (const t of ERRAND_TEMPLATES) {
      must(t.target > 0 && t.target <= 25, `цель шаблона ${t.id} (${t.target}) вне рамок задач дня`);
      must(t.rewardGold >= 150 && t.rewardGold <= 1000, `награда ${t.id} (${t.rewardGold}) не калибрована по задачам дня`);
      must(t.rewardExp > 0, `у шаблона ${t.id} нет опыта`);
      must(t.npcRu.length > 0 && t.titleRu.length > 0, `у шаблона ${t.id} нет имени НПС или названия`);
    }
  });
});

describe('Хранение: одна строка, ленивый прогресс', () => {
  it('миграция с персонажем-ключом', () => {
    must(/CREATE TABLE IF NOT EXISTS personal_errands \(/.test(миграция), 'миграции поручений нет');
    must(/character_id UUID PRIMARY KEY/.test(миграция),
      'ключ не по персонажу: активных поручений больше одного');
  });

  it('прогресс считается разницей с базой, не кэшем', () => {
    must(/профиль\.counts\[строка\.kind\] \?\? 0\) - строка\.base_count/.test(сервис),
      'прогресс не из разницы с базой: он разойдётся с наблюдением');
    must(!/progress\s*INTEGER/.test(миграция), 'в строке лежит кэш прогресса: второй источник истины');
  });

  it('устаревший шаблон снимается, а не висит вечно', () => {
    must(/DELETE FROM personal_errands WHERE character_id = \$1', \[characterId\]\);\s*\n\s*return \{ state: 'none'/.test(сервис),
      'поручение с исчезнувшим шаблоном висит вечно: персонаж заперт');
  });
});

describe('Приём и сдача: правила доступа к награде', () => {
  it('приём требует профиля и не проходит поверх активного', () => {
    must(/if \(!профиль\.top\) return \{ ok: false, code: 'errand_no_profile' \};/.test(сервис),
      'поручение даётся без наблюдений: персональности нет — это меню');
    must(/if \(active\.state === 'active' \|\| active\.state === 'done'\) return \{ ok: false, code: 'errand_already_active' \};/.test(сервис),
      'второе поручение принимается поверх активного');
    must(/профиль\.counts\[шаблонP\.kind\] \?\? 0\]/.test(сервис),
      'база не зафиксирована на момент принятия: прежние заслуги идут в прогресс');
  });

  it('сдача отказывает до выдачи и до удаления', () => {
    const claim = сервис.slice(сервис.indexOf('async claim'));
    must(/errand_not_done/.test(claim), 'недоведённое поручение сдаётся: награда без работы');
    const выдача = claim.indexOf('addGoldReward');
    const удаление = claim.indexOf('DELETE FROM personal_errands');
    must(выдача > 0 && удаление > выдача, 'строка удаляется до выдачи награды: сбой = потерянное поручение');
  });

  it('награда по правилам проекта', () => {
    must(/addGoldReward\(characterId, шаблонP\.rewardGold\)/.test(сервис),
      'золото поручения идёт мимо addGoldReward: сезонный множитель обойдён');
    must(/addExperience\(characterId, шаблонP\.rewardExp\)/.test(сервис), 'опыт не начисляется');
  });
});

describe('Маршруты и клиент', () => {
  it('три маршрута проверяют владение', () => {
    for (const путь of ["'/errand'", "'/errand/accept'", "'/errand/claim'"]) {
      must(маршруты.includes(путь), `маршрута ${путь} нет`);
    }
    must((маршруты.match(/свой\.userId !== req\.userId/) ?? []).length >= 1 &&
      /requireCharacterOwnership\(\),\s*\n\s*asyncHandler\(async \(req: Request, res: Response\) => \{\s*\n\s*const result = await поручения\.accept/.test(маршруты),
      'приём поручения не проверяет владение персонажем');
  });

  it('клиент показывает предложение, прогресс и награду', () => {
    must(/api\.errand\(charId\)/.test(клиент), 'панель задач не зовёт поручение');
    must(/api\.errandClaim\(charId\)/.test(клиент), 'кнопка награды не подключена');
    must(/errand\.in_progress/.test(клиент), 'активное поручение рисует выдуманный текст кнопки');
    must(/en2 \? e\.template\.npc : e\.template\.npcRu/.test(клиент),
      'имя НПС всегда по-русски: en-игрок читает чужой язык');
    must(/JSON\.stringify\(\{ characterId \}\)/.test(api), 'accept/claim не шлют персонажа');
  });
});
