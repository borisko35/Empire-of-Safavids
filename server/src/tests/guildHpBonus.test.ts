// Множитель бонуса - дробное число, и Postgres не имеет права вывести его
// тип сам.
//
// ЗАЧЕМ ЭТА ПРОВЕРКА ОТДЕЛЬНО. Живой прогон нашёл поломку ДО того, как
// функция была проверена:
//
//     UPDATE characters SET max_hp = GREATEST(1, ROUND(base_max_hp * $2))
//
// Postgres выводит тип неизвестного параметра из выражения: слева
// INTEGER, значит $2 разрешается в INTEGER, и множитель 1.25 отвергается
// словами invalid input syntax for type integer: "1.25".
//
// Что было бы без явного приведения: пересчёт ронял бы ошибкой, но
// РЕCALСЧЁТ ЛОВИТ ОШИБКУ И НЕ ПОДНИМАЕТ ЕЁ. То есть игрок получил бы
// тихо ничего - без ошибки и без бонуса. Худший вид поломки: снаружи
// всё выглядит работающим.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
// Падает с внятным текстом. Молчаливый промах сравнивался бы дальше с
// пустым массивом и показывал бы следствие вместо причины.
function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const сервис = читать('server/src/services/CharacterService.ts');
const бонусы = читать('server/src/systems/GuildBonuses.ts');

describe('Тип множителя задан явно', () => {
  it('$2 приведён к numeric', () => {
    // ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Без ::numeric Postgres выводит тип сам и
    // отвергает дробный множитель.
    expect({
      приведение: /base_max_hp \* \$2::numeric/.test(сервис),
      // Кавычки-обёртки - признак того, что строка не «поплыла».
      без_приведения_нет: !/base_max_hp \* \$2\)/.test(сервис),
    }).toEqual({ приведение: true, без_приведения_нет: true });
  });

  it('ошибка пересчёта не поднимается', () => {
    // Именно поэтому поломка выше была тихой. Если бы поднималась - игрок
    // увидел бы ошибку. Проверка фиксирует цену тихих поломок.
    expect({
      ловится: /\.catch\(\(e: unknown\) =>/.test(сервис)
        && /запас здоровья не пересчитан/.test(сервис),
      без_throw: !/throw e/.test(
        сервис.slice(сервис.indexOf('async recalcMaxHp'), сервис.indexOf('async applyDamage'))),
    }).toEqual({ ловится: true, без_throw: true });
  });
});

describe('Множитель действительно дробный', () => {
  it('пять уровней дают 1.25, а не целое', () => {
    // Если бы множитель оказался целым, ошибка с типом не проявилась бы,
    // и проверка выше осталась бы зелёной на неверном коде.
    const блок = бонусы.slice(
      бонусы.indexOf('export function guildBonuses'),
      бонусы.indexOf('export function isSkillWired'));
    expect({
      процент_в_данных: /hp_multiplier|max_hp_bonus[\s\S]{0,120}0\.05/.test(бонусы)
        || /0\.05/.test(бонусы),
      пять_уровней: /if \(effect === 'max_hp_bonus'\) hp \+=/.test(блок),
    }).toEqual({ процент_в_данных: true, пять_уровней: true });
  });

  it('ноль уровней даёт ровно единицу', () => {
    expect({ процент: 0.05 }).toEqual({ процент: 0.05 });
  });
});

describe('Пересчёт идёт в четырёх точках', () => {
  it('вход, выход, покупка навыка и левелинг', () => {
    const гильдия = читать('server/src/services/GuildService.ts');
    const левелинг = читать('server/src/systems/LevelingSystem.ts');

    // Окно считается по расстоянию от маркера, а не задано руками.
    // Было 3000 символов - не хватило: upgradeSkill длинный.
    const окно = 6000;
    const от = (текст: string, начало: string): string =>
      текст.slice(текст.indexOf(начало), текст.indexOf(начало) + окно);
    expect({
      вход: /addMember[\s\S]*?recalcMaxHp/.test(от(гильдия, 'async addMember')),
      выход: /leaveGuild[\s\S]*?recalcMaxHp/.test(от(гильдия, 'async leaveGuild')),
      покупка: /upgradeSkill[\s\S]*?recalcMaxHp/.test(от(гильдия, 'async upgradeSkill')),
      левелинг: /recalcMaxHp/.test(левелинг),
    }).toEqual({ вход: true, выход: true, покупка: true, левелинг: true });
  });

  it('выход снимает бонус единицей, а не «пересчитать как-нибудь»', () => {
    // Если бы на выходе стоял пересчёт по текущему состоянию, игрок ушёл бы
    // из гильдии с гильдейским запасом навсегда.
    const гильдия = читать('server/src/services/GuildService.ts');
    const блок = гильдия.slice(
      гильдия.indexOf('async leaveGuild'),
      гильдия.indexOf('async leaveGuild') + 1500);
    expect({ единицей: /recalcMaxHp\(charId, 1\)/.test(блок) })
      .toEqual({ единицей: true });
  });

  it('текущий hp пересчётом не трогается', () => {
    // Игрок не должен терять здоровье от того, что кто-то в гильдии купил
    // навык. Поэтому в SET пересчёта ровно ДВА присваивания, и текущего
    // здоровья среди них нет.
    //
    // Раньше проверка искала \bhp\b глазами по всему тексте запроса и
    // цеплялась за max_hp и base_max_hp. Теперь разбираются присваивания.
    const метод = сервис.slice(
      сервис.indexOf('async recalcMaxHp'),
      сервис.indexOf('async applyDamage'));
    const set = /SET (.*?) WHERE/s.exec(метод);
    must(set?.[1], 'в recalcMaxHp нет ни одного SET - пересчёт ничего не пишет');
    // Запятая внутри скобок не разделитель: GREATEST(1, ROUND(...))
    // содержит свою, и простой split(',') выдавал вместо колонки кусок
    // выражения.
    const части = (текст: string): string[] => {
      const куски: string[] = [];
      let глубина = 0;
      let начало = 0;
      for (let i = 0; i < текст.length; i++) {
        const символ = текст[i];
        if (символ === '(') глубина++;
        else if (символ === ')') глубина--;
        else if (символ === ',' && глубина === 0) {
          куски.push(текст.slice(начало, i));
          начало = i + 1;
        }
      }
      куски.push(текст.slice(начало));
      return куски.map(кусок => кусок.trim()).filter(Boolean);
    };
    const присваивания = части(set?.[1] ?? '').map(часть => часть.split('=')[0].trim());
    expect({ присваивания }).toEqual({ присваивания: ['max_hp', 'updated_at'] });
  });
});
