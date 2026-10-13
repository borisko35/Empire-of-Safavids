// Шард обязан переживать деактивацию. Проверка поведением, а не текстом.
//
// ЧТО ЗДЕСЬ. Монстры в мире пропали навсегда, и выглядело это как «в игре их
// нет», а не как поломка. Журнал сервера показал цепочку целиком:
//
//   17:44:45  [Spawn] Shard activated: isfahan
//   17:53:17  [Spawn] Shard deactivated: isfahan      ← ушёл последний игрок
//   18:00:27  Player authenticated: EosProbe           ← шард НЕ активирован
//
// И стенд боя (tools/combat-check.mjs) за 60 секунд не получил ни одного
// `monster:spawned`.
//
// ПРИЧИНА. Аренда шарда лежит в Redis под ключом `shard:lease:<шард>`, и её
// продлевает сердцебиение. Деактивация снимала шард с локального учёта, но
// аренду не отпускала — а `acquireIfFree` смотрит только на существование
// ключа, не на владельца. Своя аренда выглядела как «занято другим
// инстансом», активация молча отвергалась, и мир оставался пустым до
// перезапуска сервера.
//
// ПОЧЕМУ ПОВЕДЕНИЕМ. Прежние проверки этого места читали исходник глазами и
// видели в нём верный код: `acquireIfFree` действительно «взять, если
// свободно», `deactivateShard` действительно «убрать монстров». Поломка была
// не в этих методах по отдельности, а в том, что один вызывает другой
// последствия не учитывает. Такое ловится только прогоном: активировать,
// деактивировать, активировать снова.
//
// ЧТО ПРОВЕРЯЕТСЯ
//   1. Взятие свободного шарда — обычный случай.
//   2. Взятие шарда, чью аренду держим мы, — тоже успех. Это и была поломка.
//   3. Взятие шарда, чью аренду держит чужой инстанс, — отказ. Защиту от
//      двойного спавна снимать нельзя, это была её настоящая задача.
//   4. Полный круг: активация → деактивация → активация. Стопроцентное
//      воспроизведение боевого сценария.
import { RedisService } from '../services/RedisService';
import { ShardLease } from '../systems/ShardLease';
import { SpawnSystem } from '../systems/SpawnSystem';

jest.mock('../services/RedisService', () => {
  return { RedisService: { getInstance: () => redisStub } };
});

// Хранилище с теми же правилами, что и настоящий Redis на тех же Lua:
// SETEX NX (занято — не берём, владелец не смотрим), продление и снятие
// только владельцем. Именно «не смотрим на владельца» и было поломкой,
// поэтому подмена обязана это повторять, а не быть удобнее оригинала.
const store = new Map<string, string>();
let now = 1_000;

const redisStub = {
  acquireIfFree: jest.fn(async (key: string, owner: string, ttl: number) => {
    if (store.has(key)) return false;
    store.set(key, owner);
    now += ttl;
    return true;
  }),
  renewIfOwner: jest.fn(async (key: string, owner: string, ttl: number) => {
    if (store.get(key) !== owner) return false;
    now += ttl;
    return true;
  }),
  releaseIfOwner: jest.fn(async (key: string, owner: string) => {
    if (store.get(key) !== owner) return false;
    store.delete(key);
    return true;
  }),
  get: jest.fn(async (key: string) => store.get(key) ?? null),
};

function сброс(): void {
  store.clear();
  now = 1_000;
  jest.clearAllMocks();
}

const ШАРД = 'isfahan';
const ключ = (шард: string) => `shard:lease:${шард}`;

describe('Аренда шарда: свой шард нельзя потерять', () => {
  beforeEach(сброс);

  it('свободный шард берётся', async () => {
    const аренда = new ShardLease('inst_свой');
    expect(await аренда.acquire(ШАРД)).toBe(true);
    expect(store.get(ключ(ШАРД))).toBe('inst_свой');
  });

  it('ШАРД, КОТОРЫЙ ДЕРЖИМ МЫ, СЧИТАЕТСЯ СВОИМ, А НЕ ЧУЖИМ', async () => {
    // ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Ключ существует и принадлежит нам — то есть
    // ровно то состояние, в котором мир остался пустым.
    const аренда = new ShardLease('inst_свой');
    await аренда.acquire(ШАРД);

    // Имитируем сердцебиение: аренда живёт и продлевается, срок не истекает.
    now += 21;
    expect(await аренда.renew(ШАРД)).toBe(true);

    const повторно = await аренда.acquire(ШАРД);
    expect(повторно).toBe(true);
  });

  it('аренда чужого инстанса остаётся чужой', async () => {
    // Обратная сторона правки: ослаблять защиту от двойного спавна нельзя.
    // Если ключ держит не мы — активация обязана отказать.
    store.set(ключ(ШАРД), 'inst_чужой');
    const аренда = new ShardLease('inst_свой');
    expect(await аренда.acquire(ШАРД)).toBe(false);
    expect(store.get(ключ(ШАРД))).toBe('inst_чужой');
  });

  it('деактивация освобождает аренду', async () => {
    // Вторая половина правки. Пока аренду продлевает сердцебиение мёртвого
    // шарда, его не возьмёт даже тот же инстанс.
    const аренда = new ShardLease('inst_свой');
    const спавн = new SpawnSystem();
    await спавн.activateShard(ШАРД, аренда);
    expect(store.has(ключ(ШАРД))).toBe(true);

    спавн.deactivateShard(ШАРД, аренда);
    // release асинхронен, а deactivateShard — нет: ждём один тик.
    await new Promise((r) => setTimeout(r, 0));
    expect(store.has(ключ(ШАРД))).toBe(false);
  });

  it('ПОЛНЫЙ КРУГ: активация, деактивация, снова активация', async () => {
    // Сценарий из журнала, целиком. До правки последний шаг возвращал false,
    // и в мире не появлялось ни одного монстра.
    const аренда = new ShardLease('inst_свой');
    const спавн = new SpawnSystem();

    expect(await спавн.activateShard(ШАРД, аренда)).toBe(true);
    expect(спавн.isShardActive(ШАРД)).toBe(true);

    // Ушёл последний игрок.
    спавн.deactivateShard(ШАРД, аренда);
    await new Promise((r) => setTimeout(r, 0));
    expect(спавн.isShardActive(ШАРД)).toBe(false);

    // Пришёл следующий игрок — шард обязан снова подняться.
    expect(await спавн.activateShard(ШАРД, аренда)).toBe(true);
    expect(спавн.isShardActive(ШАРД)).toBe(true);
  });

  it('после круга аренда принадлежит нам, а не осталась в чужих руках', async () => {
    const аренда = new ShardLease('inst_свой');
    const спавн = new SpawnSystem();
    await спавн.activateShard(ШАРД, аренда);
    спавн.deactivateShard(ШАРД, аренда);
    await new Promise((r) => setTimeout(r, 0));
    await спавн.activateShard(ШАРД, аренда);

    const статус = await аренда.status(ШАРД);
    expect(статус.mine).toBe(true);
    expect(статус.owner).toBe('inst_свой');
  });

  it('RedisService.getInstance() действительно тот, что замокан', async () => {
    // Проверка на слепоту: если подмена перестанет работать, тесты выше
    // начнут проходить на настоящем Redis или молча на пустом хранилище.
    // Здесь мы требуем увидеть ровно наш заглушечный объект.
    expect(RedisService.getInstance()).toBe(redisStub as never);
  });
});