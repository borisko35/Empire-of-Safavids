// Фоновая музыка лежит в публичном репозитории и отдаётся игрокам по прямому
// адресу, поэтому у неё есть документ происхождения — `Sounds and music/
// CREDITS.md` — и вот этот сторож.
//
// ЗАЧЕМ. Ровно так уже было: в игре годами играла дорожка Zvukogram с чужим
// копирайтом, и заметили это не при выкатке, а при разборе лицензий папки.
// Проверка «файл на месте» такое не ловит — файл был на месте, играл и
// работал. Ловится это только сверкой содержимого с документом: хеш файла
// записан в CREDITS.md, и разойтись они молча не могут.
//
// ЕСЛИ МУЗЫКУ МЕНЯЮТ осознанно — на другой свободный трек, — придётся
// обновить три места: сам файл, раздел в CREDITS.md и хеш с числом байт
// здесь. Это и есть цель: замена чужого трека обратно не пройдёт «тихо».
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const файл = join(корень, 'client', 'src', 'app', 'public', 'sounds', 'ambient_music.mp3');
const кредиты = readFileSync(join(корень, 'Sounds and music', 'CREDITS.md'), 'utf-8');

// CC0 1.0, RandomMind «Medieval: Market Day», зацикленная версия
// (`Loop_Market_Day.mp3` с OpenGameArt), переименована в ambient_music.mp3
// 20 октября 2026 — на замену дорожке Zvukogram.
const хеш = 'e0a3a42ce9074be1ea3188ca5004712f';
const байт = 2596640;

describe('фоновая музыка: файл и документ происхождения', () => {
  it('отгружается тот самый CC0-файл', () => {
    const данные = readFileSync(файл);
    expect({
      байт: данные.length,
      md5: createHash('md5').update(данные).digest('hex'),
    }).toEqual({ байт, md5: хеш });
  });

  it('документ называет этот же файл и его лицензию', () => {
    // Хеш в CREDITS.md — не украшение: он сверяется с файлом на диске.
    expect(кредиты.toUpperCase()).toContain(хеш.toUpperCase());
    expect(кредиты).toContain('opengameart.org/content/medieval-market-day');
    // CC0 — единственная лицензия, при которой файл можно держать в публичном
    // репозитории без обязательной подписи. Если в документе появится CC-BY,
    // это не поломка сама по себе, но повод перечитать раздел, а не «пройти».
    expect(кредиты).toMatch(/CC0/);
  });

  it('чужой копирайт в игру не вернулся', () => {
    const данные = readFileSync(файл);
    // mp3 хранит ID3-теги текстом: у дорожек Zvukogram там стояли
    // `TPE1: Zvukogram.com` и `TCOP: © 2024 Zvukogram.com`. Такой файл
    // отличим от свободного без прослушивания и без внешних сервисов.
    const теги = данные.subarray(0, 8192).toString('latin1').toLowerCase();
    expect(теги).not.toContain('zvukogram');
  });
});
