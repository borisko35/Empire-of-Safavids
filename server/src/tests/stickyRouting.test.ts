// Sticky-routing: игрок шарда попадает на инстанс-хозяина.
//
// ЗАЧЕМ. Аренда (ShardLease) сама по себе НИЧЕГО не гарантирует: без
// маршрутизации игрок попадёт на случайный инстанс и увидит пустой мир, а
// монстры его шарда будут спокойно жить у соседа. Аренда и маршрутизация
// работают только вдвоём.
//
// Что здесь охраняется:
//   1) в nginx есть карта cookie -> upstream, и covering ВСЕ восемь шардов
//      (пропущенный шард ушёл бы на default, то есть на случайный инстанс);
//   2) nginx РЕАЛЬНО читает cookie в proxy_pass (иначе клиент ставит, а nginx
//      не смотрит);
//   3) клиент ставит cookie после того, как узнал шард;
//   4) резолвер есть — переменная в proxy_pass иначе роняет nginx при старте.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';
import { GAME_SERVERS } from '../../../shared/constants';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const nginx = читать('client/nginx.conf');
const мир = код('client/src/app/world.ts');

describe('Sticky-routing: карта на все шарды', () => {
  it('есть карта cookie -> upstream', () => {
    must(/map \$cookie_eos_shard \$game_backend \{/.test(nginx), 'карты нет');
    must(/default\s+\S+;/.test(nginx), 'в карте нет default: неизвестный шард упадёт');
  });

  it('все восемь шардов перечислены', () => {
    // Пропущенный шард уходит на default, то есть на случайный инстанс.
    const блок = /map \$cookie_eos_shard \$game_backend \{([\s\S]*?)\n\}/.exec(nginx)?.[1];
    must(блок !== undefined, 'тело карты не прочиталось');
    for (const сервер of GAME_SERVERS) {
      must(
        new RegExp(`\\b${сервер.id}\\s+\\S+;`).test(блок!),
        `шара ${сервер.id} нет в карте: он уйдёт на случайный инстанс`,
      );
    }
  });

  it('шары не налезают друг на друга', () => {
    // Одно имя в двух строках — последняя перебьёт первую.
    const блок = /map \$cookie_eos_shard \$game_backend \{([\s\S]*?)\n\}/.exec(nginx)?.[1];
    must(блок !== undefined, 'тело карты не прочиталось');
    const имена = [...блок!.matchAll(/^\s*(\S+)\s+\S+;\s*$/gm)].map((m) => m[1]);
    const повторы = имена.filter((имя, i) => имена.indexOf(имя) !== i);
    expect({ повторы }).toEqual({ повторы: [] });
  });
});

describe('Sticky-routing: nginx читает cookie', () => {
  it('проксирование идёт через карту', () => {
    // Клиент ставит cookie — но если nginx её не читает, routing не работает.
    must(/proxy_pass http:\/\/\$game_backend;/.test(nginx),
      'api/socket.io проксируются на одиночный server:3000: cookie не читается');
  });

  it('есть резолвер — переменная в proxy_pass иначе рушит nginx', () => {
    // Переменная в proxy_pass разрешается на каждый запрос; без resolver
    // nginx падает при старте, если имя неизвестно.
    must(/resolver\s+\S+\s+valid=/.test(nginx), 'резолвера нет');
  });

  it('websocket-апгрейд сохранён', () => {
    // Перенос на карту не должен был потерять Upgrade/Connection.
    must(/proxy_set_header Upgrade \$http_upgrade/.test(nginx), 'потерян Upgrade');
    must(/proxy_set_header Connection "upgrade"/.test(nginx), 'потерян Connection');
  });
});

describe('Sticky-routing: клиент ставит cookie', () => {
  it('cookie пишется после входа в мир', () => {
    must(/setShardCookie\(character\.serverId\)/.test(мир),
      'cookie шарда не ставится: маршрутизации не на что смотреть');
  });

  it('пишется после того, как шард известен', () => {
    // SET до auth означал бы cookie с пустым или прошлым шардом.
    const позицияAuth = мир.indexOf("socket.emit('auth'");
    const позицияCookie = мир.indexOf('setShardCookie(character.serverId)');
    must(позицияAuth > 0 &&позицияCookie > 0, 'auth или cookie не найдены');
    must(позицияCookie > позицияAuth, 'cookie ставится раньше auth: шард ещё не подтверждён');
  });

  it('не падает при запрещённых cookie', () => {
    // Приватный режим. Без try игра молча упала бы на входе в мир.
    must(/catch\s*\{/.test(мир), 'нет обработки запрещённых cookie');
  });

  it('срок жизни — год', () => {
    // Короткий срок возвращал бы игрока на случайный инстанс.
    must(/max-age=31536000/.test(мир), 'срок жизни cookie не год');
  });

  it('secure только на https', () => {
    // На http браузер отвергнет такую cookie вовсе, и routing не заработает.
    must(/location\.protocol === 'https:' \? '; secure' : ''/.test(мир),
      'secure ставится безусловно: на http cookie будет отвергнута');
  });
});