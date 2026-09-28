// Горожанин с нечисловыми координатами: остаётся в сцене, но его не видно.
//
// КАК ЭТО ВЫГЛЕДИТО ДЛЯ ИГРОКА. Игрок зашёл в город, а там никого: ни
// базарных, ни тех, кто идёт мимо мечети. Площади пустые, реплик не слышно.
// При этом NPC — стражник, торговец, аптекарь — на местах, и написано в коде,
// что горожане создаются, кладутся в сцену и видимы.
//
// ЧТО ПРОИСХОДИТ НА САМОМ ДЕЛЕ. Один кадр портит координаты до NaN — и это
// уже навсегда: и resolveStatic, и pushOutOfStatics возвращают вход как есть,
// а hypot с NaN даёт NaN. Матрица мира горожанина становится NaN, GPU
// выбрасывает каждый такой меш, и при этом горожанин по-прежнему в сцене и
// visible. Он есть, но его не видно — город выглядит мёртвым до перезагрузки.
// Замер на живой игре: все тридцать горожан одновременно с координатами NaN.
//
// ЗДЕСЬ ПРОВЕРЯЕТСЯ настоящая revive из civilians.ts: она вырезается из файла
// и исполняется на подставленном groundHeight. Копия логики в тесте не
// ломалась бы никогда — здесь ломается правка в самом файле.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRunner } from './helpers/extractFn';

const repoRoot = join(__dirname, '..', '..', '..');
const civ = readFileSync(join(repoRoot, 'client/src/app/game3d/civilians.ts'), 'utf-8');

type FakeCitizen = {
  group: { position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void } };
  homeX: number;
  homeZ: number;
  target: { x: number; z: number };
  state: string;
  stateUntil: number;
  stuckFor: number;
  lastDist: number;
  frameStartX: number;
  frameStartZ: number;
};

const HOME_X = 40.73;
const HOME_Z = 45.93;
const GROUND = 0.7;

function makeCitizen(x: number, z: number): FakeCitizen {
  return {
    group: {
      position: {
        x, y: GROUND, z,
        set(nx: number, ny: number, nz: number) { this.x = nx; this.y = ny; this.z = nz; },
      },
    },
    homeX: HOME_X,
    homeZ: HOME_Z,
    target: { x, z },
    state: 'walk',
    stateUntil: 0,
    stuckFor: 3,
    lastDist: NaN,
    frameStartX: x,
    frameStartZ: z,
  };
}

const pos = (c: FakeCitizen): [number, number] => [c.group.position.x, c.group.position.z];

describe('Горожане: нечисловые координаты снимаются тем же кадром', () => {
  const run = buildRunner(civ, ['revive'], { groundHeight: () => GROUND });
  const revive = (c: unknown, now: number): void =>
    (run({} as never).revive as (c: unknown, now: number) => void)(c, now);

  it('исполняется настоящая revive, и она вызвана из кадрового цикла', () => {
    // Функция должна быть в коде и должна вызываться: один без другого —
    // либо мёртвый код, либо дыра, которую тесты не видят
    expect(civ).toMatch(/function revive\(c: Civilian, now: number\): void \{/);
    expect(civ).toMatch(/revive\(c, now\);/);
  });

  it('NaN-позиция возвращается домой, а не остаётся NaN', () => {
    const c = makeCitizen(NaN, NaN);
    revive(c, 123456);
    expect(pos(c)).toEqual([HOME_X, HOME_Z]);
    expect(c.group.position.y).toBe(GROUND);
  });

  it('цель чинится вместе с позицией — иначе ходьба снова её портит', () => {
    const c = makeCitizen(NaN, NaN);
    revive(c, 123456);
    expect(c.target).toEqual({ x: HOME_X, z: HOME_Z });
  });

  it('залипшая ветка ходьбы сбрасывается, а счётчики обнуляются', () => {
    const c = makeCitizen(NaN, NaN);
    revive(c, 123456);
    expect(c.state).toBe('idle');
    expect(c.stateUntil).toBe(123456 + 1000);
    expect(c.stuckFor).toBe(0);
    expect(c.lastDist).toBe(0);
    expect([c.frameStartX, c.frameStartZ]).toEqual([HOME_X, HOME_Z]);
  });

  it('здорового горожанина функция не трогает', () => {
    const c = makeCitizen(12.5, -3.25);
    revive(c, 123456);
    expect(pos(c)).toEqual([12.5, -3.25]);
    expect(c.state).toBe('walk');
    expect(c.stateUntil).toBe(0);
    expect(c.target).toEqual({ x: 12.5, z: -3.25 });
  });

  it('повторный вызов ничего не делает: лечение не сдвигает горожанина дальше', () => {
    const c = makeCitizen(NaN, NaN);
    revive(c, 1000);
    revive(c, 999999);
    expect(pos(c)).toEqual([HOME_X, HOME_Z]);
    // Второй вызов не перезаписал stateUntil — позиция уже конечна
    expect(c.stateUntil).toBe(2000);
  });

  it('частично порченная позиция тоже лечится, а не только обе координаты сразу', () => {
    const c = makeCitizen(17, NaN);
    revive(c, 5000);
    expect(pos(c)).toEqual([HOME_X, HOME_Z]);
  });
});
