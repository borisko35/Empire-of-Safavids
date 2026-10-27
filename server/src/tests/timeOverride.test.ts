// Ручное время суток из админки (§353) — зеркало weatherOverride.
//
// ЗА ЧТО БОРЕТСЯ. Погоду админка перекрывает давно: кнопку «снег» нажали —
// идёт снег, не дожидаясь 4-минутного слота. А у времени суток кнопки не
// было вовсе: сутки игры идут 24 реальных минуты, и ночная механика
// (горожане по домам §351, ночной патруль §352, ночная скрытность, ночной
// спавн) была непроверяема вживую — ждать ночи ради скриншота или проверки
// значит подстраивать день под тест.
//
// ГЛАВНАЯ ОПАСНОСТЬ. Оверрайд живёт в WorldTimeSystem, а ночь из него
// читают по меньшей мере пять мест: клиентский свет и горожане (пакет
// world:time), nightFactor в скрытности, ночной спавн монстров, speedMod
// — нет, speedMod от погоды, и именно это здесь и проверяется: подмена
// времени суток не имеет права трогать погоду и её множители. Календарь
// тоже обязан остаться настоящим: подмена фазы — не перенос даты.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WorldTimeSystem, worldTimeAt, currentWeather, WEATHER_EFFECTS, GAME_EPOCH_MS,
} from '../systems/WorldTimeSystem';
import { nightFactor } from '../../../shared/stealth';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('Оверрайд времени суток: подменяется фаза, а не мир', () => {
  it('ночь принудительно — в любой момент реального времени', () => {
    // 1 реальная минута = 1 игровой час: час реального времени даёт полдень
    // игры (60 mod 24 = 12). Считаем фазу от мира, а не от своей арифметики.
    const t = GAME_EPOCH_MS + 60 * 60 * 1000;
    const реальная = worldTimeAt(t, null, null).timeOfDay;
    must(реальная === 'noon', `без оверрайда ожидался полдень, пришло ${реальная}: арифметика часов съехала`);
    must(worldTimeAt(t, null, 'night').timeOfDay === 'night', 'оверрайд ночи не применился');
    must(worldTimeAt(t, null, 'midnight').timeOfDay === 'midnight', 'оверрайд полуночи не применился');
    must(worldTimeAt(t, null, 'dawn').timeOfDay === 'dawn', 'оверрайд рассвета не применился');
  });

  it('часы и календарь остаются настоящими', () => {
    const t = GAME_EPOCH_MS + 7 * 60 * 60 * 1000;
    const обычное = worldTimeAt(t);
    const ночное = worldTimeAt(t, null, 'night');
    must(ночное.gameHour === обычное.gameHour, 'часы сдвинулись: подменяется дата, а не фаза');
    must(ночное.gameDay === обычное.gameDay && ночное.gameMonth === обычное.gameMonth, 'календарь сдвинулся');
    must(ночное.season === обычное.season, 'сезон сдвинулся');
  });

  it('погода и её множители оверрайду времени не подчиняются', () => {
    const t = GAME_EPOCH_MS + 60 * 60 * 1000;
    const обычное = worldTimeAt(t);
    const ночное = worldTimeAt(t, null, 'night');
    must(ночное.weather === обычное.weather, 'время суток поменяло погоду');
    must(ночное.speedMod === обычное.speedMod, 'время суток поменяло множитель скорости');
    // И в обратную сторону: ручная погода не трогает фазу.
    const буря = worldTimeAt(t, 'sandstorm');
    must(буря.timeOfDay === обычное.timeOfDay, 'погода поменяла время суток');
    must(буря.speedMod === WEATHER_EFFECTS.sandstorm.speedMod, 'ручная погода потеряла свой speedMod');
    must(currentWeather(t) === обычное.weather, 'currentWeather сдвинулся от оверрайда');
  });

  it('ночь из оверрайда доходит до правила скрытности', () => {
    // Именно nightFactor(время.timeOfDay) читают стражи и ночной патруль.
    const t = GAME_EPOCH_MS + 7 * 60 * 60 * 1000; // утро по часам
    must(nightFactor(worldTimeAt(t).timeOfDay) === 0, 'утро днём не ноль: nightFactor сломан');
    must(nightFactor(worldTimeAt(t, null, 'night').timeOfDay) === 1, 'принудительная ночь не доходит до nightFactor');
  });

  it('система хранит оверрайд и отдаёт его живым вызовом', () => {
    const sys = new WorldTimeSystem();
    sys.setTimeOverride('night');
    const время = sys.getCurrentWorldTime();
    must(время.timeOfDay === 'night', 'getCurrentWorldTime потерял оверрайд времени');
    // Оба оверрайда работают разом: ручная ночь в ручную бурю.
    sys.setWeatherOverride('sandstorm');
    const ночьВБурю = sys.getCurrentWorldTime();
    must(ночьВБурю.timeOfDay === 'night' && ночьВБурю.weather === 'sandstorm', 'оверарайды времени и погоды затирают друг друга');
    must(ночьВБурю.speedMod === WEATHER_EFFECTS.sandstorm.speedMod, 'в буре в ночь speedMod не от погоды');
    sys.setTimeOverride(null);
    must(sys.getCurrentWorldTime().timeOfDay !== 'night', 'снятие оверрайда не вернуло часы');
    sys.setWeatherOverride(null);
  });
});

describe('Проводка: админ-маршрут и кнопки', () => {
  const маршрут = читать('server/src/routes/admin.ts');
  const панели = читать('client/src/app/panels.ts');

  it('маршрут /time валидирует фазы и рассылает сразу', () => {
    must(/TOD_KINDS = \['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'midnight'\]/.test(маршрут),
      'в маршруте /time нет списка фаз: чужая строка пройдёт как время суток');
    must(/setTimeOverride\(raw === 'auto' \? null : \(raw as TimeOfDay\)\)/.test(маршрут),
      'маршрут /time не ставит оверрайд');
    must(/await sys\.broadcastWorldTime\(\)/.test(маршрут.slice(маршрут.indexOf("'/time'"))),
      'маршрут /time не рассылает время сразу: клиенты увидят ночь через слот');
  });

  it('кнопки админки шлют те же фазы, что понимает сервер', () => {
    must(/'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'midnight'/.test(панели),
      'в панели админа нет ряда времени суток');
    must(/api\.adminTime\(tod\)/.test(панели), 'кнопки времени не зовут adminTime');
    must(/worldclock\.\$\{tod\}/.test(панели), 'подписи кнопок времени не из worldclock: свои копии разъедутся с часами');
  });
});
