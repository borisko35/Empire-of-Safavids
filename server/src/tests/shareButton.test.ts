// Кнопка «Рассказать другу».
//
// ЗАЧЕМ. Ссылка-приглашение и кнопка копирования в панели были уже давно.
// Но игроку оставалось самому придумать текст, открыть соцсеть и вставить
// адрес. Так никто и не делился: копировать голую ссылку без причины не
// найдётся желающих, и панель приглашений была мёртвой по сути.
//
// Теперь в панели есть готовый текст и кнопки под каждую площадку. Осталось
// нажать одну кнопку — и сообщение уходит со ссылкой, по которой другу
// начислится награда. Это единственный канал продвижения, который не требует
// от разработчика никакого времени: работает сам, пока в игру заходят.
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const panels = stripComments(read('client/src/app/panels.ts'));
const css = stripComments(read('client/src/app/styles.css'));
const locales = ['ru', 'en', 'az'].map(l => ({
  l,
  raw: read(`shared/locales/${l}.json`),
}));

describe('Поделиться: кнопки на месте', () => {
  it('панель приглашений даёт кнопки площадок', () => {
    const i = panels.indexOf('async function loadReferral');
    const body = panels.slice(i, panels.indexOf('function copyText', i));
    // id задаётся в массиве, а класс кнопки собирается по шаблону
    for (const id of ['vk', 'tg', 'wa', 'x']) {
      expect(body).toContain(`id: '${id}'`);
    }
    expect(body).toMatch(/ref-share-btn ref-share-\$\{/);
  });

  it('ссылка приглашения уходит вместе с текстом', () => {
    // Без ссылки кнопка бесползна: человек напишет «поищи такую игру» и
    // никто не найдёт.
    expect(panels).toMatch(/ref-link/);
    expect(panels).toMatch(/share\.php\?url=/);
    expect(panels).toMatch(/t\.me\/share\/url\?url=/);
  });

  it('готовый текст берётся из переводов, а не зашит в код', () => {
    // Зашитый русский текст уехал бы в английскую версию интерфейса
    expect(panels).toMatch(/t\('referral\.share_text'\)/);
    expect(panels).not.toMatch(/Играю в браузерную MMORPG/);
  });

  it('адрес и текст кодируются', () => {
    // Без кодирования кириллица в ссылке ломает её у VK и Telegram
    expect(panels).toMatch(/encodeURIComponent/);
  });

  it('ссылки открываются в новой вкладке безопасно', () => {
    // target без rel="noopener" открытая страница получает доступ к окну
    // игры через window.opener
    expect(panels).toMatch(/rel = 'noopener'/);
  });

  it('есть кнопка «скопировать текст с ссылкой»', () => {
    // Кто-то предпочитает вставить сам, без площадки
    expect(panels).toMatch(/t\('referral\.share_copy'\)/);
    expect(panels).toMatch(/copyText\(shareText\)/);
  });
});

describe('Поделиться: оформление', () => {
  it('кнопки оформлены и не слипаются', () => {
    expect(css).toMatch(/\.ref-share-btn \{/);
    expect(css).toMatch(/\.ref-share-btn:hover/);
  });

  it('ссылка выглядит как кнопка, а не как обычный текст', () => {
    // Без этого ссылки подчёркнуты и про них не видно, что их нажимают
    expect(css).toMatch(/text-decoration: none/);
  });
});

describe('Поделиться: переводы', () => {
  it('все три ключа есть во всех трёх языках', () => {
    for (const { l, raw } of locales) {
      for (const key of ['share_title', 'share_text', 'share_copy']) {
        expect({ l, key, есть: raw.includes(`"${key}"`) })
          .toEqual({ l, key, есть: true });
      }
    }
  });

  it('в готовом тексте есть плейсхолдер ссылки', () => {
    // Текст должен подставлять адрес, а не быть зашитым без него
    for (const { l, raw } of locales) {
      const m = raw.match(/"share_text"\s*:\s*"([^"]*)"/);
      expect({ l, естьПлейсхолдер: !!m && m[1].includes('{link}') })
        .toEqual({ l, естьПлейсхолдер: true });
    }
  });

  it('в русском и азербайджанском тексте нет латиницы вместо букв', () => {
    // Контрольный признак порчи кодировки: русские и азербайджанские буквы
    // не должны выродиться в знаки вопроса
    for (const { l, raw } of locales.filter(x => x.l !== 'en')) {
      const m = raw.match(/"share_title"\s*:\s*"([^"]*)"/);
      expect({ l, порча: !!m && m[1].includes('?') })
        .toEqual({ l, порча: false });
    }
  });
});
