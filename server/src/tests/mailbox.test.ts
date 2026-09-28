// Почтовый ящик: награды, которые нельзя выдать сразу, не пропадают.
//
// ЧТО БЫЛО. Таблица mailbox создана миграцией 002 и была пуста все годы.
//
// Попутно вскрылась настоящая поломка аукциона: buyListing писал предмет
// прямо в character_items, минуя CharacterService.addItems, — а тот
// проверяет вместимость сумки. То есть покупка обходила лимит слотов, и
// сумка могла переполниться. Игрок платил, а вещь уходила в инвентарь
// сверх лимита, и забрать её уже было нечем.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');
const src = (p: string): string => stripComments(read(p));

const mail = src('server/src/services/MailService.ts');
const game = src('server/src/routes/game.ts');
const auction = src('server/src/services/AuctionService.ts');
const loop = src('server/src/systems/GameLoop.ts');
const api = src('client/src/app/api.ts');
const panels = src('client/src/app/panels.ts');
const hub = src('client/src/app/hub.ts');
const html = read('client/src/app/index.html');

describe('Почта: сервис', () => {
  it('письмо кладётся в таблицу mailbox', () => {
    expect(mail).toMatch(/INSERT INTO mailbox/);
  });

  it('письмо принадлежит персонажу, а не аккаунту', () => {
    // Та самая ошибка повторялась восемь раз: services ищут по character_id,
    // а маршруты передавали req.userId
    expect(mail).toMatch(/WHERE m\.recipient_id = \$1/);
    expect(mail).toMatch(/WHERE id = \$1 AND recipient_id = \$2/);
  });

  it('письмо без награды отправлять можно', () => {
    // Текст без награды — обычное дело («ваш заказ доставлен»). Проверять
    // надо «есть ли что передать вообще», а не «есть ли награда»
    expect(mail).toMatch(/reward: \{ gold\?: number; itemId\?: string; itemQty\?: number \} = \{\}/);
  });

  it('забор удаляет письмо ДО выдачи, а не после', () => {
    // Обратный порядок опасен: если выдача упадёт, письмо уже пропало и
    // награда пропала вместе с ним. Сначала удалить — тогда при сбое
    // письмо останется и попробовать можно будет снова
    const del = mail.indexOf('DELETE FROM mailbox');
    const gold = mail.indexOf('addGold(characterId, gold)');
    expect({ удаление_раньше_выдачи: del > 0 && gold > del }).toEqual({ удаление_раньше_выдачи: true });
  });

  it('просроченные письма убираются', () => {
    // expires_at в схеме есть, но про него никто не помнил: письма копились
    // бы вечно вместе с наградой внутри, и через полгода игрок увидел бы
    // двадцать писем с добычей за события месячной давности
    expect(mail).toMatch(/DELETE FROM mailbox WHERE expires_at < NOW\(\)/);
    expect(loop).toMatch(/purgeExpired\(\)/);
  });
});

describe('Почта: маршруты', () => {
  it('список, забор и прочтение есть', () => {
    expect(game).toMatch(/gameRouter\.get\('\/mail'/);
    expect(game).toMatch(/gameRouter\.post\('\/mail\/claim'/);
    expect(game).toMatch(/gameRouter\.post\('\/mail\/read'/);
  });

  it('все три идут через общий помощник идентификатора', () => {
    for (const call of ['mailService.list(characterId)', 'mailService.unreadCount(characterId)',
      'mailService.claim(req.body.id, characterId)', 'mailService.markRead(req.body.id, characterId)']) {
      expect({ call, есть: game.includes(call) }).toEqual({ call, есть: true });
    }
  });
});

describe('Почта: аукцион не обходит лимит сумки', () => {
  it('вместимость проверяется до вставки предмета', () => {
    // Смысл всего этого изменения. Раньше проверки не было вовсе
    expect(auction).toMatch(/COUNT\(DISTINCT \(item_id, enhancement\)\) AS slots/);
    expect(auction).toMatch(/MAX_INVENTORY_SLOTS/);
  });

  it('предмет такого же типа в сумку влезает всегда', () => {
    // Новый стек занимает слот, а такой же предмет ляжет в существующий.
    // Иначе игрок с полной сумкой не смог бы докупить в стек ничего
    expect(auction).toMatch(/const needsNewSlot = sameStack\.rows\.length === 0/);
    expect(auction).toMatch(/const hasRoom = !needsNewSlot \|\| usedSlots < MAX_INVENTORY_SLOTS/);
  });

  it('не поместилось — письмо, а не выброс', () => {
    expect(auction).toMatch(/INSERT INTO mailbox \(recipient_id, subject, body, item_id, item_qty\)/);
  });

  it('письмо создаётся в той же транзакции, что и списание золота', () => {
    // Иначе покупка прошла бы, а вещь потерялась бы: деньги списаны,
    // предмет ни в сумке, ни в письме
    const tx = auction.indexOf('return this.db.transaction');
    const mailIns = auction.indexOf('INSERT INTO mailbox');
    expect({ письмо_внутри_транзакции: tx > 0 && mailIns > tx }).toEqual({ письмо_внутри_транзакции: true });
  });
});

describe('Почта: панель в игре', () => {
  it('обёртка, панель, разметка и хаб на месте', () => {
    expect(api).toMatch(/mail: \(characterId: string\)/);
    expect(api).toMatch(/mailClaim: \(characterId: string, id: string\)/);
    expect(panels).toMatch(/'panel-mail': loadMail/);
    expect(html).toMatch(/id="panel-mail"/);
    expect(hub).toMatch(/id: 'panel-mail'/);
  });

  it('кнопка «Забрать» зовёт серверный забор', () => {
    expect(panels).toMatch(/api\.mailClaim\(cid\(\), m\.id\)/);
  });

  it('тексты переведены, а не зашиты по-русски', () => {
    // Проверяем только почтовую панель: в panels.ts есть и другой русский
    // текст (панель платежей), он не наш, и трогать его здесь незачем
    const start = panels.indexOf('async function loadMail');
    const own = panels.slice(start, panels.indexOf('async function loadHallOfFame', start));
    expect(own).toMatch(/t\('mail\.claim'\)/);
    expect(own).toMatch(/t\('mail\.empty'\)/);
    expect({ зашитое_русское: /Забрать'|Писем нет/.test(own) }).toEqual({ зашитое_русское: false });
  });
});
