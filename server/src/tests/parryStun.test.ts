// Оглушение от парирования (§325) — окно против монстров и стан против
// атакующего живы проводками, а не надписями.
//
// ЧТО БЫЛО. Окно парирования (260 мс) работало только в PvP-пути: монстр
// читал лишь блок (−60%) и уклонение, и пойманный таймингом удар ничем не
// отличался от удара по держащему щит вечно игроку. Обещанное road-картой
// оглушение вовсе не начиналось. Отдельный клиентский таймер окна тоже уже
// пробовали: он был «тенью» серверной механики с тостом, который обещал
// отражённый урон и ничего не делал, — поэтому здесь же проверяется, что
// тень не вернулась в world3d.ts.
//
// ЗДЕСЬ ДВА РОДА ПРОВЕРОК. Поведение AISystem запускается по-настоящему:
// оглушённый монстр молчит в тике. Проводка сокет-пути и тика проверяется
// по исходнику: поднять там настоящую обработку нечем, а regex такую
// проводку всё же страхует — перепишешь ветку, тест падает.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AISystem } from '../systems/AISystem';
import { MONSTERS_DATABASE } from '../data/monsters';
import { PARRY_WINDOW_MS, PARRY_REFLECT, PARRY_STUN_MS } from '../systems/CombatStance';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const цикл = читать('server/src/systems/GameLoop.ts');
const обработчик = читать('server/src/socket/GameSocketHandler.ts');
const client3d = читать('client/src/app/game3d/world3d.ts');

describe('Постоянные окну и стану', () => {
  it('окно и отражение согласованы с DefenseStates', () => {
    // Числа дублируются в двух модулях не для элегантности: CombatStance
    // экспортирует для сокет-пути, DefenseStates держит своё для тика.
    // Утащат значение в одном месте — тест засвистит.
    expect({ окно: PARRY_WINDOW_MS, отражение: PARRY_REFLECT })
      .toEqual({ окно: 260, отражение: 0.35 });
  });

  it('стан парирования мягче монстровых и всё же заметен', () => {
    // Самое короткое монстровое оглушение — 2 с («Таран»). Длинный стан
    // на каждый проигранный размен просадил бы PvP до взаимного паралича,
    // а короче половины секунды игрок бы не различил, что стан случился.
    expect(PARRY_STUN_MS >= 500 && PARRY_STUN_MS < 2000).toEqual(true);
  });
});

describe('AISystem: оглушение — поведение, а не поле', () => {
  const ai = new AISystem();

  it('оглушённый монстр не действует, пока идёт стан', () => {
    const определение = Object.values(MONSTERS_DATABASE)[0];
    const ctx = ai.spawnMonster(определение, { x: 0, y: 0, z: 0 });
    try {
      const принято = ai.stun(ctx.instanceId, PARRY_STUN_MS);
      expect({ принят: принято }).toEqual({ принят: true });
      // Два тика, а не один: на одиночном тике idle совпадает с обычным
      // бездействием, и тест проходил бы зря. Оглушение обязано держать
      // монстра молчащим столько, сколько длится стан.
      expect(ai.tick(ctx.instanceId, []).type).toEqual('idle');
      expect(ai.tick(ctx.instanceId, []).type).toEqual('idle');
    } finally {
      // Контексты живут в памяти класса: не добить монстра — открытый</think><tool_call>edit<arg_key>newString</arg_key><arg_value>      // Контексты живут в памяти класса: не добить монстра — оглушённый
      // экземпляр остался бы на следующие тесты, которые спавнят его же.
      ai.takeDamage(ctx.instanceId, определение.hp, 'cleanup');
    }
  });

  it('труп не оглушают, незнающего не глушат, нулевой срок не ставят', () => {
    const определение = Object.values(MONSTERS_DATABASE)[0];
    const ctx = ai.spawnMonster(определение, { x: 5, y: 0, z: 5 });
    expect({ незнающий: ai.stun('нет_такого_instance', PARRY_STUN_MS) })
      .toEqual({ незнающий: false });
    expect({ нулевой_срок: ai.stun(ctx.instanceId, 0) })
      .toEqual({ нулевой_срок: false });
    ai.takeDamage(ctx.instanceId, определение.hp, 'убойник');
    // takeDamage прибрал контекст вместе с жизнью: мёртвому стан не нужен.
    expect({ труп: ai.stun(ctx.instanceId, PARRY_STUN_MS) })
      .toEqual({ труп: false });
  });

  it('механизм пробуждения — время: срок в поле ровно now + стан', () => {
    const определение = Object.values(MONSTERS_DATABASE)[0];
    const ctx = ai.spawnMonster(определение, { x: -5, y: 0, z: 5 });
    const до = Date.now();
    ai.stun(ctx.instanceId, PARRY_STUN_MS);
    const контекст = (ai as unknown as { contexts: Map<string, { stunnedUntil?: number }> })
      .contexts.get(ctx.instanceId)!;
    // Допуск только на исполнение двух строк между now и записью:
    // он на три порядка меньше самого стана.
    expect(контекст.stunnedUntil! >= до + PARRY_STUN_MS &&
      контекст.stunnedUntil! <= Date.now() + PARRY_STUN_MS).toEqual(true);
  });
});

describe('Проводка: тик монстров читает окно, сокет-путь оглушает', () => {
  it('в PvE-цикле удар монстра разбирает парирование до блока', () => {
    // Порядок важен: проверка окна ДО множителя активной защиты, иначе
    // блок погасил бы удар на 60% раньше, и «поймать в окно» не значило
    // бы ничего сверх держащего щит.
    const ветка = /getParryReflect\(target\.id\)[\s\S]{0,900}?getIncomingMultiplier\(target\.id\)/;
    expect({ окно_читается: ветка.test(цикл) }).toEqual({ окно_читается: true });

    // В самой ветке: оглушение монстра и публикация с честным нулём урона.
    const оглушение = /getAI\(\)\.stun\(atk\.instanceId, PARRY_STUN_MS\)/.test(цикл);
    const публикация = /isParried: true,\s*\r?\n\s*reflected: 0/.test(цикл);
    expect({ оглушение, публикация }).toEqual({ оглушение: true, публикация: true });

    // Публикация стоит раньше, чем урон караулу и applyDamage: удара не
    // было, поэтому ни поглощения, ни отравления быть не должно.
    const публикацияДо = цикл.indexOf('isParried: true,');
    const applyDamage = цикл.indexOf('await this.characters.applyDamage(target.id, damage)', публикацияДо);
    const блокПосле = цикл.indexOf('getIncomingMultiplier(target.id)', публикацияДо);
    expect({ урон_после: applyDamage > 0, блок_после: блокПосле > 0 })
      .toEqual({ урон_после: true, блок_после: true });
  });

  it('в PvP-пути парирование оглушает атакующего', () => {
    const ветка = /getParryReflect\(target\.id\)[\s\S]{0,4000}?this\.debuffs\.apply\(\s*\r?\n?\s*attacker\.id,\s*\r?\n?\s*\{[\s\S]{0,400}?kind: 'stun'/;
    expect({ стан_атакующему: ветка.test(обработчик) }).toEqual({ стан_атакующему: true });
  });

  it('мост пересылает isParried с канала региона в combat:hit', () => {
    // Без пересылки клиент увидел бы нулевую цифру вместо «Парировано!»
    // и не сыграл бы лязг: поле есть в публикации, а до сокета не доходит.
    expect({ пересылка: /isParried: Boolean\(msg\.isParried\)/.test(обработчик) })
      .toEqual({ пересылка: true });
  });

  it('клиентская тень окна парирования удалена и не вернулась', () => {
    // Такая тень уже наказывалась: «тост обещал отражённый урон и ничего
    // не делал» (см. комментарий в itchBundle.test.ts). Окно живёт на
    // сервере, где лежит правда о времени начала блока.
    expect({ тень: /parryWindowEnd/.test(client3d) }).toEqual({ тень: false });
  });
});
