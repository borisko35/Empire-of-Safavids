// Приглашение друзей — самый дешёвый канал привлечения новых игроков.
//
// ГЛАВНЫЙ РИСК ФАЙЛА — накрутка. Если приглашение можно засчитать
// повторно, один человек с двумя аккаунтами накручивает себе золото
// и ломает экономику. Поэтому проверяем именно защиту, а не «красиво
// ли считается».
//
// Также проверяем, что клиент вообще умеет принять код из ссылки и
// приложить его к созданию персонажа: без этого механика существует
// только на бумаге.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

// Сервис подключается к БД в конструкторе, поэтому проверяем его исходник:
// поднимать БД в тестах нельзя, а логика защиты должна быть видна здесь.
const service = read('server/src/services/ReferralService.ts');
const clientReferral = read('client/src/app/referral.ts');
const clientChars = read('client/src/app/screens/chars.ts');
const clientMain = read('client/src/app/main.ts');
const clientApi = read('client/src/app/api.ts');
const clientPanels = read('client/src/app/panels.ts');
const characterService = read('server/src/services/CharacterService.ts');
const characterRoutes = read('server/src/routes/character.ts');
const migration = read('database/migrations/033_referrals.sql');

describe('Приглашения: код выдаётся и читается', () => {
  it('код генерируется из алфавита без похожих символов (0/O, 1/I)', () => {
    // Иначе игрок диктует код по телефону и половина кодов не работает
    expect(service).toMatch(/ALPHABET = '[^']*'/);
    const m = service.match(/ALPHABET = '([^']*)'/);
    expect(m).not.toBeNull();
    const alphabet = m![1];
    expect(alphabet).not.toMatch(/[01OI]/);
    expect(alphabet.length).toBeGreaterThanOrEqual(20);
  });

  it('код ленивый: создаётся при первом обращении, а не миграцией', () => {
    // Если выдать код всем сразу, в базе появится код у тех, кто никогда
    // друзей не звал, — и это лишняя работа на каждом запросе
    expect(service).toMatch(/getOrCreateCode/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS referral_code/);
    expect(migration).not.toMatch(/UPDATE users SET referral_code/);
  });

  it('при коллизии кода генерируется новый, а не возвращается чужой', () => {
    // Восемь букв из 32 алфавита — коллизия маловероятна, но если
    // случится, игрок не должен получить чужой код и красть приглашения
    expect(service).toMatch(/SELECT id FROM users WHERE referral_code = \$1/);
    expect(service).toMatch(/if \(clash\) continue/);
  });

  it('ссылка ведёт на боевой домен, а не на адрес разработки', () => {
    expect(service).toMatch(/\$\{origin\.replace/);
    expect(characterRoutes).toMatch(/process\.env\.CLIENT_ORIGIN/);
  });
});

describe('Приглашения: защита от накрутки', () => {
  it('пригласить самого себя нельзя', () => {
    expect(service).toMatch(/if \(referrer\.id === invitedCharacter\.userId\) return null/);
  });

  it('одного игрока можно пригласить только один раз', () => {
    // Строгая защита — в самой базе: UNIQUE не даст записать вторую строку,
    // даже если два запроса пришли одновременно
    expect(migration).toMatch(/referred_id UUID NOT NULL UNIQUE/);
    expect(service).toMatch(/SELECT id FROM referrals WHERE referred_id = \$1/);
  });

  it('гонка двух запросов не превращается в ошибку', () => {
    // Без try/catch игрок, создающий персонажа, увидел бы 500
    expect(service).toMatch(/catch \{[\s\S]*return null/);
  });

  it('награда начисляется на самый старый персонаж, а не на все', () => {
    // Иначе пять персонажей = пятикратная награда за одного приглашённого
    expect(service).toMatch(/ORDER BY created_at ASC LIMIT 1/);
    expect(service).toMatch(/UPDATE characters SET gold = gold \+ \$1, updated_at = NOW\(\) WHERE id = \$2/);
    // Ровно два начисления: приглашённому и пригласившему
    const credits = service.match(/UPDATE characters SET gold = gold \+/g) ?? [];
    expect(credits.length).toBe(2);
  });

  it('есть потолок на один код', () => {
    // Страховка от «запостил ссылку на форуме»
    expect(service).toMatch(/MAX_INVITES_PER_CODE/);
    expect(service).toMatch(/if \(Number\(count\?\.n \?\? 0\) >= MAX_INVITES_PER_CODE\) return null/);
  });

  it('пригласить нельзя того, у кого нет персонажа', () => {
    // Получить код может только вошедший в игру, но проверка закрывает
    // гонку: персонажа могли удалить между выдачей кода и приглашением
    expect(service).toMatch(/if \(!referrerChar\) return null/);
  });

  it('мусорный код не ломает игру, а просто не засчитывается', () => {
    expect(service).toMatch(/if \(!code\) return null/);
    expect(service).toMatch(/if \(clean\.length !== CODE_LEN\) return null/);
  });
});

describe('Приглашения: засчитываются в правильный момент', () => {
  it('счёт идёт на создании персонажа, а не на регистрации', () => {
    // Золото лежит в characters.gold — на момент регистрации аккаунта
    // персонажа ещё нет, платить некому
    expect(characterService).toMatch(/new ReferralService\(\)\.attribute\(referralCode/);
  });

  it('ошибка начисления не мешает создать персонажа', () => {
    // Приглашение — бонус, а не условие игры. Упавшая выдача золота
    // не должна оставлять игрока без персонажа
    expect(characterService).toMatch(/catch \(err\)[\s\S]*logger\.warn/);
  });

  it('счёт происходит один раз, а не на каждом персонаже', () => {
    // UNIQUE по referred_id в базе — главная гарантия
    expect(migration).toMatch(/referred_id UUID NOT NULL UNIQUE/);
  });

  it('маршрут принимает код, а сервер его проверяет', () => {
    expect(characterRoutes).toMatch(/referralCode: Joi\.string\(\)/);
    expect(characterRoutes).toMatch(/value\.referralCode/);
  });
});

describe('Приглашения: клиент', () => {
  it('код из ссылки забирается при старте игры, до восстановления сессии', () => {
    // Иначе приглашение потеряется у того, кто уже вошёл
    expect(clientMain).toMatch(/captureReferralFromUrl\(\)/);
    const capAt = clientMain.indexOf('captureReferralFromUrl();');
    const sessionAt = clientMain.indexOf('if (session.token)');
    expect(capAt).toBeGreaterThan(-1);
    expect(capAt).toBeLessThan(sessionAt);
  });

  it('код запоминается, а не живёт только в адресе', () => {
    // Игрок может закрыть вкладку и вернуться через неделю
    expect(clientReferral).toMatch(/localStorage\.setItem\(CODE_KEY/);
    expect(clientReferral).toMatch(/localStorage\.getItem\(CODE_KEY/);
  });

  it('код убирается из адреса, иначе игрок зовёт сам себя', () => {
    expect(clientReferral).toMatch(/searchParams\.delete\('ref'\)/);
    expect(clientReferral).toMatch(/history\.replaceState/);
  });

  it('мусорный код в ссылке не ломает страницу и не затирает прежний', () => {
    expect(clientReferral).toMatch(/looksLikeCode\(code\) && !localStorage\.getItem\(CODE_KEY\)/);
  });

  it('код тратится только после успешного создания персонажа', () => {
    // Иначе неудачная попытка съела бы приглашение навсегда
    const after = clientReferral.indexOf('localStorage.removeItem(CODE_KEY)');
    const req = clientReferral.indexOf('await api.createCharacter');
    expect(req).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(req);
  });

  it('создание персонажа идёт через обёртку с приглашением', () => {
    expect(clientChars).toMatch(/createCharacterWithReferral\(name, selectedClass, serverId\)/);
    expect(clientChars).not.toMatch(/api\.createCharacter\(/);
  });

  it('в игре есть панель с кнопкой копирования', () => {
    // Без копирования ссылка есть, но поделиться ею нечем — механика мертва
    expect(clientPanels).toMatch(/panel-referral': loadReferral/);
    expect(clientPanels).toMatch(/navigator\.clipboard\.writeText/);
    // Запасной путь: clipboard требует https и может быть закрыт
    expect(clientPanels).toMatch(/execCommand\('copy'\)/);
  });

  it('клиент забирает статистику приглашений с сервера', () => {
    expect(clientApi).toMatch(/referralInfo: \(\) =>/);
    expect(characterRoutes).toMatch(/characterRouter\.get\('\/referral'/);
  });
});

describe('Приглашения: переводы', () => {
  const keys = [
    'referral.title', 'referral.desc', 'referral.copy', 'referral.copied',
    'referral.copy_failed', 'referral.stats', 'referral.reward',
    'referral.invited_toast', 'referral.unavailable',
  ];
  for (const lang of ['ru', 'en', 'az']) {
    it(`в ${lang} есть все строки приглашения`, () => {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, unknown>;
      for (const k of keys) {
        const val = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], json);
        expect({ key: k, present: !!val }).toEqual({ key: k, present: true });
      }
    });
  }

  it('в тексте про награду есть плейсхолдеры подстановки', () => {
    for (const lang of ['ru', 'en', 'az']) {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, Record<string, string>>;
      expect(json.referral.stats).toContain('{n}');
      expect(json.referral.stats).toContain('{gold}');
    }
  });

  it('суммы награды в тексте совпадают с серверными', () => {
    // Раньше такие цифры расходились: текст обещал одно, сервер платил другое
    const invited = Number(service.match(/REWARD_INVITED_GOLD = (\d+)/)![1]);
    const referrer = Number(service.match(/REWARD_REFERRER_GOLD = (\d+)/)![1]);
    for (const lang of ['ru', 'en', 'az']) {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, Record<string, string>>;
      const reward = json.referral.reward;
      const toast = json.referral.invited_toast;
      expect({ lang, invited: reward.includes(String(invited)) }).toEqual({ lang, invited: true });
      expect({ lang, referrer: reward.includes(String(referrer)) }).toEqual({ lang, referrer: true });
      expect({ lang, invited: toast.includes(String(invited)) }).toEqual({ lang, invited: true });
    }
  });
});
