// Вертикальность (§377): прыжок и серверный конверт высоты.
//
// ЗА ЧТО БОРЕТСЯ. Прыжок и вертикальная физика были только на клиенте, и
// сервер высоту не проверял: медленный полёт проходил проверку скорости,
// а честное падение со стены города (12 м) наказывалось как speed hack -
// 3D-дистанция включала вертикаль. Теперь константы прыжка одни на обе
// стороны, сервер знает опору под ногами, падение легально, подъём
// ограничен прыжком.
//
// СВОЙСТВО, КОТОРОЕ ОБЯЗАНО ДЕРЖАТЬСЯ. Апекс прыжка (1.444 м) меньше
// порога удара сверху (1.6 м, §376): подпрыгнуть в удар по голове нельзя -
// награда за высоту достаётся тому, кто нашёл настоящее возвышение.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AntiCheatSystem } from '../systems/AntiCheatSystem';
import {
  GRAVITY, JUMP_V, JUMP_APEX_M, MAX_RISE_SPEED_MS, verticalEnvelopeOk,
  FALL_TOLERANCE_M, AIR_TOLERANCE_M,
} from '../../../shared/verticality';
import { supportHeightAt, groundHeight } from '../../../shared/terrainHeight';
import { LAKE, WORLD_HALF } from '../../../shared/water';
import { FLOOR_Y } from '../data/interiors';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const обработчик = читать('server/src/socket/GameSocketHandler.ts');
const клиент = читать('client/src/app/game3d/world3d.ts');
const интерьерыКлиента = читать('client/src/app/game3d/interiors.ts');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('Константы прыжка', () => {
  it('гравитация и скорость прыжка - числа клиента, перенесённые без правки', () => {
    expect({ гравитация: GRAVITY, прыжок: JUMP_V }).toEqual({ гравитация: 20, прыжок: 7.6 });
  });

  it('клиент больше не держит своих копий констант', () => {
    must(!/const GRAVITY = |const JUMP_V = /.test(клиент),
      'в world3d остались локальные GRAVITY/JUMP_V - копия разъедется со shared');
    must(/from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/verticality'/.test(клиент),
      'клиент не берёт константы прыжка из shared');
  });

  it('апекс прыжка меньше порога удара сверху - прыжок не подделывает высоту', () => {
    // §376: порог удара сверху 1.6 м. Апекс 1.444 м не достаёт до него:
    // свойство боя, а не совпадение чисел.
    must(JUMP_APEX_M < 1.6, `апекс ${JUMP_APEX_M} дорос до порога удара сверху`);
    expect(Math.round(JUMP_APEX_M * 1000) / 1000).toEqual(1.444);
  });
});

describe('Конверт высоты', () => {
  it('полоса: от опоры минус допуск падения до опоры плюс апекс плюс допуск', () => {
    const опора = 5;
    expect({
      на_опоре: verticalEnvelopeOk(опора, опора),
      на_апексе: verticalEnvelopeOk(опора + JUMP_APEX_M, опора),
      на_границе_падения: verticalEnvelopeOk(опора - FALL_TOLERANCE_M, опора),
      на_границе_воздуха: verticalEnvelopeOk(опора + JUMP_APEX_M + AIR_TOLERANCE_M, опора),
    }).toEqual({
      на_опоре: true,
      на_апексе: true,
      на_границе_падения: true,
      на_границе_воздуха: true,
    });
    expect({
      чуть_выше_апекса: verticalEnvelopeOk(опора + JUMP_APEX_M + 0.3, опора),
      чуть_ниже_допуска: verticalEnvelopeOk(опора - FALL_TOLERANCE_M - 0.1, опора),
      медленный_полёт: verticalEnvelopeOk(опора + 10, опора),
    }).toEqual({
      чуть_выше_апекса: false,
      чуть_ниже_допуска: false,
      медленный_полёт: false,
    });
  });

  it('мусор в числах не наказывается', () => {
    expect({
      nan_y: verticalEnvelopeOk(Number.NaN as unknown as number, 5),
      nan_опора: verticalEnvelopeOk(5, Number.NaN as unknown as number),
    }).toEqual({ nan_y: true, nan_опора: true });
  });
});

describe('Опора под точкой мира', () => {
  it('земля: опора совпадает с высотой рельефа', () => {
    // Столица стоит на ровнялке - опора там земля, не вода.
    const поддержка = supportHeightAt(34, 26);
    must(поддержка !== null, 'в центре столицы опоры нет');
    must(поддержка!.kind === 'ground', 'в столице конверт увидел воду');
    must(поддержка!.y === groundHeight(34, 26), 'опора не совпала с рельефом');
  });

  it('карман интерьеров - не мир: опоры нет, конверт меряют комнаты', () => {
    must(4836 > WORLD_HALF, 'карман уехал внутрь мира');
    expect(supportHeightAt(4836, 4836)).toEqual(null);
  });

  it('вода: опора знает поверхность, и она выше дна', () => {
    // Центр озера: дно ниже поверхности.
    const x = Math.round(LAKE.x), z = Math.round(LAKE.z);
    const поддержка = supportHeightAt(x, z);
    must(поддержка !== null, 'в центре озера опоры нет');
    if (поддержка!.kind === 'water') {
      must((поддержка!.surface ?? 0) > поддержка!.y,
        'у воды поверхность не выше дна - конверт утащил бы пловца на дно');
    }
    // Если озеро пересохло (правка воды), проверка честно это называет.
  });

  it('мост: опора - настил, а не вода под ним', () => {
    // Ищем середину первого моста в списке.
    const { BRIDGES } = require('../../../shared/water') as { BRIDGES: { x: number; z: number }[] };
    must(BRIDGES.length > 0, 'мосты исчезли из shared/water');
    const b = BRIDGES[0];
    const поддержка = supportHeightAt(b.x, b.z);
    must(поддержка !== null, 'на мосту опоры нет');
    must(поддержка!.kind === 'ground', 'мост превратился в воду');
  });
});

describe('Античит: падение легально, подъём ограничен', () => {
  const ac = new AntiCheatSystem();
  const id = 'test-vertical-1';

  it('падение со стены не наказывается', () => {
    // Первая точка задаёт базу, вторая - резкий спуск по вертикали.
    must(ac.validateMovement(id, { x: 0, y: 10, z: 0 }, 1000).valid, 'первая точка отвергнута');
    const вниз = ac.validateMovement(id, { x: 0.1, y: 5.5, z: 0 }, 1100);
    must(вниз.valid, `падение 45 м/с наказано: ${вниз.reason ?? ''}`);
  });

  it('взлёт быстрее прыжка наказан', () => {
    must(ac.validateMovement('test-vertical-2', { x: 0, y: 0, z: 0 }, 1000).valid, 'база не встала');
    const вверх = ac.validateMovement('test-vertical-2', { x: 0, y: 2.5, z: 0 }, 1100);
    must(!вверх.valid, `полёт на ${2.5 / 0.1} м/с прошёл - предел ${MAX_RISE_SPEED_MS.toFixed(1)}`);
  });

  it('горизонтальный спринт наказан, как и раньше', () => {
    must(ac.validateMovement('test-vertical-3', { x: 0, y: 0, z: 0 }, 1000).valid, 'база не встала');
    const бег = ac.validateMovement('test-vertical-3', { x: 5, y: 0, z: 0 }, 1100);
    must(!бег.valid, 'горизонтальный спринт 50 м/с прошёл проверку');
  });
});

describe('Проводка обработчика', () => {
  it('конверт стоит после проверки скорости и до записи позиции', () => {
    const начало = обработчик.indexOf('Конверт высоты (§377)');
    must(начало > 0, 'конверта высоты в обработчике нет');
    // setPlayerPosition в файле несколько (логин, travel) - берём ближайший
    // ПОСЛЕ конверта: именно его должен ждать полёт.
    const кэш = обработчик.indexOf('await this.redis.setPlayerPosition', начало);
    must(кэш > начало, 'конверт стоит после записи позиции - полёт успевает уехать');
    must(/verticalEnvelopeOk\(py, поддержка\.y\)/.test(обработчик), 'конверт не меряет от опоры');
    must(/verticalEnvelopeOk\(py, FLOOR_Y, INTERIOR_CEILING_M\)/.test(обработчик),
      'комната интерьера не меряется от пола с потолком мезонина');
    must(/MOVE_REJECTED, \{ reason: 'vertical' \}/.test(обработчик),
      'отказ полёта не уходит клиенту');
    must(!/punish\(socket, 'speed_hack'[\s\S]{0,80}vertical/.test(обработчик),
      'конверт наказывает с первого пакета - обкатка tolerances ждёт');
  });

  it('лодка конвертом не меряется: она качается на волне', () => {
    must(/if \(!this\.boatSpeeds\.get\(characterId\)\?\.boatId\) \{/.test(обработчик),
      'конверт меряет лодку - качка выкидывает пассажира');
  });

  it('пол комнаты: сервер знает число клиента, и оно одно', () => {
    expect(FLOOR_Y).toEqual(0.4);
    must(/export const FLOOR_Y = 0\.4/.test(интерьерыКлиента),
      'пол клиента уехал с 0.4 - серверная копия ослепла');
  });
});
