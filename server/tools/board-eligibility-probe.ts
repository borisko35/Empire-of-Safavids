// Приборная проверка ФИЛЬТРА абордажа на живых значениях стенда.
//
// Зачем отдельный инструмент. Пустой список целей при верной базе, верных
// лодках и верных позициях означает, что отсеивает фильтр. Фильтр — чистая
// функция, и её можно прогнать на тех самых числах, что стоят в базе сейчас,
// без базы вообще. Если фильтр на них отвечает «годен», а прод отвечает
// «пусто», значит на проде до фильтра доходит пустой список игроков — и
// искать надо там, а не здесь.
//
// Запуск: из server/ →  npx tsx tools/board-eligibility-probe.ts
import { boardTargets } from '../src/systems/BoardingTargets';
import type { BoardSearchInput } from '../src/systems/BoardingTargets';
import { BOARD_RANGE } from '../src/systems/BoardingTypes';
import type { AISystem } from '../src/systems/AISystem';

// ai нужен только для PvE; в PvP он не читается. Подменяем заглушкой —
// инструмент проверяет фильтр PvP, а не работу ИИ.
const ai = {
  getAllInstances: () => [],
} as unknown as AISystem;

const вход: BoardSearchInput = {
  attackerId: '0426742f-be75-41e3-a928-7c3b3a36432a',
  attackerLevel: 30,
  attackerRegion: 'persian_gulf' as BoardSearchInput['attackerRegion'],
  attackerShard: 'isfahan',
  x: -175,
  z: -567,
  mode: 'pvp',
};

const игроки = [
  {
    id: '7e5812b1-ac87-c103-6e40-1a107656a9c5',
    nameRu: 'EosDummy',
    level: 30,
    boatId: 'boat_rowboat',
    x: -170,
    z: -567,
  },
];

console.log('BOARD_RANGE =', BOARD_RANGE);
console.log('вход  ', JSON.stringify(вход));
console.log('игроки', JSON.stringify(игроки));
console.log('расстояние =', Math.hypot(вход.x - игроки[0].x, вход.z - игроки[0].z));

const цели = boardTargets(ai, вход, игроки, BOARD_RANGE);
console.log('целей:', цели.length);
for (const ц of цели) console.log('  ', JSON.stringify(ц));

// Тот же вход, но режим по умолчанию — PvE. Список игроков при этом НЕ
// запрашивается вовсе, и результат пуст при любых данных. Это ровно то, что
// вернула выкатка при верной базе.
const входPve: BoardSearchInput = { ...вход, mode: 'pve' };
console.log('целей в режиме pve:', boardTargets(ai, входPve, игроки, BOARD_RANGE).length);