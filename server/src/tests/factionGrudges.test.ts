// Враждебность имеет цену для каждой фракции (§364).
//
// ЗА ЧТО БОРЕТСЯ. §363 дал отрицательную ветку и следствие ровно одной
// фракции — «Враг Гильдии» платит в лавках. У остальных трёх враждебных
// рангов поведение не менялось ни на йоту: «Враг Ордена», «Сошедший с Пути»
// и «Помеченный Тенью» были надписями, а для них всё это по-прежнему
// «просто новый счётчик» — тот самый диагноз владельца.
//
// ЧТО ТЕПЕРЬ. Каждый орден отказывает своему врагу в своей услуге:
//   кызылбаши — не служат врагу в карауле (найм солдат);
//   мистики — не слушают отступника (поэзия Хафиза);
//   тень — отступилась от помеченного (кража платит вдвое меньше).
// Торговцы уже считают врага при цене (§363).
//
// ЕДИНОЕ МЕСТО «ниже нуля = враждебна». ReputationService.isHostile: свои
// запросы в каждом следствии разъехались бы при смене порога.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEFT_MARKED_MULT, THEFT_GOLD } from '../../../shared/stealth';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const сервис = читать('server/src/services/ReputationService.ts');
const солдаты = читать('server/src/services/SoldierService.ts');
const поэзия = читать('server/src/routes/poetry.ts');
const обработчик = читать('server/src/socket/GameSocketHandler.ts');
const клиент = читать('client/src/app/panels.ts');
const api = читать('client/src/app/api.ts');

describe('Единое место враждебности', () => {
  it('isHostile существует, и множитель цены читает его, а не свой запрос', () => {
    must(/async isHostile\(characterId: string, factionId: string\): Promise<boolean>/.test(сервис),
      'единого предиката враждебности нет: каждый следствие считает порог сам');
    must(/shopPriceMultiplier[\s\S]{0,120}isHostile\(characterId, 'merchants'\)/.test(сервис),
      'множитель цены держит свой запрос: при смене порога разъедется с остальными');
    must(!/reputation \?\? 0\) < 0 \? HOSTILE_PRICE_MULT/.test(сервис),
      'в множителе цены остался дублирующий запрос к базе');
  });
});

describe('Кызылбаши: врагу Ордена не служат', () => {
  it('найм отказывает до списания золота и лимита', () => {
    must(/if \(await this\.репутация\.isHostile\(characterId, 'qizilbash'\)\) \{\s*\n\s*return \{ ok: false, reason: 'qizilbash_grudge' \};/.test(солдаты),
      'враг Ордена нанимает караул: враждебность ничего не значит');
    // Отказ раньше транзакции списания: услуга не существует, а не «сорвалась».
    const отказ = солдаты.indexOf("reason: 'qizilbash_grudge'");
    const списание = солдаты.indexOf('SET gold = gold -', отказ);
    must(списание > отказ, 'враг Ордена проходит к списанию золота до отказа');
  });

  it('клиент называет причину', () => {
    must(/r\.reason === 'qizilbash_grudge' \? t\('soldiers\.hire_grudge'\)/.test(клиент),
      'отказ найма не отличает обиду от прочих причин');
  });
});

describe('Мистики: не слушают отступника', () => {
  it('старт поэзии проверяет персонажа и враждебность суфиев', () => {
    must(/if \(await new ReputationService\(\)\.isHostile\(characterId, 'sufi'\)\) \{\s*\n\s*res\.status\(403\)\.json\(\{ error: 'sufi_grudge' \}\);/.test(поэзия),
      'отступник собирает стихи Хафиза как ни в чём не бывало');
    // Персонаж проверяется на владение: чужим персонажем нельзя узнать чужую обиду.
    must(/персонаж\.userId !== req\.userId/.test(поэзия), 'поэзия не проверяет владение персонажем: чужой id раскрывает чужую репутацию');
  });

  it('клиент зовёт с персонажем и знает причину', () => {
    must(/api\.poetryStart\(challenge\.difficulty, cid\(\)\)/.test(клиент),
      'поэзия стартует без персонажа: серверу нечего проверять');
    must(/code === 'sufi_grudge'/.test(клиент), 'клиент не отличает отказ мистиков');
  });
});

describe('Тень: отступилась от помеченного', () => {
  it('кража платит по множителю из shared, а не по выдуманному числу', () => {
    must(/const награда = Math\.floor\(THEFT_GOLD \* \(тень \? THEFT_MARKED_MULT : 1\)\);/.test(обработчик),
      'помеченный Тенью ворует на полную: тень не имеет мнения');
    must(!/THEFT_GOLD\)/.test(обработчик.slice(обработчик.indexOf('const награда = Math.floor'), обработчик.indexOf('const награда = Math.floor') + 200).replace('THEFT_GOLD * (тень ? THEFT_MARKED_MULT : 1)', '')),
      'в чеке кражи осталось голое THEFT_GOLD мимо множителя');
  });

  it('множитель честно меньше единицы', () => {
    must(THEFT_MARKED_MULT > 0 && THEFT_MARKED_MULT < 1,
      `множитель помеченного ${THEFT_MARKED_MULT}: наказание не наказание или не число`);
    must(THEFT_MARKED_MULT * THEFT_GOLD >= 1, 'половина награды округляется в ноль: кража перестаёт платить вовсе');
  });
});

describe('Словари: причины названы на всех языках', () => {
  for (const ключ of ['soldiers.hire_grudge', 'poetry.grudge']) {
    it(`${ключ} есть в en, ru и az`, () => {
      const [раздел, имя] = ключ.split('.');
      for (const lang of ['en', 'ru', 'az']) {
        const словарь = JSON.parse(читать(`shared/locales/${lang}.json`));
        must((словарь[раздел]?.[имя] ?? '').trim() !== '', `${ключ} пуст в ${lang}`);
      }
    });
  }

  it('poetryStart передаёт characterId по проводу', () => {
    must(/JSON\.stringify\(\{ difficulty, characterId \}\)/.test(api),
      'api.poetryStart не шлёт characterId: сервер не может проверить враждебность');
  });
});
