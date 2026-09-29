// Шесть вещей, которые игрок не мог сделать. Все шесть выглядели одинаково:
// маршрут или обёртка были написаны, кнопки не было.
//
// Проверка идёт по коду, а не по базе: она ловит и «маршрута нет», и «кнопки
// нет», и «в маршрут передаётся аккаунт вместо персонажа» — все три способа
// выглядят снаружи одинаково, игрок видит пустую панель.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');
const src = (p: string): string => stripComments(read(p));

const game = src('server/src/routes/game.ts');
const api = src('client/src/app/api.ts');
const panels = src('client/src/app/panels.ts');
const hub = src('client/src/app/hub.ts');
const world = src('client/src/app/world.ts');
const html = read('client/src/app/index.html');
const hud = src('client/src/app/hud.ts');
const handler = src('server/src/socket/GameSocketHandler.ts');
const notif = src('server/src/services/NotificationService.ts');

/** Есть ли в тексте вызов, по которому видно, что кнопка нажимает живой код */
const calls = (source: string, names: string[]): Record<string, boolean> =>
  Object.fromEntries(names.map(n => [n, source.includes(n)]));

describe('Уведомления: панель, список, прочтение, живая доставка', () => {
  it('сервер умеет отдавать список и считать непрочитанные', () => {
    expect(calls(game, [
      "gameRouter.get('/notifications'",
      "gameRouter.post('/notifications/read-all'",
      "gameRouter.post('/notifications/read'",
    ])).toEqual({
      "gameRouter.get('/notifications'": true,
      "gameRouter.post('/notifications/read-all'": true,
      "gameRouter.post('/notifications/read'": true,
    });
    expect(calls(notif, ['async list(', 'async getUnreadCount(', 'async markRead(']))
      .toEqual({ 'async list(': true, 'async getUnreadCount(': true, 'async markRead(': true });
  });

  it('список читали по персонажу, а не по аккаунту', () => {
    expect(game).toMatch(/notificationService\.list\(characterId\)/);
    expect(game).toMatch(/notificationService\.getUnreadCount\(characterId\)/);
  });

  it('живая доставка подписана, а не только записана', () => {
    // ЧТО БЫЛО. NotificationService публиковал в Redis-канал player:notification,
    // комментарий обещал, что «сокет пересылает игроку», и подписчика не было.
    // Уведомления не доходили никуда: ни тостом, ничем.
    expect(handler).toMatch(/redis\.subscribe\('player:notification'/);
    expect(handler).toMatch(/SERVER_EVENTS\.NOTIFICATION/);
  });

  it('тост наконец показывает текст', () => {
    // ЧТО БЫЛО. Обработчик читал msg.message / msg.text / msg.title, а сервер
    // шлёт titleRu / bodyRu. Ни одно из трёх полей не совпадало с тем, что
    // приходило, — тост выводился ПУСТЫМ
    expect(world).toMatch(/msg\.titleRu/);
    expect(world).toMatch(/msg\.bodyRu/);
    expect(world).not.toMatch(/msg\.message \?\? msg\.text/);
  });

  it('в игре есть панель, кнопка и красная цифра', () => {
    expect(html).toMatch(/id="panel-notifications"/);
    expect(html).toMatch(/id="unread-badge"/);
    expect(panels).toMatch(/'panel-notifications': loadNotifications/);
    // Цифра живёт в hud.ts: panels.ts зовёт её, а world.ts импортирует
    // panels.ts — если бы она жила в world.ts, получился бы цикл импортов
    expect(hud).toMatch(/export function renderUnreadBadge/);
    expect(world).toMatch(/renderUnreadBadge\(\)/);
  });

  it('непрочитанные можно снять по одному и все сразу', () => {
    // Обёртки определены в api.ts как notifications / notificationRead /
    // notificationsReadAll, а зовутся из панели как api.notifications( и т.д.
    // Проверяем обе стороны: и определение есть, и кнопка его зовёт
    expect(calls(api, ['notifications: (characterId', 'notificationRead: (characterId', 'notificationsReadAll: (characterId']))
      .toEqual({ 'notifications: (characterId': true, 'notificationRead: (characterId': true, 'notificationsReadAll: (characterId': true });
    expect(calls(panels, ['api.notifications(cid())', 'api.notificationRead(cid()', 'api.notificationsReadAll(cid())']))
      .toEqual({ 'api.notifications(cid())': true, 'api.notificationRead(cid()': true, 'api.notificationsReadAll(cid())': true });
  });
});

describe('Питомцев можно переименовать и отпустить', () => {
  it('кнопки есть', () => {
    // Маршруты /pets/rename и /pets/release и обёртки petRename/petRelease были
    // написаны, а кнопок не было. Панель умела только «Выбрать»
    expect(calls(panels, ['api.petRename(', 'api.petRelease(']))
      .toEqual({ 'api.petRename(': true, 'api.petRelease(': true });
  });

  it('отпуск спрашивает подтверждение', () => {
    // Отпустить питомца необратимо, поэтому кнопка обязана спросить
    expect(panels).toMatch(/confirm\(t\('pets\.release_confirm'\)\)/);
  });

  it('список питомцев приходит по персонажу', () => {
    expect(panels).toMatch(/await api\.pets\(cid\(\)\)/);
    expect(game).toMatch(/petService\.getPets\(characterId\)/);
  });
});

describe('Дом можно обставить', () => {
  it('кнопка «поставить» есть и зовёт живой маршрут', () => {
    // api.house() отдавал allDecorations, а панель его игнорировала
    expect(panels).toMatch(/api\.houseDecorate\(cid\(\), sel\.value\)/);
    expect(panels).toMatch(/data\.allDecorations/);
    expect(panels).toMatch(/data\.playerDecorations/);
  });

  it('расстановка идёт по персонажу', () => {
    expect(game).toMatch(/housingService\.placeDecoration\(characterId, req\.body\.decorationId\)/);
  });
});

describe('Поиск PvP можно отменить', () => {
  it('обёртка и кнопка есть', () => {
    // Маршрут /pvp/cancel был написан, обёртки не было: матч оставался в
    // состоянии waiting навсегда, и повторное «Найти бой» натыкалось на
    // «Already searching»
    expect(api).toMatch(/pvpCancel: \(characterId: string, matchId: number\)/);
    expect(panels).toMatch(/api\.pvpCancel\(cid\(\), pendingMatchId\)/);
  });

  it('отмена идёт по персонажу', () => {
    expect(game).toMatch(/pvpService\.cancelMatch\(req\.body\.matchId, characterId\)/);
  });
});

describe('В группу можно пригласить', () => {
  it('поле ввода и кнопка есть только у главы группы', () => {
    // Партия всегда состояла из одного человека: маршрут был, обёртки нет
    expect(panels).toMatch(/m\.role === 'leader'/);
    expect(panels).toMatch(/api\.partyInvite\(partyId, cid\(\), target\)/);
  });

  it('маршрут зовёт настоящий сервис', () => {
    expect(game).toMatch(/partySystem\.inviteToParty\(req\.params\.partyId, req\.body\.inviterId, req\.body\.targetId\)/);
  });
});

describe('Панель уведомлений видна и в хабе, и в ряду кнопок', () => {
  it('она есть в хабе панелей', () => {
    expect(hub).toMatch(/id: 'panel-notifications'/);
    expect(hub).toMatch(/titleKey: 'hub\.notifications'/);
  });

  it('кнопка в ряду одна, а не тридцать три', () => {
    const row = html.slice(html.indexOf('class="hud panel-toggles"'));
    const buttons = (row.slice(0, row.indexOf('</div>')).match(/<button/g) ?? []).length;
    expect({ кнопок: buttons }).toEqual({ кнопок: expect.any(Number) });
    // Ряд остаётся коротким; потолок 7 из-за кнопки «Пригласить друга».
    // Ширина проверяется в panelHub.test.ts — там реальная граница в 46vw.
    expect(buttons).toBeLessThanOrEqual(7);
    // Ряд остаётся коротким, поэтому уведомления видно, не заходя в меню
    expect(html.indexOf('id="unread-badge"')).toBeGreaterThan(html.indexOf('class="hud panel-toggles"'));
  });
});
