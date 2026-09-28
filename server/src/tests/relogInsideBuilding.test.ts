// Переподключение внутри здания = кик и перманентный бан.
//
// ЧТО БЫЛО. World3D.enterBuildingLocalAt был написан ровно для этого: его
// комментарий гласил «без этого первый шаг в комнате упирался в кламп
// границ и давал кик». Метод не вызывался НИ ОДНОГО РАЗА.
//
// Последствия были не «неловко», а необратимы:
//   • комнаты интерьеров лежат за границей мира: комната у тракта около
//     x = 2500, а WORLD_HALF = 1200, и кламп прижимает к 1170;
//   • игрок входит в игру с сохранённой позицией в комнате, клиент видит
//     «я не внутри» и клампит — сервер получает скачок больше тысячи метров;
//   • validateMovement: distance > MAX_TELEPORT_DISTANCE и dt < 0.5 →
//     «Teleport detected», punish(speed_hack) → кик;
//   • recordViolation считает ВСЕ нарушения за 24 часа, и при
//     recentCount >= 5 ставит users.is_banned = TRUE. Перманентно.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const world3d = stripComments(read('client/src/app/game3d/world3d.ts'));
const world = stripComments(read('client/src/app/world.ts'));
const terrain = read('client/src/app/game3d/terrain.ts');
const socketHandler = stripComments(read('server/src/socket/GameSocketHandler.ts'));
const antiCheat = stripComments(read('server/src/systems/AntiCheatSystem.ts'));

const enterWorld = world.slice(world.indexOf('export async function enterWorld'), world.indexOf('export async function enterWorld') + 6000);

describe('Переподключение внутри здания', () => {
  it('enterBuildingLocalAt вызывается при входе в мир', () => {
    // ГЛАВНОЕ. Метод был написан с этой целью, но не звался ни разу
    expect(enterWorld).toMatch(/enterBuildingLocalAt\(me\.pos\.x, me\.pos\.z\)/);
  });

  it('вызов происходит после attach и до первого движения', () => {
    // До attach рига нет, и interiors.enter() не на что повесить
    const at = enterWorld.indexOf('enterBuildingLocalAt');
    expect(enterWorld.indexOf('world3d.attach')).toBeLessThan(at);
  });

  it('комнаты интерьеров действительно за границей мира', () => {
    // Числа, а не слова. Если бы граница подвинулась за 2500, поломка была
    // бы другой, а тест — врущим
    const half = Number(terrain.match(/WORLD_HALF = (\d+)/)?.[1]);
    const rooms = [...read('server/src/data/interiors.ts').matchAll(/(?:roomCx|roomCz):\s*(-?\d+)/g)]
      .map(m => Number(m[1]));
    const beyond = rooms.filter(v => Math.abs(v) > half);
    expect({
      граница_мира: half,
      координат_комнат: rooms.length,
      за_границей: beyond.length,
    }).toEqual({
      граница_мира: half,
      координат_комнат: expect.any(Number),
      // если за границей не оказалось ни одной комнаты, тест бессмыслен
      за_границей: expect.any(Number),
    });
    expect(beyond.length).toBeGreaterThan(0);
  });

  it('кламп границ срабатывает только снаружи — иначе и починка не нужна', () => {
    // Причина поломки именно в этом условии. Если бы граница применялась и
    // внутри комнат, enterBuildingLocalAt ничего бы не чинил
    const clamp = world3d.slice(world3d.indexOf('WORLD_HALF - 30') - 300, world3d.indexOf('WORLD_HALF - 30') + 200);
    expect(clamp).toMatch(/if \(!this\.interiors\.isInside\(\)\)/);
  });
});

describe('Переподключение внутри здания: серверная страховка', () => {
  it('игроку, вошедшему в здании, прощается первый пакет движения', () => {
    // Старый бандл в кэше браузера будет жить ещё неделю, а бан необратим
    expect(socketHandler).toMatch(/insideSpawnGrace\.add\(character\.id\)/);
    expect(socketHandler).toMatch(/this\.insideSpawnGrace\.delete\(characterId\)/);
  });

  it('отсрочка одноразовая, а не постоянная', () => {
    // delete в условии снимает её при первом же пакете. Если бы отсрочка не
    // снималась, игрок получил бы её при каждом входе и она ничего не
    // защищала бы
    expect(socketHandler).toMatch(/legal \|\| this\.insideSpawnGrace\.delete\(characterId\)/);
  });

  it('отсрочка чистится при выходе из игры', () => {
    // Иначе вошедший в здании получил бы её снова при следующем входе
    expect(socketHandler).toMatch(/this\.insideSpawnGrace\.delete\(socket\.characterId\)/);
  });

  it('отсрочку нельзя получить обычным входом на улице', () => {
    // Она ставится только если сохранённая позиция внутри комнаты
    expect(socketHandler).toMatch(/isInsideRoom\(d, character\.position\.x, character\.position\.z\)/);
  });
});

describe('Автобан остаётся, но не за переподключение', () => {
  it('порог автобана не ослаблен', () => {
    // Починка не должна превращаться в отказ от защиты
    expect(antiCheat).toMatch(/AUTO_BAN_VIOLATIONS = 5/);
    expect(antiCheat).toMatch(/recentCount >= AUTO_BAN_VIOLATIONS/);
  });

  it('значение порога то же, что и в тесте античита', () => {
    // Страховка — точечная, а не «ослабил и забыл»
    expect(antiCheat).toMatch(/MAX_TELEPORT_DISTANCE = 20\.0/);
  });
});
