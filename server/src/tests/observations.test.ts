// Слой наблюдений (§365): мир помнит, что игрок делает чаще.
//
// ЗА ЧТО БОРЕТСЯ. Третий пункт 9-C (личные квесты) требует слоя наблюдений,
// и карта предупреждала: «работа сделана, пользы нет — ровно то, что
// повторялось с подземельями дважды». Инфраструктура без потребителя —
// ровно та ловушка. Поэтому здесь проверяется не только запись, но и то,
// что крючок стоит в ЕДИНСТВЕННОЙ точке событий, и что потребитель
// (строка «Мир заметил» в панели задач) доезжает до клиента.
//
// ПОЧЕМУ ЕДИНАЯ ТОЧКА. Шесть канонических дел уже проходят через
// grantReputation — один список REP, один путь вызова. Свои крючки
// observe() в обработчиках монстров, данжей и квестов значили бы вторую
// копию списка «что случилось», а списки этого проекта разъезжались не раз.
//
// ПОЧЕМУ ХУК НЕ МОЖЕТ РОНИТЬ БОЙ. Наблюдение — не оплата: срыв записи
// обязан быть предупреждением в журнале, а не провалом убийства монстра.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const крючок = читать('server/src/systems/ReputationGrants.ts');
const слой = читать('server/src/systems/PlayerObservations.ts');
const миграция = читать('database/migrations/082_player_observations.sql');
const маршруты = читать('server/src/routes/game.ts');
const клиент = читать('client/src/app/panels.ts');
const api = читать('client/src/app/api.ts');

describe('Хранение: миграция и счётчик', () => {
  it('таблица наблюдений существует с составным ключом', () => {
    must(/CREATE TABLE IF NOT EXISTS player_observations \(/.test(миграция),
      'миграции наблюдений нет: память мира умерла бы на рестарте');
    must(/PRIMARY KEY \(character_id, kind\)/.test(миграция),
      'ключ не составной: строк на вид деятельности больше одной');
    must(/DO UPDATE SET count = player_observations\.count \+ 1/.test(слой),
      'счётчик не складывается: каждое дело считалось бы заново с единицы');
  });

  it('профиль отдаёт верх и пустоту новичку', () => {
    must(/ORDER BY count DESC/.test(слой), 'профиль не сортирован: «чаще всего» — не самый частый');
    must(/top: rows\[0\]\?\.kind \?\? null/.test(слой), 'у новичка top не null: нечего наблюдать, а строка есть');
  });
});

describe('Крючок: одна точка, не роняет бой', () => {
  it('наблюдение ставится в grantReputation рядом с репутацией', () => {
    must(/void наблюдения\.observe\(characterId, kind\)\.catch/.test(крючок),
      'наблюдение не стоит в единой точке событий: часть дел мир не заметит');
    must(!/observe\(/.test(крючок.replace(/void наблюдения\.observe\(characterId, kind\)\.catch\(\(error\) => \{\s*\n\s*console\.warn\('\[Observations\] not recorded:', error\);\s*\n\s*\}\);/, '')),
      'в grantReputation второй вызов observe: два места записи разъедутся');
  });

  it('ошибка наблюдения не роняет начисление', () => {
    // catch у наблюдения стоит ДО try репутации: упавшее наблюдение не
    // попадает в чужой обработчик.
    const hook = крючок.indexOf('void наблюдения.observe');
    const tryRep = крючок.indexOf('try {', hook);
    const catchObs = крючок.indexOf("catch((error)", hook);
    must(hook >= 0 && tryRep > hook && catchObs > hook,
      'наблюдение не ограждено от начисления: срыв записи уронит бой');
  });
});

describe('Маршрут и потребитель', () => {
  it('наблюдения отдаются только владельцу персонажа', () => {
    must(/gameRouter\.get\('\/observations', secureMiddleware/.test(маршруты),
      'маршрута наблюдений нет: потребителю нечего показать');
    must(/свой\.userId !== req\.userId/.test(маршруты.slice(маршруты.indexOf("'/observations'"), маршруты.indexOf("'/observations'") + 800)),
      'наблюдения отдаются не владельцу: чужие привычки читаются по id');
  });

  it('клиент показывает строку и не показывает путь ключа', () => {
    must(/api\.observations\(charId\)/.test(клиент), 'панель задач не зовёт наблюдения: инфраструктура без потребителя');
    must(/observations\.title/.test(клиент), 'строка «Мир заметил» потерялась');
    must(/шаблон\.includes\('\.'\)/.test(клиент), 'путь ключа без перевода уходит игроку как текст');
  });

  it('api.observations едет по проводу с персонажем', () => {
    must(/observations: \(characterId: string\) =>/.test(api), 'метода наблюдений нет в api');
    must(/\/api\/game\/observations\?characterId=/.test(api), 'наблюдения запрашиваются без персонажа');
  });
});

describe('Словари: мир говорит на всех языках', () => {
  const ключи = ['title', 'monsterKill', 'dungeonClear', 'questDone', 'pvpWin', 'auctionSale', 'tradeDone'];
  for (const lang of ['en', 'ru', 'az']) {
    it(`${lang}: заголовок и шесть дел на месте`, () => {
      const словарь = JSON.parse(читать(`shared/locales/${lang}.json`));
      const раздел = словарь.observations ?? {};
      const пустые = ключи.filter((k) => !(раздел[k] ?? '').trim());
      must(пустые.length === 0, `${lang}: пустые ключи наблюдений — ${пустые.join(', ')}`);
    });
  }
});
