// Пошаговая инструкция по публикации. Собирается из того, что уже проверено,
// и из того, что владелец доделает руками.
'use strict';
const fs = require('fs');
const R = 'D:/My Projects/Empire of Sefevids/';
function must(c, m) { if (!c) { console.log('ПРОВАЛ ЯКОРЯ: ' + m); process.exit(1); } }

const имя = process.argv[2];
if (!имя) {
  console.log('Передайте имя пользователя itch.io, например:');
  console.log('  node tools/build-publish-instructions.js vasheyazy');
  process.exit(1);
}
if (!/^[a-zA-Z0-9_-]{2,30}$/.test(имя)) {
  console.log('ПРОВАЛ ЯКОРЯ: имя itch.io выглядит неверно: ' + имя);
  process.exit(1);
}

const ИГРА = 'empire-of-safavids';
const витрина = `https://${имя}.itch.io/${ИГРА}`;

const текст = `# Публикация: ${ИГРА}

Сгенерировано: \`node tools/build-publish-instructions.js ${имя}\`

Всё, что нужно загрузить, уже собрано и проверено. От вас — только
нажать кнопки и вставить тексты.

---

## Шаг 1. Собрать архив (один раз)

\`\`\`bash
node tools/build-itch-bundle.js
\`\`\`

Должно напечатать \`RESULT: PASS\`. Архив: \`tools/itch-bundle.zip\`
(около 2 МБ, 9 файлов, 2.1 МБ распакованного — вчетверо меньше
предела itch.io в 500 МБ).

## Шаг 2. Создать страницу на itch.io

1. Открыть https://itch.io/game/new
2. **Kind Of Game** → **HTML Game**
3. **Title** → \`Empire of Safavids\`
4. **Short description** (до 200 знаков) →
   \`Free browser action MMORPG set in Safavid Persia, 1501-1736. No install.\`
5. **Classification** → ближайшее **Action**
6. **Tags** → добавить:
   \`mmorpg\` \`browser-game\` \`multiplayer\` \`free\` \`persia\` \`historical\` \`pvp\`
7. **Release status** → **In development** или **Ongoing**
8. **Pricing** → **No monetization** / donations
9. Сохранить. Загрузить \`tools/itch-bundle.zip\` в поле загрузки файла.
10. Дождаться: itch.io «take a moment to process the archive».

## Шаг 3. Настройка встраивания (Embed options)

Рекомендую **Click to launch in fullscreen**: размеры задавать не нужно,
а страница наша адаптивная — ширина ограничена 1280 и растёт сама.

- **Click to Play** — оставить включённым (по умолчанию).
- **Scrollbars** — выключить.
- **Mobile Friendly** — **не включать**. Игра в телефоне не проверялась, а
  itch.io покажет предупреждение, что может не работать. Лучше без него.

## Шаг 4. Описание страницы

Вставить три блока. Текст короткий намеренно: на itch.io длинные
описания не читают.

### Основной блок

\`\`\`
**Empire of Safavids** — бесплатная Action MMORPG по мотивам Сефевидской
империи, прямо в браузере. Ничего устанавливать не нужно.

1501–1736: семь регионов Персии, пять классов, PvP, торговые контракты,
гильдии, подземелья и мировые боссы. Бой на ловкость, а не на характеристики.

Игра на русском, английском и азербайджанском.

▶️ **Играть:** https://www.game.eos-gameonline.com/
▶️ **Сайт и форум:** https://www.game.eos-gameonline.com/
\`\`\`

### Картинки — обязательно

У HTML5-игр itch.io прячет колонку со скриншотами, поэтому картинки
встраиваются в описание. Без этого витрина будет пустой.

\`\`\`
![Город](https://www.game.eos-gameonline.com/assets/screenshots/city.png)
![Бой](https://www.game.eos-gameonline.com/assets/screenshots/combat.png)
![Задания](https://www.game.eos-gameonline.com/assets/screenshots/tasks.png)
![Карта мира](https://www.game.eos-gameonline.com/assets/screenshots/worldmap.png)
\`\`\`

### Проект

\`\`\`
## Управление

- **WASD** — движение
- **Мышь** — поворот и прицел
- **ЛКМ / ПКМ** — атака и блок
- **1–5** — умения
- **Пробел** — прыжок
- **Tab** — инвентарь
- **M** — карта мира
- **H** — панель хаба: задачи, достижения, гильдия, почта, лидерборд

## Что внутри

- 7 регионов Персии в одном непрерывном мире
- 5 классов, PvP, подземелья и мировые боссы
- Гильдии: ранги, навыки, задания
- Торговые контракты с таймером
- 2FA по TOTP, вход через гостя и OAuth

## Системные требования

Любой компьютер с браузером, поддерживающим WebGL: Chrome, Firefox,
Edge или Safari, 2019 года и новее. Отдельная установка не нужна.

## Лицензия

Игра — свободное программное обеспечение под
[GNU GPL v3](https://www.game.eos-gameonline.com/LICENSE).
Исходный код: https://github.com/borisko35/Empire-of-Safavids

## Статус

Игра в активной разработке. Что уже есть — видно на сайте, там же
работает форум.
\`\`\`

## Шаг 5. Трейлер (необязательно, но с кнопкой)

Плеер itch.io понимает **только YouTube, Vimeo и SketchFab**. Свой mp4
туда не попадёт.

Вариант А — без заливки: в описании уже есть ссылка на сайт, где
трейлер смотрится. Кнопки «Watch trailer» не будет, и это нормально.

Вариант Б — залить \`tools/trailer-out/trailer-vertical-1080x1920.mp4\`
на YouTube и вставить ссылку в поле «Video URL / Trailer». Появится
плеер и кнопка в списках. Учтите: YouTube показывает рекламу перед
роликом, Vimeo — нет.

## Шаг 6. Внешние ссылки

В разделе Metadata → External links:

- **Homepage** → https://www.game.eos-gameonline.com/
- **Community** → https://www.game.eos-gameonline.com/forum.html
- **Source code** → https://github.com/borisko35/Empire-of-Safavids (репозиторий уже публичный)

## Шаг 7. Проверить, как это выглядит

1. Открыть ${витрина} **в режиме инкогнито**. Площадка сама советует
   проверять именно так — залогиненный автор видит свою страницу иначе.
2. Нажать «Run game». Должен открыться трейлер.
3. Проверить, что кадры показались, а не пустые рамки. Если пусто — в
   консоли браузера будет 403, и это признак либо абсолютного пути
   (у нас их нет, проверка следит), либо несовпадения регистра.
4. Проверить мобильный вид: сузить окно. Страница адаптивная, но
   именно на телефоне не проверялась.

## Шаг 8. Reddit

Пост пишется **один раз**, в один сабреддит. Кросс-постинг в r/webgames
и r/BrowserGaming правилами запрещён, второй пост удалят, аккаунт могут
пометить.

1. Открыть https://www.game.eos-gameonline.com/trailer.html
2. Нажать «Смотреть» и записать экран — **или** отдать прямую ссылку на
   ролик: https://www.game.eos-gameonline.com/assets/trailer.mp4
3. Выбрать **один** сабреддит: r/webgames или r/BrowserGaming
4. Текст поста — из tools/itch-reddit-draft.md, на языке сабреддита
5. Первый комментарий — тот же текст, что под каждым постом в сообществе.
   Без него пост снимут как рекламный.

**Не писать** «тысяч игроков», «самый большой мир», «уникальный» — в
сообществе браузерных MMORPG это проверяют, и проверяют успешно.

---

## Что осталось за вами

Репозиторий открыт — это уже сделано и проверено:
\`https://api.github.com/repos/borisko35/Empire-of-Safavids\` отвечает 200,
\`private: false\`, GitHub сам определил лицензию как GPL-3.0.

Осталось одно:

1. **Пройти шаги 2–7 по порядку.** Загрузить архив, вставить тексты,
   проверить в инкогнито.

## Одно предупреждение про \`deploy/server-setup.sh\`

Скрипт подставляет пароль \`dev-secret-change-me-to-something-secure\`. Это
заготовка для локальной разработки, и на боевом сервере она не
применялась. Но запускать его на сервере нельзя: пароль станет известным
всем. Либо уберите его, либо оставьте предупреждение в самом скрипте.

## Адрес витрины

    ${витрина}
`;

const путь = R + 'tools/publish-instructions.md';
fs.writeFileSync(путь, текст, 'utf8');
const обратно = fs.readFileSync(путь, 'utf8');
must(обратно.includes(витрина), 'adres vitriny ne zapisan');
must(/itch-bundle\.zip/.test(обратно), 'shag s arkhivom propal');
must(/images|assets\/screenshots/.test(обратно), 'shag s kartinkami propal');
console.log('instrukciya: ' + путь.replace(R, ''));
console.log('adres vitriny: ' + витрина);
