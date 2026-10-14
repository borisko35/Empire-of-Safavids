// Приборный прогон ПОИСКА ЦЕЛЕЙ АБОРДАЖА на живой базе, внутри контейнера.
//
// ЗАЧЕМ. Маршрут /boarding/targets вернул пустой список при базе, которая для
// абордажа выглядит верной: обе лодки активны, регион и шард совпадают,
// расстояние 5 метров при пороге 24, разрыв уровней нулевой. Контрольный
// маршрут /api/game/players (тот же набор Redis, тот же роутер) жертву видит,
// а чистый фильтр на тех же числах отвечает «годен» — 1 цель.
//
// Значит пустой список приходит не от фильтра. Остаётся одно место: цикл сбора
// чужих игроков внутри найтиЦелиАбордажа. Какой именно continue там сработал —
// не угадать: и набор Redis, и выборка персонажа, и выборка лодки могут вернуть
// пусто, и все три снаружи выглядят одинаково.
//
// ЭТОТ ИНСТРУМЕНТ ПЕЧАТАЕТ КАЖДЫЙ ШАГ. Ничего не меняет и никого не вводит:
// только читает.
//
// ЗАПУСК (в контейнере сервера, где живут база и Redis):
//   docker cp server/tools/boarding-search-probe.ts <к>: /tmp/
//   docker exec <к> sh -c 'cd /app/server && npx tsx /tmp/boarding-search-probe.ts <атакующий> <жертва>'
//
// ПОЧЕМУ ТЕЛО В async main. Файл лежит вне каталога проекта, и tsx считает его
// CommonJS: верхний await в таком файле не поддерживается, и сборка падает ещё
// до первой строки. Обёртка работает в обоих случаях.
import { RedisService } from '/app/server/src/services/RedisService';
import { CharacterService } from '/app/server/src/services/CharacterService';
import { BoatSystem } from '/app/server/src/systems/BoatSystem';
import { boardTargets } from '/app/server/src/systems/BoardingTargets';
import { BOARD_RANGE } from '/app/server/src/systems/BoardingTypes';
import { найтиЦелиАбордажа } from '/app/server/src/systems/BoardingSearch';
import type { AISystem } from '/app/server/src/systems/AISystem';

async function main(): Promise<void> {
  const атакующийId = process.argv[2];
  const жертваId = process.argv[3];
  if (!атакующийId || !жертваId) {
    console.error('нужны два id: npx tsx boarding-search-probe.ts <атакующий> <жертва>');
    process.exit(2);
  }

  const redis = RedisService.getInstance();
  // Соединение поднимает индекс при старте, а не конструктор. Без него любой
  // приборный прогон читает закрытый клиент и молча видит пустой мир —
  // ровно то, что я сначала принял за поломку сервера.
  await redis.connect().catch(() => {});
  const characters = new CharacterService();
  const boats = new BoatSystem();
  const ai = { getAllInstances: () => [] } as unknown as AISystem;

  const attacker = await characters.getCharacterById(атакующийId);
  console.log('=== 1. атакующий ===');
  console.log('  найден:', Boolean(attacker));
  if (attacker) {
    console.log('  регион:', attacker.region, '| шард:', attacker.serverId, '| уровень:', attacker.level);
    console.log('  позиция:', JSON.stringify(attacker.position));
  }
  const лодка = await boats.getActiveBoat(атакующийId).catch(() => null);
  console.log('  активная лодка:', лодка ? лодка.boatId : 'НЕТ');

  console.log('\n=== 2. набор Redis ===');
  const shard = attacker?.serverId ?? 'isfahan';
  const region = attacker?.region ?? '';
  const вРегионе = await redis.getPlayersInRegion(shard, region).catch((e: Error) => {
    console.log('  ОШИБКА ЧТЕНИЯ:', e.message);
    return [] as string[];
  });
  console.log('  ключ region:players:' + shard + ':' + region);
  console.log('  найдено игроков:', вРегионе.length, JSON.stringify(вРегионе));
  console.log('  жертва в наборе:', вРегионе.includes(жертваId));

  console.log('\n=== 3. выборка персонажа и лодки жертвы ===');
  const чужой = await characters.getCharacterById(жертваId).catch((e: Error) => {
    console.log('  getCharacterById ОШИБКА:', e.message);
    return null;
  });
  console.log('  персонаж жертвы:', Boolean(чужой));
  if (чужой) {
    console.log('  регион:', чужой.region, '| уровень:', чужой.level);
    console.log('  позиция:', JSON.stringify(чужой.position));
  }
  const чужаяЛодка = await boats.getActiveBoat(жертваId).catch((e: Error) => {
    console.log('  getActiveBoat ОШИБКА:', e.message);
    return null;
  });
  console.log('  активная лодка жертвы:', чужаяЛодка ? чужаяЛодка.boatId : 'НЕТ');

  console.log('\n=== 4. сборка списка игроков (как в найтиЦелиАбордажа) ===');
  const игроки = [];
  for (const id of вРегионе) {
    if (id === атакующийId) {
      console.log('  ' + id + ' — это сам атакующий, пропускаем');
      continue;
    }
    const ч = await characters.getCharacterById(id).catch(() => null);
    const л = await boats.getActiveBoat(id).catch(() => null);
    if (!ч || !л) {
      console.log('  ' + id + ' — ОТСЕЧЕН: персонаж=' + Boolean(ч) + ' лодка=' + Boolean(л));
      continue;
    }
    игроки.push({
      id,
      nameRu: ч.name,
      level: ч.level,
      boatId: л.boatId,
      x: ч.position?.x ?? 0,
      z: ч.position?.z ?? 0,
    });
    console.log('  ' + id + ' — принят: ' + ч.name + ' ур.' + ч.level + ' @' + JSON.stringify(ч.position));
  }
  console.log('  игроков в списке:', игроки.length);

  console.log('\n=== 5. фильтр ===');
  if (attacker) {
    const вход = {
      attackerId: атакующийId,
      attackerLevel: attacker.level,
      attackerRegion: attacker.region,
      attackerShard: shard,
      x: attacker.position?.x ?? 0,
      z: attacker.position?.z ?? 0,
      mode: 'pvp' as const,
    };
    console.log('  BOARD_RANGE =', BOARD_RANGE);
    console.log('  целей:', JSON.stringify(boardTargets(ai, вход, игроки, BOARD_RANGE)));
  }

  console.log('\n=== 6. целиком найтиЦелиАбордажа ===');
  if (attacker) {
    const поиск = await найтиЦелиАбордажа({ boats, redis, characters, ai }, attacker, 'pvp');
    console.log('  ok:', поиск.ok, '| code:', поиск.code ?? '(нет)');
    console.log('  целей:', поиск.targets.length, JSON.stringify(поиск.targets));
    console.log('  вход:', JSON.stringify(поиск.вход));
  }
}

void main().then(() => process.exit(0), (e: Error) => {
  console.error('ПРОГОН УПАЛ:', e?.message, e?.stack);
  process.exit(1);
});