// Логика каравана: груз реально едет, и сдать его раньше срока нельзя.
// Раньше контракт можно было закрыть сразу же, не выйдя из города
// отправителя, а груз возвращался только при явной отмене — если игрок
// просто закрыл панель и забыл, груз пропадал навсегда.
import { TradeService, TRADE_CONTRACTS } from '../systems/TradeService';

/** Строка trade_caravans в том виде, в котором её отдаёт SELECT */
interface CaravanRow {
  contract_id: string | null;
  item_id: string;
  quantity: number;
  eta_minutes: number;
  started_at: Date;
  status: string;
}

type Result<T = Record<string, unknown>> =
  | { ok: true } & T
  | { ok: false; code: string };

/** Публичная часть TradeService, без приватных полей */
interface TestableTrade {
  accept(characterId: string, contractId: string): Promise<Result>;
  getActive(characterId: string): Promise<{ status: string; cargoReturned: boolean; arrivesAt: number } | null>;
  deliver(characterId: string): Promise<Result>;
  cancel(characterId: string): Promise<boolean>;
}

interface Harness {
  svc: TestableTrade;
  added: { itemId: string; qty: number }[];
  removed: { itemId: string; qty: number }[];
  db: { query: jest.Mock; queryOne: jest.Mock };
  characters: {
    getCharacterById: jest.Mock;
    addItems: jest.Mock;
    removeItems: jest.Mock;
    addGold: jest.Mock;
  };
}

function makeHarness(selectRow: CaravanRow | null): Harness {
  const added: { itemId: string; qty: number }[] = [];
  const removed: { itemId: string; qty: number }[] = [];

  const db = {
    query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
    queryOne: jest.fn(async (text: string, params?: unknown[]) =>
      /FROM trade_caravans/i.test(text) && selectRow ? { ...selectRow, params } : null
    ),
  };

  const characters = {
    getCharacterById: jest.fn(async () => ({ id: 'char-1', level: 60, region: 'tabriz' })),
    addItems: jest.fn(async (_cid: string, list: { itemId: string; qty: number }[]) => { added.push(...list); }),
    removeItems: jest.fn(async (_cid: string, list: { itemId: string; qty: number }[]) => { removed.push(...list); }),
    addGold: jest.fn(async () => {}),
    addExperience: jest.fn(async () => null),
    addSilver: jest.fn(async () => {}),
    addSyrianGold: jest.fn(async () => {}),
  };

  const svc = new TradeService() as unknown as TestableTrade;
  (svc as unknown as { db: unknown }).db = db;
  (svc as unknown as { characters: unknown }).characters = characters;
  (svc as unknown as { redis: unknown }).redis = {
    get: jest.fn(async () => null), set: jest.fn(async () => 'OK'), del: jest.fn(async () => 1),
  };

  return { svc, added, removed, db, characters };
}

const MIN = 60_000;
const def = TRADE_CONTRACTS[0];

function caravan(over: Partial<CaravanRow> = {}): CaravanRow {
  return {
    contract_id: def.id,
    item_id: def.cargoItemId,
    quantity: def.cargoQty,
    eta_minutes: def.travelMinutes,
    started_at: new Date(Date.now() - 30_000),
    status: 'transit',
    ...over,
  };
}

describe('TradeService: караван в пути', () => {
  it('у каждого контракта задан срок в пути', () => {
    for (const c of TRADE_CONTRACTS) {
      expect(typeof c.travelMinutes).toBe('number');
      expect(c.travelMinutes).toBeGreaterThan(0);
    }
  });

  it('при приёме строка каравана создаётся раньше, чем списывается груз', async () => {
    // Порядок важен: если INSERT не прошёл, груз не должен пропасть
    const h = makeHarness(null);
    const order: string[] = [];
    h.characters.removeItems.mockImplementation(async () => { order.push('remove'); });
    h.db.query.mockImplementation(async (text: string) => {
      if (/INSERT INTO trade_caravans/i.test(text)) order.push('insert');
      return { rows: [], rowCount: 1 };
    });
    const res = await h.svc.accept('char-1', def.id);
    expect(res.ok).toBe(true);
    expect(order).toEqual(['insert', 'remove']);
  });

  it('если караван не создался — контракт не принимается, груз остаётся у игрока', async () => {
    const h = makeHarness(null);
    h.db.query.mockImplementation(async (text: string) => {
      if (/INSERT INTO trade_caravans/i.test(text)) throw new Error('no such table');
      return { rows: [], rowCount: 1 };
    });
    const res = await h.svc.accept('char-1', def.id);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('contract_caravan_unavailable');
    expect(h.characters.removeItems).not.toHaveBeenCalled();
  });

  it('пока караван едет — статус transit, груз в сумке не появляется', async () => {
    const h = makeHarness(caravan());
    const active = await h.svc.getActive('char-1');
    expect(active).not.toBeNull();
    expect(active!.status).toBe('transit');
    expect(active!.cargoReturned).toBe(false);
    expect(h.added).toEqual([]);
  });

  it('по истечении срока караван прибывает и груз возвращается в сумку один раз', async () => {
    const arrived = caravan({
      started_at: new Date(Date.now() - (def.travelMinutes + 1) * MIN),
      status: 'transit',
    });
    const h = makeHarness(arrived);

    const first = await h.svc.getActive('char-1');
    expect(first!.status).toBe('arrived');
    expect(h.added).toEqual([{ itemId: def.cargoItemId, qty: def.cargoQty }]);
    expect(h.db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'arrived'"),
      ['char-1']
    );

    // Повторный опрос не должен выдавать груз повторно
    h.added.length = 0;
    const h2 = makeHarness({ ...arrived, status: 'arrived' });
    const second = await h2.svc.getActive('char-1');
    expect(second!.status).toBe('arrived');
    expect(h2.added).toEqual([]);
  });

  it('сдать груз раньше прихода нельзя', async () => {
    const h = makeHarness(caravan());
    const res = await h.svc.deliver('char-1');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('contract_caravan_in_transit');
    expect(h.characters.addGold).not.toHaveBeenCalled();
  });

  it('при отмене едущего каравана груз возвращается', async () => {
    const h = makeHarness(caravan());
    expect(await h.svc.cancel('char-1')).toBe(true);
    expect(h.added).toEqual([{ itemId: def.cargoItemId, qty: def.cargoQty }]);
  });

  it('при отмене уже прибывшего каравана груз второй раз не выдаётся', async () => {
    // Груз уже в сумке (вернулся при приходе) — отмена не должна удваивать
    const h = makeHarness(caravan({
      started_at: new Date(Date.now() - (def.travelMinutes + 1) * MIN),
      status: 'arrived',
    }));
    expect(await h.svc.cancel('char-1')).toBe(true);
    expect(h.added).toEqual([]);
  });

  it('контракт из старой версии (без id в БД) не висит вечно', async () => {
    // До миграции 027 в строке нет contract_id, и контракт было не восстановить
    const h = makeHarness(caravan({ contract_id: null, status: 'active' }));
    expect(await h.svc.getActive('char-1')).toBeNull();
    expect(h.db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM trade_caravans'),
      ['char-1']
    );
  });
});
