// Комбо из 5 засчитывается по-настоящему.
//
// ЧТО БЫЛО. Достижение «Мастер Комбо» обещало «комбо из 5 ударов», и
// условия не было. Цепочка ударов считалась в памяти (comboChains) и
// никуда не записывалась.
//
// ПОЧЕМУ ЭТО НЕ СЧЁТЧИК-СУММА. Цепочка - это длина ОДНОЙ серии подряд.
// Сложение дало бы «две серии по три удара = шесть», и «комбо из 5» закрыл
// бы тот, кто прыгал с места на место, но ни разу не ударил пять раз
// подряд. Поэтому запись идёт через GREATEST, а не сложением.
//
// ГЛАВНАЯ ПРОВЕРКА ФАЙЛА - ГРАНИЦА «РОВНО 5». Запись делается в момент
// пересечения порога, то есть ровно на пятом ударе. Шестой удар серии
// записывать уже не нужно, и если бы запись шла на каждом ударе, рекорд
// рос бы вместе с длиной серии, а это уже не «достигнутое достижение», а
// текущая серия.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENTS, isEarned } from '../services/AchievementService';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

describe('Условие «комбо из 5»', () => {
  it('смотрит на combo_best с порогом 5', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_combo_5')!;
    expect({ условие: def.condition }).toEqual({ условие: { counter: 'combo_best', need: 5 } });
  });

  it('четырёх ударов не хватает, пяти хватает', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_combo_5')!;
    expect({
      четыре: isEarned(def, { combo_best: 4 }),
      пять: isEarned(def, { combo_best: 5 }),
    }).toEqual({ четыре: false, пять: true });
  });

  it('описание обещает ровно то, что проверяет условие', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_combo_5')!;
    const цифра = /(\d+)/.exec(def.description ?? '')?.[1];
    expect({ в_описании: Number(цифра), в_условии: (def.condition as { need: number }).need })
      .toEqual({ в_описании: 5, в_условии: 5 });
  });

  it('порог записи и порог условия - одно и то же число', () => {
    // Запись срабатывает при chain.count === COMBO_THRESHOLD, условие ждёт
    // need. Две цифры в двух местах - это ровно то, из-за чего описание
    // перестаёт совпадать с выдачей: запись случится, а условие будет
    // ждать другого числа, и достижение не выдастся НИКОГДА.
    const обработчик = читать('server/src/socket/GameSocketHandler.ts');
    const порогВЗаписи = Number(
      /static readonly COMBO_THRESHOLD = (\d+)/.exec(обработчик)?.[1]);
    const need = (ACHIEVEMENTS.find(a => a.id === 'ach_combo_5')!.condition as { need: number }).need;
    expect({ порог_в_записи: порогВЗаписи, need, совпало: порогВЗаписи === need })
      .toEqual({ порог_в_записи: 5, need: 5, совпало: true });
  });
});

describe('Запись идёт через максимум, а не через сложение', () => {
  it('используется GREATEST, а не сложение', () => {
    // Сложение превратило бы достижение в «соверши 5 ударов, необязательно
    // подряд»: пять отдельных тычков дали бы пять, и условие сошлось бы.
    const lb = читать('server/src/services/LeaderboardService.ts');
    const метод = lb.slice(lb.indexOf('async recordCombo'), lb.indexOf('async increment'));
    expect({
      greatest: /GREATEST\(leaderboard\.combo_best, EXCLUDED\.combo_best\)/.test(метод),
      сложения_нет: !/\+\s*\$2|combo_best = leaderboard\.combo_best \+/.test(метод),
    }).toEqual({ greatest: true, сложения_нет: true });
  });

  it('запись идёт в combo_best, а не в чужую колонку', () => {
    const lb = читать('server/src/services/LeaderboardService.ts');
    const метод = lb.slice(lb.indexOf('async recordCombo'), lb.indexOf('async increment'));
    expect({
      пишет_combo_best: /INSERT INTO leaderboard \(character_id, combo_best/.test(метод),
      чужих_колонок_нет: !/monsters_killed|parries|pvp_wins|poetry_completed/.test(метод),
    }).toEqual({ пишет_combo_best: true, чужих_колонок_нет: true });
  });

  it('нулевая цепочка не пишется', () => {
    // Запись нуля создала бы строку рейтинга ни о чём: у игрока появилось бы
    // достижение-пустышка в общей таблице.
    const lb = читать('server/src/services/LeaderboardService.ts');
    const метод = lb.slice(lb.indexOf('async recordCombo'), lb.indexOf('async increment'));
    expect({ есть_выход: /if \(!chain\) return;/.test(метод) }).toEqual({ есть_выход: true });
  });
});

describe('Запись не утяжеляет каждый удар', () => {
  it('срабатывает ровно на пятом ударе, а не на каждом', () => {
    // comboMultiplier зовётся на каждом ударе. Запись в базу на каждом ударе
    // сделала бы самый горячий путь игры самым тяжёлым.
    const обработчик = читать('server/src/socket/GameSocketHandler.ts');
    expect({
      ровно_на_пороге: /if \(chain\.count === GameSocketHandler\.COMBO_THRESHOLD\)/.test(обработчик),
      не_на_каждом_ударе: !/if \(true\)/.test(обработчик),
    }).toEqual({ ровно_на_пороге: true, не_на_каждом_ударе: true });
  });

  it('ошибка записи не роняет удар', () => {
    // Игрок бьёт. Запись - его достижение. Незаписанное достижение лучше,
    // чем ненанесённый удар.
    const обработчик = читать('server/src/socket/GameSocketHandler.ts');
    const блок = обработчик.slice(
      обработчик.indexOf('if (chain.count === GameSocketHandler.COMBO_THRESHOLD)'),
      обработчик.indexOf('return chain.count % 3'));
    expect({
      не_await: /void this\.leaderboardService/.test(блок),
      ошибка_перехвачена: /\.catch\(err => logger\.error/.test(блок),
    }).toEqual({ не_await: true, ошибка_перехвачена: true });
  });

  it('удары со скиллом и не-атаки цепочку не наращивают', () => {
    // Иначе игрок набивал бы достижение ударами вне боя.
    const обработчик = читать('server/src/socket/GameSocketHandler.ts');
    const метод = обработчик.slice(
      обработчик.indexOf('private comboMultiplier'),
      обработчик.indexOf('private comboMultiplier') + 400);
    expect({ отсекает: /action\.actionType !== 'attack' \|\| action\.skillId/.test(метод) })
      .toEqual({ отсекает: true });
  });
});

describe('Колонка появляется миграцией', () => {
  it('combo_best с ограничением и добавлением существующих', () => {
    const миграция = читать('database/migrations/057_combo_best.sql');
    expect({
      колонка: /ADD COLUMN IF NOT EXISTS combo_best INT NOT NULL DEFAULT 0/.test(миграция),
      потолок: /combo_best >= 0 AND combo_best <= 100/.test(миграция),
    }).toEqual({ колонка: true, потолок: true });
  });
});
