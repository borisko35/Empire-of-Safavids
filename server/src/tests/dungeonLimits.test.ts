// timeLimit и difficulties перестали быть украшением.
//
// ЧТО БЫЛО. У всех семи данжей стояли `timeLimit` (45/60/90/120 минут) и
// `difficulties: ['normal','hard','heroic','mythic']`. Первое не читалось
// нигде: таймера захода в проекте не было, игрок входил «на 45 минут» и играл
// сколько угодно. Второе читалось только первой буквой: `difficulties[0]`
// писался в базу и больше нигде не участвовал — монстры и добыча были
// одинаковыми на всех сложностях.
//
// ЧТО ЗАЩИЩАЕТСЯ. Не «в коде есть слово timeLimit», а то, что заход
// действительно закрывается и что сложность действительно меняет заход.
// Проверка на слово прошла бы и на прежнем коде.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const сервис = код('server/src/systems/DungeonService.ts');
const петля = код('server/src/systems/GameLoop.ts');
const маршруты = код('server/src/routes/game.ts');
const данные = код('server/src/data/dungeons.ts');
const панель = код('client/src/app/panels.ts');
const апи = код('client/src/app/api.ts');

function словарь(кодЯзыка: string): Record<string, unknown> {
  return JSON.parse(читать(`shared/locales/${кодЯзыка}.json`));
}
const ЯЗЫКИ = ['ru', 'en', 'az'] as const;

describe('timeLimit: срок захода существует', () => {
  it('у сессии есть срок, и он ставится из данных', () => {
    must(/expiresAt: number;/.test(сервис), 'у сессии нет срока');
    must(
      /expiresAt: DungeonService\.expiresAtFrom\(Date\.now\(\), def\.timeLimit\)/.test(сервис),
      'срок не ставится из timeLimit при входе',
    );
  });

  it('восстановленный заход считает остаток от своего старта, а не от рестарта', () => {
    // Иначе перезапуск продлевал подземелье на полный срок, и лимит
    // действовал только при непрерывной работе сервера.
    must(
      /expiresAt: DungeonService\.expiresAtFrom\(new Date\(row\.started_at\)\.getTime\(\), def\.timeLimit\)/.test(
        сервис
      ),
      'восстановление считает срок от момента восстановления: перезапуск продлевает заход',
    );
  });

  it('нулевой лимит — это «без срока», а не «истёк сейчас»', () => {
    // Сравнение expiresAt > 0 иначе закрыло бы заход мгновенно.
    must(
      /timeLimitMinutes > 0 \? startedAt \+ timeLimitMinutes \* 60_000 : 0/.test(сервис),
      'нулевой лимит обрабатывается неверно',
    );
    must(
      /сессия\.expiresAt > 0 && сессия\.expiresAt <= теперь/.test(сервис),
      'проверка просрочки не отличает «нет срока» от «срок вышел»',
    );
  });

  it('заходы действительно закрываются, а не только отмечаются', () => {
    must(/async expireOverdueSessions\(\): Promise<number>/.test(сервис), 'обхода просроченных нет');
    must(
      /closeSessionInDb\(session\.id, 'abandoned'\)[\s\S]{0,200}disposeSession\(session\)/.test(сервис),
      'просроченный заход не закрывается в базе и не убирается из памяти',
    );
  });

  it('обход висит в тике, а не ждёт входа', () => {
    // Иначе заход, который простаивает, висел бы в памяти до перезапуска.
    must(/expireOverdueSessions\(\)/.test(петля), 'таймер захода не вызывается из тика');
    must(
      /\.catch\(\(e\) => logger\.error\('[^\']*expireOverdueSessions rejected/.test(петля),
      'обход заходов не локализован: его падение уронит остальные проходы тика',
    );
  });

  it('в просроченный заход не пускают', () => {
    must(
      /if \(session\.expiresAt > 0 && session\.expiresAt <= Date\.now\(\)\) \{\s*return \{ ok: false, code: 'dungeon_time_expired' \};/.test(
        сервис
      ),
      'в заход с истёкшим сроком можно войти',
    );
  });

  it('остаток времени виден игроку', () => {
    // Без этого закрытие захода выглядит как поломка: человека выбрасывает
    // без объяснения.
    must(
      /timeLeftSec: dungeonService\.timeLeftSec/.test(маршруты),
      'сервер не отдаёт остаток времени',
    );
    must(
      /timeLeftSec\?: number/.test(апи),
      'клиент не объявил остаток в типе ответа',
    );
    must(/status\.timeLeftSec/.test(панель), 'панель не показывает остаток');
  });

  it('срок показан до входа, а не только внутри', () => {
    must(/d\.timeLimit/.test(панель), 'панель не показывает срок до входа');
  });
});

describe('difficulties: сложность меняет заход', () => {
  it('множители объявлены и растут', () => {
    must(/export const DIFFICULTY_SCALING/.test(данные), 'шкалы сложности нет');
    // Сложность без разницы между монстрами и наградой не нужна.
    must(/hp: 1, damage: 1, reward: 1/.test(данные), 'обычная сложность должна быть единицей');
    must(
      /hp: 3\.2, damage: 2\.5, reward: 3\.2/.test(данные),
      'мифическая сложность не отличается от обычной: выбор не имеет смысла',
    );
  });

  it('сложность выбирает игрок, и она проверяется', () => {
    must(/async enter\(characterId: string, dungeonId: string, difficulty\?: string\)/.test(сервис),
      'вход не принимает сложность');
    must(
      /\(def\.difficulties as string\[\]\)\.includes\(difficulty\)/.test(сервис),
      'сложность не сверяется со списком данжа: можно было бы выбрать mythic в подземелье без него',
    );
  });

  it('монстры масштабируются по выбранной сложности', () => {
    // Копия определения, а не сам объект: иначе монстр из hard-захода
    // остался бы с тройным здоровьем до перезагрузки процесса.
    must(
      /const monsterDef: typeof базовый = \{[\s\S]{0,200}hp: Math\.round\(базовый\.hp \* сложность\.hp\)/.test(сервис),
      'здоровье монстра не масштабируется по сложности',
    );
    must(/strength: Math\.round\(базовый\.strength \* сложность\.damage\)/.test(сервис),
      'урон монстра не масштабируется по сложности');
  });

  it('награда масштабируется', () => {
    must(/difficultyScaling\(session\.difficulty\)\.reward/.test(сервис),
      'награда за заход не зависит от сложности');
    // ОБЕ точки, а не одна. Опыт считается дважды: в раздаче участникам и в
    // отчёте о завершении. Проверка на одно вхождение проходила бы, когда
    // второе забыли, — это и случилось: масштабирование убрали из отчёта, а
    // проверка осталась зелёной, потому что видела раздачу.
    const масштабированных = (сервис.match(/experience: Math\.round\(def\.rewards\.experience \* множитель\)/g) ?? []).length;
    must(
      масштабированных === 2,
      `опыт масштабируется в ${масштабированных} местах из 2: раздача участникам и отчёт о завершении`,
    );
  });

  it('сложность переживает перезапуск', () => {
    must(
      /difficulty: row\.difficulty \?\? def\.difficulties\[0\]/.test(сервис),
      'восстановление читает сложность не из базы: перезапуск тихо понижал заход до normal',
    );
    must(
      /\[session\.id, session\.dungeonId, session\.difficulty, session\.leaderId/.test(сервис),
      'в базу пишется не та сложность, по которой идёт заход',
    );
  });

  it('выбор сложности есть в интерфейсе', () => {
    must(/d\.difficulties/.test(панель), 'панель не предлагает выбрать сложность');
    must(/api\.dungeonEnter\(d\.id, cid\(\), выбрана/.test(панель), 'выбранная сложность не уходит на сервер');
    must(
      /difficulties\?: string\[\]/.test(апи),
      'список сложностей не объявлен в типе ответа: панель не смогла бы его нарисовать',
    );
  });

  it('у каждой сложности есть подпись во всех трёх языках', () => {
    for (const кодЯзыка of ЯЗЫКИ) {
      const п = словарь(кодЯзыка) as { panels: Record<string, string> };
      for (const сложность of ['normal', 'hard', 'heroic', 'mythic']) {
        must(
          п.panels?.[`diff_${сложность}`],
          `в ${кодЯзыка}.json нет panels.diff_${сложность}: выбор сложности покажет пустое имя`,
        );
      }
    }
  });
});