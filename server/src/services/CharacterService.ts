import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './DatabaseService';
import { Character, CharacterClass, CharacterStats, Region, ItemType, EquipmentBonuses, CharacterEquipment } from '../types/game.types';
import { camelizeRow, camelizeRows } from '../utils/camelize';
import { LevelingSystem } from '../systems/LevelingSystem';
import { ITEMS_DATABASE } from '../data/items';
import { REGION_SPAWNS, getZoneAt } from '../../../shared/constants';
import { getBuffService, ITEM_BUFFS, type ActiveBuff } from './BuffService';
import { ReferralService } from './ReferralService';
import { logger } from '../utils/logger';
import { analytics } from './AnalyticsService';
import { seasonalEvent } from './SeasonalEventService';
import { weatherExpMultiplier } from '../systems/WorldTimeSystem';
import type { WalletCurrency } from '../utils/economy';
import { MAX_LEVEL, DEFAULT_SERVER_ID, getRegionSpawn, STAMINA } from '../../../shared/constants';
import { isCombatStance, type CombatStance } from '../systems/CombatStance';
// РќР°РІС‹РєРё РіРёР»СЊРґРёРё. РРјРїРѕСЂС‚ Р·РґРµСЃСЊ, Р° РЅРµ С‚РѕР»СЊРєРѕ РІ РјР°СЂС€СЂСѓС‚Р°С…: Р±РѕРЅСѓСЃ Рє РѕРїС‹С‚Сѓ
// СЃС‡РёС‚Р°РµС‚СЃСЏ РІ addExperience, Рё РѕРЅ РґРѕР»Р¶РµРЅ РїРѕРїР°РґР°С‚СЊ РІ С‚Сѓ Р¶Рµ С†РµРїРѕС‡РєСѓ, С‡С‚Рѕ Р±Р°С„С„,
// СЃРµР·РѕРЅРЅС‹Р№ РїСЂР°Р·РґРЅРёРє Рё Р±РѕРЅСѓСЃ РїСЂРѕС„РµСЃСЃРёРё.
import { GuildService } from './GuildService';
import { professionOf } from './ProfessionService';
import { professionBonuses } from '../systems/ProfessionBonuses';
import { guildMissionService } from './GuildMissionService';

const BASE_STATS: Record<CharacterClass, CharacterStats> = {
  [CharacterClass.QIZILBASH]: {
    strength: 20, agility: 12, intelligence: 5, endurance: 18, charisma: 8,
  },
  [CharacterClass.SUFI_MYSTIC]: {
    strength: 6, agility: 10, intelligence: 22, endurance: 10, charisma: 15,
  },
  [CharacterClass.PERSIAN_ARCHER]: {
    strength: 12, agility: 22, intelligence: 8, endurance: 12, charisma: 10,
  },
  [CharacterClass.BAZAAR_MERCHANT]: {
    strength: 8, agility: 14, intelligence: 12, endurance: 10, charisma: 20,
  },
  [CharacterClass.COURT_DIPLOMAT]: {
    strength: 7, agility: 13, intelligence: 15, endurance: 9, charisma: 22,
  },
};

/**
 * Р§С‚Рѕ РІРѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµС‚ СЂР°СЃС…РѕРґРЅРёРє. Р’С‹РЅРµСЃРµРЅРѕ РёР· РєР»Р°СЃСЃР°, С‡С‚РѕР±С‹ С‚РµСЃС‚С‹
 * С†РµР»РѕСЃС‚РЅРѕСЃС‚Рё РјРѕРіР»Рё СЃРІРµСЂРёС‚СЊ С‚Р°Р±Р»РёС†Сѓ СЃ РєР°С‚Р°Р»РѕРіРѕРј РїСЂРµРґРјРµС‚РѕРІ: РїСЂРµРґРјРµС‚,
 * РѕР±РµС‰Р°СЋС‰РёР№ РІ РѕРїРёСЃР°РЅРёРё РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ, РѕР±СЏР·Р°РЅ Р·РґРµСЃСЊ Р±С‹С‚СЊ вЂ” РёРЅР°С‡Рµ
 * useItem Р±СЂРѕСЃР°РµС‚ В«Item has no usable effectВ».
 */
export const USE_ITEM_EFFECTS: Record<string, { hp?: number; mana?: number; stamina?: number }> = {
  con_health_potion_s: { hp: 200 },
  con_health_potion_m: { hp: 800 },
  con_mana_potion: { mana: 300 },
  con_stamina_food: { stamina: 150 },
  // Р’С‚РѕСЂРѕР№ СЃР»РѕР№ СЂР°СЃС…РѕРґРЅРёРєРѕРІ (РїСЂРµС„РёРєСЃ pot_/food_) Р±С‹Р» РѕРїРёСЃР°РЅ РІ РєР°С‚Р°Р»РѕРіРµ,
  // РЅРѕ РѕС‚СЃСѓС‚СЃС‚РІРѕРІР°Р» Р·РґРµСЃСЊ вЂ” useItem Р±СЂРѕСЃР°Р» В«Item has no usable effectВ»,
  // С‚Рѕ РµСЃС‚СЊ РІС‹РїРёС‚СЊ Р·РµР»СЊРµ РёР»Рё СЃСЉРµСЃС‚СЊ РєРµР±Р°Р± Р±С‹Р»Рѕ РЅРµРІРѕР·РјРѕР¶РЅРѕ. Р—РЅР°С‡РµРЅРёСЏ РІР·СЏС‚С‹
  // РёР· РѕРїРёСЃР°РЅРёР№ РїСЂРµРґРјРµС‚РѕРІ. Р‘РѕРЅСѓСЃ Рє СЃРёР»Рµ/СѓСЂРѕРЅСѓ РёР· РѕРїРёСЃР°РЅРёР№ РїРѕРєР° РЅРµ
  // СЂРµР°Р»РёР·РѕРІР°РЅ: РґР»СЏ СЌС‚РѕРіРѕ РЅСѓР¶РЅР° СЃРёСЃС‚РµРјР° РІСЂРµРјРµРЅРЅС‹С… РјРѕРґРёС„РёРєР°С‚РѕСЂРѕРІ.
  pot_health_small: { hp: 50 },
  pot_health_medium: { hp: 150 },
  pot_mana_small: { mana: 40 },
  pot_stamina_small: { stamina: 30 },
  food_kebab: { hp: 80 },
};

export class CharacterService {
  private db = DatabaseService.getInstance();
  private leveling = new LevelingSystem();

  async createCharacter(
    userId: string,
    name: string,
    characterClass: CharacterClass,
    serverId: string = DEFAULT_SERVER_ID,
    /** РљРѕРґ РїСЂРёРіР»Р°С€РµРЅРёСЏ РёР· СЃСЃС‹Р»РєРё ?ref= вЂ” РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј */
    referralCode?: string,
    /** РќР°РґРµС‚С‹Рµ РїСЂРµРґРјРµС‚С‹ РЎРµС„РµРІРёРґРѕРІ (РѕРґРµР¶РґР°, РґРѕСЃРїРµС…Рё, РѕСЂСѓР¶РёРµ РїРѕ СЃР»РѕС‚Р°Рј) */
    equipment?: CharacterEquipment,
  ): Promise<Character> {
    const stats = BASE_STATS[characterClass];
    const maxHp = 100 + stats.endurance * 10;
    const maxMana = 50 + stats.intelligence * 8;
    const maxStamina = 100 + stats.agility * 5;

    // Р§РўРћ Р‘Р«Р›Рћ. РўРѕС‡РєР° СЃС‚Р°СЂС‚Р° Рё СЂРµРіРёРѕРЅ Р·Р°РґР°РІР°Р»РёСЃСЊ РґРІСѓРјСЏ СЂР°Р·РЅС‹РјРё РІРµС‰Р°РјРё:
    // position = (0,0) - СЌС‚Рѕ РСЃС„Р°С…Р°РЅ РїРѕ REGION_SPAWNS, Р° region СЃС‚РѕСЏР»
    // Region.TABRIZ. РџРµСЂСЃРѕРЅР°Р¶ СЂРѕР¶РґР°Р»СЃСЏ РЅР° РїР»РѕС‰Р°РґРё СЃС‚РѕР»РёС†С‹, Р° СЃРµСЂРІРµСЂ
    // СЃС‡РёС‚Р°Р» РµРіРѕ РІ РўРµР±СЂРёР·Рµ, РіРґРµ С‚СЂРµР±СѓРµС‚СЃСЏ 20 СѓСЂРѕРІРµРЅСЊ.
    //
    // Р§РµРј СЌС‚Рѕ РѕР±РѕСЂР°С‡РёРІР°Р»РѕСЃСЊ. РџРµСЂСЃРѕРЅР°Р¶ 1-РіРѕ СѓСЂРѕРІРЅСЏ С‡РёСЃР»РёР»СЃСЏ РІ СЂРµРіРёРѕРЅРµ,
    // РІ РєРѕС‚РѕСЂС‹Р№ РЅРµР»СЊР·СЏ РїРѕРїР°СЃС‚СЊ: С‚СЂРµР±РѕРІР°РЅРёРµ СѓСЂРѕРІРЅСЏ РїРµСЂРµСЃС‚Р°РІР°Р»Рѕ Р±С‹С‚СЊ
    // Р·Р°С‚РІРѕСЂРѕРј, РїРѕС‚РѕРјСѓ С‡С‚Рѕ РЅРѕРІРёС‡РѕРє СЂРѕР¶РґР°Р»СЃСЏ РїРѕ С‚Сѓ СЃС‚РѕСЂРѕРЅСѓ РІРѕСЂРѕС‚.
    // РћС‚СЃСЋРґР° Р¶Рµ РјРѕРЅСЃС‚СЂС‹, РєРѕРјРЅР°С‚С‹ СЃРѕРєРµС‚РѕРІ, С‡Р°С‚ Рё РєРІРµСЃС‚С‹ РєР»СЋС‡РёР»РёСЃСЊ РЅР°
    // РўРµР±СЂРёС†, Р° РёРіСЂРѕРє СЃС‚РѕСЏР» РІ РСЃС„Р°С…Р°РЅРµ, Рё РїРѕРґРїРёСЃСЊ РІ СѓРіР»Сѓ СЌРєСЂР°РЅР° РІСЂР°Р»Р°.
    // Рђ recordRegionVisit СЃСЂР°Р·Сѓ РїРѕРјРµС‡Р°Р» РўРµР±СЂРёР· РїРѕСЃРµС‰С‘РЅРЅС‹Рј - В«РїРѕСЃРµС‚РёС‚СЊ
    // РўРµР±СЂРёР·В» Р·Р°СЃС‡РёС‚С‹РІР°Р»РѕСЃСЊ, РЅРёРєСѓРґР° РЅРµ СЃС…РѕРґРёРІ.
    //
    // РљРѕРјРјРµРЅС‚Р°СЂРёР№ РІ РєРѕРґРµ СЌС‚Рѕ РѕРїСЂР°РІРґС‹РІР°Р»: РјРѕР», РўРµР±СЂРёС† - СЃС‚Р°СЂС‚РѕРІС‹Р№ РіРѕСЂРѕРґ.
    // РќРѕ РіРѕСЂРѕРґ, РєРѕС‚РѕСЂС‹Р№ РїРѕСЃС‚СЂРѕРµРЅ Рё РІ РєРѕС‚РѕСЂС‹Р№ СЃС‚Р°РІСЏС‚ СЃРїР°РІРЅ, - РСЃС„Р°С…Р°РЅ.
    // Р­С‚Рѕ РѕСЃС‚Р°Р»СЃСЏ СЃР»РµРґ РѕС‚ РІСЂРµРјРµРЅРё, РєРѕРіРґР° СЃС‚РѕР»РёС†Сѓ РЅР°Р·С‹РІР°Р»Рё tabriz.
    //
    // Р§РўРћ РЎР”Р•Р›РђРќРћ. РўРѕС‡РєР°, СЂРµРіРёРѕРЅ Рё Р·РѕРЅР° Р±РµСЂСѓС‚СЃСЏ РёР· РћР”РќРћР“Рћ РёСЃС‚РѕС‡РЅРёРєР° -
    // СЏРєРѕСЂСЏ РСЃС„Р°С…Р°РЅР° РІ REGION_SPAWNS, Р° Р·РѕРЅР° СЃС‡РёС‚Р°РµС‚СЃСЏ РѕС‚ С‚РѕР№ Р¶Рµ С‚РѕС‡РєРё
    // С„СѓРЅРєС†РёРµР№ getZoneAt. РўСЂРё РїРѕР»СЏ РЅРµ РјРѕРіСѓС‚ СЂР°Р·РѕР№С‚РёСЃСЊ РјРµР¶РґСѓ СЃРѕР±РѕР№: РёС…
    // РЅРµРіРґРµ РІРІРѕРґРёС‚СЊ РїРѕ РѕС‚РґРµР»СЊРЅРѕСЃС‚Рё.
    const РЎРўРђР РўРћР’Р«Р™_Р Р•Р“РРћРќ = Region.ISFAHAN;
    const СЏРєРѕСЂСЊ = REGION_SPAWNS[РЎРўРђР РўРћР’Р«Р™_Р Р•Р“РРћРќ];
    const СЃС‚Р°СЂС‚РѕРІР°СЏ_РїРѕР·РёС†РёСЏ = { x: СЏРєРѕСЂСЊ.x, y: 0, z: СЏРєРѕСЂСЊ.z };
    const СЃС‚Р°СЂС‚РѕРІР°СЏ_Р·РѕРЅР° = getZoneAt(СЏРєРѕСЂСЊ.x, СЏРєРѕСЂСЊ.z);

    const character: Character = {
      id: uuidv4(),
      userId,
      name,
      class: characterClass,
      level: 1,
      experience: 0,
      stats,
      hp: maxHp,
      maxHp,
      mana: maxMana,
      maxMana,
      stamina: maxStamina,
      maxStamina,
      position: СЃС‚Р°СЂС‚РѕРІР°СЏ_РїРѕР·РёС†РёСЏ,
      region: РЎРўРђР РўРћР’Р«Р™_Р Р•Р“РРћРќ,
      // Р—РѕРЅР° РїРёС€РµС‚СЃСЏ СЃСЂР°Р·Сѓ, РїСЂРё СЃРѕР·РґР°РЅРёРё. Р Р°РЅСЊС€Рµ РєРѕР»РѕРЅРєР° zone РІРѕРѕР±С‰Рµ РЅРµ
      // РїРѕРїР°РґР°Р»Р° РІ INSERT Рё РјРѕР»С‡Р° Р±СЂР°Р»Р° Р·РЅР°С‡РµРЅРёРµ РёР· СѓРјРѕР»С‡Р°РЅРёСЏ Р±Р°Р·С‹, Р°
      // РёРјСЏ СЂРµРіРёРѕРЅР° РІ РёРЅС‚РµСЂС„РµР№СЃРµ Р±СЂР°Р»РѕСЃСЊ РёР· characters.region. Р’РјРµСЃС‚Рµ
      // СЌС‚Рѕ РґР°РІР°Р»Рѕ РїРѕРґРїРёСЃСЊ В«РўРµР±СЂРёР·В» СЂСЏРґРѕРј СЃ РїР»РѕС‰Р°РґСЊСЋ РСЃС„Р°С…Р°РЅР°.
      zone: СЃС‚Р°СЂС‚РѕРІР°СЏ_Р·РѕРЅР°?.id,
      serverId,
      gold: 100,
      equipment: equipment ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.query(
      `INSERT INTO characters
        (id, user_id, name, class, level, experience, stats, hp, max_hp, base_max_hp,
         mana, max_mana, stamina, max_stamina, position, region, zone, server_id, gold, equipment, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        character.id, character.userId, character.name, character.class,
        character.level, character.experience, JSON.stringify(character.stats),
        character.hp, character.maxHp,
        // РџРѕР·РёС†РёСЏ 10 - base_max_hp, СЂРѕРІРЅРѕ РїРѕ РїР»РµР№СЃС…РѕР»РґРµСЂСѓ $10. РќР° СЃРІРѕС‘Рј
        // РјРµСЃС‚Рµ, Р° РЅРµ РІ РєРѕРЅС†Рµ СЃРїРёСЃРєР°: РїР»РµР№СЃС…РѕР»РґРµСЂС‹ РЅСѓРјРµСЂСѓСЋС‚СЃСЏ РїРѕ РїРѕР·РёС†РёРё,
        // Рё Р·РЅР°С‡РµРЅРёРµ РЅР° С‡СѓР¶РѕРј РјРµСЃС‚Рµ РјРѕР»С‡Р° РєР»Р°РґС‘С‚ РѕРґРЅРѕ РїРѕР»Рµ РІ РґСЂСѓРіРѕРµ.
        character.maxHp,
        character.mana, character.maxMana,
        character.stamina, character.maxStamina, JSON.stringify(character.position),
        // 16 - region, 17 - zone. Р—РѕРЅР° РІСЃС‚Р°РІР»РµРЅР° СЂРѕРІРЅРѕ РЅР° СЃРІРѕС‘ РјРµСЃС‚Рѕ:
        // РїСЂРё РґРѕР±Р°РІР»РµРЅРёРё РєРѕР»РѕРЅРєРё РІ РєРѕРЅРµС† СЃРїРёСЃРєР° Р±РµР· СЃРґРІРёРіР° РїР»РµР№СЃС…РѕР»РґРµСЂРѕРІ
        // Р·РЅР°С‡РµРЅРёРµ zone РјРѕР»С‡Р° Р»РµРіР»Рѕ Р±С‹ РІ server_id.
        character.region, character.zone ?? null,
        character.serverId, character.gold,
        JSON.stringify(character.equipment ?? {}),
        character.createdAt, character.updatedAt,
      ]
    );

    // РЎС‚Р°СЂС‚РѕРІС‹Р№ СЂРµРіРёРѕРЅ СЃС‡РёС‚Р°РµС‚СЃСЏ РїРѕСЃРµС‰С‘РЅРЅС‹Рј: РїРµСЂСЃРѕРЅР°Р¶ СЃС‚РѕРёС‚ РІ РЅС‘Рј, Р·РЅР°С‡РёС‚
    // РѕРЅ С‚Р°Рј Рё Р±С‹Р». РРЅР°С‡Рµ В«РїРѕСЃРµС‚РёС‚СЊ РІСЃРµ СЃРµРјСЊ СЂРµРіРёРѕРЅРѕРІВ» Р±С‹Р»Рѕ Р±С‹ РЅРµРґРѕСЃС‚РёР¶РёРјРѕ
    // РґР»СЏ РЅРѕРІРёС‡РєР° - РµРјСѓ РїСЂРёС€Р»РѕСЃСЊ Р±С‹ СЃС…РѕРґРёС‚СЊ РІ РСЃС„Р°С…Р°РЅ, С‡С‚РѕР±С‹ С‚РѕС‚ Р·Р°СЃС‡РёС‚Р°Р»СЃСЏ.
    await this.recordRegionVisit(character.id, character.region);

    // РџСЂРёРіР»Р°С€РµРЅРёРµ РґСЂСѓРіР° Р·Р°СЃС‡РёС‚С‹РІР°РµС‚СЃСЏ Р·РґРµСЃСЊ, Р° РЅРµ РїСЂРё СЂРµРіРёСЃС‚СЂР°С†РёРё:
    // Р·РѕР»РѕС‚Рѕ Р»РµР¶РёС‚ РІ characters.gold, Рё РЅР° РјРѕРјРµРЅС‚ СЂРµРіРёСЃС‚СЂР°С†РёРё Р°РєРєР°СѓРЅС‚Р°
    // РїРµСЂСЃРѕРЅР°Р¶Р° РµС‰С‘ РЅРµС‚. РћС€РёР±РєР° РЅР°С‡РёСЃР»РµРЅРёСЏ РЅРµ РґРѕР»Р¶РЅР° РїРѕРјРµС€Р°С‚СЊ РёРіСЂРѕРєСѓ
    // СЃРѕР·РґР°С‚СЊ РїРµСЂСЃРѕРЅР°Р¶Р°, РїРѕСЌС‚РѕРјСѓ РїСЂРѕСЃС‚Рѕ Р»РѕРіРёСЂСѓРµРј.
    try {
      await new ReferralService().attribute(referralCode, {
        id: character.id,
        userId,
      });
    } catch (err) {
      logger.warn(`[Referral] РЅРµ СѓРґР°Р»РѕСЃСЊ Р·Р°СЃС‡РёС‚Р°С‚СЊ РїСЂРёРіР»Р°С€РµРЅРёРµ: ${(err as Error).message}`);
    }

    // РЁР°Рі РІРѕСЂРѕРЅРєРё В«Р·Р°С€С‘Р» в†’ Р·Р°РІС‘Р» РїРµСЂСЃРѕРЅР°Р¶Р°В». РЎРѕР±С‹С‚РёРµ character_created
    // Р±С‹Р»Рѕ РІ СЃРїРёСЃРєРµ AnalyticsEvent, РЅРѕ РµРіРѕ РЅРµ РїРёСЃР°Р» РЅРёРєС‚Рѕ вЂ” РёР·-Р·Р° С‡РµРіРѕ
    // РІРѕСЂРѕРЅРєСѓ РїРѕСЃС‡РёС‚Р°С‚СЊ Р±С‹Р»Рѕ РЅРµС‡РµРј: Р±РµР· РЅРµРіРѕ РЅРµРёР·РІРµСЃС‚РЅРѕ, СЃРєРѕР»СЊРєРѕ Р»СЋРґРµР№
    // РґРѕС€Р»Рѕ РґРѕ РёРіСЂС‹, Р° СЃРєРѕР»СЊРєРѕ Р·Р°СЃС‚СЂСЏР»Рѕ РЅР° СЌРєСЂР°РЅРµ РІС…РѕРґР°.
    analytics.track(
      'character_created',
      { class: characterClass, serverId },
      userId,
      character.id,
    );

    return character;
  }

  /**
   * Р—Р°РЅСЏС‚Рѕ Р»Рё РёРјСЏ РїРµСЂСЃРѕРЅР°Р¶Р°.
   *
   * РќСѓР¶РЅРѕ РґР»СЏ РІРЅСЏС‚РЅРѕРіРѕ РѕС‚РІРµС‚Р° РёРіСЂРѕРєСѓ: Р±РµР· СЌС‚РѕР№ РїСЂРѕРІРµСЂРєРё СЃРѕРІРїР°РґРµРЅРёРµ РёРјРµРЅРё
   * СЂРѕРЅСЏР»Рѕ РІСЃС‚Р°РІРєСѓ, Рё С‡РµР»РѕРІРµРє РІРёРґРµР» РѕС€РёР±РєСѓ Р±Р°Р·С‹ РІРјРµСЃС‚Рѕ В«СЌС‚Рѕ РёРјСЏ Р·Р°РЅСЏС‚РѕВ».
   * Р РµРіРёСЃС‚СЂ РЅРµ СЂР°Р·Р»РёС‡Р°РµРј вЂ” РёРіСЂРѕРє РЅРµ РґРѕР»Р¶РµРЅ РіР°РґР°С‚СЊ, РІ С‡С‘Рј СЂР°Р·РЅРёС†Р°.
   */
  async isNameTaken(name: string): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM characters WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [name],
    );
    return !!row;
  }

  /**
   * РЈРґР°Р»РµРЅРёРµ РїРµСЂСЃРѕРЅР°Р¶Р° СЃРѕ РІСЃРµРјРё Р·Р°РІРёСЃРёРјРѕСЃС‚СЏРјРё, Сѓ РєРѕС‚РѕСЂС‹С… РЅРµС‚ РєР°СЃРєР°РґР°.
   * Р“Р»Р°РІР° РіРёР»СЊРґРёРё СѓРґР°Р»РёС‚СЊСЃСЏ РЅРµ РјРѕР¶РµС‚ вЂ” СЃРЅР°С‡Р°Р»Р° РїРµСЂРµРґР°С‚СЊ Р»РёРґРµСЂСЃС‚РІРѕ.
   */
  async deleteCharacter(characterId: string): Promise<void> {
    await this.db.transaction(async (client) => {
      const own = await client.query('SELECT id FROM characters WHERE id = $1', [characterId]);
      if (own.rowCount === 0) throw new Error('Character not found');
      const leaderOf = await client.query('SELECT id FROM guilds WHERE leader_id = $1', [characterId]);
      if ((leaderOf.rowCount ?? 0) > 0) {
        throw new Error('Guild leader cannot be deleted: transfer leadership first');
      }
      // РџР°СЂС‚РёРё: РІС‹Р№С‚Рё; РµСЃР»Рё Р»РёРґРµСЂ вЂ” РїРµСЂРµРґР°С‚СЊ СЃС‚Р°СЂРµР№С€РµРјСѓ СѓС‡Р°СЃС‚РЅРёРєСѓ
      const ledParties = await client.query('SELECT id FROM parties WHERE leader_id = $1', [characterId]);
      for (const row of ledParties.rows as { id: string }[]) {
        const other = await client.query(
          `SELECT character_id FROM party_members WHERE party_id = $1 AND character_id <> $2
           ORDER BY joined_at LIMIT 1`,
          [row.id, characterId]
        );
        if (other.rowCount === 0) {
          await client.query('DELETE FROM parties WHERE id = $1', [row.id]);
        } else {
          const next = (other.rows[0] as { character_id: string }).character_id;
          await client.query('UPDATE parties SET leader_id = $1 WHERE id = $2', [next, row.id]);
          await client.query(
            `UPDATE party_members SET role = 'leader' WHERE party_id = $1 AND character_id = $2`,
            [row.id, next]
          );
        }
      }
      await client.query('DELETE FROM party_members WHERE character_id = $1', [characterId]);
      await client.query('DELETE FROM party_invites WHERE inviter_id = $1 OR target_id = $1', [characterId]);
      // РђСѓРєС†РёРѕРЅ Рё С‚РѕСЂРіРѕРІС‹Рµ СЃС‚РµРЅРґС‹: СЃРЅСЏС‚СЊ СЃРІРѕРё Р»РѕС‚С‹
      await client.query('DELETE FROM auction_listings WHERE seller_id = $1 OR buyer_id = $1', [characterId]);
      await client.query('DELETE FROM trade_listings WHERE seller_id = $1', [characterId]);
      await client.query('DELETE FROM trade_history WHERE seller_id = $1 OR buyer_id = $1', [characterId]);
      await client.query('DELETE FROM trade_contracts WHERE seller_id = $1 OR buyer_id = $1', [characterId]);
      // PvP-Р°СЂРµРЅР° Рё РЅР°РіСЂР°РґС‹ Р·Р° РіРѕР»РѕРІСѓ СЃ СѓС‡Р°СЃС‚РёРµРј
      await client.query(
        'DELETE FROM pvp_arena WHERE player1_id = $1 OR player2_id = $1 OR winner_id = $1',
        [characterId]
      );
      await client.query(
        'DELETE FROM bounties WHERE placer_id = $1 OR target_id = $1 OR claimer_id = $1',
        [characterId]
      );
      // Р’РєР»Р°РґС‹ РІ Р±Р°РЅРє РіРёР»СЊРґРёРё вЂ” РѕР±РµР·Р»РёС‡РёС‚СЊ, РёСЃС‚РѕСЂРёСЋ СЃРѕС…СЂР°РЅРёС‚СЊ
      await client.query('UPDATE guild_bank SET deposited_by = NULL WHERE deposited_by = $1', [characterId]);
      await client.query('DELETE FROM characters WHERE id = $1', [characterId]);
    });
  }

  async getCharactersByUser(userId: string): Promise<Character[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return camelizeRows<Character>(rows).map(c => this.parseJsonFields(c));
  }

  async getCharacterById(characterId: string): Promise<Character | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM characters WHERE id = $1',
      [characterId]
    );
    if (!row) return null;
    const character = camelizeRow<Character>(row)!;
    return this.parseJsonFields(character);
  }

  /** JSONB-РєРѕР»РѕРЅРєРё РјРѕРіСѓС‚ РїСЂРёР№С‚Рё СЃС‚СЂРѕРєРѕР№ вЂ” РЅРѕСЂРјР°Р»РёР·СѓРµРј РІ РѕР±СЉРµРєС‚С‹ */
  private parseJsonFields(character: Character): Character {
    const c = character as Character & { stats?: unknown; position?: unknown };
    if (typeof c.stats === 'string') c.stats = JSON.parse(c.stats) as CharacterStats;
    if (typeof c.position === 'string') c.position = JSON.parse(c.position);
    return character;
  }

  /**
   * РќР°С‡РёСЃР»РёС‚СЊ РѕРїС‹С‚. Р•РґРёРЅСЃС‚РІРµРЅРЅР°СЏ С‚РѕС‡РєР° РґР»СЏ РІСЃРµС… РёСЃС‚РѕС‡РЅРёРєРѕРІ (СѓР±РёР№СЃС‚РІР°,
   * РєРІРµСЃС‚С‹, СЂС‹Р±Р°Р»РєР°, РєР°СЂР°РІР°РЅС‹, РґР°РЅР¶Рё, РіСЂСѓРїРїР°), РїРѕСЌС‚РѕРјСѓ РІСЂРµРјРµРЅРЅРѕР№ Р±РѕРЅСѓСЃ
   * В«+50% Рє РѕРїС‹С‚СѓВ» РїСЂРёРјРµРЅСЏРµС‚СЃСЏ РёРјРµРЅРЅРѕ Р·РґРµСЃСЊ Рё СЂР°Р±РѕС‚Р°РµС‚ РІРµР·РґРµ СЃСЂР°Р·Сѓ.
   *
   * РњРЅРѕР¶РёС‚РµР»СЊ РєР°Р¶РґС‹Р№ СЂР°Р· СЃС‡РёС‚Р°РµС‚СЃСЏ РѕС‚ Р±Р°Р·РѕРІРѕР№ СЃСѓРјРјС‹ Р·Р°РЅРѕРІРѕ, Р° РЅРµ
   * РЅР°РєР°РїР»РёРІР°РµС‚СЃСЏ: РїРѕРІС‚РѕСЂРЅС‹Р№ Р·Р°РїСЂРѕСЃ РЅРµ СѓРјРЅРѕР¶РёС‚ РѕРїС‹С‚ РґРІР°Р¶РґС‹.
   */
  async addExperience(characterId: string, amount: number): Promise<{ leveledUp: boolean; newLevel: number }> {
    const character = await this.getCharacterById(characterId);
    if (!character) throw new Error('Character not found');

    const mult = await getBuffService().getExpMultiplier(characterId);
    // РЎРµР·РѕРЅРЅС‹Р№ РїСЂР°Р·РґРЅРёРє. РљРѕРјРјРµРЅС‚Р°СЂРёР№ РІС‹С€Рµ РѕР±РµС‰Р°Р» СЌС‚РѕС‚ Р±РѕРЅСѓСЃ years РЅР°Р·Р°Рґ, Р°
    // РєРѕРґР° РЅРµ Р±С‹Р»Рѕ: СѓРјРЅРѕР¶Р°Р»СЃСЏ С‚РѕР»СЊРєРѕ Р±Р°С„С„ РёР· Р±Р°Р·С‹. РўРµРїРµСЂСЊ СѓРјРЅРѕР¶Р°РµС‚СЃСЏ Рё РѕРЅ.
    const seasonal = seasonalEvent.expMultiplier();
    // Р‘РѕРЅСѓСЃ РїСЂРѕС„РµСЃСЃРёРё В«РСЃСЃР»РµРґРѕРІР°С‚РµР»СЊВ». Р Р°РЅСЊС€Рµ РѕРїРёСЃР°РЅРёРµ РѕР±РµС‰Р°Р»Рѕ В«РѕС‚РєСЂС‹РІР°РµС‚
    // СЃРµРєСЂРµС‚РЅС‹Рµ Р»РѕРєР°С†РёРёВ» вЂ” С‚Р°РєРѕР№ СЃРёСЃС‚РµРјС‹ РІ РёРіСЂРµ РЅРµС‚, Рё РѕР±РµС‰Р°РЅРёРµ Р±С‹Р»Рѕ РїСѓСЃС‚С‹Рј.
    // РўРµРїРµСЂСЊ РѕР±РµС‰Р°РµС‚ РѕРїС‹С‚, Рё РѕРЅ СЃС‡РёС‚Р°РµС‚СЃСЏ Р·РґРµСЃСЊ Р¶Рµ, Р° РЅРµ РІ РѕРїРёСЃР°РЅРёРё.
    const prof = await professionOf(characterId);
    const profExp = professionBonuses(prof?.id ?? null, prof?.level ?? 0).experience;
    // РќР°РІС‹Рє РіРёР»СЊРґРёРё В«Р‘Р»Р°РіРѕСЃР»РѕРІРµРЅРёРµ РЈС‡С‘РЅРѕРіРѕВ». Р”Рѕ СЌС‚РѕРіРѕ РІ data/guilds.ts Р±С‹Р»
    // РѕР±СЉСЏРІР»РµРЅ РЅР°РІС‹Рє СЃ РѕРїРёСЃР°РЅРёРµРј В«+2% Рє РѕРїС‹С‚Сѓ Р·Р° РєР°Р¶РґС‹Р№ СѓСЂРѕРІРµРЅСЊВ», Рё РѕРЅ РЅРµ
    // СЃСѓС‰РµСЃС‚РІРѕРІР°Р» РЅРёРіРґРµ. РўРµРїРµСЂСЊ Р±РѕРЅСѓСЃ РіРёР»СЊРґРёРё РІС…РѕРґРёС‚ РІ С‚Сѓ Р¶Рµ С†РµРїРѕС‡РєСѓ.
    //
    // РћС€РёР±РєР° РЅРµ СЂРѕРЅСЏРµС‚ РЅР°С‡РёСЃР»РµРЅРёРµ РѕРїС‹С‚Р°: РµСЃР»Рё РіРёР»СЊРґРёСЏ РЅРµРґРѕСЃС‚СѓРїРЅР°, РёРіСЂРѕРє
    // РїРѕР»СѓС‡Р°РµС‚ РѕРїС‹С‚ Р±РµР· Р±РѕРЅСѓСЃР°, Р° РЅРµ РѕСЃС‚Р°С‘С‚СЃСЏ Р±РµР· РѕРїС‹С‚Р° РІРѕРѕР±С‰Рµ. РћС‚Р»РѕРІ
    // РѕС€РёР±РєРё Р·РґРµСЃСЊ РЅРµ РјР°СЃРєРёСЂРѕРІРєР° - Р±РѕРЅСѓСЃ РЅРµ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїСЂРёС‡РёРЅРѕР№ РїРѕС‚РµСЂРё
    // РѕРїС‹С‚Р°, РёРЅР°С‡Рµ РѕС‚РєР°Р· Р±Р°Р·С‹ Р±С‹Р» Р±С‹ РЅР°РєР°Р·Р°РЅ РёРіСЂРѕРєСѓ РґРІР°Р¶РґС‹.
    let guildExp = 1;
    try {
      guildExp = (await new GuildService().getBonuses(characterId)).exp;
    } catch {
      guildExp = 1;
    }
    // Р‘РѕРЅСѓСЃ РїРѕРіРѕРґС‹. РћР±СЉСЏРІР»СЏР»СЃСЏ РІ WEATHER_EFFECTS РєР°Рє expMod Рё РЅРµ С‡РёС‚Р°Р»СЃСЏ
    // РЅРёРіРґРµ: РІ РґРѕР¶РґСЊ РѕРїС‹С‚ С€С‘Р» РїРѕ Р±Р°Р·РѕРІРѕР№ СЃС‚Р°РІРєРµ. РЎС‡РёС‚Р°РµС‚СЃСЏ Р·РґРµСЃСЊ, РІ С‚РѕР№
    // Р¶Рµ С†РµРїРѕС‡РєРµ, С‡С‚Рѕ СЃРµР·РѕРЅ, РїСЂРѕС„РµСЃСЃРёСЏ Рё РіРёР»СЊРґРёСЏ.
    const weather = weatherExpMultiplier();
    const total = Math.floor(amount * mult * seasonal * profExp * guildExp * weather);

    // Р”РµР»РµРіРёСЂСѓРµРј РµРґРёРЅРѕР№ СЃРёСЃС‚РµРјРµ РїСЂРѕРєР°С‡РєРё (РїСЂРёСЂРѕСЃС‚ СЃС‚Р°С‚РѕРІ/РЅР°РІС‹РєРѕРІ РїСЂРё level up)
    const result = await this.leveling.addExperience(character, total, 'experience_gain');
    return { leveledUp: result.leveledUp, newLevel: result.leveledUp ? result.newLevel : character.level };
  }

  async updatePosition(characterId: string, position: { x: number; y: number; z: number }): Promise<void> {
    await this.db.query(
      'UPDATE characters SET position = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(position), characterId]
    );
  }

  // ============================================================
  // Р‘РѕРµРІР°СЏ СЃС‚РѕР№РєР°
  // ============================================================

  /**
   * РўРµРєСѓС‰Р°СЏ СЃС‚РѕР№РєР° РїРµСЂСЃРѕРЅР°Р¶Р°.
   *
   * РЎС‚СЂРѕРєР° РёР· Р±Р°Р·С‹ РјРѕР¶РµС‚ РѕРєР°Р·Р°С‚СЊСЃСЏ С‡РµРј СѓРіРѕРґРЅРѕ, РµСЃР»Рё РµС‘ РїСЂР°РІРёР»Рё РІСЂСѓС‡РЅСѓСЋ РёР»Рё
   * Р±Р°Р·Р° РѕС‚СЃС‚Р°Р»Р° РѕС‚ РјРёРіСЂР°С†РёРё. РџРѕСЌС‚РѕРјСѓ РЅРµР·РЅР°РєРѕРјРѕРµ Р·РЅР°С‡РµРЅРёРµ Р·Р°РјРµРЅСЏРµС‚СЃСЏ РѕР±С‹С‡РЅС‹Рј
   * Р±РѕРµРј РїСЂСЏРјРѕ Р·РґРµСЃСЊ: СЃС‚РѕР№РєР° РЅРµ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РїСЂРёС‡РёРЅРѕР№, РїРѕ РєРѕС‚РѕСЂРѕР№ РЅРµ СЂР°Р±РѕС‚Р°РµС‚
   * СѓРґР°СЂ. Р’Р°Р»РёРґР°С†РёСЏ РІ Р±Р°Р·Рµ (CHECK) - РІС‚РѕСЂР°СЏ Р»РёРЅРёСЏ, Р° РЅРµ РµРґРёРЅСЃС‚РІРµРЅРЅР°СЏ.
   */
  async getStance(characterId: string): Promise<CombatStance> {
    const rows = await this.db.query<{ combat_stance: string }>(
      'SELECT combat_stance FROM characters WHERE id = $1',
      [characterId]
    );
    const value = rows[0]?.combat_stance ?? 'balanced';
    return isCombatStance(value) ? value : 'balanced';
  }

  /**
   * РџРµСЂРµРєР»СЋС‡РёС‚СЊ СЃС‚РѕР№РєСѓ.
   *
   * Р’РѕР·РІСЂР°С‰Р°РµС‚ С„Р°РєС‚РёС‡РµСЃРєРё РїСЂРёРјРµРЅС‘РЅРЅСѓСЋ СЃС‚РѕР№РєСѓ: РµСЃР»Рё РїСЂРѕСЃРёР»Рё РЅРµРёР·РІРµСЃС‚РЅСѓСЋ, applied
   * Р±СѓРґРµС‚ 'balanced', Рё РІС‹Р·С‹РІР°СЋС‰РёР№ РєРѕРґ РїРѕРєР°Р¶РµС‚ С‡РµСЃС‚РЅРѕРµ Р·РЅР°С‡РµРЅРёРµ, Р° РЅРµ С‚Рѕ,
   * Рѕ РєРѕС‚РѕСЂРѕРј РїСЂРѕСЃРёР»Рё.
   */
  async setStance(characterId: string, stance: string): Promise<CombatStance> {
    if (!isCombatStance(stance)) return this.getStance(characterId);
    await this.db.query(
      'UPDATE characters SET combat_stance = $1, updated_at = NOW() WHERE id = $2',
      [stance, characterId]
    );
    return stance;
  }

  // ============================================================
  // Р‘РѕРµРІС‹Рµ РѕРїРµСЂР°С†РёРё (РїРµСЂСЃРёСЃС‚РµРЅС‚РЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ HP/РјР°РЅС‹/СЃС‚Р°РјРёРЅС‹)
  // ============================================================

  /** РќР°РЅРµСЃС‚Рё СѓСЂРѕРЅ. Р’РѕР·РІСЂР°С‰Р°РµС‚ РѕСЃС‚Р°РІС€РµРµСЃСЏ HP Рё РїСЂРёР·РЅР°Рє СЃРјРµСЂС‚Рё. */
  /**
   * Р’РµСЂРЅСѓС‚СЊ РїРѕР»РЅРѕРµ Р·РґРѕСЂРѕРІСЊРµ. РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РїРѕСЃР»Рµ Р±РѕСЏ РЅР° Р°СЂРµРЅРµ: СѓСЂРѕРЅ Р±С‹Р»
   * С‡РµСЃС‚РЅС‹Рј, РЅРѕ СЃР»РµРґРѕРІ Рѕ РЅС‘Рј РѕСЃС‚Р°С‚СЊСЃСЏ РЅРµ РґРѕР»Р¶РЅРѕ, РёРЅР°С‡Рµ РїСЂРѕРёРіСЂР°РІС€РёР№ РІС‹С€РµР»
   * Р±С‹ РёР· РіРѕСЂРѕРґР° СЃ 1 HP.
   */
  async restoreHp(characterId: string): Promise<number> {
    const row = await this.db.queryOne<{ hp: number }>(
      'UPDATE characters SET hp = max_hp, updated_at = NOW() WHERE id = $1 RETURNING hp',
      [characterId],
    );
    return row?.hp ?? 0;
  }

  /**
   * РџРµСЂРµСЃС‡РёС‚Р°С‚СЊ Р·Р°РїР°СЃ Р·РґРѕСЂРѕРІСЊСЏ СЃ СѓС‡С‘С‚РѕРј Р±РѕРЅСѓСЃР° РіРёР»СЊРґРёРё.
   *
   * РџРћР§Р•РњРЈ РњР•РќРЇР•РўРЎРЇ РљРћР›РћРќРљРђ, Рђ РќР• Р§РўР•РќРР•. max_hp С‡РёС‚Р°РµС‚ Р±РѕР№: applyDamage
   * РІРѕР·РІСЂР°С‰Р°РµС‚ РµРіРѕ РІРјРµСЃС‚Рµ СЃ СѓСЂРѕРЅРѕРј. Р•СЃР»Рё Р±РѕРЅСѓСЃ СЃС‡РёС‚Р°С‚СЊ РїСЂРё РєР°Р¶РґРѕРј С‡С‚РµРЅРёРё,
   * РІ РіРѕСЂСЏС‡РёР№ РїСѓС‚СЊ РїРѕРїР°РґС‘С‚ Р·Р°РїСЂРѕСЃ РІ Р±Р°Р·Сѓ Р·Р° СѓСЂРѕРІРЅСЏРјРё РЅР°РІС‹РєР° - С‚Рѕ РµСЃС‚СЊ
   * Р·Р°РїСЂРѕСЃ РЅР° РєР°Р¶РґС‹Р№ СѓРґР°СЂ РєР°Р¶РґРѕРіРѕ РёРіСЂРѕРєР°. РџРѕСЌС‚РѕРјСѓ РєРѕР»РѕРЅРєР° РїРµСЂРµСЃС‡РёС‚С‹РІР°РµС‚СЃСЏ
   * РїСЂРё РёР·РјРµРЅРµРЅРёСЏС…, Р° Р±РѕР№ С‡РёС‚Р°РµС‚ РіРѕС‚РѕРІРѕРµ С‡РёСЃР»Рѕ, РєР°Рє Рё СЂР°РЅСЊС€Рµ.
   *
   * РЎС…РµРјР°: max_hp = base_max_hp * РјРЅРѕР¶РёС‚РµР»СЊ. GREATEST(1, ...) - СЂРµС€Р°РµС‚
   * РґРІРµ РІРµС‰Рё: РѕРєСЂСѓРіР»РµРЅРёРµ РЅРµ РјРѕР¶РµС‚ РґР°С‚СЊ РЅРѕР»СЊ, Р° РѕС‚СЂРёС†Р°С‚РµР»СЊРЅС‹Р№ РјРЅРѕР¶РёС‚РµР»СЊ
   * (РјСѓСЃРѕСЂ РІ РґР°РЅРЅС‹С…) РЅРµ СЃРґРµР»Р°РµС‚ РїРµСЂСЃРѕРЅР°Р¶Р° Р±РµСЃСЃРјРµСЂС‚РЅС‹Рј Рё РЅРµ СЃР»РѕРјР°РµС‚ Р±РѕР№.
   *
   * РўРµРєСѓС‰РёР№ hp РЅРµ С‚СЂРѕРіР°РµС‚СЃСЏ: РёРіСЂРѕРє РЅРµ РґРѕР»Р¶РµРЅ С‚РµСЂСЏС‚СЊ Р·РґРѕСЂРѕРІСЊРµ РѕС‚ С‚РѕРіРѕ, С‡С‚Рѕ
   * РєС‚Рѕ-С‚Рѕ РІ РµРіРѕ РіРёР»СЊРґРёРё РєСѓРїРёР» РЅР°РІС‹Рє.
   */
  async recalcMaxHp(characterId: string, multiplier: number): Promise<void> {
    const РјРЅРѕР¶РёС‚РµР»СЊ = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    await this.db.query(
      'UPDATE characters SET max_hp = GREATEST(1, ROUND(base_max_hp * $2::numeric)), updated_at = NOW() WHERE id = $1',
      [characterId, РјРЅРѕР¶РёС‚РµР»СЊ],
    ).catch((e: unknown) => {
      // РћС€РёР±РєР° РЅРµ РїРѕРґРЅРёРјР°РµС‚СЃСЏ: РїРѕС‚РµСЂСЏ Р±РѕРЅСѓСЃР° Р»СѓС‡С€Рµ СѓРїР°РІС€РµРіРѕ РІС‹Р·РѕРІР° РёР·
      // Р»РµРІРµР»РёРЅРіР° РёР»Рё РїРѕРєСѓРїРєРё РЅР°РІС‹РєР°. РџСЂРёС‡РёРЅР° - РІ Р¶СѓСЂРЅР°Р».
      logger.error('[Character] Р·Р°РїР°СЃ Р·РґРѕСЂРѕРІСЊСЏ РЅРµ РїРµСЂРµСЃС‡РёС‚Р°РЅ:', (e as Error).message);
    });
  }

  async applyDamage(characterId: string, damage: number): Promise<{ hp: number; maxHp: number; died: boolean }> {
    const row = await this.db.queryOne<{ hp: number; max_hp: number }>(
      'UPDATE characters SET hp = GREATEST(0, hp - $1), updated_at = NOW() WHERE id = $2 RETURNING hp, max_hp',
      [Math.max(0, Math.floor(damage)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return { hp: row.hp, maxHp: row.max_hp, died: row.hp <= 0 };
  }

  /** Р’РѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ HP (Р»РµС‡РµРЅРёРµ). Р’РѕР·РІСЂР°С‰Р°РµС‚ Р°РєС‚СѓР°Р»СЊРЅРѕРµ HP. */
  async applyHeal(characterId: string, amount: number): Promise<{ hp: number; maxHp: number }> {
    const row = await this.db.queryOne<{ hp: number; max_hp: number }>(
      'UPDATE characters SET hp = LEAST(max_hp, hp + $1), updated_at = NOW() WHERE id = $2 RETURNING hp, max_hp',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return { hp: row.hp, maxHp: row.max_hp };
  }

  /** РЎРїРёСЃР°С‚СЊ РјР°РЅСѓ/СЃС‚Р°РјРёРЅСѓ. false вЂ” РµСЃР»Рё СЂРµСЃСѓСЂСЃРѕРІ РЅРµ С…РІР°С‚Р°РµС‚ (РґРµР№СЃС‚РІРёРµ РЅРµРІРѕР·РјРѕР¶РЅРѕ). */
  async spendResources(characterId: string, manaCost: number, staminaCost: number): Promise<boolean> {
    const affected = await this.db.run(
      `UPDATE characters SET
         mana = mana - $1, stamina = stamina - $2, updated_at = NOW()
       WHERE id = $3 AND mana >= $1 AND stamina >= $2`,
      [Math.max(0, manaCost), Math.max(0, staminaCost), characterId]
    );
    return affected > 0;
  }

  /**
   * Р’РѕР·СЂРѕР¶РґРµРЅРёРµ РїРѕСЃР»Рµ СЃРјРµСЂС‚Рё: 50% HP/РјР°РЅС‹ Рё РїРѕР»РЅР°СЏ СЃС‚Р°РјРёРЅР°.
   *
   * `spot` вЂ” С‚РѕС‡РєР° СЃРјРµСЂС‚Рё (СЂРµСЃРїР°РІРЅ РЅР° РјРµСЃС‚Рµ Р·Р° Р·РѕР»РѕС‚Рѕ). Р‘РµР· РЅРµС‘ РёРіСЂРѕРє
   * РІРѕР·РІСЂР°С‰Р°РµС‚СЃСЏ РЅР° СЃС‚Р°СЂС‚РѕРІСѓСЋ С‚РѕС‡РєСѓ СЂРµРіРёРѕРЅР°.
   * `goldCost` СЃРїРёСЃС‹РІР°РµС‚СЃСЏ Р’ РўРћРњ Р–Р• UPDATE, С‡С‚Рѕ Рё РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ: РґРІРµ
   * РѕС‚РґРµР»СЊРЅС‹Рµ РѕРїРµСЂР°С†РёРё РѕСЃС‚Р°РІР»СЏР»Рё Р±С‹ РѕРєРЅРѕ, РІ РєРѕС‚РѕСЂРѕРј РїРµСЂСЃРѕРЅР°Р¶ СѓР¶Рµ Р¶РёРІРѕР№,
   * Р° Р·РѕР»РѕС‚Рѕ РµС‰С‘ РЅРµ СЃРїРёСЃР°РЅРѕ (РёР»Рё РЅР°РѕР±РѕСЂРѕС‚). `WHERE gold >= $3` РґРµР»Р°РµС‚
   * РїСЂРѕРІРµСЂРєСѓ Рё СЃРїРёСЃР°РЅРёРµ Р°С‚РѕРјР°СЂРЅС‹РјРё вЂ” РєРѕРЅРєСѓСЂРµРЅС‚РЅС‹Р№ РІС‹Р·РѕРІ РЅРµ СЃРјРѕР¶РµС‚
   * РІРѕСЃРєСЂРµСЃРёС‚СЊ Р±РµСЃРїР»Р°С‚РЅРѕ.
   *
   * РќРёС‡РµРіРѕ РЅРµ Р±СЂРѕСЃР°РµС‚: РЅРµСѓРґР°С‡Р° РѕРїРёСЃР°РЅР° РІ СЂРµР·СѓР»СЊС‚Р°С‚Рµ, РІС‹Р·С‹РІР°СЋС‰РёР№ СЂРµС€Р°РµС‚,
   * С‡С‚Рѕ РїРѕРєР°Р·Р°С‚СЊ РёРіСЂРѕРєСѓ.
   */
  async respawn(
    characterId: string,
    options: { spot?: { x: number; z: number }; goldCost?: number } = {}
  ): Promise<
    | { ok: true; hp: number; maxHp: number; gold: number; position: { x: number; y: number; z: number } }
    | { ok: false; reason: 'not_found' | 'no_gold' }
  > {
    // Р РµСЃРїР°РІРЅ РЅР° РјРµСЃС‚Рµ вЂ” С‚РѕС‡РєР° СѓР¶Рµ РёР·РІРµСЃС‚РЅР°, СЂРµРіРёРѕРЅ Р·Р° РЅРµР№ РЅРµ РЅСѓР¶РµРЅ
    let position: { x: number; z: number };
    if (options.spot) {
      position = { x: options.spot.x, z: options.spot.z };
    } else {
      const current = await this.db.queryOne<{ region: string }>(
        'SELECT region FROM characters WHERE id = $1',
        [characterId]
      );
      position = getRegionSpawn(current?.region ?? Region.TABRIZ);
    }
    const point = { x: position.x, y: 0, z: position.z };
    const cost = Math.max(0, Math.floor(options.goldCost ?? 0));
    const row = await this.db.queryOne<{ hp: number; max_hp: number; gold: number }>(
      `UPDATE characters SET
         hp = GREATEST(1, FLOOR(max_hp * 0.5)),
         mana = GREATEST(FLOOR(max_mana * 0.5), 0),
         stamina = max_stamina,
         position = $2::jsonb,
         gold = gold - $3,
         updated_at = NOW()
       WHERE id = $1 AND gold >= $3
       RETURNING hp, max_hp, gold`,
      [characterId, JSON.stringify(point), cost]
    );
    if (row) {
      return { ok: true, hp: row.hp, maxHp: row.max_hp, gold: Number(row.gold), position: point };
    }
    // UPDATE РЅРёС‡РµРіРѕ РЅРµ РІРµСЂРЅСѓР»: Р»РёР±Рѕ РїРµСЂСЃРѕРЅР°Р¶Р° РЅРµС‚, Р»РёР±Рѕ РЅРµ С…РІР°С‚РёР»Рѕ Р·РѕР»РѕС‚Р°
    if (cost <= 0) return { ok: false, reason: 'not_found' };
    const exists = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM characters WHERE id = $1',
      [characterId]
    );
    return exists ? { ok: false, reason: 'no_gold' } : { ok: false, reason: 'not_found' };
  }

  /** РњР°РєСЃРёРјР°Р»СЊРЅС‹Р№ СѓСЂРѕРІРµРЅСЊ (РёР· РѕР±С‰РёС… РєРѕРЅСЃС‚Р°РЅС‚) */
  getMaxLevel(): number {
    return MAX_LEVEL;
  }

  // ============================================================
  // Р РµРіРµРЅРµСЂР°С†РёСЏ Рё СЂРµСЃСѓСЂСЃС‹
  // ============================================================

  /**
   * Р РµРіРµРЅРµСЂР°С†РёСЏ СЂРµСЃСѓСЂСЃРѕРІ (Р·Р° 5-СЃРµРєСѓРЅРґРЅС‹Р№ С‚РёРє СЃРµСЂРІРµСЂР°).
   * `inWater` вЂ” РёРіСЂРѕРє РІ РіР»СѓР±РѕРєРѕР№ РІРѕРґРµ: СЃС‚Р°РјРёРЅР° РЅРµ РІРѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµС‚СЃСЏ, Р°
   * СЂР°СЃС…РѕРґСѓРµС‚СЃСЏ. Р Р°РЅСЊС€Рµ РѕРЅР° regen'РёР»Р°СЃСЊ РѕРґРёРЅР°РєРѕРІРѕ РґР»СЏ СЃС‚РѕСЏС‰РµРіРѕ, Р±РµРіСѓС‰РµРіРѕ
   * Рё РїР»С‹РІСѓС‰РµРіРѕ вЂ” РїР»С‹С‚СЊ РјРѕР¶РЅРѕ Р±С‹Р»Рѕ Р±РµСЃРєРѕРЅРµС‡РЅРѕ.
   */
  /**
   * РњРµРґР»РµРЅРЅС‹Р№ РѕС‚РґС‹С… Рё СЂР°СЃС…РѕРґ РІС‹РЅРѕСЃР»РёРІРѕСЃС‚Рё РѕРЅР»Р°Р№РЅ-РёРіСЂРѕРєРѕРІ.
   *
   * sprinting вЂ” Р±РµР¶Р°Р» Р»Рё РёРіСЂРѕРє РІ СЌС‚Рѕ РѕРєРЅРѕ СЂРµРіРµРЅРµСЂР°С†РёРё (5 СЃРµРєСѓРЅРґ). РћРїСЂРµРґРµР»СЏРµС‚СЃСЏ
   * РїРѕ РёР·РјРµСЂРµРЅРЅРѕР№ СЃРєРѕСЂРѕСЃС‚Рё РјРµР¶РґСѓ РґРІСѓРјСЏ С‚РёРєР°РјРё, Р° РЅРµ РїРѕ СЃР»РѕРІР°Рј РєР»РёРµРЅС‚Р°: РёРЅР°С‡Рµ
   РїРѕРґРґРµР»Р°С‚СЊ РјРѕР¶РЅРѕ В«РЅРµ РѕС‚РїСЂР°РІР»СЏР№ РїР°РєРµС‚ РґРІРёР¶РµРЅРёСЏВ», СЂРѕРІРЅРѕ РєР°Рє СЃ В«СЏ РЅРµ РІ РІРѕРґРµВ».
   *
   * РћРєРЅРѕ СЃС‡РёС‚Р°РµС‚СЃСЏ С†РµР»РёРєРѕРј: Р·Р° РїСЏС‚СЊ СЃРµРєСѓРЅРґ РёРіСЂРѕРє РјРѕР¶РµС‚ РЅР°С‡Р°С‚СЊ Р±РµРі Рё РѕСЃС‚Р°РЅРѕРІРёС‚СЊСЃСЏ
   * РїРѕСЃРµСЂРµРґРёРЅРµ, Р° СЃРµСЂРІРµСЂ Р·РЅР°РµС‚ С‚РѕР»СЊРєРѕ РґРІРµ С‚РѕС‡РєРё. РўРѕС‡РЅСѓСЋ РєР°СЂС‚РёРЅСѓ РІРµРґС‘С‚ РєР»РёРµРЅС‚, Сѓ
   * РєРѕС‚РѕСЂРѕРіРѕ Shift РЅР°Р¶Р°С‚ РІ РєР°Р¶РґС‹Р№ РјРѕРјРµРЅС‚, Р·РґРµСЃСЊ Р¶Рµ вЂ” РіСЂСѓР±Р°СЏ СЃС‚СЂР°С…РѕРІРєР° РѕС‚
   * Р±РµСЃРїР»Р°С‚РЅРѕРіРѕ Р±РµРіР°.
   */
  async regenResources(characterId: string, inWater = false, sprinting = false): Promise<{
    hp: number; maxHp: number; mana: number; maxMana: number;
    stamina: number; maxStamina: number; level: number; experience: number; gold: number;
  } | null> {
    // Р’ РІРѕРґРµ СЂР°СЃС…РѕРґ Р·Р° Р±РµРі РЅРµ РёРјРµРµС‚ СЃРјС‹СЃР»Р°: С‚Р°Рј СЃРІРѕСЏ, Р±РѕР»РµРµ РґРѕСЂРѕРіР°СЏ СЃС‚СЂРѕРєР°.
    const Р±РµРі = inWater ? false : sprinting === true;
    const row = await this.db.queryOne<Record<string, number>>(
      `UPDATE characters SET
         hp      = LEAST(max_hp,      hp + GREATEST(1, FLOOR(max_hp * 0.012) * 5)),
         mana    = LEAST(max_mana,    mana + GREATEST(1, FLOOR(max_mana * 0.02) * 5)),
         stamina = CASE WHEN $2::boolean
                        THEN GREATEST(0, stamina - GREATEST(1, FLOOR(max_stamina * $3) * 5))
                        WHEN $4::boolean
                        THEN GREATEST(0, stamina - GREATEST(1, FLOOR(max_stamina * $5) * 5))
                        ELSE LEAST(max_stamina, stamina + GREATEST(1, FLOOR(max_stamina * 0.04) * 5))
                   END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING hp, max_hp, mana, max_mana, stamina, max_stamina, level, experience, gold`,
      [characterId, inWater, STAMINA.SWIM_DRAIN_PER_5S, Р±РµРі, STAMINA.SPRINT_DRAIN_PER_5S]
    );
    if (!row) return null;
    return {
      hp: Number(row.hp), maxHp: Number(row.max_hp),
      mana: Number(row.mana), maxMana: Number(row.max_mana),
      stamina: Number(row.stamina), maxStamina: Number(row.max_stamina),
      level: Number(row.level), experience: Number(row.experience), gold: Number(row.gold),
    };
  }

  /**
   * РќР°С‡РёСЃР»РёС‚СЊ Р·РѕР»РѕС‚Рѕ. Р’РѕР·РІСЂР°С‰Р°РµС‚ РЅРѕРІС‹Р№ Р±Р°Р»Р°РЅСЃ.
   *
   * РЎСѓРјРјР° РїСЂРёРІРѕРґРёС‚СЃСЏ Рє РЅСѓР»СЋ СЃРЅРёР·Сѓ, РїРѕСЌС‚РѕРјСѓ РјРµС‚РѕРґ СѓРјРµРµС‚ С‚РѕР»СЊРєРѕ РџР РР‘РђР’Р›РЇРўР¬.
   * Р Р°СЃС…РѕРґ РёРґС‘С‚ С‡РµСЂРµР· spendGold, РІРѕР·РІСЂР°С‚ Р·Р° РЅРµСѓРґР°С‡РЅСѓСЋ РїРѕРєСѓРїРєСѓ - С‚РѕР¶Рµ СЃСЋРґР°.
   * РЎРµР·РѕРЅРЅРѕРіРѕ Р±РѕРЅСѓСЃР° Р·РґРµСЃСЊ РЅРµС‚ РЅР°РјРµСЂРµРЅРЅРѕ: СѓРјРЅРѕР¶Р°С‚СЊ РІРѕР·РІСЂР°С‚ РЅРµР»СЊР·СЏ, РёРЅР°С‡Рµ РІРѕ
   * РІСЂРµРјСЏ РїСЂР°Р·РґРЅРёРєР° РЅРµСѓРґР°С‡РЅР°СЏ РїРѕРєСѓРїРєР° РїР»Р°С‚РёР»Р° Р±С‹ СЃРІРµСЂС….
   */
  async addGold(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ gold: number }>(
      'UPDATE characters SET gold = gold + $1 WHERE id = $2 RETURNING gold',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.gold);
  }

  /**
   * РќР°С‡РёСЃР»РёС‚СЊ Р·РѕР»РѕС‚Рѕ Р—Рђ РќРђР“Р РђР”РЈ вЂ” СЃ СЃРµР·РѕРЅРЅС‹Рј Р±РѕРЅСѓСЃРѕРј.
   *
   * РћС‚РґРµР»СЊРЅС‹Р№ РјРµС‚РѕРґ, Р° РЅРµ С„Р»Р°Р¶РѕРє Сѓ addGold, РїРѕС‚РѕРјСѓ С‡С‚Рѕ С‡РµСЂРµР· addGold РёРґС‘С‚
   * Рё РІРѕР·РІСЂР°С‚ Р·Р° РЅРµСѓРґР°С‡РЅСѓСЋ РїРѕРєСѓРїРєСѓ. Р•СЃР»Рё Р±С‹ Р±РѕРЅСѓСЃ РїСЂРёРјРµРЅСЏР»СЃСЏ С‚Р°Рј, С‚Рѕ РІРѕ
   * РІСЂРµРјСЏ РїСЂР°Р·РґРЅРёРєР° РІРѕР·РІСЂР°С‚ РїР»Р°С‚РёР» Р±С‹ Р±РѕР»СЊС€Рµ, С‡РµРј РѕС‚РґР°РЅРѕ.
   */
/**
 * РљР°СЂРјР° РїРµСЂСЃРѕРЅР°Р¶Р°.
 *
 * РћС‚РґРµР»СЊРЅРѕРµ С‡С‚РµРЅРёРµ: РІ С‚РёРїРµ Character РїРѕР»СЏ karma РЅРµС‚, РєР°СЂРјР° Р»РµР¶РёС‚ РІ РєРѕР»РѕРЅРєРµ
 * characters, РЅРѕ РІ РѕР±СЉРµРєС‚ РїРµСЂСЃРѕРЅР°Р¶Р° РЅРµ РїРѕРїР°РґР°РµС‚. РњРµСЃС‚Р°, РіРґРµ РѕРЅР° РЅСѓР¶РЅР°,
 * РёРґСѓС‚ С‡РµСЂРµР· СЌС‚РѕС‚ РјРµС‚РѕРґ, Р° РЅРµ РїРёС€СѓС‚ СЃРІРѕР№ Р·Р°РїСЂРѕСЃ: С„РѕСЂРјСѓР»РёСЂРѕРІРєРё СЂР°Р·СЉРµР·Р¶Р°СЋС‚СЃСЏ,
 * Рё РїСЂРѕ null Р·Р°Р±С‹РІР°РµС‚ РѕРґРЅР° РёР· СЃС‚РѕСЂРѕРЅ.
 *
 * РћС‚СЃСѓС‚СЃС‚РІРёРµ СЃС‚СЂРѕРєРё вЂ” СЌС‚Рѕ РЅРѕР»СЊ, С‚Рѕ РµСЃС‚СЊ РЅРµР№С‚СЂР°Р»СЊРЅС‹Р№ РїРµСЂСЃРѕРЅР°Р¶. Р›СѓС‡С€Рµ, С‡РµРј
 * РјРѕР»С‡Р°Р»РёРІС‹Р№ undefined, РЅР° РєРѕС‚РѕСЂРѕРј Р°СЂРёС„РјРµС‚РёРєР° РґР°С‘С‚ NaN.
 */
  async getKarma(characterId: string): Promise<number> {
    const row = await this.db.queryOne<{ karma: number | null }>(
      'SELECT karma FROM characters WHERE id = $1',
      [characterId],
    );
    return Number(row?.karma ?? 0);
  }

  async addGoldReward(characterId: string, amount: number): Promise<number> {
    return this.addGold(characterId, Math.floor(amount * seasonalEvent.goldMultiplier()));
  }

  /**
   * Р’РµСЂРЅСѓС‚СЊ РїРѕС‚СЂР°С‡РµРЅРЅРѕРµ - РІ С‚РѕР№ Р¶Рµ РІР°Р»СЋС‚Рµ, РІ РєРѕС‚РѕСЂРѕР№ С‚СЂР°С‚РёР»Рё.
   *
   * РџРћР§Р•РњРЈ Р­РўРћ РќР• В«РџР РћРЎРўРћ Р’Р•Р РќРЈРўР¬ Р’ Р—РћР›РћРўРћВ». РњР°СЂС€СЂСѓС‚ РїРѕРєСѓРїРєРё СЃРїРёСЃС‹РІР°РµС‚
   * С†РµРЅСѓ РёР· РєРѕС€РµР»СЊРєР°, РєРѕС‚РѕСЂС‹Р№ СѓРєР°Р·Р°Р» РјР°РіР°Р·РёРЅ, Рё РїСЂРё РЅРµСѓРґР°С‡РЅРѕР№ РІС‹РґР°С‡Рµ
   * РІРѕР·РІСЂР°С‰Р°Р» СЃСѓРјРјСѓ С‡РµСЂРµР· addGold - С‚Рѕ РµСЃС‚СЊ РІСЃРµРіРґР° Р·РѕР»РѕС‚РѕРј. РЎРµРіРѕРґРЅСЏ РІСЃРµ
   * Р»РѕРґРєРё РїСЂРѕРґР°СЋС‚СЃСЏ Р·Р° Р·РѕР»РѕС‚Рѕ, РїРѕСЌС‚РѕРјСѓ СЂР°СЃС…РѕР¶РґРµРЅРёРµ РЅРµ РїСЂРѕСЏРІР»СЏР»РѕСЃСЊ. РќРѕ
   * СЃС‚РѕРёС‚ РїРѕР»РѕР¶РёС‚СЊ Р»РѕРґРєСѓ РІ РјР°РіР°Р·РёРЅ Р·Р° Р°Р·РµРЅС‹ - Рё РїРѕРєСѓРїРєР° В«РїР»Р°С‚РёС‚ Р°Р·РµРЅР°РјРё,
   * Р° РІРѕР·РІСЂР°С‰Р°РµС‚ Р·РѕР»РѕС‚РѕВ»: РїСЂРµРјРёР°Р»СЊРЅР°СЏ РІР°Р»СЋС‚Р° РїСЂРµРІСЂР°С‰Р°РµС‚СЃСЏ РІ Р·РѕР»РѕС‚Рѕ, С‚Рѕ
   * РµСЃС‚СЊ РїРѕРєСѓРїРєР° СЃС‚Р°РЅРѕРІРёС‚СЃСЏ РѕР±РјРµРЅРѕРј РІР°Р»СЋС‚С‹, Р° РЅРµ РїРѕРєСѓРїРєРѕР№.
   *
   * Р’РѕР·РІСЂР°С‚ РёРґС‘С‚ С‡РµСЂРµР· add*, Р° РЅРµ С‡РµСЂРµР· addGoldReward: СЌС‚Рѕ РЅРµ РЅР°РіСЂР°РґР°, Рё
   * СЃРµР·РѕРЅРЅС‹Р№ Р±РѕРЅСѓСЃ Рє РІРѕР·РІСЂР°С‚Сѓ РѕС‚РЅРѕС€РµРЅРёСЏ РЅРµ РёРјРµРµС‚.
   */
  async refund(characterId: string, wallet: WalletCurrency, amount: number): Promise<void> {
    const value = Math.max(0, Math.floor(amount));
    if (value === 0) return;
    if (wallet === 'azens') { await this.addAzens(characterId, value); return; }
    if (wallet === 'silver') { await this.addSilver(characterId, value); return; }
    if (wallet === 'syrian') { await this.addSyrianGold(characterId, value); return; }
    await this.addGold(characterId, value);
  }

  /** РђС‚РѕРјР°СЂРЅРѕ СЃРїРёСЃР°С‚СЊ Р·РѕР»РѕС‚Рѕ. Р‘СЂРѕСЃР°РµС‚ РѕС€РёР±РєСѓ, РµСЃР»Рё СЃСЂРµРґСЃС‚РІ РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ. Р’РѕР·РІСЂР°С‰Р°РµС‚ РѕСЃС‚Р°С‚РѕРє. */
  async spendGold(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, Math.floor(amount));
    const row = await this.db.queryOne<{ gold: number }>(
      'UPDATE characters SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING gold',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient gold');
    return Number(row.gold);
  }

  /** РќР°С‡РёСЃР»РёС‚СЊ AZENS (РїСЂРµРјРёСѓРј-РІР°Р»СЋС‚Р°). Р’РѕР·РІСЂР°С‰Р°РµС‚ РЅРѕРІС‹Р№ Р±Р°Р»Р°РЅСЃ. */
  async addAzens(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ azens: number }>(
      'UPDATE characters SET azens = azens + $1 WHERE id = $2 RETURNING azens',
      [Math.max(0, amount), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.azens);
  }

  /** РђС‚РѕРјР°СЂРЅРѕ СЃРїРёСЃР°С‚СЊ AZENS. Р‘СЂРѕСЃР°РµС‚ РѕС€РёР±РєСѓ РїСЂРё РЅРµС…РІР°С‚РєРµ. Р’РѕР·РІСЂР°С‰Р°РµС‚ РѕСЃС‚Р°С‚РѕРє. */
  async spendAzens(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, amount);
    const row = await this.db.queryOne<{ azens: number }>(
      'UPDATE characters SET azens = azens - $1 WHERE id = $2 AND azens >= $1 RETURNING azens',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient AZENS');
    return Number(row.azens);
  }

  /** РќР°С‡РёСЃР»РёС‚СЊ РёСЃС„Р°С…Р°РЅСЃРєРѕРµ СЃРµСЂРµР±СЂРѕ (Р±РµСЃРїР»Р°С‚РЅР°СЏ РІР°Р»СЋС‚Р° РєРІРµСЃС‚РѕРІ/РёРІРµРЅС‚РѕРІ). */
  async addSilver(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ isfahan_silver: number }>(
      'UPDATE characters SET isfahan_silver = isfahan_silver + $1 WHERE id = $2 RETURNING isfahan_silver',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.isfahan_silver);
  }

  /** РќР°С‡РёСЃР»РёС‚СЊ СЃРёСЂРёР№СЃРєРѕРµ Р·РѕР»РѕС‚Рѕ (Р±РµСЃРїР»Р°С‚РЅР°СЏ РІР°Р»СЋС‚Р° РєРІРµСЃС‚РѕРІ/РёРІРµРЅС‚РѕРІ). */
  async addSyrianGold(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ syrian_gold: number }>(
      'UPDATE characters SET syrian_gold = syrian_gold + $1 WHERE id = $2 RETURNING syrian_gold',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.syrian_gold);
  }

  /** РђС‚РѕРјР°СЂРЅРѕ СЃРїРёСЃР°С‚СЊ РёСЃС„Р°С…Р°РЅСЃРєРѕРµ СЃРµСЂРµР±СЂРѕ. Р‘СЂРѕСЃР°РµС‚ РѕС€РёР±РєСѓ РїСЂРё РЅРµС…РІР°С‚РєРµ. */
  async spendSilver(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, Math.floor(amount));
    const row = await this.db.queryOne<{ isfahan_silver: number }>(
      'UPDATE characters SET isfahan_silver = isfahan_silver - $1 WHERE id = $2 AND isfahan_silver >= $1 RETURNING isfahan_silver',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient Isfahan silver');
    return Number(row.isfahan_silver);
  }

  /** РђС‚РѕРјР°СЂРЅРѕ СЃРїРёСЃР°С‚СЊ СЃРёСЂРёР№СЃРєРѕРµ Р·РѕР»РѕС‚Рѕ. Р‘СЂРѕСЃР°РµС‚ РѕС€РёР±РєСѓ РїСЂРё РЅРµС…РІР°С‚РєРµ. */
  async spendSyrianGold(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, Math.floor(amount));
    const row = await this.db.queryOne<{ syrian_gold: number }>(
      'UPDATE characters SET syrian_gold = syrian_gold - $1 WHERE id = $2 AND syrian_gold >= $1 RETURNING syrian_gold',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient Syrian gold');
    return Number(row.syrian_gold);
  }

  /** РђС‚РѕРјРЅС‹Р№ РѕР±РјРµРЅ СЃРІРѕР±РѕРґРЅС‹С… РІР°Р»СЋС‚ (Р·РѕР»РѕС‚Рѕ/СЃРµСЂРµР±СЂРѕ/СЃРёСЂРёР№СЃРєРѕРµ Р·РѕР»РѕС‚Рѕ). */
  async exchange(
    characterId: string,
    debit: 'gold' | 'isfahan_silver' | 'syrian_gold',
    debitAmount: number,
    credit: 'gold' | 'isfahan_silver' | 'syrian_gold',
    creditAmount: number
  ): Promise<{ gold: number; silver: number; syrian: number }> {
    const cols = ['gold', 'isfahan_silver', 'syrian_gold'] as const;
    if (!cols.includes(debit) || !cols.includes(credit) || debit === credit) {
      throw new Error('Bad exchange pair');
    }
    const give = Math.max(1, Math.floor(debitAmount));
    const get = Math.max(1, Math.floor(creditAmount));
    const row = await this.db.queryOne<{ gold: number; isfahan_silver: number; syrian_gold: number }>(
      `UPDATE characters SET ${debit} = ${debit} - $1, ${credit} = ${credit} + $2
       WHERE id = $3 AND ${debit} >= $1
       RETURNING gold, isfahan_silver, syrian_gold`,
      [give, get, characterId]
    );
    if (!row) throw new Error('Insufficient funds for exchange');
    return { gold: Number(row.gold), silver: Number(row.isfahan_silver), syrian: Number(row.syrian_gold) };
  }

  /** РўРѕС‡РЅС‹Р№ РїРѕРёСЃРє РїРµСЂСЃРѕРЅР°Р¶Р° РїРѕ РёРјРµРЅРё (РґР»СЏ РїРѕРґР°СЂРєРѕРІ). */
  async getCharacterByNameExact(name: string): Promise<Character | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM characters WHERE name = $1',
      [name]
    );
    if (!row) return null;
    return this.parseJsonFields(camelizeRow<Character>(row)!);
  }

  /** Р”РѕР»РіРѕРІР°СЏ РїРѕР»РёС‚РёРєР°: РїСЂРё РјРёРЅСѓСЃРµ РїРѕ AZENS (С‡Р°СЂРґР¶Р±СЌРє/СЂРµС„Р°РЅРґ) Р»СЋР±С‹Рµ С‚СЂР°С‚С‹
   *  Р·Р°РїСЂРµС‰РµРЅС‹ РґРѕ РїРѕРіР°С€РµРЅРёСЏ. РџСЂРѕРІРµСЂСЏС‚СЊ РїРµСЂРµРґ РєР°Р¶РґРѕР№ С‚СЂР°С‚РѕР№ AZENS. */
  async assertSolvent(characterId: string): Promise<void> {
    const row = await this.db.queryOne<{ azens: number }>(
      'SELECT azens FROM characters WHERE id = $1',
      [characterId]
    );
    if (!row) throw new Error('Character not found');
    if (Number(row.azens) < 0) throw new Error('AZENS debt: top up to continue');
  }

  /**
   * РћС‚РјРµС‚РёС‚СЊ, С‡С‚Рѕ РїРµСЂСЃРѕРЅР°Р¶ РїРѕР±С‹РІР°Р» РІ СЂРµРіРёРѕРЅРµ.
   *
   * Р—Р°С‡РµРј РѕС‚РґРµР»СЊРЅР°СЏ С‚Р°Р±Р»РёС†Р° РїРѕСЃРµС‰РµРЅРёР№, РµСЃР»Рё РµСЃС‚СЊ characters.region: С‚Р°Рј Р»РµР¶РёС‚
   * РўР•РљРЈР©РР™ СЂРµРіРёРѕРЅ, Р° РґРѕСЃС‚РёР¶РµРЅРёСЏРј РЅСѓР¶РµРЅ РІРµСЃСЊ РїСЂРѕР№РґРµРЅРЅС‹Р№ РїСѓС‚СЊ. РР· РѕРґРЅРѕРіРѕ
   * СЃС‚РѕР»Р±С†Р° В«РіРґРµ РїРµСЂСЃРѕРЅР°Р¶ СЃРµР№С‡Р°СЃВ» РЅРµР»СЊР·СЏ РІС‹РІРµСЃС‚Рё РЅРё В«РїРѕСЃРµС‚РёР» РўРµР±СЂРёР·В», РЅРё
   * В«РїРѕСЃРµС‚РёР» РІСЃРµ СЃРµРјСЊВ» - РІ РЅС‘Рј Р»РµР¶РёС‚ С‚РѕР»СЊРєРѕ РѕРґРЅР° С‚РѕС‡РєР° РјР°СЂС€СЂСѓС‚Р°.
   *
   * ON CONFLICT DO NOTHING, Р° РЅРµ DO UPDATE СЃРѕ СЃС‡С‘С‚С‡РёРєРѕРј РїСЂРёС…РѕРґРѕРІ: РїРѕРІС‚РѕСЂРЅС‹Р№
   * РїСЂРёС…РѕРґ РІ С‚РѕС‚ Р¶Рµ РіРѕСЂРѕРґ РЅРµ РґРѕР»Р¶РµРЅ РЅРё РїР»РѕРґРёС‚СЊ СЃС‚СЂРѕРєРё, РЅРё С‚СЂРµР±РѕРІР°С‚СЊ Р·Р°РїРёСЃРё.
   * РЎС‚СЂРѕРєР° РѕР·РЅР°С‡Р°РµС‚ В«Р·РґРµСЃСЊ Р±С‹Р»В», Р° РЅРµ В«СЃРєРѕР»СЊРєРѕ СЂР°Р· С…РѕРґРёР»В».
   *
   * РћС€РёР±РєР° РЅРµ РїРѕРґРЅРёРјР°РµС‚СЃСЏ. Р•СЃР»Рё Р·Р°РїРёСЃСЊ РЅРµ Р»РµРіР»Р°, РїРµСЂСЃРѕРЅР°Р¶ РІСЃС‘ СЂР°РІРЅРѕ
   * РѕРєР°Р·Р°Р»СЃСЏ РІ СЂРµРіРёРѕРЅРµ, Рё СЂРѕРЅСЏС‚СЊ РїСѓС‚РµС€РµСЃС‚РІРёРµ РёР·-Р·Р° РѕС‚РјРµС‚РєРё Р·РЅР°С‡РёР»Рѕ Р±С‹
   * РЅР°РєР°Р·Р°С‚СЊ РёРіСЂРѕРєР° Р·Р° С‚Рѕ, С‡С‚Рѕ РѕРЅ РїСЂРѕСЃС‚Рѕ РєСѓРґР°-С‚Рѕ РґРѕС€С‘Р».
   */
  private async recordRegionVisit(characterId: string, region: Region): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO region_visits (character_id, region)
         VALUES ($1, $2)
         ON CONFLICT (character_id, region) DO NOTHING`,
        [characterId, region],
      );
    } catch (err) {
      logger.warn(`[Regions] РЅРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµС‚РёС‚СЊ РїРѕСЃРµС‰РµРЅРёРµ ${region}: ${(err as Error).message}`);
    }
  }

  /** РЎРјРµРЅРёС‚СЊ СЂРµРіРёРѕРЅ РїРµСЂСЃРѕРЅР°Р¶Р° (РїСѓС‚РµС€РµСЃС‚РІРёРµ). Р’РѕР·РІСЂР°С‰Р°РµС‚ РѕР±РЅРѕРІР»С‘РЅРЅРѕРіРѕ РїРµСЂСЃРѕРЅР°Р¶Р°. */
  async updateRegion(characterId: string, region: Region): Promise<Character | null> {
    // Р§РўРћ Р‘Р«Р›Рћ. РњРµС‚РѕРґ РјРµРЅСЏР» СЂРѕРІРЅРѕ РѕРґРЅСѓ РІРµС‰СЊ - region, - Рё Р±РѕР»СЊС€Рµ РЅРёС‡РµРіРѕ.
    // РџСѓС‚РµС€РµСЃС‚РІРёРµ РјРµРЅСЏР»Рѕ РњР•РўРљРЈ, Р° РїРµСЂСЃРѕРЅР°Р¶ РѕСЃС‚Р°РІР°Р»СЃСЏ СЃС‚РѕСЏС‚СЊ РЅР° РїСЂРµР¶РЅРёС…
    // РєРѕРѕСЂРґРёРЅР°С‚Р°С…. Р—РѕРЅР° Р¶Рµ СЃС‡РёС‚Р°Р»Р°СЃСЊ С„СѓРЅРєС†РёРµР№ РєРѕРѕСЂРґРёРЅР°С‚ (getZoneAt РЅР°
    // РєР°Р¶РґРѕРј С€Р°РіРµ), С‚Р°Рє С‡С‚Рѕ РїРѕСЃР»Рµ РїРѕРµР·РґРєРё РїРµСЂСЃРѕРЅР°Р¶ РѕРєР°Р·С‹РІР°Р»СЃСЏ СЃСЂР°Р·Сѓ РІ РґРІСѓС…
    // РјРµСЃС‚Р°С…: region = khorasan РІ Р±Р°Р·Рµ Рё zone = tabriz_north РїРѕ СЃС‚Р°СЂРѕР№ С‚РѕС‡РєРµ.
    // РћР±Р° РїРѕР»СЏ С…СЂР°РЅРёР»РёСЃСЊ, РѕР±Р° РїРѕРєР°Р·С‹РІР°Р»РёСЃСЊ.
    //
    // РўРµРїРµСЂСЊ СЂРµРіРёРѕРЅ Рё РєРѕРѕСЂРґРёРЅР°С‚С‹ РјРµРЅСЏСЋС‚СЃСЏ РІРјРµСЃС‚Рµ: СЏРєРѕСЂСЊ СЂРµРіРёРѕРЅР° РёР·
    // REGION_SPAWNS, Р·РѕРЅР° СЃС‡РёС‚Р°РµС‚СЃСЏ РѕС‚ РЅРѕРІРѕР№ С‚РѕС‡РєРё. Р РµРіРёРѕРЅ СЃС‚Р°Р» РјРµСЃС‚РѕРј,
    // Р° РЅРµ РїРѕРґРїРёСЃСЊСЋ.
    const СЏРєРѕСЂСЊ = REGION_SPAWNS[region];
    if (!СЏРєРѕСЂСЊ) {
      // Р Р°РЅСЊС€Рµ С‚Р°РєРѕР№ СЃР»СѓС‡Р°Р№ РїСЂРѕС…РѕРґРёР» РјРѕР»С‡Р°: UPDATE РѕС‚СЂР°Р±Р°С‚С‹РІР°Р», РёРіСЂРѕРє
      // РјРµРЅСЏР» СЂРµРіРёРѕРЅ РЅР° С‚РѕС‚, Сѓ РєРѕС‚РѕСЂРѕРіРѕ РЅРµС‚ РЅРё СЏРєРѕСЂСЏ, РЅРё Р·РѕРЅ, Рё РѕРєР°Р·С‹РІР°Р»СЃСЏ
      // РїРѕСЃСЂРµРґРё РїСѓСЃС‚РѕС‚С‹ Р±РµР· СЃРїР°РІРЅРѕРІ. РўРµРїРµСЂСЊ СЌС‚Рѕ РѕС€РёР±РєР°, Р° РЅРµ РїРѕР»РѕРјРєР°.
      logger.warn(`[Regions] РїСѓС‚РµС€РµСЃС‚РІРёРµ Р±РµР· СЏРєРѕСЂСЏ: СЂРµРіРёРѕРЅ ${String(region)}`);
      return null;
    }
    const РїРѕР·РёС†РёСЏ = { x: СЏРєРѕСЂСЊ.x, y: 0, z: СЏРєРѕСЂСЊ.z };
    const Р·РѕРЅР° = getZoneAt(СЏРєРѕСЂСЊ.x, СЏРєРѕСЂСЊ.z);

    const row = await this.db.queryOne<{ id: string }>(
      `UPDATE characters
          SET region = $2,
              position = $3,
              zone = $4,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [characterId, region, JSON.stringify(РїРѕР·РёС†РёСЏ), Р·РѕРЅР°?.id ?? null]
    );
    if (!row) return null;
    // РћС‚РјРµС‚РєР° РїРѕСЃРµС‰РµРЅРёСЏ: СЃРјРµРЅРёС‚СЊ СЂРµРіРёРѕРЅ Рё Р·Р°Р±С‹С‚СЊ РѕР± СЌС‚РѕРј РЅРµР»СЊР·СЏ, РёРЅР°С‡Рµ
    // РёСЃС‚РѕСЂРёСЏ РїСѓС‚РµС€РµСЃС‚РІРёР№ РЅРµ РЅР°РєР°РїР»РёРІР°Р»Р°СЃСЊ Р±С‹ Рё РґРѕСЃС‚РёР¶РµРЅРёСЏ РїРѕ СЂРµРіРёРѕРЅР°Рј
    // РѕСЃС‚Р°Р»РёСЃСЊ Р±С‹ РЅРµРґРѕСЃС‚РёР¶РёРјС‹РјРё РЅР°РІСЃРµРіРґР°.
    await this.recordRegionVisit(characterId, region);
    return this.getCharacterById(characterId);
  }

  /** РЎРјРµРЅРёС‚СЊ Р·РѕРЅСѓ РїРµСЂСЃРѕРЅР°Р¶Р° (РїСЂРё РїРµСЂРµСЃРµС‡РµРЅРёРё РіСЂР°РЅРёС†С‹ Р·РѕРЅС‹). */
  async updateZone(characterId: string, zone: string | null): Promise<void> {
    await this.db.query(
      'UPDATE characters SET zone = $2, updated_at = NOW() WHERE id = $1',
      [characterId, zone]
    );
  }

  // ============================================================
  // РРЅРІРµРЅС‚Р°СЂСЊ (СЃС‚РµРєРё: РїРµСЂСЃРѕРЅР°Р¶ + РїСЂРµРґРјРµС‚ + СѓСЂРѕРІРµРЅСЊ Р·Р°С‚РѕС‡РєРё)
  // ============================================================

  /**
   * Р”РѕР±Р°РІРёС‚СЊ РїСЂРµРґРјРµС‚С‹ (Р»СѓС‚, РЅР°РіСЂР°РґС‹), СЂР°СЃРєР»Р°РґС‹РІР°СЏ РїРѕ СЃС‚РµРєР°Рј РґРѕ РїСЂРµРґРµР»Р°.
   *
   * Р§РўРћ Р—Р”Р•РЎР¬ Р‘Р«Р›Рћ. РћРґРёРЅ INSERT...ON CONFLICT СЃРєР»Р°РґС‹РІР°Р» РєРѕР»РёС‡РµСЃС‚РІРѕ Р±РµР·
   * СѓСЃР»РѕРІРёСЏ. РџРѕР»Рµ maxStack РµСЃС‚СЊ Сѓ 79 РїСЂРµРґРјРµС‚РѕРІ (Сѓ 34 - 999, Сѓ 28 - 1) Рё РЅРµ
   * РїСЂРѕРІРµСЂСЏР»РѕСЃСЊ РЅРёРіРґРµ: РїСЂРµРґРјРµС‚ СЃ maxStack 5 РґРѕС…РѕРґРёР» РґРѕ 5000 РІ РѕРґРЅРѕР№ СЃС‚СЂРѕРєРµ.
   * Р¦РёС„СЂС‹ Р±С‹Р»Рё РѕР±СЉСЏРІР»РµРЅРёРµРј, РєРѕС‚РѕСЂРѕРіРѕ РІ РёРіСЂРµ РЅРµ СЃСѓС‰РµСЃС‚РІРѕРІР°Р»Рѕ.
   *
   * РџРћР§Р•РњРЈ РќР•Р›Р¬Р—РЇ РџР РћРЎРўРћ РЈР Р•Р—РђРўР¬. 3000 Р·РµР»РёР№ СЃ maxStack 20 - СЌС‚Рѕ 150 СЃС‚РµРєРѕРІ.
   * РЎС…РµРјР° (РјРёРіСЂР°С†РёСЏ 007) РґРѕРїСѓСЃРєР°РµС‚ РѕРґРЅСѓ СЃС‚СЂРѕРєСѓ РЅР° РїСЂРµРґРјРµС‚ Рё Р·Р°С‚РѕС‡РєСѓ, С‚Р°Рє С‡С‚Рѕ
   * РѕСЃС‚Р°С‚РѕРє Р±С‹Р»Рѕ РЅРµРєСѓРґР° РґРµРІР°С‚СЊ: Р»РёР±Рѕ С‚РµСЂСЏС‚СЊ РґРѕР±С‹С‡Сѓ, Р»РёР±Рѕ РїР»РѕРґРёС‚СЊ СЃС‚РµРєРё.
   * РўРµСЂСЏС‚СЊ РѕСЃС‚Р°С‚РѕРє РЅРµР»СЊР·СЏ - СЌС‚Рѕ РјРѕР»С‡Р°Р»РёРІР°СЏ РїСЂРѕРїР°Р¶Р° РІРµС‰РµР№,
   * РїРѕСЌС‚РѕРјСѓ РјРёРіСЂР°С†РёСЏ 075 РґРѕР±Р°РІРёР»Р° stack_index, Рё РѕСЃС‚Р°С‚РѕРє СЂР°СЃРєР»Р°РґС‹РІР°РµС‚СЃСЏ.
   *
   * РЎС‚РµРєРё РґР»СЏ РїСЂРµРґРјРµС‚Р° Рё Р·Р°С‚РѕС‡РєРё Р±РµСЂСѓС‚СЃСЏ РїРѕ РІРѕР·СЂР°СЃС‚Р°РЅРёСЋ quantity: РґРѕР·Р°РїРѕР»РЅСЏРµРј
   * СЃР°РјС‹Рµ РЅРµРїРѕР»РЅС‹Рµ, С‡С‚РѕР±С‹ РЅРµ РѕСЃС‚Р°РІР»СЏС‚СЊ РїРѕР»СѓРїСѓСЃС‚С‹С… СЂСЏРґРѕРІ РІ СЃСѓРјРєРµ.
   */
  async addItems(characterId: string, items: { itemId: string; qty: number; enhancement?: number }[]): Promise<void> {
    for (const it of items) {
      const enhancement = Math.max(0, Math.min(20, Math.floor(it.enhancement ?? 0)));
      const qty = Math.max(1, Math.floor(it.qty));
      const def = ITEMS_DATABASE[it.itemId];
      // РџСЂРµРґРµР» СЃС‚РµРєР°. РќРµСЃС‚РµРєР°РµРјС‹Р№ РїСЂРµРґРјРµС‚ РІСЃРµРіРґР° 1 РІ СЃС‚РµРєРµ: stackable: false
      // Сѓ РѕСЂСѓР¶РёСЏ Рё Р±СЂРѕРЅРё - СЌС‚Рѕ РѕС‚РґРµР»СЊРЅРѕРµ РїСЂР°РІРёР»Рѕ, Р° РЅРµ РґСѓР±Р»СЊ maxStack.
      const limit = def?.stackable === false ? 1 : Math.max(1, Math.floor(def?.maxStack ?? 1));

      let РѕСЃС‚Р°Р»РѕСЃСЊ = qty;

      // 1. Р”РѕР·Р°РїРѕР»РЅСЏРµРј СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ РЅРµРїРѕР»РЅС‹Рµ СЃС‚РµРєРё.
      const СЃС‚РµРєРё = await this.db.query<{ id: string; quantity: number }>(
        `SELECT id, quantity FROM character_items
          WHERE character_id = $1 AND item_id = $2 AND enhancement = $3 AND quantity < $4
          ORDER BY quantity DESC`,
        [characterId, it.itemId, enhancement, limit]
      ).catch(() => []);
      for (const СЃС‚РµРє of СЃС‚РµРєРё) {
        const СЃРІРѕР±РѕРґРЅРѕ = limit - СЃС‚РµРє.quantity;
        const РїРѕР»РѕР¶РёС‚СЊ = Math.min(СЃРІРѕР±РѕРґРЅРѕ, РѕСЃС‚Р°Р»РѕСЃСЊ);
        if (РїРѕР»РѕР¶РёС‚СЊ <= 0) continue;
        await this.db.query(
          'UPDATE character_items SET quantity = quantity + $1 WHERE id = $2',
          [РїРѕР»РѕР¶РёС‚СЊ, СЃС‚РµРє.id]
        ).catch(() => undefined);
        РѕСЃС‚Р°Р»РѕСЃСЊ -= РїРѕР»РѕР¶РёС‚СЊ;
      }

      // 2. РћСЃС‚Р°С‚РѕРє - РІ РЅРѕРІС‹Рµ СЃС‚РµРєРё. РќРѕРјРµСЂ СЃР»РµРґСѓСЋС‰РµРіРѕ СЃС‡РёС‚Р°РµС‚СЃСЏ РІ Р±Р°Р·Рµ, РёРЅР°С‡Рµ
      // РґРІР° РѕРґРЅРѕРІСЂРµРјРµРЅРЅС‹С… РґРѕР·Р°РїРѕР»РЅРµРЅРёСЏ Р·Р°РІРµР»Рё Р±С‹ РІС‚РѕСЂРѕР№ СЃС‚РµРє РЅРѕРјРµСЂ 0 Рё СѓРїР°Р»Рё
      // Р±С‹ РЅР° СѓРЅРёРєР°Р»СЊРЅРѕРј РєР»СЋС‡Рµ.
      while (РѕСЃС‚Р°Р»РѕСЃСЊ > 0) {
        const РїРѕР»РѕР¶РёС‚СЊ = Math.min(limit, РѕСЃС‚Р°Р»РѕСЃСЊ);
        const СЂСЏРґ = await this.db.queryOne<{ РЅРѕРјРµСЂ: number }>(
          `SELECT COALESCE(MAX(stack_index), -1) + 1 AS РЅРѕРјРµСЂ
             FROM character_items
            WHERE character_id = $1 AND item_id = $2 AND enhancement = $3`,
          [characterId, it.itemId, enhancement]
        ).catch(() => null);
        await this.db.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement, stack_index)
           VALUES ($1, $2, $3, $4, $5)`,
          [characterId, it.itemId, РїРѕР»РѕР¶РёС‚СЊ, enhancement, СЂСЏРґ?.РЅРѕРјРµСЂ ?? 0]
        );
        РѕСЃС‚Р°Р»РѕСЃСЊ -= РїРѕР»РѕР¶РёС‚СЊ;
      }

      // РџСЂРѕРіСЂРµСЃСЃ РіРёР»СЊРґРµР№СЃРєРёС… Р·Р°РґР°РЅРёР№ С‚РёРїР° В«СЃРѕР±СЂР°С‚СЊВ». void: addItems Р·РѕРІСѓС‚
      // РґРµСЃСЏС‚СЊ РјРµСЃС‚, РІРєР»СЋС‡Р°СЏ РІС‹РґР°С‡Сѓ РЅР°РіСЂР°Рґ, Рё РѕР¶РёРґР°РЅРёРµ РЅРµ РґРѕР»Р¶РЅРѕ
      // СЃС‚Р°РЅРѕРІРёС‚СЊСЃСЏ С‡Р°СЃС‚СЊСЋ РІС‹РґР°С‡Рё.
      void guildMissionService.onItemGained(characterId, it.itemId, qty);
    }
  }

  /**
   * РЎРїРёСЃР°С‚СЊ РїСЂРµРґРјРµС‚С‹ (СЃРЅР°С‡Р°Р»Р° РёР· Р±РѕР»РµРµ Р·Р°С‚РѕС‡РµРЅРЅС‹С… СЃС‚РµРєРѕРІ). Р‘СЂРѕСЃР°РµС‚ РїСЂРё РЅРµС…РІР°С‚РєРµ.
   *
   * Р§РўРћ РР—РњР•РќРР›РћРЎР¬. РџСЂРµР¶РґРµ Р±СЂР°Р»Р°СЃСЊ РћР”РќРђ СЃС‚СЂРѕРєР° СЃ quantity >= РЅСѓР¶РЅРѕРіРѕ: СЂР°Р·
   * РїСЂРµРґРјРµС‚ Р»РµР¶Р°Р» РѕРґРЅРѕР№ СЃС‚СЂРѕРєРѕР№ (С‚Р°РєРѕР№ Р±С‹Р»Р° СЃС…РµРјР°), СЌС‚РѕРіРѕ С…РІР°С‚Р°Р»Рѕ. РўРµРїРµСЂСЊ
   * СЃС‚РµРєРѕРІ РјРѕР¶РµС‚ Р±С‹С‚СЊ РЅРµСЃРєРѕР»СЊРєРѕ (РјРёРіСЂР°С†РёСЏ 075), Рё РїСЂРµР¶РЅРёР№ Р·Р°РїСЂРѕСЃ РѕС‚РєР°Р·Р°Р» Р±С‹
   * РїСЂРё С‚СЂС‘С… СЃС‚РµРєР°С… РїРѕ 20 Рё СЃРїРёСЃР°РЅРёРё 50 - РёРјРµСЏ С€РµСЃС‚СЊРґРµСЃСЏС‚.
   *
   * РџРѕСЌС‚РѕРјСѓ СЃРїРёСЃР°РЅРёРµ РёРґС‘С‚ РїРѕ РєСЂСѓРіСѓ: РёР· РєР°Р¶РґРѕРіРѕ РЅРµРїСѓСЃС‚РѕРіРѕ СЃС‚РµРєР° СЃРЅРёРјР°РµС‚СЃСЏ
   * СЃРєРѕР»СЊРєРѕ РІ РЅС‘Рј РµСЃС‚СЊ, РїРѕРєР° РЅРµ РЅР°Р±РµСЂС‘С‚СЃСЏ РЅСѓР¶РЅРѕРµ. FOR UPDATE Р±Р»РѕРєРёСЂСѓРµС‚
   * СЃС‚СЂРѕРєРё РІРЅСѓС‚СЂРё С‚СЂР°РЅР·Р°РєС†РёРё: РґРІР° РѕРґРЅРѕРІСЂРµРјРµРЅРЅС‹С… СЃРїРёСЃР°РЅРёСЏ РёРЅР°С‡Рµ РїСЂРѕС‡РёС‚Р°Р»Рё Р±С‹
   * РѕРґРЅРѕ Рё С‚Рѕ Р¶Рµ РєРѕР»РёС‡РµСЃС‚РІРѕ РѕР±Р°.
   */
  async removeItems(characterId: string, items: { itemId: string; qty: number }[]): Promise<void> {
    await this.db.transaction(async (client) => {
      for (const it of items) {
        let РЅР°РґРѕ = Math.max(1, Math.floor(it.qty));
        // РџСЂРµРґРµР» РёС‚РµСЂР°С†РёР№ - СЃС‚СЂР°С…РѕРІРєР° РѕС‚ Р±РµСЃРєРѕРЅРµС‡РЅРѕРіРѕ С†РёРєР»Р° РїСЂРё РѕС€РёР±РєРµ
        // РїРѕРґСЃС‡С‘С‚Р°: СЃС‚РµРєРѕРІ РјРѕР¶РµС‚ Р±С‹С‚СЊ РјРЅРѕРіРѕ, РЅРѕ РЅРµ Р±РµСЃРєРѕРЅРµС‡РЅРѕ.
        for (let РєСЂСѓРі = 0; РЅР°РґРѕ > 0 && РєСЂСѓРі < 200; РєСЂСѓРі++) {
          const СЂСЏРґ = await client.query<{ id: string; quantity: number | string }>(
            `SELECT id, quantity FROM character_items
              WHERE character_id = $1 AND item_id = $2 AND quantity > 0
              ORDER BY enhancement DESC, quantity DESC
              LIMIT 1
              FOR UPDATE`,
            [characterId, it.itemId]
          );
          if (!СЂСЏРґ.rows.length) break;
          const СЃС‚РµРє = СЂСЏРґ.rows[0];
          const РІРЎС‚РµРєРµ = Number(СЃС‚РµРє.quantity);
          const СЃРЅСЏС‚СЊ = Math.min(РЅР°РґРѕ, РІРЎС‚РµРєРµ);
          await client.query(
            'UPDATE character_items SET quantity = quantity - $1 WHERE id = $2',
            [СЃРЅСЏС‚СЊ, СЃС‚РµРє.id]
          ).catch(() => undefined);
          РЅР°РґРѕ -= СЃРЅСЏС‚СЊ;
        }
        await client.query(
          'DELETE FROM character_items WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
          [characterId, it.itemId]
        ).catch(() => undefined);
        if (РЅР°РґРѕ > 0) {
          const have = await client.query(
            'SELECT COALESCE(SUM(quantity), 0) AS total FROM character_items WHERE character_id = $1 AND item_id = $2',
            [characterId, it.itemId]
          ).catch(() => ({ rows: [{ total: 0 }] }));
          throw new Error(
            `Not enough items: ${it.itemId} (need ${Math.max(1, Math.floor(it.qty))}, have ${Number(have.rows[0].total)})`
          );
        }
      }
    });
  }

  /** РЎСѓРјРјР°СЂРЅРѕРµ РєРѕР»РёС‡РµСЃС‚РІРѕ РїСЂРµРґРјРµС‚Р° РїРѕ РІСЃРµРј СЃС‚РµРєР°Рј: { itemId: qty } */
  async getItemQuantities(characterId: string): Promise<Record<string, number>> {
    const rows = await this.db.query<{ item_id: string; total: string | number }>(
      'SELECT item_id, SUM(quantity) AS total FROM character_items WHERE character_id = $1 GROUP BY item_id',
      [characterId]
    );
    const map: Record<string, number> = {};
    for (const r of rows) map[r.item_id] = Number(r.total);
    return map;
  }

  /** РРЅРІРµРЅС‚Р°СЂСЊ СЃ РёРјРµРЅР°РјРё/СЂРµРґРєРѕСЃС‚СЊСЋ РёР· ITEMS_DATABASE. */
  async getInventory(characterId: string): Promise<InventoryEntry[]> {
    const rows = await this.db.query<{ item_id: string; quantity: number; enhancement: number }>(
      'SELECT item_id, quantity, enhancement FROM character_items WHERE character_id = $1 ORDER BY acquired_at DESC',
      [characterId]
    );
    return rows
      .map(r => {
        const def = ITEMS_DATABASE[r.item_id];
        return {
          itemId: r.item_id,
          name: def?.name ?? r.item_id,
          nameRu: def?.nameRu ?? r.item_id,
          type: def?.type ?? 'material',
          rarity: def?.rarity ?? 'common',
          quantity: Number(r.quantity),
          enhancement: Number(r.enhancement),
          iconPath: def?.iconPath,
          description: def?.description,
        };
      });
  }

  // ============================================================
  // Р­РєРёРїРёСЂРѕРІРєР° (РѕСЂСѓР¶РёРµ / Р±СЂРѕРЅСЏ / Р°РєСЃРµСЃСЃСѓР°СЂ)
  // ============================================================

  private static SLOT_BY_TYPE: Partial<Record<ItemType, 'weapon' | 'armor' | 'accessory'>> = {
    [ItemType.WEAPON]: 'weapon',
    [ItemType.ARMOR]: 'armor',
    [ItemType.ACCESSORY]: 'accessory',
  };

  /** Р­РєРёРїРёСЂРѕРІР°РЅРЅС‹Рµ РїСЂРµРґРјРµС‚С‹ Рё Р°РіСЂРµРіРёСЂРѕРІР°РЅРЅС‹Рµ Р±РѕРЅСѓСЃС‹ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРє (+5% Р·Р° СѓСЂРѕРІРµРЅСЊ Р·Р°С‚РѕС‡РєРё). */
  async getEquipment(characterId: string): Promise<{ items: EquippedItem[]; stats: CharacterStats; bonuses: EquipmentBonuses }> {
    const rows = await this.db.query<{ slot: string; item_id: string; enhancement: number }>(
      'SELECT slot, item_id, enhancement FROM character_equipment WHERE character_id = $1',
      [characterId]
    );
    const items: EquippedItem[] = [];
    const stats: CharacterStats = { strength: 0, agility: 0, intelligence: 0, endurance: 0, charisma: 0 };
    // Р‘РѕРЅСѓСЃС‹ РІРѕРґС‹ РєРѕРїСЏС‚СЃСЏ РѕС‚РґРµР»СЊРЅРѕ РѕС‚ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРє: РѕРЅРё РЅРµ РґРѕР»Р¶РЅС‹ РїРѕРїР°РґР°С‚СЊ
    // РІ СЃСѓРјРјСѓ В«Р‘РѕРЅСѓСЃ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєВ» РІ РїР°РЅРµР»Рё РїРµСЂСЃРѕРЅР°Р¶Р°
    const bonuses: EquipmentBonuses = { waterSpeed: 0, swimStamina: 0 };
    for (const r of rows) {
      const def = ITEMS_DATABASE[r.item_id];
      const enhancement = Number(r.enhancement);
      const mult = 1 + 0.05 * enhancement;
      items.push({
        slot: r.slot as EquippedItem['slot'],
        itemId: r.item_id,
        name: def?.name ?? r.item_id,
        nameRu: def?.nameRu ?? r.item_id,
        rarity: def?.rarity ?? 'common',
        enhancement,
        stats: def?.stats,
        // Р’СЂРµРјСЏ Р·Р°РјР°С…Р°: Сѓ РѕСЂСѓР¶РёСЏ СЌС‚Рѕ РїРѕР»Рµ speed РІ РґР°РЅРЅС‹С… РїСЂРµРґРјРµС‚Р°, Сѓ Р±СЂРѕРЅРё
        // РµРіРѕ РЅРµС‚, Рё С‚Р°Рј РѕСЃС‚Р°С‘С‚СЃСЏ РїСѓСЃС‚С‹Рј вЂ” РєР»РёРµРЅС‚ Р±РµСЂС‘С‚ С‚РѕРіРґР° СѓРјРѕР»С‡Р°РЅРёРµ.
        swingSeconds: def?.weapon?.speed,
        // РРєРѕРЅРєР° Рё РѕРїРёСЃР°РЅРёРµ РЅР°РґРµС‚С‹ С‚РѕР¶Рµ РґРѕР»Р¶РЅС‹ Р±С‹С‚СЊ РІРёРґРЅС‹: СЌРєРёРїРёСЂРѕРІРєР°
        // РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РІ РїР°РЅРµР»Рё РїРµСЂСЃРѕРЅР°Р¶Р°, Рё РЅРµС‚ РїСЂРёС‡РёРЅС‹ РѕС‚РґР°РІР°С‚СЊ С‚СѓРґР°
        // РјРµРЅСЊС€Рµ, С‡РµРј РІ СЃСѓРјРєСѓ. iconPath РµСЃС‚СЊ РІ РґР°РЅРЅС‹С…, РЅРѕ РЅРµ РґРѕС…РѕРґРёР» РЅРё СЃСЋРґР°,
        // РЅРё С‚СѓРґР°.
        iconPath: def?.iconPath,
        description: def?.description,
      });
      for (const [key, value] of Object.entries(def?.stats ?? {})) {
        if (key in stats) stats[key as keyof CharacterStats] += Math.round(Number(value) * mult);
      }
      bonuses.waterSpeed = Math.min(1, bonuses.waterSpeed + (def?.waterSpeed ?? 0) * mult);
      bonuses.swimStamina = Math.min(0.75, bonuses.swimStamina + (def?.swimStamina ?? 0) * mult);
    }
    return { items, stats, bonuses };
  }

  /** РќР°РґРµС‚СЊ РїСЂРµРґРјРµС‚: СЃРїРёСЃС‹РІР°РµС‚СЃСЏ РёР· СЃСѓРјРєРё, РїСЂРµРґС‹РґСѓС‰РёР№ РїСЂРµРґРјРµС‚ СЃР»РѕС‚Р° РІРѕР·РІСЂР°С‰Р°РµС‚СЃСЏ РІ РЅРµС‘. */
  async equipItem(characterId: string, itemId: string): Promise<{ items: EquippedItem[]; stats: CharacterStats }> {
    const def = ITEMS_DATABASE[itemId];
    if (!def) throw new Error('Item not found');
    const slot = CharacterService.SLOT_BY_TYPE[def.type];
    if (!slot) throw new Error('Item cannot be equipped');
    const character = await this.getCharacterById(characterId);
    if (!character) throw new Error('Character not found');
    if (def.level > character.level) throw new Error(`Requires level ${def.level}`);

    await this.db.transaction(async (client) => {
      // Р’Р·СЏС‚СЊ РѕРґРёРЅ СЌРєР·РµРјРїР»СЏСЂ РёР· СЃСѓРјРєРё (СЃРІРµСЂС…Сѓ вЂ” СЃР°РјС‹Р№ Р·Р°С‚РѕС‡РµРЅРЅС‹Р№)
      const taken = await client.query(
        `UPDATE character_items SET quantity = quantity - 1
         WHERE id = (
           SELECT id FROM character_items
           WHERE character_id = $1 AND item_id = $2 AND quantity >= 1
           ORDER BY enhancement DESC LIMIT 1
           FOR UPDATE
         )
         RETURNING enhancement`,
        [characterId, itemId]
      );
      if (taken.rowCount === 0) throw new Error('Item not in inventory');
      const enhancement = Number(taken.rows[0].enhancement);
      await client.query(
        'DELETE FROM character_items WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
        [characterId, itemId]
      );

      // РЎРЅСЏС‚СЊ РїСЂРµРґС‹РґСѓС‰РёР№ РїСЂРµРґРјРµС‚ СЃР»РѕС‚Р° РѕР±СЂР°С‚РЅРѕ РІ СЃСѓРјРєСѓ
      const prev = await client.query(
        'SELECT item_id, enhancement FROM character_equipment WHERE character_id = $1 AND slot = $2 FOR UPDATE',
        [characterId, slot]
      );
      if (prev.rows[0]) {
        await client.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (character_id, item_id, enhancement)
           DO UPDATE SET quantity = character_items.quantity + 1`,
          [characterId, prev.rows[0].item_id, Number(prev.rows[0].enhancement)]
        );
      }

      await client.query(
        `INSERT INTO character_equipment (character_id, slot, item_id, enhancement, equipped_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (character_id, slot)
         DO UPDATE SET item_id = EXCLUDED.item_id, enhancement = EXCLUDED.enhancement, equipped_at = NOW()`,
        [characterId, slot, itemId, enhancement]
      );
    });

    return this.getEquipment(characterId);
  }

  /** РЎРЅСЏС‚СЊ РїСЂРµРґРјРµС‚ СЃР»РѕС‚Р° РѕР±СЂР°С‚РЅРѕ РІ СЃСѓРјРєСѓ. */
  async unequipItem(characterId: string, slot: 'weapon' | 'armor' | 'accessory'): Promise<{ items: EquippedItem[]; stats: CharacterStats }> {
    await this.db.transaction(async (client) => {
      const row = await client.query(
        'SELECT item_id, enhancement FROM character_equipment WHERE character_id = $1 AND slot = $2 FOR UPDATE',
        [characterId, slot]
      );
      if (!row.rows[0]) throw new Error('Nothing equipped in slot');
      await client.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + 1`,
        [characterId, row.rows[0].item_id, Number(row.rows[0].enhancement)]
      );
      await client.query(
        'DELETE FROM character_equipment WHERE character_id = $1 AND slot = $2',
        [characterId, slot]
      );
    });
    return this.getEquipment(characterId);
  }

  // ============================================================
  // Р Р°СЃС…РѕРґРЅРёРєРё
  // ============================================================

  private static USE_ITEM_EFFECTS = USE_ITEM_EFFECTS;

  /**
   * РСЃРїРѕР»СЊР·РѕРІР°С‚СЊ СЂР°СЃС…РѕРґРЅРёРє: СЃРїРёСЃС‹РІР°РµС‚ РїСЂРµРґРјРµС‚, РІРѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµС‚ СЂРµСЃСѓСЂСЃС‹
   * Рё/РёР»Рё РІС‹РґР°С‘С‚ РІСЂРµРјРµРЅРЅС‹Р№ Р±РѕРЅСѓСЃ (РєРµР±Р°Р±, СЃРІРёС‚РѕРє СѓС‡С‘РЅРѕРіРѕ).
   */
  async useItem(characterId: string, itemId: string): Promise<{
    hp: number; maxHp: number; mana: number; maxMana: number; stamina: number; maxStamina: number;
    buff: ActiveBuff | null;
  }> {
    const def = ITEMS_DATABASE[itemId];
    if (!def) throw new Error('Item not found');
    if (def.type !== ItemType.CONSUMABLE) throw new Error('Item is not consumable');
    const effect = CharacterService.USE_ITEM_EFFECTS[itemId];
    // РџСЂРµРґРјРµС‚ РјРѕР¶РµС‚ РЅРµ РІРѕСЃСЃС‚Р°РЅР°РІР»РёРІР°С‚СЊ СЂРµСЃСѓСЂСЃС‹, Р° РґР°РІР°С‚СЊ РІСЂРµРјРµРЅРЅС‹Р№ Р±РѕРЅСѓСЃ
    // (РЎРІРёС‚РѕРє РЈС‡С‘РЅРѕРіРѕ) вЂ” С‚РѕРіРґР° РІСЃС‘, С‡С‚Рѕ РѕРЅ РѕР±РµС‰Р°РµС‚, СЌС‚Рѕ Р±РѕРЅСѓСЃ.
    const buffId = ITEM_BUFFS[itemId];
    if (!effect && !buffId) throw new Error('Item has no usable effect');

    await this.removeItems(characterId, [{ itemId, qty: 1 }]);
    const buff = buffId ? await getBuffService().grant(characterId, buffId) : null;

    // Р‘РѕРЅСѓСЃ РїСЂРѕС„РµСЃСЃРёРё В«РўСЂР°РІРЅРёРєВ»: РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ РѕС‚ Р·РµР»РёР№ РёпїЅпїЅРЅР°СЃС‚РѕРє СЃРёР»СЊРЅРµРµ.
    // РћРїРёСЃР°РЅРёРµ РѕР±РµС‰Р°Р»Рѕ В«Р·РµР»СЊСЏ РґРµР№СЃС‚РІСѓСЋС‚ РЅР° 20% СЃРёР»СЊРЅРµРµВ», Рё РѕР±РµС‰Р°РЅРёРµ Р±С‹Р»Рѕ
    // РЅРё СЃ С‡РµРј РЅРµ СЃРІСЏР·Р°РЅРѕ. РњРЅРѕР¶РёС‚РµР»СЊ РїСЂРёРјРµРЅСЏРµС‚СЃСЏ Рє СЃР°РјРѕРјСѓ СЌС„С„РµРєС‚Сѓ, Р° РЅРµ Рє
    // РІРµР»РёС‡РёРЅРµ Р·Р°РїР°СЃР° СЃРІРµСЂС…Сѓ: РёС‚РѕРі РІСЃС‘ СЂР°РІРЅРѕ РѕР±СЂРµР·Р°РµС‚СЃСЏ РїРѕ РјР°РєСЃРёРјСѓРјСѓ, С‚Р°Рє
    // С‡С‚Рѕ В«Р±РѕР»РµРµ СЃРёР»СЊРЅРѕРµ Р·РµР»СЊРµВ» Рё В«С‚Рѕ Р¶Рµ Р·РµР»СЊРµ РїСЂРё РїРѕР»РЅРѕРј Р·РґРѕСЂРѕРІСЊРµВ» - СЌС‚Рѕ
    // РѕРґРЅРѕ Рё С‚Рѕ Р¶Рµ.
    const prof = await professionOf(characterId);
    const potionMult = professionBonuses(prof?.id ?? null, prof?.level ?? 0).potion;
    const healed = (v: number): number => Math.max(1, Math.round(v * potionMult));

    const sets: string[] = [];
    const params: number[] = [];
    let i = 2; // $1 = characterId
    if (effect?.hp)      { sets.push(`hp = LEAST(max_hp, hp + ${i})`);          params.push(healed(effect.hp)); i++; }
    if (effect?.mana)    { sets.push(`mana = LEAST(max_mana, mana + ${i})`);    params.push(healed(effect.mana)); i++; }
    if (effect?.stamina) { sets.push(`stamina = LEAST(max_stamina, stamina + ${i})`); params.push(healed(effect.stamina)); i++; }
    // РџСЂРµРґРјРµС‚ Р±РµР· РјРіРЅРѕРІРµРЅРЅРѕРіРѕ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЏ: С‚СЂРѕРіР°РµРј С‚РѕР»СЊРєРѕ РѕС‚РјРµС‚РєСѓ РІСЂРµРјРµРЅРё
    if (!sets.length) {
      await this.db.query('UPDATE characters SET updated_at = NOW() WHERE id = $1', [characterId]);
      const cur = await this.getCharacterById(characterId);
      if (!cur) throw new Error('Character not found');
      return {
        hp: cur.hp, maxHp: cur.maxHp,
        mana: cur.mana, maxMana: cur.maxMana,
        stamina: cur.stamina, maxStamina: cur.maxStamina,
        buff,
      };
    }
    const row = await this.db.queryOne<Record<string, number>>(
      `UPDATE characters SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING hp, max_hp, mana, max_mana, stamina, max_stamina`,
      [characterId, ...params]
    );
    if (!row) throw new Error('Character not found');
    return {
      hp: Number(row.hp), maxHp: Number(row.max_hp),
      mana: Number(row.mana), maxMana: Number(row.max_mana),
      stamina: Number(row.stamina), maxStamina: Number(row.max_stamina),
      buff,
    };
  }
}

export interface InventoryEntry {
  itemId: string;
  name: string;
  nameRu: string;
  type: string;
  rarity: string;
  quantity: number;
  enhancement: number;
  /**
   * РџСѓС‚СЊ Рє РєР°СЂС‚РёРЅРєРµ РїСЂРµРґРјРµС‚Р°.
   *
   * Р§РўРћ Р—Р”Р•РЎР¬ Р‘Р«Р›Рћ. РџРѕР»Рµ iconPath РµСЃС‚СЊ Сѓ 80 РїСЂРµРґРјРµС‚РѕРІ РІ ITEMS_DATABASE, Р°
   * СЌС‚РѕС‚ РѕС‚РІРµС‚ РµРіРѕ РЅРµ РѕС‚РґР°РІР°Р»: РёРЅРІРµРЅС‚Р°СЂСЊ РїРѕРєР°Р·С‹РІР°Р» С‚РѕР»СЊРєРѕ РёРјСЏ, СЂРµРґРєРѕСЃС‚СЊ Рё
   * С‡РёСЃР»Рѕ. Р”Р°РЅРЅС‹Рµ РіРѕРІРѕСЂРёР»Рё В«РІРѕС‚ РєР°Рє СЌС‚Рѕ РІС‹РіР»СЏРґРёС‚В», Р° СЂРёСЃРѕРІР°С‚СЊ Р±С‹Р»Рѕ РЅРµС‡РµРіРѕ.
   *
   * РЎСЃС‹Р»РєР° РЅР° С„Р°Р№Р» РЅРµ РїСЂРѕРІРµСЂСЏРµС‚СЃСЏ: С‡Р°СЃС‚СЊ РїСѓС‚РµР№ РІРµРґС‘С‚ Рє РјРѕРґРµР»СЏРј, РєРѕС‚РѕСЂС‹С… РЅРµС‚
   * РІ СЃР±РѕСЂРєРµ, Рё РєР»РёРµРЅС‚ РѕР±СЏР·Р°РЅ СЃ СЌС‚РёРј СЃРїСЂР°РІР»СЏС‚СЊСЃСЏ РїРѕРєР°Р·РѕРј Р·Р°РіР»СѓС€РєРё. РћС‚РґР°РІР°С‚СЊ
   * РїСѓС‚СЊ СЃ СЃРµСЂРІРµСЂР° Рё РЅРµ РїРѕРєР°Р·С‹РІР°С‚СЊ вЂ” РѕРґРЅРѕ РёР· РґРІСѓС…, Рё РІС‹Р±СЂР°РЅРѕ РїРѕРєР°Р·С‹РІР°С‚СЊ.
   */
  iconPath?: string;
  /** РћРїРёСЃР°РЅРёРµ РїСЂРµРґРјРµС‚Р°. РўРѕР¶Рµ РЅРµ РґРѕС…РѕРґРёР»Рѕ: РІ РґР°РЅРЅС‹С… РѕРЅРѕ РµСЃС‚СЊ Сѓ РІСЃРµС…. */
  description?: string;
}

export interface EquippedItem {
  slot: 'weapon' | 'armor' | 'accessory';
  itemId: string;
  name: string;
  nameRu: string;
  rarity: string;
  enhancement: number;
  stats?: Partial<CharacterStats>;
  /** РРєРѕРЅРєР° РїСЂРµРґРјРµС‚Р° РёР· РґР°РЅРЅС‹С…. РќРµ РґРѕС…РѕРґРёР»Р° РґРѕ РєР»РёРµРЅС‚Р° вЂ” СЂРёСЃРѕРІР°С‚СЊ Р±С‹Р»Рѕ РЅРµС‡РµРіРѕ. */
  iconPath?: string;
  /** РћРїРёСЃР°РЅРёРµ РїСЂРµРґРјРµС‚Р° РёР· РґР°РЅРЅС‹С…. */
  description?: string;
  /**
   * Р’СЂРµРјСЏ РѕРґРЅРѕРіРѕ Р·Р°РјР°С…Р° РІ СЃРµРєСѓРЅРґР°С… вЂ” РёР· РґР°РЅРЅС‹С… РїСЂРµРґРјРµС‚Р° (РїРѕР»Рµ speed).
   *
   * РћС‚РїСЂР°РІР»СЏРµС‚СЃСЏ РєР»РёРµРЅС‚Сѓ, С‡С‚РѕР±С‹ Р·Р°РјР°С… РІ 3D С€С‘Р» РїРѕ РґР°РЅРЅС‹Рј РѕСЂСѓР¶РёСЏ, Р° РЅРµ РїРѕ
   * РІР±РёС‚РѕРјСѓ 0.45. Р‘РµР· СЌС‚РѕРіРѕ Р±С‹СЃС‚СЂРѕРµ РѕСЂСѓР¶РёРµ РЅРµ Р±С‹СЃС‚СЂРµРµ, Р° РјРµРґР»РµРЅРЅРѕРµ Р»РѕРІРёС‚
   * РѕС‚РєР°Р· В«СЃР»РёС€РєРѕРј Р±С‹СЃС‚СЂРѕВ» РЅР° РєР°Р¶РґС‹Р№ Р»РёС€РЅРёР№ РєР»РёРє.
   */
  swingSeconds?: number;
}

