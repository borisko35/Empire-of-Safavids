// ============================================================
// Торговые контракты (Шёлковый путь) — Empire of Safavids
// ============================================================
// Игрок принимает контракт в городе-отправителе, закупает груз
// (предметы списываются при приёме) и доставляет его в город-
// получатель. На маршрут влияют разбойники и война — груз может
// выпасть после смерти (упрощение: списывается при приёме контракта).

import { Region } from '../types/game.types';
import { CharacterService } from '../services/CharacterService';
import { ITEMS_DATABASE } from '../data/items';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

export interface TradeContractDef {
  id: string;
  nameRu: string;
  fromRegion: Region;
  toRegion: Region;
  cargoItemId: string;
  cargoQty: number;
  rewardGold: number;
  rewardExp: number;
  /** Бонус исфаханским серебром (бесплатная валюта). */
  rewardSilver?: number;
  /** Бонус сирийским золотом (бесплатная валюта). */
  rewardSyrian?: number;
  minLevel: number;
}

export interface ActiveContract {
  contractId: string;
  startedAt: number;
}

const CONTRACT_KEY = (characterId: string) => `trade:contract:${characterId}`;
const KEY_TTL_SECONDS = 7 * 24 * 3600;

export const TRADE_CONTRACTS: TradeContractDef[] = [
  {
    id: 'trade_tabriz_isfahan_silk',
    nameRu: 'Шёлк для Исфахана',
    fromRegion: Region.TABRIZ, toRegion: Region.ISFAHAN,
    cargoItemId: 'mat_silk', cargoQty: 3,
    rewardGold: 450, rewardExp: 400, rewardSilver: 15, minLevel: 5,
  },
  {
    id: 'trade_isfahan_shiraz_saffron',
    nameRu: 'Шафран в Шираз',
    fromRegion: Region.ISFAHAN, toRegion: Region.SHIRAZ,
    cargoItemId: 'mat_saffron', cargoQty: 2,
    rewardGold: 700, rewardExp: 900, minLevel: 20,
  },
  {
    id: 'trade_shiraz_caucasus_turquoise',
    nameRu: 'Бирюза на Кавказ',
    fromRegion: Region.SHIRAZ, toRegion: Region.CAUCASUS,
    cargoItemId: 'mat_turquoise', cargoQty: 2,
    rewardGold: 900, rewardExp: 1600, minLevel: 40,
  },
  {
    id: 'trade_caucasus_meso_ore',
    nameRu: 'Руда для военных лагерей',
    fromRegion: Region.CAUCASUS, toRegion: Region.MESOPOTAMIA,
    cargoItemId: 'mat_iron_ore', cargoQty: 20,
    rewardGold: 1200, rewardExp: 2600, minLevel: 55,
  },
  {
    id: 'trade_isfahan_khorasan_scale',
    nameRu: 'Драконья чешуя в Хорасан',
    fromRegion: Region.ISFAHAN, toRegion: Region.KHORASAN,
    cargoItemId: 'mat_dragon_scale', cargoQty: 1,
    rewardGold: 8000, rewardExp: 5200, rewardSilver: 120, rewardSyrian: 40, minLevel: 70,
  },
];

export class TradeService {
  private redis = RedisService.getInstance();
  private characters = new CharacterService();

  listContracts(): TradeContractDef[] {
    return TRADE_CONTRACTS;
  }

  async getActive(characterId: string): Promise<ActiveContract | null> {
    const raw = await this.redis.get(CONTRACT_KEY(characterId));
    return raw ? (JSON.parse(raw) as ActiveContract) : null;
  }

  async accept(
    characterId: string,
    contractId: string
  ): Promise<{ ok: true; contract: TradeContractDef } | { ok: false; code: string }> {
    const def = TRADE_CONTRACTS.find(c => c.id === contractId);
    if (!def) return { ok: false, code: 'contract_not_found' };

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (character.level < def.minLevel) return { ok: false, code: 'contract_level_low' };
    if (character.region !== def.fromRegion) return { ok: false, code: 'contract_wrong_region' };
    if (await this.getActive(characterId)) return { ok: false, code: 'contract_already_active' };

    // Груз списывается при приёме: караван «уходит» вместе с игроком
    await this.characters.removeItems(characterId, [{ itemId: def.cargoItemId, qty: def.cargoQty }]);

    const active: ActiveContract = { contractId, startedAt: Date.now() };
    await this.redis.set(CONTRACT_KEY(characterId), JSON.stringify(active), KEY_TTL_SECONDS);
    logger.info(`[Trade] Contract ${contractId} accepted by ${characterId}`);
    return { ok: true, contract: def };
  }

  async deliver(
    characterId: string
  ): Promise<{ ok: true; gold: number; exp: number; silver: number; syrian: number; contract: TradeContractDef } | { ok: false; code: string }> {
    const active = await this.getActive(characterId);
    if (!active) return { ok: false, code: 'contract_none_active' };

    const def = TRADE_CONTRACTS.find(c => c.id === active.contractId);
    if (!def) return { ok: false, code: 'contract_not_found' };

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (character.region !== def.toRegion) return { ok: false, code: 'contract_not_delivered' };

    await this.characters.addGold(characterId, def.rewardGold).catch(() => {});
    await this.characters.addExperience(characterId, def.rewardExp).catch(() => {});
    const silver = def.rewardSilver ?? 0;
    const syrian = def.rewardSyrian ?? 0;
    if (silver > 0) await this.characters.addSilver(characterId, silver).catch(() => {});
    if (syrian > 0) await this.characters.addSyrianGold(characterId, syrian).catch(() => {});
    await this.redis.del(CONTRACT_KEY(characterId));
    logger.info(`[Trade] Contract ${def.id} delivered by ${characterId}`);
    return { ok: true, gold: def.rewardGold, exp: def.rewardExp, silver, syrian, contract: def };
  }

  /** Отказаться от контракта: груз возвращается (караван развернулся) */
  async cancel(characterId: string): Promise<boolean> {
    const active = await this.getActive(characterId);
    if (!active) return false;
    const def = TRADE_CONTRACTS.find(c => c.id === active.contractId);
    if (def) {
      await this.characters.addItems(characterId, [{ itemId: def.cargoItemId, qty: def.cargoQty }]).catch(() => {});
    }
    await this.redis.del(CONTRACT_KEY(characterId));
    return true;
  }

  /** Описание контрактов для клиента (с именами предметов) */
  listForClient(): (TradeContractDef & { cargoNameRu: string })[] {
    return TRADE_CONTRACTS.map(c => ({
      ...c,
      cargoNameRu: ITEMS_DATABASE[c.cargoItemId]?.nameRu ?? c.cargoItemId,
    }));
  }
}
