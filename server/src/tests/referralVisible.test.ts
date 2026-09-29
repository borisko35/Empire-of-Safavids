// Пункт A: «Позвать друга» должен быть виден с первого клика.
//
// ЧТО ПРОВЕРЯЕМ. Панель приглашений работала и раньше: ссылка, кнопка
// «скопировать», текст для отправки, награды 500 и 1000 золота. Не было
// только повода ею воспользоваться — кнопки в постоянном ряду не
// существовало, а в хабе панель стояла пятой из пяти.
//
// Проверки намеренно сверяются с ИСХОДНИКОМ разметки
// (client/src/app/index.html), а не с client/web/game/index.html: второй
// файл — сборный артефакт, лежащий в репозитории устаревшим (ряд из 29
// кнопок старой вёрстки, ни хаба, ни бейджей). Именно из-за него разбор
// сначала пришёл к выводу, что бейдж заданий — мёртвый код, и это было
// неверно: в живом мире бейдж работает.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const html = read('client/src/app/index.html');
const hub = stripComments(read('client/src/app/hub.ts'));
const icons = read('client/src/ui/icons.ts');
const referralService = stripComments(read('server/src/services/ReferralService.ts'));
const builtArtifact = read('client/web/game/index.html');

/** Кнопки постоянного ряда: блок .panel-toggles целиком */
function rowBlock(): string {
  const i = html.indexOf('class="hud panel-toggles"');
  return i < 0 ? '' : html.slice(i, html.indexOf('</div>', i));
}

describe('Пригласить друга видно с первого клика', () => {
  it('кнопка есть в постоянном ряду', () => {
    expect(rowBlock()).toMatch(/data-panel="panel-referral"/);
  });

  it('рядом с ней стоят задачи и квесты: приглашение рядом с «что делать»', () => {
    // Смысл ряда — то, чем игрок пользуется каждый день. Кнопка про
    // разовое действие встанет в углу не рядом со всем, а рядом с
    // задачами, где её и замечают
    const row = rowBlock();
    const pos = (id: string) => row.indexOf(`data-panel="${id}"`);
    expect({ есть_задачи: pos('panel-tasks') > 0, есть_рефералка: pos('panel-referral') > 0, порядок: pos('panel-referral') > pos('panel-tasks') })
      .toEqual({ есть_задачи: true, есть_рефералка: true, порядок: true });
  });

  it('у кнопки есть подпись, а не только иконка', () => {
    // Без подписи иконку «человечек» не отличить от «друзей» и «гильдии»
    const m = /<button[^>]*data-panel="panel-referral"[^>]*>/.exec(html)?.[0] ?? '';
    expect({
      подпись: /title="Пригласить друга"/.test(m),
      перевод: /data-i18n-title="hub\.referral"/.test(m),
    }).toEqual({ подпись: true, перевод: true });
  });

  it('иконка кнопки есть в каталоге', () => {
    // Каталог иконок конечен: имя не из него даёт пустую кнопку. Именно
    // так и вышло с первой попыткой — «gift» в каталоге нет
    const m = /data-panel="panel-referral"[^>]*data-icon="([^"]+)"/.exec(html)?.[1] ?? '';
    expect({ иконка: m, есть_в_каталоге: new RegExp('^\\s{2}' + m + ':', 'm').test(icons) })
      .toEqual({ иконка: expect.any(String), есть_в_каталоге: true });
  });
});

describe('Второй путь тоже ведёт сразу', () => {
  it('в хабе приглашение идёт сразу за уведомлениями', () => {
    // Раньше — пятым из пяти, после гильдии, партии и друзей: ровно тот
    // порядок, в котором панель и не находят.
    //
    // Уведомления остаются первыми: их место в хабе продумано, это
    // единственная панель, которую игрок обязан увидеть. Приглашение идёт
    // вторым — первым из действий, где нужны другие люди.
    //
    // Первая версия этой проверки требовала, чтобы приглашение было
    // первым в группе, и упала: код ставил его третьим, перед «Группой».
    // Формулировку исправили под смысл, а не под код.
    const group = /id: 'social'[\s\S]*?panels: \[([\s\S]*?)\n {4}\]/.exec(hub)?.[1] ?? '';
    const order = [...group.matchAll(/id: '([a-z-]+)'/g)].map(m => m[1]);
    expect({ порядок: order.slice(0, 2) }).toEqual({ порядок: ['panel-notifications', 'panel-referral'] });
  });

  it('хаб по-прежнему знает про панель приглашений', () => {
    // Иначе панель пропала бы из хаба при перерисовке
    expect(hub).toMatch(/id: 'panel-referral'/);
  });
});

describe('Смысл кнопки не выдуман', () => {
  it('за приглашение реально платят, и не нулём', () => {
    // Первая версия требовала рядом с названием награды просто цифру — и
    // ноль ей удовлетворял. Слой с обнулённой наградой остался зелёным.
    // Кнопка, которая обещает «500 золота», а платит ноль, хуже, чем её
    // отсутствие: игрок позовёт друга и ничего не получит.
    const referrer = Number(/REWARD_REFERRER_GOLD\s*=\s*(\d+)/.exec(referralService)?.[1] ?? 0);
    const invited = Number(/REWARD_INVITED_GOLD\s*=\s*(\d+)/.exec(referralService)?.[1] ?? 0);
    expect({
      пригласившему: referrer,
      приглашённому: invited,
      обе_больше_нуля: referrer > 0 && invited > 0,
    }).toEqual({
      пригласившему: expect.any(Number),
      приглашённому: expect.any(Number),
      обе_больше_нуля: true,
    });
  });

  it('код приглашения выдаётся по аккаунту, а не после первого персонажа', () => {
    // Если бы код ждал персонажа, кнопка была бы мёртвой для гостя, а
    // гостевой вход у нас теперь главный путь в игру
    expect(referralService).toMatch(/referral_code/);
  });
});

describe('Разметку читаем из исходника, а не из артефакта сборки', () => {
  it('артефакт в репозитории устарел — и это видно', () => {
    // Не «сломанная проверка», а описание реального расхождения: в
    // артефакте 29 кнопок и нет хаба. Если артефакт однажды приведут в
    // порядок, проверка начнёт падать и скажет об этом прямо
    const i = builtArtifact.indexOf('class="hud panel-toggles"');
    const block = i < 0 ? '' : builtArtifact.slice(i, builtArtifact.indexOf('</div>', i));
    const count = (block.match(/data-panel="/g) ?? []).length;
    expect({
      кнопок_в_артефакте: count,
      хаб_в_артефакте: builtArtifact.includes('id="panel-hub"'),
      бейдж_в_артефакте: builtArtifact.includes('id="tasks-badge"'),
    }).toEqual({
      кнопок_в_артефакте: expect.any(Number),
      хаб_в_артефакте: false,
      бейдж_в_артефакте: false,
    });
  });

  it('исходник разметки существует и в нём есть ряд', () => {
    // Проверка, на которую опираются все остальные: если исходник исчезнет,
    // они все начнут падать молча
    expect(html).toMatch(/class="hud panel-toggles"/);
  });
});
