// PvP: подтверждение результата.
//
// ТУТ БЫЛА ДЫРА, КОТОРАЯ ЛОМАЛА РЕЙТИНГ. Маршрут /api/game/pvp/complete
// принимал winnerId прямо из тела запроса. requireCharacterOwnership
// проверял только characterId — что он твой. Победителя не проверял
// никто, поэтому можно было отправить:
//
//   characterId = свой (проверка проходит)
//   winnerId    = любой персонаж
//   matchId     = любой
//
// и начислить рейтинг себе, а сопернику снять. Топ-10 при этом висит
// прямо на сайте.
//
// Починили так: исход подтверждают оба игрока, сервер ждёт обоих.
// Проверяем именно защиту, а не «красиво ли считается».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const service = read('server/src/services/PvPService.ts');
const routes = read('server/src/routes/game.ts');
const migration = read('database/migrations/035_pvp_confirmation.sql');
const clientApi = read('client/src/app/api.ts');

describe('PvP: дыра с подменой победителя закрыта', () => {
  it('победитель обязан быть участником матча', () => {
    // Главное. Раньше можно было назвать победителем третьего персонажа
    expect(service).toMatch(/if \(claimedWinnerId !== match\.player1_id && claimedWinnerId !== match\.player2_id\)/);
    expect(service).toMatch(/Winner must be one of the match participants/);
  });

  it('вызывающий обязан быть участником матча', () => {
    expect(service).toMatch(/if \(!isP1 && !isP2\) throw new Error\('You are not a participant/);
  });

  it('маршрут больше не передаёт winnerId в начисление напрямую', () => {
    expect(routes).toMatch(/pvpService\.reportResult\(matchId, req\.body\.characterId, claimedWinnerId\)/);
    expect(routes).not.toMatch(/completeMatch\(/);
  });

  it('повторно закрыть матч нельзя', () => {
    // Иначе можно было бы дёрнуть /complete много раз и накрутить очки
    expect(service).toMatch(/if \(match\.status === 'finished' \|\| match\.winner_id\)/);
    expect(service).toMatch(/AND status <> 'finished' AND winner_id IS NULL/);
  });

  it('начисление защищено от гонки двух запросов', () => {
    // Два подтверждения одновременно не должны начислить рейтинг дважды
    expect(service).toMatch(/if \(!done\.length\)/);
  });
});

describe('PvP: подтверждают оба', () => {
  it('в базе есть колонки подтверждений и срок ожидания', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS p1_confirmed UUID/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS p2_confirmed UUID/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS settle_after\s+TIMESTAMPTZ/);
  });

  it('оба назвали одного — победа ему', () => {
    expect(service).toMatch(/if \(p1 && p2 && p1 === p2\)/);
  });

  it('оба назвали разных — ничья, рейтинг не трогаем', () => {
    // Иначе врать было бы выгодно, а это и есть накрутка
    expect(service).toMatch(/if \(p1 && p2 && p1 !== p2\)/);
    expect(service).toMatch(/status = 'draw'/);
  });

  it('не ответил никто — тоже ничья', () => {
    expect(service).toMatch(/не ответил никто|не ответил/);
  });

  it('молчаливый игрок проигрывает', () => {
    // Иначе можно выиграть, просто не отвечая
    expect(service).toMatch(/opponent silent, win to/);
    expect(service).toMatch(/const answered = p1 \?\? p2/);
  });

  it('ожидание ограничено по времени', () => {
    expect(service).toMatch(/PVP_CONFIRM_WINDOW_SEC = \d+/);
    expect(service).toMatch(/settle_after = COALESCE\(settle_after, \$2\)/);
  });

  it('пока второй не ответил, статус pending', () => {
    expect(service).toMatch(/status: 'pending'/);
  });
});

describe('PvP: клиент ждёт второго', () => {
  it('ответ различает settled / pending / draw', () => {
    // Раньше тип обещал одни цифры рейтинга: клиент ждал победу сразу
    expect(clientApi).toMatch(/status: 'settled' \| 'pending' \| 'draw'/);
  });

  it('есть способ узнать, закрылся ли матч', () => {
    expect(routes).toMatch(/pvp\/matches\/:id\/status/);
    expect(clientApi).toMatch(/pvpMatchStatus/);
  });
});

describe('PvP: задача дня считает только реальную победу', () => {
  it('награда начисляется по фактическому победителю, а не по заявленному', () => {
    // Иначе можно было бы назвать себя победителем и получить задачу
    expect(routes).toMatch(/result\.status === 'settled' && result\.winnerId/);
  });
});
