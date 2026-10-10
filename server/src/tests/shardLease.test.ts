// Масштабирование, шаг B: аренда шарда.
//
// ЗАЧЕМ. Сейчас `SpawnSystem.activateShard()` кладёт shardId в ЛОКАЛЬНЫЙ
// Set, и при двух инстансах оба активируют каждый шард. Два процесса спавнили
// бы одних и техых монстров: два набора с разными instanceId, объявленных
// всем, но бить можно только своего.
//
// Проверка сторожит: атомарность (Lua, а не «прочитал — удалил»), TTL (шард
// освобождается сам при падении инстанса), продление ТОЛЬКО у владельца
// (иначе два инстанса продлевали бы чужую аренду), и что activateShard
// действительно спрашивает аренду, а не делает вид.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const аренда = код('server/src/systems/ShardLease.ts');
const редис = код('server/src/services/RedisService.ts');
const спавн = код('server/src/systems/SpawnSystem.ts');
const сокет = код('server/src/socket/GameSocketHandler.ts');

describe('Аренда шарда: атомарность', () => {
  it('взятие, продление и снятие идут через Lua', () => {
    // Через GET и потом DEL это гонка: два упавших инстанса прочитали
    // одно «я владелец» и оба удалили — шард ушёл третьему. Lua делает
    // проверку и действие одной операцией на сервере Redis.
    for (const метод of ['acquireIfFree', 'renewIfOwner', 'releaseIfOwner']) {
      must(new RegExp(`async ${метод}\\(`).test(редис), `метода ${метод} нет`);
    }
    evalMentions(редис, 'acquireIfFree');
    evalMentions(редис, 'renewIfOwner');
    evalMentions(редис, 'releaseIfOwner');
  });

  it('TTL задаётся при взятии, а не отдельно', () => {
    // «Взял, но без срока» значит «аренда до перезапуска Redis».
    must(/SETEX/.test(редис), 'SETEX не используется: аренда без срока');
  });
});

function evalMentions(источник: string, метод: string): void {
  const начало = источник.indexOf(`async ${метод}(`);
  must(начало > 0, `тело ${метод} не найдено`);
  const конец = источник.indexOf('\n  }', начало);
  const тело = источник.slice(начало, конец > начало ? конец : начало + 700);
  must(/client\.eval\(/.test(тело), `${метод} не через eval: проверка и действие разно, будет гонка`);
}

describe('Аренда шарда: поведение', () => {
  it('продлевает только владелец', () => {
    // Иначе чужой успешно продлевает и шард остаётся у двоих.
    const кусок = тело(редис, 'renewIfOwner');
    must(/GET', KEYS\[1\]\) == ARGV\[1\]/.test(кусок), 'продление не сверяется с владельцем');
  });

  it('снимает только владелец', () => {
    const кусок = тело(редис, 'releaseIfOwner');
    must(/== ARGV\[1\] then[\s\S]{0,120}DEL/.test(кусок), 'снятие не сверяется с владельцем');
  });

  it('есть heartbeat, и он продлевает', () => {
    must(/startHeartbeat\(/.test(аренда), 'сердцебиения нет: TTL просто истечёт посреди работы');
    must(/renew\(shardId\)/.test(аренда), 'сердцебиение не продлевает аренду');
    must(/setInterval\(/.test(аренда), 'сердцебиение не таймер');
  });

  it('heartbeat частость короче срока', () => {
    // Иначе шард мигает: успевает истечь до продления.
    const срок = /SHARD_LEASE_TTL_SEC = (\d+)/.exec(аренда)?.[1];
    const шаг = /SHARD_HEARTBEAT_EVERY_SEC = (\d+)/.exec(аренда)?.[1];
    must(срок !== undefined && шаг !== undefined, 'константы не прочитались');
    must(Number(шаг) * 3 <= Number(срок), `шаг ${шаг}с при сроке ${срок}с: меньше трёх проб`);
  });
});

function тело(источник: string, метод: string): string {
  const начало = источник.indexOf(`async ${метод}(`);
  const конец = источник.indexOf('\n  }', начало);
  const к = Number(конец);
  return источник.slice(начало, к > начало ? к : начало + 700);
}

describe('Масштабирование: спавн спрашивает аренду', () => {
  it('activateShard принимает аренду', () => {
    must(/async activateShard\(shardId: string, аренда\?: ShardLease\)/.test(спавн),
      'activateShard не принимает аренду: шард активируется безусловно');
  });

  it('не взял — не активировал', () => {
    // Не «взял или нет, всё равно добавим».
    must(/const моя = аренда \? await аренда\.acquire\(shardId\) : true;/.test(спавн),
      'взятие не влияет на активацию');
    must(/if \(!моя\) return false;/.test(спавн), 'отказ аренды не останавливает активацию');
  });

  it('вызов входа передаёт аренду', () => {
    // Самая тихая поломка: метод умеет спрашивать, а вызывающий не спрашивает.
    must(/activateShard\(shardId, this\.аренда\)/.test(сокет), 'вход не передаёт аренду в activateShard');
    must(/private аренда = new ShardLease\(\)/.test(сокет), 'в обработчике сокета нет экземпляра аренды');
  });
});