// Шаг 2 стелса: скрытность отменяет обнаружение.
//
// ЧТО ИЗМЕРЕНО ДО ЭТОЙ ПРОВЕРКИ (все числа сняты с кода, а не выбраны):
//   CROUCH_SPEED = 2.2, WALK_SPEED = 4.2  ->  2.2/4.2 = 0.524, взято 0.5
//   visibilityMod в WEATHER_EFFECTS: ясно 1.0, облачно 0.9, дождь 0.7,
//     буря 0.4, песчаная буря 0.3, туман 0.5, снег 0.6, ветер 0.85.
//     Поле было мёртвым: объявлялось и не читалось нигде.
//   Фактор ночи в client/src/app/world.ts: night/midnight -> 1,
//     evening/dawn -> 0.5, иначе 0. Считался только для освещения.
//
// ПОЧЕМУ ПРОВЕРКА СЧИТАЕТ ЧИСЛА, А НЕ ИЩЕТ СТРОКИ. Поиск "CROUCH_SIGHT"
// доказал бы, что строка есть. Здесь считаются множители и расстояния:
// испорченное число роняет утверждение.
//
// ГЛАВНОЕ УТВЕРЖДЕНИЕ ПРОВЕРКИ. Скрытность должна быть ПОВЕДЕНИЕМ, а не
// полем: присевший игрок срывается с обнаружения. Если правило просто лежит
// в файле, стелса нет - есть мёртвое поле.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CROUCH_SIGHT,
  NIGHT_SIGHT,
  GUARD_POSTS,
  GUARD_SIGHT,
  concealment,
  effectiveSight,
  nightFactor,
  spottedBy,
} from '../../../shared/stealth';
import { WEATHER_EFFECTS } from '../systems/WorldTimeSystem';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('Скрытность: приседание сокращает обзор стража', () => {
  const стража = GUARD_POSTS[0];

  it('коэффициенты не нулевые и не единичные', () => {
    // Ноль был бы той же мёртвой маской, что и visibilityMod: правило есть,
    // а на деле всегда вижу.
    must(Number(CROUCH_SIGHT) > 0, 'CROUCH_SIGHT = 0: приседание ничего не даёт');
    must(Number(CROUCH_SIGHT) < 1, 'CROUCH_SIGHT = 1: приседание не сокращает обзор вовсе');
    must(Number(NIGHT_SIGHT) > 0, 'NIGHT_SIGHT = 0: ночь не помогает');
    must(Number(NIGHT_SIGHT) < 1, 'NIGHT_SIGHT = 1: ночь не сокращает обзор');
  });

  it('присевший срывается с обнаружения там, где стоящий замечен', () => {
    // Точка внутри обычного обзора, но за половиной приседного.
    // 14 единиц: видно при sight 20, не видно при 20 * 0.5 = 10.
    const игрок = { x: стража.x + 14, z: стража.z };

    must(spottedBy(игрок, [стража], {}) !== null, 'на 14 единицах стоя должен быть замечен');
    must(
      spottedBy(игрок, [стража], { crouch: true }) === null,
      'присевший на 14 единицах тоже замечен: приседание не работает'
    );
  });

  it('подтверждено числами: обзор при приседании вдвое меньше', () => {
    must(
      Math.abs(effectiveSight(стража, { crouch: true }) - GUARD_SIGHT * 0.5) < 1e-9,
      `при приседании обзор ${effectiveSight(стража, { crouch: true })}, а не половина от ${GUARD_SIGHT}`
    );
    must(
      Math.abs(effectiveSight(стража, {}) - GUARD_SIGHT) < 1e-9,
      'без скрытности обзор изменился - чистое обнаружение должно остаться прежним'
    );
  });

  it('вблизи страж замечает и присевшего - приседание не делает невидимым', () => {
    // Иначе страж был бы слеп в упор. Радиус 10 у присевшего: стоим в 5.
    const вплотную = { x: стража.x + 5, z: стража.z };
    must(
      spottedBy(вплотную, [стража], { crouch: true }) !== null,
      'страж не видит присевшего в 5 единицах: приседание сделало его слепым'
    );
  });
});

describe('Скрытность: погода берёт готовое число, а не выдуманное', () => {
  it('visibilityMod действительно читается и сокращает обзор', () => {
    for (const погода of Object.keys(WEATHER_EFFECTS) as (keyof typeof WEATHER_EFFECTS)[]) {
      const м = WEATHER_EFFECTS[погода].visibilityMod;
      must(typeof м === 'number' && м > 0, `у погоды ${погода} visibilityMod = ${String(м)}`);
      // Обзор в песчаную бурю должен стать заметно короче обычного.
      const обзор = effectiveSight(GUARD_POSTS[0], { visibility: м });
      must(обзор > 0, `при погоде ${погода} обзор стал нулевым - стражи слепнут полностью`);
      must(
        обзор <= GUARD_SIGHT,
        `при погоде ${погода} обзор ${обзор} больше обычного ${GUARD_SIGHT}`
      );
    }
  });

  it('песчаная буря сокращает обзор до трети, как в справочнике', () => {
    // Число 0.3 - из WEATHER_EFFECTS, а не выбрано здесь.
    const м = WEATHER_EFFECTS.sandstorm.visibilityMod;
    must(Math.abs(м - 0.3) < 1e-9, `в справочнике песчаная буря даёт ${м}, а проверка ждёт 0.3`);
    const обзор = effectiveSight(GUARD_POSTS[0], { visibility: м });
    must(
      Math.abs(обзор - GUARD_SIGHT * 0.3) < 1e-9,
      `в песчаную бурю обзор ${обзор}, а должен быть ${GUARD_SIGHT * 0.3}`
    );
  });

  it('множители перемножаются: приседание в ночь в дождь - самый короткий обзор', () => {
    const стоит = effectiveSight(GUARD_POSTS[0], {});
    const приселНочью = effectiveSight(GUARD_POSTS[0], { crouch: true, night: 1 });
    must(приселНочью < стоит, 'приседание ночью не хуже, чем стоя днём');
  });
});

describe('Скрытность: ночь считается той же формулой, что и на клиенте', () => {
  it('nightFactor совпадает с формулой в клиенте', () => {
    // Две копии одного правила однажды разъехались - так были потеряны
    // координаты дверей. Здесь функция сверяется со строкой в клиенте.
    const world = читать('client/src/app/world.ts');
    const строка = /night\s*=\s*(tod\s*===[^\n]+)/.exec(world);
    must(строка !== null, 'в клиенте не найдена строка расчёта night');

    const код = строка![1];
    // Разбираем именно форму клиента: night/midnight -> 1, evening/dawn -> 0.5.
    must(
      код.includes("'night'") && код.includes("'midnight'") && код.includes('? 1'),
      'в клиенте ночь перестала давать 1 - правила разошлись'
    );
    must(
      код.includes("'evening'") && код.includes("'dawn'") && код.includes('? 0.5'),
      'в клиенте сумерки перестали давать 0.5 - правила разошлись'
    );

    // И значения функции совпадают с формулой, а не просто существуют.
    must(Number(nightFactor('night')) === 1, 'nightFactor(night) должен давать 1');
    must(Number(nightFactor('midnight')) === 1, 'nightFactor(midnight) должен давать 1');
    must(Number(nightFactor('evening')) === 0.5, 'nightFactor(evening) должен давать 0.5');
    must(Number(nightFactor('dawn')) === 0.5, 'nightFactor(dawn) должен давать 0.5');
    must(Number(nightFactor('noon')) === 0, 'в полдень ночи быть не должно');
  });
});

describe('Скрытность: она действительно подключена с обеих сторон', () => {
  it('клиент отправляет приседание, сервер его принимает и применяет', () => {
    const world = читать('client/src/app/world.ts');
    const socket = читать('server/src/socket/GameSocketHandler.ts');
    must(world.length > 1000 && socket.length > 1000, 'файлы не прочитаны');

    // 1. Клиент кладёт crouch в пакет движения.
    must(
      // Порог 1200, а не 600: между emit и полем crouch лежит комментарий на
    // 658 символов, и при 600 проверка искала мимо живого кода - то есть
    // сам проверяющий инструмент врал, а не код. Порог взят с запасом, но
    // он не бесконечный: если crouch уехало бы совсем в другой пакет, поля
    // всё равно не оказалось бы внутри player:move.
    /socket\.emit\('player:move'[\s\S]{0,1200}?crouch:/.test(world),
      'клиент не отправляет crouch в player:move: сервер не узнает о приседании'
    );
    // 2. Значение берётся из движка, а не выдумывается на месте.
    must(
      /crouch:\s*world3d\?\.crouching/.test(world),
      'клиент шлёт не то состояние, что показывает анимация'
    );
    // 3. Движок действительно отдаёт приседание наружу.
    const world3d = читать('client/src/app/game3d/world3d.ts');
    must(
      /get crouching\(\)\s*\{\s*return this\.crouch;/.test(world3d),
      'в world3d нет геттера crouching: клиент не сможет сообщить о приседании'
    );
    // 4. Тип пакета на сервере содержит поле.
    must(
      /crouch\?:\s*boolean/.test(socket),
      'в типе пакета player:move нет crouch: сервер его не прочитает'
    );
    // 5. Сервер читает поле и передаёт его в правило.
    must(
      /crouch:\s*data\.crouch\s*===\s*true/.test(socket),
      'сервер не читает crouch из пакета в правило скрытности'
    );
    must(
      /visibility:\s*WEATHER_EFFECTS\[/.test(socket),
      'сервер не передаёт погоду в правило: песчаная буря не скрывает'
    );
    must(/night:\s*nightFactor\(/.test(socket), 'сервер не передаёт ночь в правило');
  });

  it('шаг 1 не сломан: без скрытности всё считается как раньше', () => {
    // Если бы контекст влиял на чистое обнаружение, шаг 1 тихо изменился бы:
    // страж перестал бы замечать стоящего игрока.
    const стража = GUARD_POSTS[0];
    must(
      spottedBy({ x: стража.x + 19, z: стража.z }, [стража]) !== null,
      'шаг 1 перестал работать: на 19 единицах стоящий не замечен'
    );
    must(
      spottedBy({ x: стража.x + 21, z: стража.z }, [стража]) === null,
      'обзор без скрытности расползся'
    );
    must(Number(concealment()) === 1, 'пустой контекст должен давать единицу, а не иное число');
  });

  it('заявление проверки погоды перестало быть ложным', () => {
    // weatherEffects.test.ts утверждал в заголовке, что visibilityMod не
    // читается никем. После шага 2 это неправда, и оставлять ложь в
    // заголовке проверки нельзя: следующий человек поверит комментарию.
    const текст = читать('server/src/tests/weatherEffects.test.ts');
    const шапка = текст.slice(0, 1200);
    if (/visibilityMod[\s\S]{0,200}?НЕ ОДИН не\s*\n?\s*читался/.test(шапка)) {
      must(
        false,
        'в заголовке weatherEffects.test.ts по-прежнему написано, что visibilityMod ' +
          'никем не читается, а теперь его читает правило скрытности. Заголовок - ложь.'
      );
    }
  });
});