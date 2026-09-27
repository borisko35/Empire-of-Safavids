// Привязка аккаунтов.
//
// ГЛАВНЫЙ РИСК ФАЙЛА — ИГРОК ТЕРЯЕТ ДОСТУП К ПЕРСОНАЖУ. Если можно
// отвязать последний способ входа, кнопка «Отвязать Google» превращается
// в «удалить мой аккаунт», и вернуть доступ можно будет только руками
// через базу. Поэтому проверяем именно эту защиту.
//
// Вторая по важности дыра тоже отсюда: в OAuthService.login() вход с
// уже привязанным чужим провайдером молча переключал игрока на чужой
// аккаунт. Теперь это явная ошибка.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const service = read('server/src/services/AccountLinkService.ts');
const routes = read('server/src/routes/auth.ts');
const oauth = read('server/src/services/OAuthService.ts');
const authService = read('server/src/services/AuthService.ts');
const migration = read('database/migrations/034_account_linking.sql');
const client = read('client/src/app/accountLinks.ts');
const clientMain = read('client/src/app/main.ts');
const clientIndex = read('client/src/app/index.html');

describe('Привязка: нельзя потерять доступ к аккаунту', () => {
  it('последний способ входа отвязать нельзя', () => {
    expect(service).toMatch(/if \(info\.total <= 1\)[\s\S]*throw linkError\('last_way_in'/);
  });

  it('сервер заранее говорит, что можно отвязать, а что нет', () => {
    // Клиент не должен решать это сам: иначе правило разъедется с сервером
    expect(service).toMatch(/canDetach: true/);
    expect(service).toMatch(/canDetach: false, lockedReason: 'last_way_in'/);
  });

  it('клиент не рисует кнопку отвязки для последнего способа', () => {
    expect(client).toMatch(/acc\.canDetach/);
    expect(client).toMatch(/last_way_in/);
  });

  it('перед удалением проверяется, что способ реально привязан', () => {
    // Иначе можно было бы слать удаление чего попало
    expect(service).toMatch(/if \(!info\.accounts\.some\(\(a\) => a\.method === provider\)\)/);
  });

  it('пароль отвязать нельзя — его можно сменить', () => {
    expect(service).toMatch(/async unlink\(userId: string, provider: OAuthProvider\)/);
    expect(routes).toMatch(/provider !== 'google' && provider !== 'facebook'/);
  });
});

describe('Привязка: дыра в OAuthService', () => {
  it('вход с чужим привязанным провайдером отвергается, а не переключает аккаунт', () => {
    // ТУТ БЫЛО: игрок вошёл, нажал «Войти через Google», код находил
    // готовую привязку к чужому аккаунту и просто пускал в него.
    // Игрок получал чужой персонаж и не понимал почему.
    expect(oauth).toMatch(/if \(linkedRow && st\.userId && linkedRow\.user_id !== st\.userId\)/);
    expect(oauth).toMatch(/throw this\.oauthError\(\s*'identity_taken'/);
  });

  it('привязка своего провайдера к текущему аккаунту по-прежнему работает', () => {
    // Иначе починим дыру, сломав гостевой вход через Google
    expect(oauth).toMatch(/userId = st\.userId/);
    expect(oauth).toMatch(/INSERT INTO user_identities \(user_id, provider, provider_id\)/);
  });

  it('state по-прежнему одноразовый', () => {
    // Иначе перехваченный state можно использовать для привязки дважды
    expect(oauth).toMatch(/consumeState/);
    expect(oauth).toMatch(/await this\.redis\.del\(key\)/);
  });
});

describe('Привязка: вход по почте требует и почту, и пароль', () => {
  it('почта запрашивается вместе с паролем', () => {
    // У аккаунта Google служебная почта google_…@oauth.invalid, её никто
    // не введёт. Пароль без почты был бы мёртвым: вход идёт по email.
    expect(service).toMatch(/async addEmailLogin\(userId: string, email: string, password: string\)/);
    expect(routes).toMatch(/const \{ email, password \} = req\.body/);
  });

  it('вход действительно идёт по почте — это проверяет сама схема', () => {
    expect(authService).toMatch(/FROM users WHERE email = \$1/);
  });

  it('почта занята другим аккаунтом — отказ', () => {
    // Иначе игрок введёт чужую почту и попадёт не в тот аккаунт
    expect(service).toMatch(/SELECT id FROM users WHERE email = \$1/);
    expect(service).toMatch(/throw linkError\('email_taken'/);
  });

  it('уже существующий пароль через этот маршрут не меняется', () => {
    // Иначе любой с украденным токеном захватил бы аккаунт сменой пароля
    expect(service).toMatch(/if \(user\.has_password\)[\s\S]*throw linkError\('password_already_set'/);
  });

  it('пароль короче 8 символов не принимается', () => {
    expect(service).toMatch(/password\.length < 8/);
  });
});

describe('Привязка: признак «пароль есть»', () => {
  it('признак в базе есть, а не угадывается по хешу', () => {
    // У гостя в password_hash лежит случайный хеш — по нему не отличить
    // гостя от игрока с настоящим паролем
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS has_password BOOLEAN/);
  });

  it('существующие аккаунты с паролем получили признак при миграции', () => {
    // Иначе после выкатки игроки, зарегистрированные по почте, увидели бы
    // «добавьте пароль» вместо своего пароля
    expect(migration).toMatch(/SET has_password = TRUE/);
    expect(migration).toMatch(/email NOT LIKE '%@oauth\.invalid'/);
    expect(migration).toMatch(/email NOT LIKE '%@guest\.invalid'/);
  });

  it('пароль ставится в каждом месте, где он настоящий', () => {
    // Регистрация — INSERT с признаком сразу
    expect(authService).toMatch(/INSERT INTO users \(id, username, email, password_hash, has_password,/);
    // Сохранение гостя и сброс пароля — UPDATE
    const updates = authService.match(/has_password = TRUE/g) ?? [];
    expect(updates.length).toBeGreaterThanOrEqual(2);
    // Вставка гостя пароль НЕ настоящий: признак остаётся FALSE
    const guestInsert = authService.match(/INSERT INTO users \(id, username, email, password_hash, is_guest/);
    expect(guestInsert).not.toBeNull();
    const guestHasFlag = authService.match(
      /INSERT INTO users \(id, username, email, password_hash, is_guest[^)]*\)[\s\S]{0,60}?has_password/,
    );
    expect(guestHasFlag).toBeNull();
  });
});

describe('Привязка: клиент', () => {
  it('панель в настройках подгружается при открытии', () => {
    // В момент входа в игру привязок могло ещё не быть
    expect(clientIndex).toMatch(/id="link-accounts"/);
    expect(clientIndex).toMatch(/id="link-add"/);
    expect(read('client/src/app/world.ts')).toMatch(/void loadAccountLinks\(\)/);
  });

  it('ошибка привязки не выбрасывает игрока на экран входа', () => {
    // Игрок привязывал, уже вошёл. Выбрасывание в экран входа пугает
    // и выглядит как «меня выкинули из игры»
    expect(clientMain).toMatch(/eos_oauth_linking/);
    expect(clientMain).toMatch(/if \(wasLinking && session\.token\)/);
    expect(clientMain).toMatch(/identity_taken/);
  });

  it('ошибка привязки показывается игроку, а не проглатывается', () => {
    // Раньше catch был пустым: игрок не понимал, что произошло
    expect(clientMain).toMatch(/toast\(msg, 'error'\)/);
  });

  it('форма запрашивает и почту, и пароль', () => {
    // Поля создаются через createElement, а не в разметке
    expect(client).toMatch(/\.type = 'email'/);
    expect(client).toMatch(/\.type = 'password'/);
  });

  it('серверный код ошибки переводится на язык игрока', () => {
    expect(client).toMatch(/email_taken/);
    expect(client).toMatch(/password_already_set/);
  });
});

describe('Привязка: маршруты защищены авторизацией', () => {
  it('все три маршрута требуют входа', () => {
    // Без авторизации любой мог бы отвязать чужой Google, зная user_id
    for (const route of [
      "authRouter.get('/identities', secureMiddleware",
      "authRouter.post('/identities/email', secureMiddleware",
      "authRouter.post('/identities/:provider/unlink', secureMiddleware",
    ]) {
      expect({ route, present: routes.includes(route) })
        .toEqual({ route, present: true });
    }
  });

  it('добавление почты ограничено по частоте', () => {
    // Иначе можно перебирать чужие почты, чтобы понять, какие заняты
    expect(routes).toMatch(/authRouter\.post\('\/identities\/email', secureMiddleware, authRateLimiter/);
  });
});

describe('Привязка: переводы', () => {
  const keys = [
    'link.title', 'link.hint', 'link.password_note', 'link.unlink', 'link.unlinked',
    'link.unlink_failed', 'link.last_way_in', 'link.add_email', 'link.add_email_btn',
    'link.email_added', 'link.email_taken', 'link.email_invalid',
    'link.password_already_set', 'link.fill_both', 'link.add_failed',
    'link.provider_linked', 'link.provider_failed', 'link.identity_taken', 'link.unavailable',
  ];
  for (const lang of ['ru', 'en', 'az']) {
    it(`в ${lang} есть все строки привязки`, () => {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, unknown>;
      for (const k of keys) {
        const val = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], json);
        expect({ key: k, present: !!val }).toEqual({ key: k, present: true });
      }
    });
  }
});
