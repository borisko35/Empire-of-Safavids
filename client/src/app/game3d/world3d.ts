// ============================================================
// World3D вЂ” 3D-РґРІРёР¶РѕРє РёРіСЂС‹ вЂ” Empire of Safavids
// ============================================================
// РЎС†РµРЅР° Three.js: СЂРµР»СЊРµС„, РіРѕСЂРѕРґ, Р»Р°РіРµСЂСЊ, СЂР°СЃС‚РёС‚РµР»СЊРЅРѕСЃС‚СЊ; РєР°РјРµСЂР° РѕС‚
// С‚СЂРµС‚СЊРµРіРѕ Р»РёС†Р° СЃ РѕСЂР±РёС‚РѕР№ 360В° Рё Р·СѓРјРѕРј (pointer lock); С„РёР·РёРєР°
// РїРµСЂСЃРѕРЅР°Р¶Р° (Р±РµРі/РїСЂС‹Р¶РѕРє/РїСЂРёСЃРµРґ/Р±Р»РѕРє); РїСЂРёС†РµР»РёРІР°РЅРёРµ Р»СѓС‡РѕРј; Р±РѕРµРІС‹Рµ
// СЌС„С„РµРєС‚С‹ Рё РїР»Р°РІР°СЋС‰РёР№ СѓСЂРѕРЅ. РЎРµС‚РµРІС‹Рµ РґР°РЅРЅС‹Рµ С‡РёС‚Р°РµС‚ РёР· entities.World.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { DeferredPass } from './deferred/deferredPass';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { t } from '../i18n';
import { World, PlayerEntity } from '../entities';
import { STANCES, getStance } from '../stance';
import { buildPlayerRig, buildMonsterRig, Rig, type DodgeDirection } from './rig';
import { loadRealPlayerRig, CLASS_WEAPON, СЂРѕСЃС‚РџРѕР·С‹ } from './realRig';
import { loadRealMonsterRig, preloadModels } from './characterModels';
import { РѕР±РЅРѕРІРёС‚СЊРЎС‚СЂР°Р¶РµР№ } from './interiors';
import { SAFADIV_AVATAR_ASSETS, getSafavidAsset, type SafavidAssetDef } from '../../assets/safavid/SafavidAssets';
import { getSafavidAssetInstance, isSafavidAssetLoaded } from './safavidLoader';
import {
  groundHeight, buildTerrain, buildScatter, buildCity, buildCamp, buildWater, buildSettlements, buildRoads,
  buildRegionTowns, buildAqueduct, buildTradeTent, buildVillageForge, buildRuinGate,
  buildSignposts, buildGameTable, buildCows, updateCows, buildBazaarStatue,
buildCaravanseraiTorches, buildVillageSwords, buildBazaarChests,
  buildPassageTorches, Р¤РћРќРђР Р_Р“Р РћР‘РќРР¦Р«,
  РўРћР Р§_РЎР’Р•Рў_Р¦Р’Р•Рў, РўРћР Р§_РЎР’Р•Рў_РЇР РљРћРЎРўР¬, РўРћР Р§_РЎР’Р•Рў_Р”РђР›Р¬РќРћРЎРўР¬, buildMosqueCourtyard,
  buildFortBastions, buildRuinChapel, buildRuinCourt, buildOaks,
  buildRuinBridge, buildPassRocks, buildDesertTower,
  buildVillageArchway, buildChurchDoorway, buildOnionDomeTower, buildGallows,
  buildMarketCart, buildGallowsPalisade, buildPortRoadBarricade, buildCaravanseraiWindmill,
  buildMillPlough, buildVillageGrindstone,
  bridgeAt, waterSurfaceY, WORLD_HALF, CITY, CAMP, LAKE, COLLIDERS, FAUNA_COLLIDERS, CIV_COLLIDERS,
} from './terrain';
import { waterMaterials, followSeaToCamera, РєР°С‡Р°СЋС‰РёРµСЃСЏ, setGroundState, setSnowOnSurfaces, setPuddles, РґС‹РјРЅС‹РµРўСЂСѓР±С‹, Р»РѕРґРєРёРЈРџРёСЂР°, С‡Р°Р№РєРёРќР°РџСЂРёС‡Р°Р»Рµ, hash2, РѕРіРЅРёР¤РѕРЅР°СЂРµР№ } from './terrain';
import { createSky, SkyHandle, SKY_RADIUS } from './sky';
import { createPuffs, type Puffs } from './puffs';
import { createDustDevils, type DustDevilsHandle } from './dustDevil';
import { createMirage, type MirageHandle } from './mirage';
import { createRoadDust, type RoadDustHandle } from './roadDust';
import { createRoadWater, type RoadWaterHandle } from './roadWater';
import { createCaravanTracks, type CaravanTracksHandle } from './caravanTracks';
import { createBirds, type BirdsHandle } from './birds';
import { createGlints, type GlintsHandle } from './wetGlints';
import { createRipples, type RipplesHandle } from './boatRipples';
import { createPuddleRipples, type PuddleRipplesHandle } from './puddleRipples';
import { SkyEnvironment, type SkyState } from './skyEnvironment';
import { createFauna, FaunaHandle } from './fauna';
import { С‚РёРєР°С‚СЊР—РІРµСЂРµР№ } from './animalModels';
import { createNpcs, NpcsHandle } from './npc';
import { createCivilians, CiviliansHandle } from './civilians';
import { createTownfolk, TownfolkHandle } from './townfolk';
import { createRoadTraffic, RoadTrafficHandle } from './roadTraffic';
import { createWeather, WeatherHandle, type WeatherKind } from './weather';
import { buildTownBuildings, createInteriors, InteriorsHandle, INTERIOR_COLLIDERS, POCKET_COLLIDERS, buildPocketGround, pocketGroundY, BUILDINGS, M } from './interiors';
import { DestructibleData, damageDestructible, applyDestructibleVisuals, createBreakEffect } from './destructible';
import { setTextureAnisotropy } from './textures';
import { setSurfaceAnisotropy } from './surfaces';
import { createNavigator, NavigatorHandle, NavTarget } from './navigator';
import { chopFor } from './waterWaves';
import { audio } from '../audio';
import { session } from '../state';
import { getSettings, graphicsProfile, type GraphicsLevel } from '../settings';
import { chatVisible } from '../hud';

export interface World3DCallbacks {
  onAttack: () => void;
  onTarget: (name: string, hp: number, maxHp: number) => void;
  onTargetCleared: () => void;
  /** РљР»РёРє РїРѕ NPC: РѕС‚РєСЂС‹С‚СЊ СЃРІСЏР·Р°РЅРЅСѓСЋ РїР°РЅРµР»СЊ */
  onNpc?: (panel: string, nameRu: string, npcId: string) => void;
  /** РљР»РёРє РїРѕ РґРІРµСЂРё Р·РґР°РЅРёСЏ: РІРѕР№С‚Рё/РІС‹Р№С‚Рё (РјРёСЂ СѓР¶Рµ С‚РµР»РµРїРѕСЂС‚РёСЂРѕРІР°РЅ, РЅСѓР¶РµРЅ С‚РѕР»СЊРєРѕ С‚РѕСЃС‚). */
  onDoor?: (action: 'enter' | 'exit', buildingId: string, nameRu: string, entranceId?: string) => void;
  /** РљР»РёРє РїРѕ РёРЅС‚РµСЂР°РєС‚РёРІРЅРѕРјСѓ РѕР±СЉРµРєС‚Сѓ: СЏС‰РёРє, РєСѓРІС€РёРЅ, РЅР°РІРµСЃ. */
  onInteractive?: (kind: string, state: string, obj: THREE.Object3D) => void;
  /** РЎС‚СЂРѕРєР° РїРѕРґСЃРєР°Р·РєРё РґР»СЏ РІРёРґР° РѕРєСЂСѓР¶РµРЅРёСЏ (В§370): РґРІРёР¶РѕРє РЅРµ Р·РЅР°РµС‚ РїРµСЂРµРІРѕРґРѕРІ */
  onInteractiveHint?: (kind: string) => string;
}

/** Р­РєРёРїРёСЂРѕРІРєР° СЃРІРѕРµРіРѕ РїРµСЂСЃРѕРЅР°Р¶Р°, РІРёРґРёРјР°СЏ РЅР° 3D-Р°РІР°С‚Р°СЂРµ */
export interface LocalGear {
  /** РћСЂСѓР¶РёРµ РЅР°РґРµС‚Рѕ вЂ” РІ СЂСѓРєРµ РІРёРґРЅРѕ РєР»РёРЅРѕРє */
  weapon: boolean;
  /** Р¦РІРµС‚ РіСЂСѓРґРё РїРѕ СЂРµРґРєРѕСЃС‚Рё РґРѕСЃРїРµС…Р°; null вЂ” Р±СЂРѕРЅРё РЅРµС‚ */
  armorColor: number | null;
  /**
   * Р’СЂРµРјСЏ РѕРґРЅРѕРіРѕ Р·Р°РјР°С…Р° РІ СЃРµРєСѓРЅРґР°С… вЂ” РёР· РґР°РЅРЅС‹С… РїСЂРµРґРјРµС‚Р°.
   *
   * null РёР»Рё РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ вЂ” РѕСЂСѓР¶РёСЏ РЅРµС‚ Р»РёР±Рѕ СЌРєРёРїРёСЂРѕРІРєР° РµС‰С‘ РЅРµ РїСЂРёС€Р»Р°, С‚РѕРіРґР°
   * Р±РµСЂС‘С‚СЃСЏ DEFAULT_WEAPON.speed (0.45).
   */
  swingSeconds?: number | null;
  /** РќР°РґРµС‚С‹ Р»Рё РґРѕСЃРїРµС…Рё (РєРѕР»СЊС‡СѓРіР°) */
  mail?: boolean;
  /** РќР°РґРµС‚ Р»Рё С€Р»РµРј */
  helmet?: boolean;
  /** РќР°РґРµС‚ С…Р°Р»Р°С‚ (qaba) */
  robe?: boolean;
  /** РќР°РґРµС‚ С‚СЋСЂР±Р°РЅ */
  turban?: boolean;
  /** РќР°РґРµС‚ РІРµСЂС…РЅРёР№ РїР»Р°С‰ (chogha) */
  coat?: boolean;
  /** ID weapon РёР· РєР°С‚Р°Р»РѕРіР° РЎРµС„РµРІРёРґРѕРІ */
  weaponAssetId?: string;
  /** ID helmet РёР· РєР°С‚Р°Р»РѕРіР° РЎРµС„РµРІРёРґРѕРІ */
  helmetAssetId?: string;
  /** ID robe РёР· РєР°С‚Р°Р»РѕРіР° РЎРµС„РµРІРёРґРѕРІ */
  robeAssetId?: string;
  /** ID turban РёР· РєР°С‚Р°Р»РѕРіР° РЎРµС„РµРІРёРґРѕРІ */
  turbanAssetId?: string;
  /** ID coat РёР· РєР°С‚Р°Р»РѕРіР° РЎРµС„РµРІРёРґРѕРІ */
  coatAssetId?: string;
  /** ID mail РёР· РєР°С‚Р°Р»РѕРіР° РЎРµС„РµРІРёРґРѕРІ */
  mailAssetId?: string;
}

/**
 * РџСЂРёРІСЏР·РєР° РёСЃС‚РѕСЂРёС‡РµСЃРєРёС… Р°СЃСЃРµС‚РѕРІ РЎРµС„РµРІРёРґРѕРІ Рє РєРѕСЃС‚СЏРј РјРѕРґРµР»Рё РёРіСЂРѕРєР°.
 *
 * РљР°Р¶РґС‹Р№ Р°СЃСЃРµС‚ вЂ” РѕС‚РґРµР»СЊРЅР°СЏ 3D-РјРѕРґРµР»СЊ (РєР°С„С‚Р°РЅ, С‚СЋСЂР±Р°РЅ, С€Р»РµРј, РѕСЂСѓР¶РёРµ Рё С‚.Рґ.),
 * РєРѕС‚РѕСЂСѓСЋ РјС‹ РєР»РѕРЅРёСЂСѓРµРј Рё РїСЂРёРєСЂРµРїР»СЏРµРј Рє СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓСЋС‰РµР№ РєРѕСЃС‚Рё СЃРєРµР»РµС‚Р°:
 *   - РѕСЂСѓР¶РёРµ в†’ РїСЂР°РІР°СЏ РєРёСЃС‚СЊ (mixamorig:RightHand)
 *   - С€Р»РµРј в†’ РіРѕР»РѕРІР° (mixamorig:Head)
 *   - С…Р°Р»Р°С‚/РїР»Р°С‰/РєРѕР»СЊС‡СѓРіР° в†’ С‚РµР»Рѕ (РєРѕСЂРµРЅСЊ РіСЂСѓРїРїС‹, СЃРјРµС‰Р°СЋС‚СЃСЏ РїРѕ Y)
 *   - С‚СЋСЂР±Р°РЅ в†’ РіРѕР»РѕРІР° (РїРѕРґ С€Р»РµРјРѕРј, РµСЃР»Рё С€Р»РµРјР° РЅРµС‚)
 *
 * РђСЃСЃРµС‚С‹ РЅРµ СЃРєРёРЅРµРЅС‹ вЂ” РѕРЅРё РїСЂРёРІСЏР·С‹РІР°СЋС‚СЃСЏ Р¶РµСЃС‚РєРѕ, Р±РµР· РІРµСЃРѕРІ.
 * РџРѕРґС…РѕРґРёС‚ РґР»СЏ РїСЂРёРјРёС‚РёРІРЅС‹С… РјРѕРґРµР»РµР№ РёР· Blender.
 */
export class SafavidEquipment3D {
  private group: THREE.Group;
  private instanceIds: Record<string, string> = {};
  private meshes: THREE.Group[] = [];

  constructor(private playerGroup: THREE.Group) {
    this.group = new THREE.Group();
    this.group.name = 'safavid-equipment-3d';
    playerGroup.add(this.group);
  }

  /** РџСЂРёРјРµРЅРёС‚СЊ РїРѕР»РЅСѓСЋ СЌРєРёРїРёСЂРѕРІРєСѓ Рє РёРіСЂРѕРєСѓ */
  async apply(gear: LocalGear): Promise<void> {
    this.clear();

    const slots: [keyof LocalGear, string][] = [
      ['robeAssetId', 'robe'],
      ['turbanAssetId', 'turban'],
      ['coatAssetId', 'coat'],
      ['mailAssetId', 'mail'],
      ['helmetAssetId', 'helmet'],
      ['weaponAssetId', 'weapon'],
    ];

    for (const [idField, slotName] of slots) {
      const assetId = gear[idField as keyof LocalGear] as string | undefined;
      if (!assetId) continue;

      const def = getSafavidAsset(assetId);
      if (!def) {
        console.warn(`[Safavid3D] Asset "${assetId}" not found in catalog`);
        continue;
      }

      // Р–РґС‘Рј Р·Р°РіСЂСѓР·РєРё Р°СЃСЃРµС‚РѕРІ
      if (!isSafavidAssetLoaded(assetId)) {
        console.warn(`[Safavid3D] Asset "${assetId}" not loaded yet`);
        continue;
      }

      const instance = getSafavidAssetInstance(assetId);
      if (!instance) continue;

      this.attachToBone(instance, def.category, slotName);
      this.instanceIds[assetId] = slotName;
    }
  }

  /** РџСЂРёРєСЂРµРїРёС‚СЊ РјРµС€ Рє РєРѕСЃС‚Рё РёР»Рё РєРѕСЂРЅСЋ РІ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё РѕС‚ РєР°С‚РµРіРѕСЂРёРё */
  private attachToBone(instance: THREE.Group, category: string, slotName: string): void {
    const mesh = instance.clone();
    mesh.name = `safavid-${slotName}`;

    // РљРѕСЃС‚СЊ РґР»СЏ РїСЂРёРІСЏР·РєРё
    let bone: THREE.Bone | null = null;

    switch (category) {
      case 'weapon': // sword, dagger, mace, bow
        bone = this.playerGroup.getObjectByName('mixamorig:RightHand') as THREE.Bone;
        if (bone) {
          // РЎРјРµС‰РµРЅРёРµ РѕСЂСѓР¶РёСЏ РІ СЂСѓРєРµ (РєР°Рє РІ RealRig.equipWeapon)
          mesh.position.set(0, -0.05, 0.02);
          bone.add(mesh);
        } else {
          this.group.add(mesh);
        }
        break;

      case 'helmet':
        bone = this.playerGroup.getObjectByName('mixamorig:Head') as THREE.Bone;
        if (bone) {
          mesh.position.set(0, 0.05, 0);
          bone.add(mesh);
        } else {
          this.group.add(mesh);
          mesh.position.set(0, 1.7, 0);
        }
        break;

      case 'turban':
        bone = this.playerGroup.getObjectByName('mixamorig:Head') as THREE.Bone;
        if (bone) {
          mesh.position.set(0, 0.12, 0);
          bone.add(mesh);
        } else {
          this.group.add(mesh);
          mesh.position.set(0, 1.75, 0);
        }
        break;

      default: // robe, coat, mail, clothing
        // РћРґРµР¶РґР° РїСЂРёРІСЏР·С‹РІР°РµС‚СЃСЏ Рє РєРѕСЂРЅСЋ РіСЂСѓРїРїС‹ РёРіСЂРѕРєР° СЃРѕ СЃРјРµС‰РµРЅРёРµРј РїРѕ С‚РµР»Сѓ
        this.group.add(mesh);
        mesh.position.set(0, 0.9, 0);
        break;
    }

    this.meshes.push(mesh);
  }

  /** РЈР±СЂР°С‚СЊ РІСЃСЋ СЌРєРёРїРёСЂРѕРІРєСѓ */
  clear(): void {
    for (const mesh of this.meshes) {
      mesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      mesh.parent?.remove(mesh);
    }
    this.meshes = [];
    this.instanceIds = {};
  }

  /** РЈРЅРёС‡С‚РѕР¶РёС‚СЊ */
  dispose(): void {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}

/**
 * Р—Р°РјР°С… РїСѓСЃС‚С‹С… СЂСѓРє: СЂРѕРІРЅРѕ С‚Рѕ, С‡С‚Рѕ СЃС‚РѕРёС‚ РІ РґР°РЅРЅС‹С… РєР°Рє DEFAULT_WEAPON.speed.
 * Р Р°РЅСЊС€Рµ СЌС‚Р° С†РёС„СЂР° Р±С‹Р»Р° РІР±РёС‚Р° РІ Р·Р°РјР°С… РґРІР°Р¶РґС‹ Рё РЅРµ РёРјРµР»Р° РЅРёС‡РµРіРѕ РѕР±С‰РµРіРѕ СЃ
 * РїСЂРµРґРјРµС‚Р°РјРё: СЃРјРµРЅР° РѕСЂСѓР¶РёСЏ РЅР° Р±С‹СЃС‚СЂРѕРµ РЅРёС‡РµРіРѕ РЅРµ СѓСЃРєРѕСЂСЏР»Р°.
 */
const Р—РђРњРђРҐ_РџРЈРЎРўР«РњР_Р РЈРљРђРњР = 0.45;

// Р“СЂР°РІРёС‚Р°С†РёСЏ Рё РїСЂС‹Р¶РѕРє - РёР· shared/verticality.ts (В§377): СЃРµСЂРІРµСЂ СЃС‡РёС‚Р°РµС‚
// С‚РµРјРё Р¶Рµ С‡РёСЃР»Р°РјРё, Рё РїРѕР»С‘С‚ РІС‹С€Рµ Р°РїРµРєСЃР° РЅРµРІРѕР·РјРѕР¶РµРЅ.
import { GRAVITY, JUMP_V } from '../../../../shared/verticality';
const WALK_SPEED = 4.2;
const RUN_SPEED = 7.6;
const CROUCH_SPEED = 2.2;
/** Р’Рѕ СЃРєРѕР»СЊРєРѕ СЂР°Р· Р±РµРі РІРµСЂС…РѕРј Р±С‹СЃС‚СЂРµРµ С€Р°РіР° РІРµСЂС…РѕРј */
const MOUNT_SPRINT_MULT = 1.4;
const PLAYER_R = 1.0;   // СЂР°РґРёСѓСЃ РїРµСЂСЃРѕРЅР°Р¶Р° РґР»СЏ СЃС‚РѕР»РєРЅРѕРІРµРЅРёР№
const CAMERA_R = 0.35;  // РєР°РјРµСЂР° РјРѕР¶РµС‚ РїСЂРёР¶РёРјР°С‚СЊСЃСЏ Рє СЃС‚РµРЅРµ Р±Р»РёР¶Рµ, С‡РµРј РїРµСЂСЃРѕРЅР°Р¶
// в”Ђв”Ђ РљР°РјРµСЂР° Рё СЃС‚РµРЅС‹ (В§369) в”Ђв”Ђ
/** РЁР°Рі СЃСЌРјРїР»РёСЂРѕРІР°РЅРёСЏ Р»СѓС‡Р° В«РёРіСЂРѕРє в†’ РєР°РјРµСЂР°В». Р’Р«Р‘РћР : РјРµРЅСЊС€Рµ РґРёР°РјРµС‚СЂР° РєР°РјРµСЂС‹
 *  (2 * CAMERA_R = 0.7), С‡С‚РѕР±С‹ СЃС‚РµРЅР° РЅРµ РїСЂРѕСЃРєРѕС‡РёР»Р° РјРµР¶РґСѓ РїСЂРѕР±Р°РјРё. */
const CAMERA_SAMPLE_STEP = 0.4;
/** РЎ РєР°РєРѕР№ РґРёСЃС‚Р°РЅС†РёРё РЅР°С‡РёРЅР°РµРј Р»СѓС‡: Р±Р»РёР¶Рµ вЂ” РєР°РјРµСЂР° РІРЅСѓС‚СЂРё РїРµСЂСЃРѕРЅР°Р¶Р°. */
const CAMERA_SAMPLE_MIN = 1.2;
/** РџРѕС‚РѕР»РѕРє РґРёСЃС‚Р°РЅС†РёРё РІ РёРЅС‚РµСЂСЊРµСЂР°С…. Р’Р«Р‘РћР : РєРѕРјРЅР°С‚Р° С€РёСЂРёРЅРѕР№ 22 Рј, Рё РєР°РјРµСЂР°
 *  РЅР° 7.5 Рј РІ РЅРµР№ РІСЃРµРіРґР° СѓРїРёСЂР°РµС‚СЃСЏ РІ РґР°Р»СЊРЅСЋСЋ СЃС‚РµРЅСѓ вЂ” С‚РµСЃРЅРµРµ РІРёРґРЅРµРµ. */
const CAMERA_INDOOR_MAX = 5;
/** РЎРєРѕСЂРѕСЃС‚СЊ СЃРіР»Р°Р¶РёРІР°РЅРёСЏ (РІ СЃРµРєСѓРЅРґСѓ, СЌРєСЃРїРѕРЅРµРЅС†РёР°Р»СЊРЅРѕ). Р’Р«Р‘РћР : РєР°РјРµСЂР°
 *  СѓСЃРїРµРІР°РµС‚ СѓР№С‚Рё РѕС‚ СЃС‚РµРЅС‹ Р·Р° РґРѕР»СЋ СЃРµРєСѓРЅРґС‹ Рё С‚Р°Рє Р¶Рµ СЃРїРѕРєРѕР№РЅРѕ РІРѕР·РІСЂР°С‰Р°РµС‚СЃСЏ. */
const CAMERA_PULL_RATE = 10;
/**
 * РЎРєРѕСЂРѕСЃС‚СЊ РґРѕРІРѕСЂРѕС‚Р° РїРµСЂСЃРѕРЅР°Р¶Р° РІ РЅР°РїСЂР°РІР»РµРЅРёРё РґРІРёР¶РµРЅРёСЏ, РґРѕР»СЏ РїСѓС‚Рё Рє С†РµР»Рё Р·Р° СЃРµРєСѓРЅРґСѓ.
 *
 * РЎС‚РѕРёС‚ 10, Р° РЅРµ 1: РјРіРЅРѕРІРµРЅРЅС‹Р№ РґРѕРІРѕСЂРѕС‚ С‡РёС‚Р°РµС‚СЃСЏ РєР°Рє СЂС‹РІРѕРє, РѕСЃРѕР±РµРЅРЅРѕ РєРѕРіРґР° РєР°РјРµСЂР°
 * РєСЂСѓС‚РёС‚СЃСЏ РјС‹С€СЊСЋ. Р—Р° 0,1 СЃ РїРµСЂСЃРѕРЅР°Р¶ РїСЂРѕС…РѕРґРёС‚ 63 % СѓРіР»Р°, Р·Р° 0,3 СЃ - 95 %.
 */
const FACE_TURN_RATE = 10;
/**
 * РљСЂРµРЅ РєР°РјРµСЂС‹: СЃРєРѕСЂРѕСЃС‚СЊ РЅР°РєР»РѕРЅР° РІ СЃРµРєСѓРЅРґСѓ Рё РїСЂРµРґРµР», СЂР°Рґ.
 *
 * РџСЂРµРґРµР» 0,6 СЂР°РґРёР°РЅР° - СЌС‚Рѕ 34 РіСЂР°РґСѓСЃР°. Р”Р°Р»СЊС€Рµ РіРѕСЂРёР·РѕРЅС‚ СѓРµР·Р¶Р°РµС‚ С‚Р°Рє, С‡С‚Рѕ В«РІРїРµСЂС‘РґВ» РЅР°
 * СЌРєСЂР°РЅРµ РїРµСЂРµСЃС‚Р°С‘С‚ Р±С‹С‚СЊ В«РІРїРµСЂС‘РґВ», Рё СѓРїСЂР°РІР»РµРЅРёРµ СЃС‚Р°РЅРѕРІРёС‚СЃСЏ РЅРµСѓРґРѕР±РЅС‹Рј. 34 РіСЂР°РґСѓСЃР° РґР°СЋС‚
 * Р·Р°РјРµС‚РЅС‹Р№ РЅР°РєР»РѕРЅ Рё РѕСЃС‚Р°РІР»СЏСЋС‚ РЅР°РїСЂР°РІР»РµРЅРёРµ С€Р°РіР° С‡РёС‚Р°РµРјС‹Рј.
 */
const ROLL_RATE = 1.1;
const ROLL_LIMIT = 0.6;
/**
 * РћРєРЅРѕ СЃРІСЏР·РєРё СѓРґР°СЂРѕРІ, РјСЃ. РџРѕРІС‚РѕСЂРЅС‹Р№ РєР»РёРє РІРЅСѓС‚СЂРё РѕРєРЅР° вЂ” РІС‚РѕСЂР°СЏ СЃС‚Р°РґРёСЏ
 * (РѕР±СЂР°С‚РЅС‹Р№ Р·Р°РјР°С…), РєР»РёРє РїРѕР·Р¶Рµ вЂ” СЃРІСЏР·РєР° РЅР°С‡РёРЅР°РµС‚СЃСЏ Р·Р°РЅРѕРІРѕ СЃ РїРµСЂРІРѕР№.
 *
 * 2000, Р° РЅРµ 4000 РєР°Рє СЃРµСЂРІРµСЂРЅР°СЏ С†РµРїРѕС‡РєР°: СЃРµСЂРІРµСЂ СЃС‡РёС‚Р°РµС‚ СЃРµСЂРёСЋ РґР»СЏ СѓСЂРѕРЅР° РїРѕ
 * СЃРІРѕРёРј С‡Р°СЃР°Рј Рё СЃРІРѕРµРјСѓ РѕРєРЅСѓ, Р° СЌС‚Рѕ РѕРєРЅРѕ вЂ” РїСЂРѕ СЂРёС‚Рј Р·Р°РјР°С…РѕРІ РЅР° СЌРєСЂР°РЅРµ.
 * РћРєРЅРѕ РѕР±СЏР·Р°РЅРѕ Р±С‹С‚СЊ С€РёСЂРµ СЃР°РјРѕРіРѕ РґРѕР»РіРѕРіРѕ Р·Р°РјР°С…Р°, РёРЅР°С‡Рµ РІС‚РѕСЂСѓСЋ СЃС‚Р°РґРёСЋ
 * РЅРµР»СЊР·СЏ Р±С‹Р»Рѕ Р±С‹ РІС‹Р±РёС‚СЊ РІ РїСЂРёРЅС†РёРїРµ.
 */
const COMBO_WINDOW_MS = 2000;

/**
 * РљР°Рє С‡Р°СЃС‚Рѕ РёСЃРєР°С‚СЊ РІ СЃС†РµРЅРµ РјР°С‚РµСЂРёР°Р»С‹, РїРѕСЏРІРёРІС€РёРµСЃСЏ РїРѕСЃР»Рµ РїСЂРѕС€РёРІРєРё G-buffer, СЃ.
 *
 * РњРёСЂ РїСЂРѕС€РёРІР°РµС‚СЃСЏ РѕРґРёРЅ СЂР°Р· РїРѕСЃР»Рµ РїРѕСЃС‚СЂРѕР№РєРё, РЅРѕ РёРіСЂРѕРє, РјРѕРЅСЃС‚СЂС‹, Р»РѕС€Р°РґРё Рё
 * РєР°СЂР°РІР°РЅС‹ РїСЂРёС…РѕРґСЏС‚ РІ СЃС†РµРЅСѓ РјРѕРґРµР»СЏРјРё вЂ” РІ Р»СЋР±РѕР№ РјРѕРјРµРЅС‚. РџСЂРѕС€РёРІРєР° РЅРѕРІРѕРіРѕ
 * РјР°С‚РµСЂРёР°Р»Р° вЂ” СЌС‚Рѕ РѕР±С…РѕРґ СЃС†РµРЅС‹ Рё РєРѕРјРїРёР»СЏС†РёСЏ С€РµР№РґРµСЂР°, РїРѕСЌС‚РѕРјСѓ РєР°Р¶РґС‹Р№ РєР°РґСЂ РµС‘
 * РґРµР»Р°С‚СЊ РЅРµР»СЊР·СЏ, Р° СЂР°Р· РІ РґРІРµ СЃРµРєСѓРЅРґС‹ РѕРЅР° РЅРµ РІРёРґРЅР°: AO РЅР° РїСЂРёС€РµРґС€РµРј РјРѕРЅСЃС‚СЂРµ
 * РїРѕСЏРІР»СЏРµС‚СЃСЏ РЅР° СЃРµРєСѓРЅРґСѓ РїРѕР·Р¶Рµ, Рё СЌС‚Рѕ РЅРµ Р·Р°РјРµС‡Р°РµС‚СЃСЏ.
 */
const РџР•Р РРћР”_РџР РћРЁРР’РљР = 2;
/** РљР»Р°РІРёС€Рё, РґРІРѕР№РЅРѕРµ РЅР°Р¶Р°С‚РёРµ РєРѕС‚РѕСЂС‹С… РѕР·РЅР°С‡Р°РµС‚ СЂС‹РІРѕРє: WASD РїР»СЋСЃ СЃС‚СЂРµР»РєРё */
const DOUBLE_TAP_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const DODGE_SPEED = 15.0;    // СЃРєРѕСЂРѕСЃС‚СЊ СЂС‹РІРєР°, СЋРЅРёС‚С‹/СЃРµРє
const DODGE_TIME_MS = 220;   // СЃРєРѕР»СЊРєРѕ РґР»РёС‚СЃСЏ СЃР°Рј СЂС‹РІРѕРє, РјСЃ

// в”Ђв”Ђ Р’РѕРґР° в”Ђв”Ђ
// Р“Р»СѓР±РёРЅР° СЃС‡РёС‚Р°РµС‚СЃСЏ РѕС‚ РќРђРЎРўРћРЇР©Р•Р“Рћ РґРЅР° (Р»Р°РЅРґС€Р°С„С‚) РґРѕ РїРѕРІРµСЂС…РЅРѕСЃС‚Рё РІРѕРґС‹,
// Р° РЅРµ РїРѕ РјР°СЃРєРµ waterMask: РјР°СЃРєР° Р»РёС€СЊ РіРѕРІРѕСЂРёС‚ В«Р·РґРµСЃСЊ РІРѕРґР°В», РЅРѕ РЅРµ РЅР°СЃРєРѕР»СЊРєРѕ.
// РРјРµРЅРЅРѕ РіР»СѓР±РёРЅР° СЂРµС€Р°РµС‚, Р±СЂРѕРґРёС‚ РїРµСЂСЃРѕРЅР°Р¶ РёР»Рё РїР»С‹РІС‘С‚.
const WADE_MIN_DEPTH = 0.15;  // РѕС‚ СЌС‚РѕР№ РіР»СѓР±РёРЅС‹ РЅРѕРіРё СѓР¶Рµ РІ РІРѕРґРµ
const SWIM_MIN_DEPTH = 1.2;   // РіР»СѓР±Р¶Рµ вЂ” РїР»Р°РІР°РЅРёРµ, РјРµР»СЊС‡Рµ вЂ” Р±СЂРѕРґ РїРѕ РґРЅСѓ
const SWIM_FEET = 1.2;        // РІРѕ РІСЂРµРјСЏ РїР»Р°РІР°РЅРёСЏ РЅРѕРіРё РЅР° СЃС‚РѕР»СЊРєРѕ РЅРёР¶Рµ РїРѕРІРµСЂС…РЅРѕСЃС‚Рё
const SWIM_SPEED = 2.0;       // РѕР±С‹С‡РЅРѕРµ РїР»Р°РІР°РЅРёРµ (Р±С‹СЃС‚СЂРµРµ РёРґС‚Рё, С‡РµРј Р±СЂРѕРґРёС‚СЊ)
const SWIM_SPRINT = 3.2;      // РїР»Р°РІР°РЅРёРµ СЃ СѓСЃРёР»РёРµРј
const WADE_MULT = 0.75;       // Р·Р°РјРµРґР»РµРЅРёРµ РІ Р±СЂРѕРґСѓ РїРѕ РІРѕРґРµ

interface BoundRig {
  rig: Rig;
  kind: 'player' | 'monster';
  /**
   * РќР°СЃС‚РѕСЏС‰Р°СЏ РјРѕРґРµР»СЊ СѓР¶Рµ Р·Р°РїСЂРѕС€РµРЅР° Рё РїРѕРґСЃС‚Р°РІР»РµРЅР° (РёР»Рё РїРѕРїС‹С‚РєР° Р·Р°РєРѕРЅС‡РёР»Р°СЃСЊ).
   *
   * РЎС‚Р°РІРёС‚СЃСЏ РѕРґРёРЅ СЂР°Р· РЅР° СЂРёРі: Р±РµР· СЌС‚РѕР№ РѕС‚РјРµС‚РєРё РєР°Р¶РґС‹Р№ РєР°РґСЂ СЃРЅРѕРІР° СЃРїСЂР°С€РёРІР°Р» Р±С‹
   * С„Р°Р№Р» РёР· СЃРµС‚Рё, Р° РєРµС€ Р·Р°РіСЂСѓР·С‡РёРєР° РІСЃС‘ СЂР°РІРЅРѕ РѕС‚РґР°Р» Р±С‹ С‚Рѕ Р¶Рµ СЃР°РјРѕРµ.
   */
  realModelTried?: boolean;
  /** РњРѕРЅСЃС‚СЂ РѕРєР°Р·Р°Р»СЃСЏ РІ РіР»СѓР±РѕРєРѕР№ РІРѕРґРµ Рё РїР»С‹РІС‘С‚ (РїРѕР·Р° Рё Р°РЅРёРјР°С†РёСЏ) */
  monsterSwim?: boolean;
  /** РџРѕРґРІРѕРґРЅРѕРµ СЃСѓС‰РµСЃС‚РІРѕ: СЂРёСЃСѓРµС‚СЃСЏ РЅР° РїРѕРІРµСЂС…РЅРѕСЃС‚Рё, Р° РЅРµ РїРѕРґ РЅРµР№ */
  aquatic?: boolean;
  /** РќР°СЃРєРѕР»СЊРєРѕ С‚РµР»Рѕ РїРѕРґРЅСЏС‚Рѕ РЅР°Рґ РІРѕРґРѕР№ (СЃРїРёРЅР° С‚РѕСЂС‡РёС‚) */
  aquaticLift?: number;
}

/**
 * РљСѓРґР° РґСѓРµС‚ РІРµС‚РµСЂ, РІ СЂР°РґРёР°РЅР°С… (В§258). Р—РµР»РµРЅСЊ РЅР°РєР»РѕРЅСЏРµС‚СЃСЏ РїРѕ СЌС‚РѕРјСѓ РІРµРєС‚РѕСЂСѓ.
 * РћРґРЅРѕ РЅР°РїСЂР°РІР»РµРЅРёРµ РЅР° РІРµСЃСЊ РјРёСЂ: РІРµС‚РµСЂ РІ РјРёСЂРµ РѕРґРёРЅ, Р° РЅРµ СЃРІРѕР№ РІ РєР°Р¶РґРѕРј РєСѓСЃС‚Рµ.
 */
const РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ = 0.7;

/**
 * РЎРёР»Р° РІРµС‚СЂР° РїРѕ РїРѕРіРѕРґРµ (В§281).
 *
 * Р’ РјРёСЂРµ РІРµС‚РµСЂ РѕРґРёРЅ, РЅРѕ Р·РµР»РµРЅСЊ РµРіРѕ С‡СѓРІСЃС‚РІСѓРµС‚ РїРѕ-СЂР°Р·РЅРѕРјСѓ: РІ Р±СѓСЂРµ РІРµС‚РєСѓ СЂРІС‘С‚,
 * РІ С€С‚РёР»СЊ РѕРЅР° РµР»Рµ С€РµРІРµР»РёС‚СЃСЏ. Р§РёСЃР»Р° вЂ” РїРѕ РѕС‰СѓС‰РµРЅРёСЋ, Р° РЅРµ РїРѕ measurement: РІР°Р¶РЅРѕ,
 * С‡С‚РѕР±С‹ СЂР°Р·РЅРёС†Р° С‡РёС‚Р°Р»Р°СЃСЊ, Р° РЅРµ Р±С‹Р»Р° С‚РѕС‡РЅРѕР№.
 */
export function РІРµС‚РµСЂРЎРёР»С‹(weather: string): number {
  switch (weather) {
    case 'storm': return 2.3;
    case 'sandstorm': return 1.7;
    case 'wind': return 1.5;
    case 'rain': return 1.15;
    case 'cloudy': return 0.85;
    case 'snow': return 0.5;
    case 'fog': return 0.4;
    default: return 0.7;
  }
}

/** РћРґРёРЅ РєР°РґСЂ РѕС‚СЂРёСЃРѕРІРєРё: С‚РѕС‡РєР°, РіРґРµ С‚СЏР¶С‘Р»Р°СЏ РїРѕСЃС‚СЂРѕР№РєР° СѓСЃС‚СѓРїР°РµС‚ СЌРєСЂР°РЅ. */
const РєР°РґСЂ = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export class World3D {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  /** РљРѕРјРїРѕР·РёС‚РѕСЂ РґР»СЏ SSAO + SSR + Bloom. Р‘РµР· РЅРёС… СЃС†РµРЅР° РІС‹РіР»СЏРґРёС‚ РїР»РѕСЃРєРѕР№. */
  private composer!: EffectComposer;
  private deferred!: DeferredPass;
    private previousReport: { РїСЂРѕС€РёС‚Рѕ: number; РІСЃРµРіРѕ: number; РјРёРјРѕ: string[] } | null = null;
  private ssrPass!: SSRPass;
  private bloomPass!: UnrealBloomPass;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private torches: { light: THREE.PointLight; base: number; phase: number }[] = [];
  /**
   * РСЃС‚РѕС‡РЅРёРєРё, РєРѕС‚РѕСЂС‹Рµ РіРѕСЂСЏС‚ РїРѕСЃС‚РѕСЏРЅРЅРѕ: СЃРІРµС‚ РІ РїСЂРѕС‘РјР°С… Рё С„РѕРЅР°СЂРё.
   *
   * РћС‚РґРµР»СЊРЅС‹Рј СЃРїРёСЃРєРѕРј РѕС‚ torches, РїРѕС‚РѕРјСѓ С‡С‚Рѕ СѓР»РёС‡РЅС‹Р№ С„Р°РєРµР» РґРЅС‘Рј РіРѕСЂРёС‚ РІ
   * С‡РµС‚РІРµСЂС‚СЊ СЃРёР»С‹ (0.35 + night * 0.65), Р° РІ РїСЂРѕС‘РјРµ Рё РїРѕРґ С„РѕРЅР°СЂС‘Рј С‚РµРјРЅРѕ
   * РІСЃРµРіРґР°: СЃРѕР»РЅС†Рµ С‚СѓРґР° РЅРµ РґРѕС…РѕРґРёС‚.
   */
  private lamps: { light: THREE.PointLight; base: number }[] = [];
  private flames: THREE.Mesh[] = [];
  /** Р”С‹Рј РЅР°Рґ Р±РѕР»СЊС€РёРјРё РѕРіРЅСЏРјРё (В§255): РєРѕСЃС‚С‘СЂ РІ Р»Р°РіРµСЂРµ Рё С„Р°РєРµР»С‹ РєР°СЂР°РІР°РЅ-СЃР°СЂР°СЏ. */
  private РґС‹Рј: { РґС‹Рј: Puffs; x: number; y: number; z: number; С‚Р°Р№РјРµСЂ: number }[] = [];
  /** РџС‹Р»СЊРЅС‹Рµ РІРёС…СЂРё РІ РїСѓСЃС‚С‹РЅРµ (В§257). */
  private РІРёС…СЂРё!: DustDevilsHandle;
  /** РћС‚Р±Р»РµСЃРєРё С„РѕРЅР°СЂРµР№ РЅР° РјРѕРєСЂРѕР№ Р·РµРјР»Рµ (В§276). */
  private РѕС‚Р±Р»РµСЃРєРё!: GlintsHandle;
  /** Р СЏР±СЊ РѕС‚ Р»РѕРґРѕРє Сѓ РїСЂРёС‡Р°Р»Р° (В§280). */
  private СЂСЏР±СЊ!: RipplesHandle;
  /** Р СЏР±СЊ РѕС‚ РґРѕР¶РґСЏ РІ Р»СѓР¶Р°С… (В§285). */
  private СЂСЏР±СЊР›СѓР¶!: PuddleRipplesHandle;
  /** РњР°СЂРµРІРѕ РЅР°Рґ РіРѕСЂРёР·РѕРЅС‚РѕРј РІ Р¶Р°СЂСѓ (В§265). */
  private РјР°СЂРµРІРѕ!: MirageHandle;
  /** РџС‹Р»СЊ РЅР°Рґ РґРѕСЂРѕРіРѕР№ РІ Р¶Р°СЂСѓ (В§268). */
  private РїС‹Р»СЊР”РѕСЂРѕРіРё!: RoadDustHandle;
  /** Р’РѕРґР° РІ РєРѕР»РµСЏС… РґРѕСЂРѕРіРё Рё Р»СѓР¶Рё РІ РїСЂРёРіРѕСЂРѕРґРµ (В§269). */
  private РІРѕРґР°Р”РѕСЂРѕРіРё!: RoadWaterHandle;
  /** РЎР»РµРґС‹ РєР°СЂР°РІР°РЅРѕРІ РЅР° РґРѕСЂРѕРіРµ (В§270). */
  private СЃР»РµРґС‹РљР°СЂР°РІР°РЅРѕРІ!: CaravanTracksHandle;
  /** Р”С‹Рј РёР· РїРµС‡РЅС‹С… С‚СЂСѓР± РіРѕСЂРѕРґР° (В§266). */
  private РґС‹РјРўСЂСѓР±!: Puffs;
  /** РўРµРЅСЊ РѕС‚ РєРѕСЃС‚СЂР° РІ Р»Р°РіРµСЂРµ (В§267). */
  private С‚РµРЅСЊРљРѕСЃС‚СЂР°!: THREE.SpotLight;
  /** РљРѕРіРґР° РІ СЃР»РµРґСѓСЋС‰РёР№ СЂР°Р· РїРѕР№РґС‘С‚ РєР»СѓР± РёР· С‚СЂСѓР±С‹. */
  private РґС‹РјРўСЂСѓР±РўР°Р№РјРµСЂ = 0;
  /** РџС‚РёС†С‹ РЅР°Рґ РїСѓСЃС‚С‹РЅРµР№ Рё РіРѕСЂРѕРґРѕРј (В§259). */
  private РїС‚РёС†С‹!: BirdsHandle;
  /** РќР°СЃРєРѕР»СЊРєРѕ Р·РµРјР»СЏ РјРѕРєСЂР°СЏ, 0..1 (В§261). */
  private РјРѕРєСЂРѕС‚Р° = 0;
  /** РќР°СЃРєРѕР»СЊРєРѕ Р·РµРјР»СЏ Р·Р°СЃРЅРµР¶РµРЅР°, 0..1 (В§262). */
  private СЃРЅРµРі = 0;
  /** РќР°СЃРєРѕР»СЊРєРѕ Р·РµРјР»СЏ Р·Р°РїС‹Р»РµРЅР° Р±СѓСЂРµР№, 0..1 (В§283). */
  private РїС‹Р»СЊ = 0;
  private sky!: SkyHandle;
  /** РўРµРєСѓС‰Р°СЏ РїРѕРіРѕРґР° (РґР»СЏ env-РёРЅС‚РµРЅСЃРёРІРЅРѕСЃС‚Рё). */
  private currentWeather: WeatherKind = 'clear';
  /**
   * HDRI-РѕРєСЂСѓР¶РµРЅРёРµ: РєР°СЂС‚Р° РЅРµР±Р°, РёР· РєРѕС‚РѕСЂРѕР№ СЃС‡РёС‚Р°РµС‚СЃСЏ СЃРІРµС‚.
   *
   * Р–РёРІС‘С‚ СЂСЏРґРѕРј СЃРѕ sky, Р° РЅРµ РІРЅСѓС‚СЂРё РЅРµРіРѕ, РїРѕС‚РѕРјСѓ С‡С‚Рѕ РЅРµР±Рѕ РѕС‚РІРµС‡Р°РµС‚ Р·Р° РєР°СЂС‚РёРЅРєСѓ
   * (СЃРѕР»РЅС†Рµ, Р»СѓРЅР°, Р·РІС‘Р·РґС‹, РѕР±Р»Р°РєР°, С†РІРµС‚ С‚СѓРјР°РЅР°), Р° РѕРєСЂСѓР¶РµРЅРёРµ вЂ” Р·Р° РѕСЃРІРµС‰РµРЅРёРµ.
   * РЎРјРµС€Р°Р»Рё Р±С‹ вЂ” Рё РїСЂР°РІРєР° РЅРµР±Р° С‚Р°С‰РёР»Р° Р±С‹ Р·Р° СЃРѕР±РѕР№ РїРµСЂРµСЃР±РѕСЂРєСѓ РєР°СЂС‚С‹ РЅР° GPU.
   */
  private env!: SkyEnvironment;
  private fauna!: FaunaHandle;
  private npcs!: NpcsHandle;
  private civilians!: CiviliansHandle;
  private townfolk!: TownfolkHandle;
  /** РЎРјРµСЃРёС‚РµР»Рё РєРѕСЂРѕРІ: СЃРїРёСЃРѕРє РїСѓСЃС‚, РїРѕРєР° РјРѕРґРµР»СЊ РЅРµ РїСЂРёРµС…Р°Р»Р°. */
  private cowMixers: THREE.AnimationMixer[] = [];
  private roadTraffic!: RoadTrafficHandle;
  private weather!: WeatherHandle;
  private interiors!: InteriorsHandle;
  private doorTargets: THREE.Object3D[] = [];
  private interactiveTargets: THREE.Object3D[] = [];
  private climbTargets: THREE.Object3D[] = [];
  private destructibleTargets: THREE.Object3D[] = [];
  /** Р›РµСЃС‚РЅРёС†Р°, РЅР° РєРѕС‚РѕСЂРѕР№ СЃРµР№С‡Р°СЃ СЃС‚РѕРёРј (В§324). null - РЅРµ Р»РµР·РµРј. */
  private climb: THREE.Object3D | null = null;
  private navigator!: NavigatorHandle;
  private clockHour = 12;          // РёРіСЂРѕРІС‹Рµ СЃСѓС‚РєРё: 0вЂ“23
  private lastInCity = false;
  /** РќР°РєРѕРїРёС‚РµР»СЊ РІСЂРµРјРµРЅРё РґРѕ СЃР»РµРґСѓСЋС‰РµРіРѕ РїРѕРёСЃРєР° РЅРѕРІС‹С… materials РґР»СЏ G-buffer. */
  private patchTimer = 0;
  /** Рћ РЅРµРїСЂРѕС€РёС‚С‹С… РјР°С‚РµСЂРёР°Р»Р°С… РїСЂРµРґСѓРїСЂРµР¶РґР°РµРј РѕРґРёРЅ СЂР°Р·, Р° РЅРµ РєР°Р¶РґС‹Рµ РґРІРµ СЃРµРєСѓРЅРґС‹. */
  /** РћР±С‰РµРµ РІСЂРµРјСЏ РІРѕРґС‹ РґР»СЏ РІСЃРµС… С‚РµР»: СЃРµРєСѓРЅРґС‹ СЃ Р·Р°РїСѓСЃРєР° РјРёСЂР°. */
  private waterTime = 0;

  private container!: HTMLElement;
  private fxLayer!: HTMLElement;
  private crosshair!: HTMLElement;
  private entities: World | null = null;
  private me: PlayerEntity | null = null;
  private rigs = new Map<string, BoundRig>();

  // РљР°РјРµСЂР°
  private yaw = Math.PI;          // РєСѓРґР° СЃРјРѕС‚СЂРёС‚ РєР°РјРµСЂР°
  private pitch = 0.34;
  /** Р–РµР»Р°РµРјР°СЏ РґРёСЃС‚Р°РЅС†РёСЏ (РєРѕР»РµСЃРѕ РјС‹С€Рё, РЅР°СЃС‚СЂРѕР№РєРё) */
  private dist = 7.5;
  /**
   * Р¤Р°РєС‚РёС‡РµСЃРєР°СЏ РґРёСЃС‚Р°РЅС†РёСЏ РєР°РјРµСЂС‹ (В§369): СЃРіР»Р°Р¶РµРЅРЅРѕ РґРѕРіРѕРЅСЏРµС‚ СЂР°Р·СЂРµС€С‘РЅРЅСѓСЋ.
   * Р–РµР»Р°РµРјР°СЏ Рё С„Р°РєС‚РёС‡РµСЃРєР°СЏ СЂР°Р·РґРµР»СЊРЅС‹, С‡С‚РѕР±С‹ СЃС‚РµРЅР° РЅРµ РґС‘СЂРіР°Р»Р° РєР°РјРµСЂСѓ РєР°РґСЂРѕРј вЂ”
   * РѕРЅР° Р»РёС€СЊ РѕРіСЂР°РЅРёС‡РёРІР°РµС‚ С†РµР»СЊ, Р° РєР°РјРµСЂР° РґРѕРµР·Р¶Р°РµС‚ РїР»Р°РІРЅРѕ.
   */
  private distCurrent = 7.5;
/**
 * РљСЂРµРЅ РєР°РјРµСЂС‹, СЂР°РґРёР°РЅС‹. РџРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Р№ вЂ” РіРѕСЂРёР·РѕРЅС‚ СѓС…РѕРґРёС‚ РІР»РµРІРѕ.
 *
 * РћС‚РґРµР»СЊРЅРѕРµ РїРѕР»Рµ, Р° РЅРµ С‡Р°СЃС‚СЊ yaw, РёРјРµРЅРЅРѕ С‡С‚РѕР±С‹ РєСЂРµРЅ РЅРµ РІР»РёСЏР» РЅР° РґРІРёР¶РµРЅРёРµ:
 * С€Р°Рі С‡РёС‚Р°РµС‚СЃСЏ РїРѕ this.yaw, Рё РЅР°РєР»РѕРЅС‘РЅРЅС‹Р№ РіРѕСЂРёР·РѕРЅС‚ РЅРµ РґРѕР»Р¶РµРЅ РµРіРѕ РїРµСЂРµРїРёСЃС‹РІР°С‚СЊ.
 */
private roll = 0;
  private locked = false;

  // Р¤РёР·РёРєР° РёРіСЂРѕРєР°
  private vy = 0;
  private grounded = true;
  private crouch = false;
  private wasCrouch = false;
  /** РџРѕРґРєР°С‚ (В§385): РѕСЃС‚Р°С‚РѕРє РІСЂРµРјРµРЅРё СЃРєРѕР»СЊР¶РµРЅРёСЏ РїРѕСЃР»Рµ РїСЂРёСЃРµРґР° РЅР° С…РѕРґСѓ. */
  private slideTimer = 0;
  private block = false;
  private swimming = false;
  /** Р’С‹СЃРѕС‚Р° РЅРѕРі Р»РѕРєР°Р»СЊРЅРѕРіРѕ РёРіСЂРѕРєР° СЃ РїСЂРµРґС‹РґСѓС‰РµРіРѕ РєР°РґСЂР° (С„РёР·РёРєР°, Р° РЅРµ Р»Р°РЅРґС€Р°С„С‚) */
  private feetY = Number.NaN;
  private keys = new Set<string>();
  /** РҐРІР°С‚Р°РµС‚ Р»Рё СЃС‚Р°РјРёРЅС‹ РЅР° Р±РµРі/СѓСЃРёР»РµРЅРЅРѕРµ РїР»Р°РІР°РЅРёРµ вЂ” СЂРµС€Р°РµС‚ world.ts РїРѕ РїРѕР»РѕСЃРєРµ */
  private sprintAllowed = true;
  /** РЎРєРѕСЂРѕСЃС‚СЊ РІ РІРѕРґРµ Рё СЌРєРѕРЅРѕРјРёСЏ СЃС‚Р°РјРёРЅС‹ вЂ” РёР· СЌРєРёРїРёСЂРѕРІРєРё (СЃР°РїРѕРіРё, РїР»Р°С‰) */
  private waterSpeedBonus = 0;
  private swimStaminaSave = 0;
  /** Р›РѕРґРєР°: id Р°РєС‚РёРІРЅРѕР№ Рё РµС‘ Р±РѕРЅСѓСЃС‹ Рє РІРѕРґРµ */
  private boatId: string | null = null;
  private boatWaterSpeed = 0;
  private boatStaminaSave = 0;
  /** РЎРєРѕСЂРѕСЃС‚СЊ РІ РІРѕРґРµ РЅР° Р»РѕРґРєРµ, Рј/СЃ */
  private boatSwimSpeed = 0;
  /**
   * РђРєС‚РёРІРЅС‹Р№ СЃРєР°РєСѓРЅ: РµРіРѕ СЃРєРѕСЂРѕСЃС‚СЊ С€Р°РіРѕРј, Рј/СЃ. 0 вЂ” РїРµС€РєРѕРј.
   *
   * РЎРєРѕСЂРѕСЃС‚СЊ РЎРєР°РєСѓРЅР° Р—РђРњР•РќРЇРµС‚ РїРµС€СѓСЋ, Р° РЅРµ РїСЂРёР±Р°РІР»СЏРµС‚СЃСЏ. Р§РёСЃР»Р° РІ С‚Р°Р±Р»РёС†Рµ
   * СЃРєР°РєСѓРЅРѕРІ (3.5вЂ“12 Рј/СЃ) РјРµРЅСЊС€Рµ Р±РµРіР° РїРµС€РєРѕРј (7.6), С‚Р°Рє С‡С‚Рѕ В«СЃРєРѕСЂРѕСЃС‚СЊ +
   * Р±РѕРЅСѓСЃВ» РѕР·РЅР°С‡Р°Р»Рѕ Р±С‹, С‡С‚Рѕ РґРѕСЂРѕРіРѕР№ РЎРёРјСѓСЂРі РµРґРµС‚ РјРµРґР»РµРЅРЅРµРµ, С‡РµРј Р±РµРі Р±РµР·
   * РЅРµРіРѕ. РЁР°РіРѕРј РµРґРµРј РЅР° РїРѕР»РЅРѕР№ СЃРєРѕСЂРѕСЃС‚Рё СЃРєР°РєСѓРЅР°, Р±РµРіРѕРј вЂ” РІ 1.4 СЂР°Р·Р° Р±С‹СЃС‚СЂРµРµ.
   */
  private mountSpeed = 0;
  /**
   * РњРЅРѕР¶РёС‚РµР»СЊ РїРѕРіРѕРґС‹ РЅР° СЃРєРѕСЂРѕСЃС‚СЊ СЃСѓС€Рё, РїСЂРёСЃС‹Р»Р°РµС‚ СЃРµСЂРІРµСЂ РІ world:time.
   *
   * Р—РЅР°С‡РµРЅРёРµ вЂ” WEATHER_EFFECTS[weather].speedMod С‚РѕРіРѕ Р¶Рµ РїР°РєРµС‚Р°: РІ РїРµСЃС‡Р°РЅСѓСЋ
   * Р±СѓСЂСЋ 0.6, РІ Р±СѓСЂСЋ 0.7, РІ СЃРЅРµРі 0.8, РІ РґРѕР¶РґСЊ 0.9. РЎС‡РёС‚Р°С‚СЊ РµРіРѕ РЅР° РєР»РёРµРЅС‚Рµ
   * РїРѕ СЃРІРѕРµР№ РєРѕРїРёРё СЃРїСЂР°РІРѕС‡РЅРёРєР° Р·РЅР°С‡РёР»Рѕ Р±С‹ СЂР°РЅРѕ РёР»Рё РїРѕР·РґРЅРѕ СЂР°Р·СЉРµС…Р°С‚СЊСЃСЏ СЃ
   * СЃРµСЂРІРµСЂРѕРј. РњРµРґР»РµРЅРЅС‹Рј РїРѕРіРѕРґР° РґРµР»Р°РµС‚ С‚РѕР»СЊРєРѕ СЃСѓС€Сѓ: Сѓ РІРѕРґС‹ СЃРІРѕСЏ С„РёР·РёРєР°
   * (Р±СЂРѕРґ, СЃР°РїРѕРіРё, Р»РѕРґРєР°), СЂС‹РІРѕРє вЂ” С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹Р№ РјР°РЅС‘РІСЂ СЃРѕ СЃРІРѕРµР№
   * РїСЂРѕРІРµСЂРµРЅРЅРѕР№ РјР°С‚РµРјР°С‚РёРєРѕР№, РїСЂРёСЃРµРґ вЂ” В«РєСЂР°РґСѓСЃСЊ С‚РёС…РѕВ». РђРЅС‚РёС‡РёС‚Сѓ РЅРёС‡РµРіРѕ РЅРµ
   * РЅСѓР¶РЅРѕ: РїРѕРіРѕРґР° Р·Р°РјРµРґР»СЏРµС‚, РїРѕС‚РѕР»РѕРє СЃРєРѕСЂРѕСЃС‚Рё РЅРµ СЂР°СЃС‚С‘С‚.
   */
  private speedMod = 1;
  /**
   * Р­РєРёРїРёСЂРѕРІРєР° СЃРІРѕРµРіРѕ РїРµСЂСЃРѕРЅР°Р¶Р° РґР»СЏ СЂРёРіР°; null вЂ” СЃРµСЂРІРµСЂ РµС‰С‘ РЅРµ РѕС‚РІРµС‚РёР».
   *
   * armorColor вЂ” С†РІРµС‚ РіСЂСѓРґРё РїРѕ СЂРµРґРєРѕСЃС‚Рё РґРѕСЃРїРµС…Р°, С‡С‚РѕР±С‹ СЃРјРµРЅР° Р±СЂРѕРЅРё Р±С‹Р»Р° РІРёРґРЅР°
   * РЅРµ С‚РѕР»СЊРєРѕ РІ РїР°РЅРµР»Рё.
   */
  private localGear: LocalGear | null = null;
  /** 3D-СЌРєРёРїРёСЂРѕРІРєР° РЎРµС„РµРІРёРґРѕРІ РЅР° РјРѕРґРµР»Рё РёРіСЂРѕРєР° (РѕРґРµР¶РґР°, РґРѕСЃРїРµС…Рё, РѕСЂСѓР¶РёРµ) */
  private safavidEquipment3D: SafavidEquipment3D | null = null;
  /** РЎРєРѕР»СЊРєРѕ СЃРµРєСѓРЅРґ РѕСЃС‚Р°Р»РѕСЃСЊ РїРѕРєР°Р·С‹РІР°С‚СЊ В«РІС‹РґРѕС…СЃСЏВ» РїРѕСЃР»Рµ РєРѕРЅС†Р° СЃС‚Р°РјРёРЅС‹ */
  private exhaustedFlash = 0;
  private stepTimer = 0;
  private attackCd = 0;
  /**
   * РЎС‚Р°РґРёСЏ СЃРІСЏР·РєРё СѓРґР°СЂРѕРІ: 1 вЂ” РїСЂСЏРјРѕР№ Р·Р°РјР°С…, 2 вЂ” РѕР±СЂР°С‚РЅС‹Р№. РџРµСЂРµРєР»СЋС‡Р°РµС‚СЃСЏ
   * РїРѕРІС‚РѕСЂРЅС‹Рј РєР»РёРєРѕРј РІ РѕРєРЅРµ COMBO_WINDOW_MS. РўСЂРµС‚СЊРµР№ СЃС‚Р°РґРёРё Сѓ РєР»РёРєРѕРІ РЅРµС‚:
   * Р·Р°РІРµСЂС€Р°СЋС‰Р°СЏ Р°С‚Р°РєР° вЂ” СЌС‚Рѕ РєР»РёРє РїР»СЋСЃ РЅР°РІС‹Рє, РїРѕСЌС‚РѕРјСѓ РґР°Р»СЊС€Рµ СЃС‡С‘С‚С‡РёРє
   * С‡РµСЂРµРґСѓРµС‚СЃСЏ, РїРѕРєР° РѕРєРЅРѕ РЅРµ РІС‹Р№РґРµС‚.
   */
  private comboStage: 1 | 2 = 1;
  private lastSwingAt = 0;
  /** РЎС‚Р°РґРёСЏ С‚РµРєСѓС‰РµРіРѕ Р·Р°РјР°С…Р°: СЃС‚Р°РІРёС‚СЃСЏ РІ tryAttack, С‡РёС‚Р°РµС‚СЃСЏ РєР°РґСЂРѕРј РЅРёР¶Рµ. */
  private attackStage: 1 | 2 = 1;
  /**
   * РљСЂСЋС‡РѕРє В«РёРіСЂРѕРє Р·Р°РјР°С…РЅСѓР»СЃСЏВ». РЎС‚Р°РІРёС‚СЃСЏ СЃР»РѕРµРј РїСЂРёР»РѕР¶РµРЅРёСЏ (СЃРј. world.ts) вЂ”
   * С‚СѓС‚РѕСЂРёР°Р»Сѓ РЅСѓР¶РЅРѕ Р·РЅР°С‚СЊ Рѕ Р·Р°РјР°С…Рµ, Р° Р·Р°РІРѕРґРёС‚СЊ Р·Р°РІРёСЃРёРјРѕСЃС‚СЊ РѕС‚ РёРЅС‚РµСЂС„РµР№СЃР°
   * РІРЅСѓС‚СЂСЊ 3D-СЃР»РѕСЏ РЅРµР»СЊР·СЏ.
   */
  private onAttack: (() => void) | null = null;
  /**
   * РљСЂСЋС‡РѕРє В«РёРіСЂРѕРє РѕСЃРјРѕС‚СЂРµР»СЃСЏВ». РљР°РјРµСЂСѓ РєСЂСѓС‚РёС‚ РґРІРёР¶РµРЅРёРµ РјС‹С€Рё РїСЂРё Р·Р°С…РІР°С‚Рµ
   * СѓРєР°Р·Р°С‚РµР»СЏ, Р° РЅРµ РїСЂР°РІР°СЏ РєРЅРѕРїРєР° (РѕРЅР° вЂ” Р±Р»РѕРє), РїРѕСЌС‚РѕРјСѓ С€Р°Рі С‚СѓС‚РѕСЂРёР°Р»Р°
   * Р·Р°СЃС‡РёС‚С‹РІР°РµРј РёРјРµРЅРЅРѕ Р·РґРµСЃСЊ. РРЅР°С‡Рµ РёРіСЂРѕРє РєСЂСѓС‚РёР» Р±С‹ РјС‹С€СЊСЋ Рё РЅРµ РІРёРґРµР» Р±С‹
   * СЂРµР°РєС†РёРё, Р° С‚РµРєСЃС‚ С€Р°РіР° РѕР±РµС‰Р°Р» РїСЂР°РІСѓСЋ РєРЅРѕРїРєСѓ, РєРѕС‚РѕСЂР°СЏ С‚СѓС‚ РЅРё РїСЂРё С‡С‘Рј.
   */
  private onCamera: (() => void) | null = null;
  private onBlock: (() => void) | null = null;
  private onDodge: (() => void) | null = null;
  /**
   * Р”РІРѕР№РЅС‹Рµ РЅР°Р¶Р°С‚РёСЏ РєР»Р°РІРёС€ РЅР°РїСЂР°РІР»РµРЅРёСЏ: РєР»Р°РІРёС€Р° -> РІСЂРµРјСЏ РїРѕСЃР»РµРґРЅРµРіРѕ РЅР°Р¶Р°С‚РёСЏ.
   * РџРѕ РЅРµРјСѓ Р»РѕРІРёС‚СЃСЏ СЂС‹РІРѕРє. РџСѓСЃС‚РѕР№ РЅР°Р±РѕСЂ РѕР·РЅР°С‡Р°РµС‚ В«РґРІРѕР№РЅРѕРіРѕ РЅР°Р¶Р°С‚РёСЏ РЅРµ Р±С‹Р»РѕВ».
   */
  private lastTap = new Map<string, number>();
  /** Р”РІР° РЅР°Р¶Р°С‚РёСЏ СЌС‚РѕР№ РєР»Р°РІРёС€Рё Р·Р° РјРµРЅСЊС€Рµ, С‡РµРј СЃС‚РѕР»СЊРєРѕ, СЃС‡РёС‚Р°СЋС‚СЃСЏ СЂС‹РІРєРѕРј */
  private static readonly DOUBLE_TAP_MS = 260;
  /**
   * Р С‹РІРѕРє: С‚РѕС‡РєР° СЃС‚Р°СЂС‚Р°, РјРѕРјРµРЅС‚ СЃС‚Р°СЂС‚Р° Рё РµРґРёРЅРёС‡РЅРѕРµ РЅР°РїСЂР°РІР»РµРЅРёРµ.
   *
   * Р”РІРёР¶РµРЅРёРµ СЃС‡РёС‚Р°РµС‚СЃСЏ Р°РЅР°Р»РёС‚РёС‡РµСЃРєРё (СЃРјРµС‰РµРЅРёРµ = v*t РјРёРЅСѓСЃ v*tВІ/2), Р° РЅРµ
   * СЃРєР»Р°РґС‹РІР°РЅРёРµРј С€Р°РіРѕРІ РїРѕ РєР°РґСЂР°Рј: СЃРєР»Р°РґС‹РІР°РЅРёРµ РґР°РІР°Р»Рѕ 2.26 РјРµС‚СЂР° РЅР° 30 РєР°РґСЂР°С…
   * Рё 1.75 РЅР° 144, С‚Рѕ РµСЃС‚СЊ РЅР° СЃР»Р°Р±РѕРј РєРѕРјРїСЊСЋС‚РµСЂРµ РёРіСЂРѕРєР° РєРёРґР°Р»Рѕ РІРґРІРѕРµ РґР°Р»СЊС€Рµ.
   */
  private dodgeStartAt = 0;
  private dodgeT = 0;
  private dodgeOx = 0;
  private dodgeOz = 0;
  private dodgeDx = 0;
  private dodgeDz = 0;
  private dodgeUntil = 0;

  // РЎР»СѓР¶РµР±РЅРѕРµ
  private raf = 0;
  private lastFx = { floater: 0, effect: 0 };
  private targetRing!: THREE.Mesh;
  private targetRingTarget: string | null = null;
  private targetNameEl!: HTMLElement;
  /** РџРѕРґСЃРєР°Р·РєР° РѕРєСЂСѓР¶РµРЅРёСЏ (В§370): В«РЇС‰РёРє вЂ” С‚РѕР»РєРЅСѓС‚СЊВ» РїРѕРґ РїСЂРёС†РµР»РѕРј */
  private envHintEl: HTMLElement | null = null;
  private wasNight = false;
  private lastDir: { x: number; y: number; z: number } = { x: 0, y: 0, z: 1 };
  private callbacks: World3DCallbacks | null = null;
  private debugColliders!: THREE.Group;
  private wasInWater = false;
  private splashMesh!: THREE.Mesh;
  private bubbleTimer = 0;
  /** РЎР»РµРґРёС‚ Р·Р° СЂР°Р·РјРµСЂРѕРј РєРѕРЅС‚РµР№РЅРµСЂР°: РїРѕР»РЅС‹Р№ СЌРєСЂР°РЅ Рё СЂРµР¶РёРј В«СЃ СЂР°РјРєРѕР№В»
   *  РјРµРЅСЏСЋС‚ СЂР°Р·РјРµСЂ Р±РµР· СЃРѕР±С‹С‚РёСЏ resize РѕРєРЅР° */
  private ro: ResizeObserver | null = null;

  get isLocked() { return this.locked; }

  /** РџР»С‹РІС‘С‚ Р»Рё РёРіСЂРѕРє вЂ” СЂР°СЃС…РѕРґ РІС‹РЅРѕСЃР»РёРІРѕСЃС‚Рё Рё Р·РІСѓРєРё РІРѕРґС‹ Р·Р°РІРёСЃСЏС‚ РѕС‚ СЌС‚РѕРіРѕ */
  get isSwimming() { return this.swimming; }

  /** РќР° С‡С‘Рј РёРіСЂРѕРє: null вЂ” РЅР° Р±РµСЂРµРіСѓ, РёРЅР°С‡Рµ id Р°РєС‚РёРІРЅРѕР№ Р»РѕРґРєРё */
  get activeBoatId(): string | null { return this.boatId; }

  /**
   * Р›РѕРґРєР°: СЃРЅРёРјР°РµС‚ Р·Р°РјРµРґР»РµРЅРёРµ РІРѕРґС‹, РґРѕР±Р°РІР»СЏРµС‚ СЃРєРѕСЂРѕСЃС‚СЊ Рё СЌРєРѕРЅРѕРјРёС‚
   * РІС‹РЅРѕСЃР»РёРІРѕСЃС‚СЊ. Р—Р°РјРµРЅСЏРµС‚ СЃР°РїРѕРіРё, РїРѕРєР° РёРіСЂРѕРє РІ Р»РѕРґРєРµ, вЂ” Р±РµСЂС‘С‚СЃСЏ Р»СѓС‡С€РёР№
   * РёР· РґРІСѓС… Р±РѕРЅСѓСЃРѕРІ, Р° РЅРµ СЃСѓРјРјР° (РёРЅР°С‡Рµ Р»РѕРґРєР° РґР°Р»Р° Р±С‹ Р±РѕР»СЊС€Рµ РµРґРёРЅРёС†С‹).
   */
  setBoat(boatId: string | null, waterSpeed: number, staminaSave: number, swimSpeed = 0): void {
    this.boatId = boatId;
    this.boatWaterSpeed = boatId ? Math.max(0, Math.min(1, waterSpeed)) : 0;
    this.boatStaminaSave = boatId ? Math.max(0, Math.min(0.9, staminaSave)) : 0;
    this.boatSwimSpeed = boatId ? Math.max(0, swimSpeed) : 0;
  }

  /**
   * РЎРєРѕСЂРѕСЃС‚СЊ Р°РєС‚РёРІРЅРѕРіРѕ СЃРєР°РєСѓРЅР° (С€Р°РіРѕРј), 0 вЂ” РёРіСЂРѕРє РїРµС€РєРѕРј.
   *
   * Р§РёСЃР»Рѕ РїСЂРёСЃС‹Р»Р°РµС‚ СЃРµСЂРІРµСЂ РІРјРµСЃС‚Рµ СЃРѕ СЃРїРёСЃРєРѕРј СЃРєР°РєСѓРЅРѕРІ: СЃС‡РёС‚Р°С‚СЊ СЃРєРѕСЂРѕСЃС‚СЊ РЅР°
   * РєР»РёРµРЅС‚Рµ РЅРµР»СЊР·СЏ, С‚Р°Рј СЃРІРѕСЏ РєРѕРїРёСЏ С‚Р°Р±Р»РёС†С‹, РєРѕС‚РѕСЂР°СЏ СЂР°Р·РѕС€Р»Р°СЃСЊ СЃ СЃРµСЂРІРµСЂРЅРѕР№.
   * РџСЂРµРґРµР» СЃРєРѕСЂРѕСЃС‚Рё Сѓ Р°РЅС‚РёС‡РёС‚Р° С‚РѕР¶Рµ СЃС‡РёС‚Р°РµС‚ СЃРµСЂРІРµСЂ вЂ” РёР· character_mounts.
   */
  setMountSpeed(speed: number): void {
    this.mountSpeed = Number.isFinite(speed) && speed > 0 ? speed : 0;
  }

  /** РҐРІР°С‚Р°РµС‚ Р»Рё РІС‹РЅРѕСЃР»РёРІРѕСЃС‚Рё РЅР° Р±РµРі (Рё РЅР° СѓСЃРёР»РµРЅРЅРѕРµ РїР»Р°РІР°РЅРёРµ) */
  setSprintAllowed(v: boolean): void {    // РњРѕРјРµРЅС‚, РєРѕРіРґР° СЃРёР»С‹ РєРѕРЅС‡РёР»РёСЃСЊ, вЂ” РѕРґРёРЅ СЂР°Р· РїРѕРґСЃРєР°Р·С‹РІР°РµРј РёРіСЂРѕРєСѓ
    if (this.sprintAllowed && !v) this.exhaustedFlash = 0.4;
    this.sprintAllowed = v;
  }

  /**
   * РњРЅРѕР¶РёС‚РµР»СЊ РїРѕРіРѕРґС‹ РЅР° СЃРєРѕСЂРѕСЃС‚СЊ СЃСѓС€Рё. РџСЂРёС…РѕРґРёС‚ СЃ СЃРµСЂРІРµСЂР° РІ world:time.
   * РњСѓСЃРѕСЂ Рё СѓСЃРєРѕСЂРµРЅРёРµ РѕС‚СЃРµРєР°СЋС‚СЃСЏ: РїРѕРіРѕРґР° СѓРјРµРµС‚ С‚РѕР»СЊРєРѕ РјРµС€Р°С‚СЊ РёРґС‚Рё, fastest
   * РїРѕРіРѕРґР° вЂ” СЏСЃРЅР°СЏ (1.0).
   */
  setSpeedMod(speedMod: number): void {
    this.speedMod = Number.isFinite(speedMod) && speedMod > 0
      ? Math.min(1, Math.max(0.3, speedMod))
      : 1;
  }

  /** Р­РєРѕРЅРѕРјРёСЏ РІС‹РЅРѕСЃР»РёРІРѕСЃС‚Рё РїСЂРё РїР»Р°РІР°РЅРёРё: СЃР°РїРѕРіРё/РїР»Р°С‰ РёР»Рё Р»РѕРґРєР° */
  get waterStaminaSave(): number {
    return Math.max(this.swimStaminaSave, this.boatStaminaSave);
  }

  /** True РѕРґРёРЅ СЂР°Р·, С‚РѕР»СЊРєРѕ С‡С‚Рѕ РІС‹РЅРѕСЃР»РёРІРѕСЃС‚СЊ Р·Р°РєРѕРЅС‡РёР»Р°СЃСЊ */
  get exhaustedNow(): boolean {
    if (this.exhaustedFlash <= 0) return false;
    this.exhaustedFlash = 0;
    return true;
  }

  /**
   * Р‘РѕРЅСѓСЃС‹ В«РґР»СЏ РІРѕРґС‹В» РёР· СЌРєРёРїРёСЂРѕРІРєРё (СЃР°РїРѕРіРё/РїР»Р°С‰): 0 вЂ” РІРѕРґР° С‚РѕСЂРјРѕР·РёС‚ РєР°Рє
   * РѕР±С‹С‡РЅРѕ, 1 вЂ” РІРѕРґР° РЅРµ РјРµС€Р°РµС‚ РІРѕРІСЃРµ; stamina вЂ” СЌРєРѕРЅРѕРјРёСЏ СЂР°СЃС…РѕРґР°.
   */
  setWaterBonus(waterSpeed: number, staminaSave: number): void {
    this.waterSpeedBonus = Math.max(0, Math.min(1, waterSpeed));
    this.swimStaminaSave = Math.max(0, Math.min(0.75, staminaSave));
  }

  /** РџРѕСЃР»РµРґРЅРµРµ РЅР°РїСЂР°РІР»РµРЅРёРµ РґРІРёР¶РµРЅРёСЏ РІ РјРёСЂРѕРІС‹С… РєРѕРѕСЂРґРёРЅР°С‚Р°С… (РґР»СЏ РїР°РєРµС‚РѕРІ player:move) */
  get moveDir() { return this.lastDir; }

  /**
   * РџСЂРёСЃРµР» Р»Рё РїРµСЂСЃРѕРЅР°Р¶ СЃРµР№С‡Р°СЃ.
   *
   * РќСѓР¶РµРЅ РЅР°СЂСѓР¶Сѓ, С‡С‚РѕР±С‹ СЃРєР°Р·Р°С‚СЊ СЃРµСЂРІРµСЂСѓ РІ РїР°РєРµС‚Рµ РґРІРёР¶РµРЅРёСЏ. РџСЂРёСЃРµРґР°РЅРёРµ СЃР°РјРѕ РїРѕ
   * СЃРµР±Рµ Р±С‹Р»Рѕ С‡РёСЃС‚Рѕ РєР»РёРµРЅС‚СЃРєРёРј: СЃРєРѕСЂРѕСЃС‚СЊ, Р°РЅРёРјР°С†РёСЏ Рё РєР°РјРµСЂР° РЅР° РЅС‘Рј РјРµРЅСЏР»РёСЃСЊ
   * (CROUCH_SPEED = 2.2), РЅРѕ СЃРµСЂРІРµСЂ Рѕ РЅС‘Рј РЅРµ Р·РЅР°Р» - Р° Р·РЅР°С‡РёС‚, РЅРµ РјРѕРі РЅРёРєРѕРіРѕ
   * РЅРµ Р·Р°РјРµС‚РёС‚СЊ. РЁР°Рі 2 СЃС‚РµР»СЃР°: РїСЂР°РІРёР»Рѕ СЃРєСЂС‹С‚РЅРѕСЃС‚Рё Р¶РёРІС‘С‚ РІ shared/stealth.ts,
   * Рё Р±РµР· СЌС‚РѕРіРѕ РіРµС‚С‚РµСЂР° СЃРµСЂРІРµСЂ РїРѕР»СѓС‡РёР» Р±С‹ С‚РѕР»СЊРєРѕ РєРѕРѕСЂРґРёРЅР°С‚С‹ Рё СЃС‡РёС‚Р°Р» Р±С‹,
   * С‡С‚Рѕ РёРіСЂРѕРє СЃС‚РѕРёС‚.
   *
   * Р—РЅР°С‡РµРЅРёРµ С‡РёС‚Р°РµС‚СЃСЏ РёР· С‚РѕРіРѕ Р¶Рµ РїРѕР»СЏ, С‡С‚Рѕ РёРґС‘С‚ РІ Р°РЅРёРјР°С†РёСЋ, - СЂР°СЃС…РѕР¶РґРµРЅРёРµ
   * РјРµР¶РґСѓ В«Р°РЅРёРјР°С†РёРµР№ РїСЂРёСЃРµР»Р°В» Рё В«СЃРµСЂРІРµСЂСѓ СЃРєР°Р·Р°Р»Рё Рѕ РїСЂРёСЃРµРґРµВ» РЅРµРІРѕР·РјРѕР¶РЅРѕ РїРѕ
   * РїРѕСЃС‚СЂРѕРµРЅРёСЋ.
   */
  get crouching() { return this.crouch; }

  /** РЁР°Рі 3 СЃС‚РµР»СЃР°: РёРіСЂРѕРє РЅР°Р¶Р°Р» F. Р¤Р»Р°Рі СЃС‚Р°РІРёС‚СЃСЏ РЅР°Р¶Р°С‚РёРµРј Рё СЃРЅРёРјР°РµС‚СЃСЏ С‡С‚РµРЅРёРµРј. */
  private stealRequested = false;
  // Zapros na stol s dokumentami. Odnokratnyy i sbСЂР°СЃС‹vaetsya chteniyem,
  // rovno kak flag krazhi: inache uderzhanie klavishi slalo by zaprosy
  // kazhdyy kadr.
  private documentRequested = false;

  /**
   * Р—Р°Р±СЂР°С‚СЊ Р·Р°РїСЂРѕСЃ РЅР° РєСЂР°Р¶Сѓ.
   *
   * Р’РѕР·РІСЂР°С‰Р°РµС‚ true СЂРѕРІРЅРѕ РѕРґРёРЅ СЂР°Р· РЅР° РЅР°Р¶Р°С‚РёРµ. Р•СЃР»Рё Р±С‹ РІРѕР·РІСЂР°С‰Р°Р» С„Р»Р°Рі Р±РµР·
   * СЃР±СЂРѕСЃР°, СѓРґРµСЂР¶Р°РЅРёРµ F СЃР»Р°Р»Рѕ Р±С‹ Р·Р°РїСЂРѕСЃС‹ РєР°Р¶РґС‹Р№ РєР°РґСЂ, Рё СЃРµСЂРІРµСЂ РїРѕР»СѓС‡Р°Р» Р±С‹
   * СЃРѕС‚РЅРё РїРѕРїС‹С‚РѕРє РІ СЃРµРєСѓРЅРґСѓ РѕС‚ РѕРґРЅРѕРіРѕ РЅР°Р¶Р°С‚РёСЏ.
   */
  /**
   * Zabrat li zapros na dokumenty. Flag sbСЂР°СЃС‹vaetsya chteniyem.
   */
  consumeDocumentRequest(): boolean {
    const byl = this.documentRequested;
    this.documentRequested = false;
    return byl;
  }
  consumeStealRequest(): boolean {
    const Р±С‹Р» = this.stealRequested;
    this.stealRequested = false;
    return Р±С‹Р»;
  }

  /**
   * Р­РєРёРїРёСЂРѕРІРєР° СЃРІРѕРµРіРѕ РїРµСЂСЃРѕРЅР°Р¶Р° РґР»СЏ 3D-СЂРёРіР°.
   *
   * Р§РўРћ Р‘Р«Р›Рћ. Р’РёРґ РѕСЂСѓР¶РёСЏ Рё С‰РёС‚Р° РІС‹РІРѕРґРёР»СЃСЏ РёР· РєР»Р°СЃСЃР°, Р° РЅРµ РёР· С‚РѕРіРѕ, С‡С‚Рѕ РЅР°РґРµС‚Рѕ:
   * СЃСѓС„РёР№ СЃ РєСѓРїР»РµРЅРЅС‹Рј РјРµС‡РѕРј С…РѕРґРёР» Р±РµР· РјРµС‡Р°, РєС‹Р·С‹Р»Р±Р°С€ Р±РµР· РѕСЂСѓР¶РёСЏ вЂ” СЃ РјРµС‡РѕРј.
   * РЎР»РѕС‚ С‰РёС‚Р° РІ РёРіСЂРµ РІРѕРѕР±С‰Рµ РЅРµС‚ (weapon, armor, accessory), РїРѕСЌС‚РѕРјСѓ С‰РёС‚
   * РѕСЃС‚Р°С‘С‚СЃСЏ РєР»Р°СЃСЃРѕРІС‹Рј: СЌС‚Рѕ РЅРµ Р·Р°Р±С‹С‚С‹Р№ РєРѕРґ, Р° СЂРµС€РµРЅРёРµ.
   */
  setLocalGear(gear: LocalGear | null): void {
    // null вЂ” В«СЌРєРёРїРёСЂРѕРІРєР° РµС‰С‘ РЅРµ РїСЂРёС€Р»Р°В», Рё СЂРёРі РїРѕРєР°Р·С‹РІР°РµС‚ РєР»Р°СЃСЃРѕРІС‹Р№ РІРёРґ.
    // РћР±СЉРµРєС‚ СЃ weapon: false вЂ” В«РїСЂРёС€Р»Р°, РѕСЂСѓР¶РёСЏ РЅРµС‚В», Рё РјРµС‡ СѓР±РёСЂР°РµС‚СЃСЏ
    this.localGear = gear;

    // 3D-СЌРєРёРїРёСЂРѕРІРєР° РЎРµС„РµРІРёРґРѕРІ: РїСЂРёРјРµРЅСЏРµРј Рє РјРѕРґРµР»Рё, РµСЃР»Рё РѕРЅР° СѓР¶Рµ Р·Р°РіСЂСѓР¶РµРЅР°
    if (this.safavidEquipment3D && gear) {
      void this.safavidEquipment3D.apply(gear);
    }
  }

  /**
   * Р‘РµР¶РёС‚ Р»Рё РёРіСЂРѕРє РїСЂСЏРјРѕ СЃРµР№С‡Р°СЃ.
   *
   * РџРѕРІС‚РѕСЂСЏРµС‚ С‚Рµ Р¶Рµ СѓСЃР»РѕРІРёСЏ, С‡С‚Рѕ Рё РІС‹Р±РѕСЂ СЃРєРѕСЂРѕСЃС‚Рё РІ РєР°РґСЂРµ: Р±РµР· Shift, Р±РµР·
   * В«РїСЂРёСЃРµСЃС‚СЊВ» Рё Р±РµР· РІРѕРґС‹ Р±РµРіР° РЅРµС‚, Р° РїСЂРё РЅСѓР»РµРІРѕР№ РІС‹РЅРѕСЃР»РёРІРѕСЃС‚Рё Р±РµРі
   * РІС‹РєР»СЋС‡РµРЅ. РРЅР°С‡Рµ РїРѕР»РѕСЃР° СѓР±С‹РІР°Р»Р° Р±С‹, РєРѕРіРґР° РёРіСЂРѕРє СЃС‚РѕРёС‚, Рё РЅРµ СѓР±С‹РІР°Р»Р° Р±С‹,
   * РєРѕРіРґР° РѕРЅ РґРµР№СЃС‚РІРёС‚РµР»СЊРЅРѕ Р±РµР¶РёС‚.
   */
  isSprinting(): boolean {
    if (!this.sprintAllowed || !this.me || this.crouch || this.swimming) return false;
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Р’СЂРµРјСЏ Р·Р°РјР°С…Р° РІ СЃРµРєСѓРЅРґР°С…: РёР· РґР°РЅРЅС‹С… РѕСЂСѓР¶РёСЏ, РґРµР»С‘РЅРЅРѕРµ РЅР° СЃРєРѕСЂРѕСЃС‚СЊ СЃС‚РѕР№РєРё. */
  private swingSeconds(): number {
    const РѕСЂСѓР¶РёРµ = this.localGear?.swingSeconds ?? Р—РђРњРђРҐ_РџРЈРЎРўР«РњР_Р РЈРљРђРњР;
    // Р”РµР»РµРЅРёРµ, Р° РЅРµ СѓРјРЅРѕР¶РµРЅРёРµ: attackSpeed вЂ” РјРЅРѕР¶РёС‚РµР»СЊ СЃРєРѕСЂРѕСЃС‚Рё. РЈ В«РЎРµСЂРїРѕРІРѕР№
    // РїР»СЏСЃРєРёВ» РѕРЅ 1.3 (В«СѓСЂРѕРЅ Рё СЃРєРѕСЂРѕСЃС‚СЊ РІС‹С€РµВ»), Р·РЅР°С‡РёС‚ Р·Р°РјР°С… РєРѕСЂРѕС‡Рµ.
    return РѕСЂСѓР¶РёРµ / (STANCES[getStance()].attackSpeed || 1);
  }

  /**
   * РљРѕРјСѓ SSR РІРѕРѕР±С‰Рµ РїРѕР»РѕР¶РµРЅ: СЃРѕР±РёСЂР°РµС‚ РѕС‚СЂР°Р¶Р°СЋС‰РёРµ РѕР±СЉРµРєС‚С‹ РіРѕС‚РѕРІРѕР№ СЃС†РµРЅС‹.
   *
   * РџРћР§Р•РњРЈ РќР• Р’РЎРЃ. РџРѕРєР° РІ `selects` СЃС‚РѕСЏР»Рѕ null, РѕС‚СЂР°Р¶РµРЅРёРµ Р±СЂР°Р»Р° Р’РЎРЇ СЃС†РµРЅР°
   * С†РµР»РёРєРѕРј, Рё РјРёСЂ СЃС‚Р°РЅРѕРІРёР»СЃСЏ Р·РµСЂРєР°Р»СЊРЅС‹Рј: Р·РµРјР»СЏ РѕС‚СЂР°Р¶Р°Р»Р° РґРѕРјР°, СЃС‚РµРЅС‹ вЂ” РґСЂСѓРі
   * РґСЂСѓРіР°, РїРµСЂСЃРѕРЅР°Р¶ СЃР°Рј СЃРµР±СЏ. РљРѕРјРјРµРЅС‚Р°СЂРёР№ РЅР°Рґ СЃРѕР·РґР°РЅРёРµРј РїР°СЃСЃР° РѕР±РµС‰Р°Р» В«РІРѕРґР°,
   * РјРѕРєСЂС‹Р№ РєР°РјРµРЅСЊ, РјРµС‚Р°Р»Р», СЃС‚РµРєР»РѕВ», С‚Рѕ РµСЃС‚СЊ РіРѕСЂСЃС‚РєСѓ РѕР±СЉРµРєС‚РѕРІ, Р° РїРѕР»СѓС‡РёР»Р°СЃСЊ
   * Р·РµСЂРєР°Р»СЊРЅР°СЏ РєРѕРјРЅР°С‚Р°. Р­С‚Рѕ РЅРµ РІРєСѓСЃ: three РїСЂСЏРјРѕ РїРёС€РµС‚, С‡С‚Рѕ null РѕР·РЅР°С‡Р°РµС‚
   * РІСЃСЋ СЃС†РµРЅСѓ (SSRPass.js:151).
   *
   * РљР РРўР•Р РР™. РњРµС‚Р°Р»Р» РїРѕ metalness вЂ” С‚Рѕ, С‡С‚Рѕ С„РёР·РёС‡РµСЃРєРё РѕР±СЏР·Р°РЅРѕ РѕС‚СЂР°Р¶Р°С‚СЊ.
   * Р—РµРјР»СЏ, РїРµСЃРѕРє, РєР°РјРµРЅСЊ, РґРµСЂРµРІРѕ Рё С€РєСѓСЂР° РїРµСЂСЃРѕРЅР°Р¶Р° РёРјРµСЋС‚ metalness 0 Рё РІ
   * СЃРїРёСЃРѕРє РЅРµ РїРѕРїР°РґР°СЋС‚: РѕРЅРё РјР°С‚РѕРІС‹Рµ, РѕС‚СЂР°Р¶РµРЅРёРµ РёРј РЅРµ РїРѕР»Р°РіР°РµС‚СЃСЏ.
   *
   * Р’ СЃРїРёСЃРѕРє РЅРµ РїРѕРїР°РґР°РµС‚ Рё РІРѕРґР°: Сѓ РЅРµС‘ СЃРѕР±СЃС‚РІРµРЅРЅС‹Р№ С€РµР№РґРµСЂ СЃ РїСЂРµР»РѕРјР»РµРЅРёРµРј Рё
   * РѕС‚СЂР°Р¶РµРЅРёСЏРјРё (В§208). Р’С‚РѕСЂРѕР№ РїСЂРѕС…РѕРґ РїРѕРІРµСЂС… С€РµР№РґРµСЂР° РЅРµ РЅСѓР¶РµРЅ, Р° СЂР°РЅСЊС€Рµ РѕРЅ
   * РµС‰С‘ Рё РґСѓР±Р»РёСЂРѕРІР°Р» СЂР°Р±РѕС‚Сѓ.
   *
   * РџСѓСЃС‚РѕР№ РјР°СЃСЃРёРІ вЂ” С‡РµСЃС‚РЅС‹Р№ СЃР»СѓС‡Р°Р№: РѕС‚СЂР°Р¶Р°С‚СЊ РЅРµС‡РµРіРѕ, SSR РЅРµ СЂРёСЃСѓРµС‚ РЅРёС‡РµРіРѕ.
   */
  private collectSsrReflectors(): void {
    const РѕС‚СЂР°Р¶Р°СЋС‰РёРµ: THREE.Mesh[] = [];
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      const РјР°С‚РµСЂРёР°Р»С‹ = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!РјР°С‚РµСЂРёР°Р»С‹.length) return;
      const РјРµС‚Р°Р»Р» = РјР°С‚РµСЂРёР°Р»С‹.some((m) => (m as THREE.MeshStandardMaterial).metalness >= 0.3);
      if (РјРµС‚Р°Р»Р») РѕС‚СЂР°Р¶Р°СЋС‰РёРµ.push(mesh);
    });
    this.ssrPass.selects = РѕС‚СЂР°Р¶Р°СЋС‰РёРµ;
  }

  /**
   * РџСЂРѕС€РёС‚СЊ РјР°С‚РµСЂРёР°Р»С‹ РјРёСЂР° РІ G-buffer: РЅРѕСЂРјР°Р»Рё СЃ РєР°СЂС‚Р°РјРё РЅРѕСЂРјР°Р»РµР№, Р°Р»СЊР±РµРґРѕ,
   * С€РµСЂРѕС…РѕРІР°С‚РѕСЃС‚СЊ Рё СЃРІРµС‡РµРЅРёРµ.
   *
   * Р—РђР§Р•Рњ РџРћРЎР›Р• РџРћРЎРўР РћР™РљР, Рђ РќР• Р’ РџР РћРҐРћР”Р•. РџСЂРѕС…РѕРґ СЃРѕР·РґР°С‘С‚СЃСЏ РІ РЅР°С‡Р°Р»Рµ СЃР±РѕСЂРєРё
   * РјРёСЂР°, РєРѕРіРґР° СЃС†РµРЅР° РїСѓСЃС‚Р°: РѕС‚С‡С‘С‚ С‚РѕР№ РїСЂРѕС€РёРІРєРё вЂ” В«0 РёР· 0В», Рё Сѓ РІСЃРµРіРѕ РјРёСЂР°
   * РєР°РЅР°Р»С‹ РѕСЃС‚Р°РІР°Р»РёСЃСЊ РїСѓСЃС‚С‹РјРё. Р’РЅРµС€РЅРµ СЌС‚Рѕ РїРѕС‡С‚Рё РЅРµ РІРёРґРЅРѕ, РїРѕСЌС‚РѕРјСѓ Р¶РёР»Рѕ РґРѕР»РіРѕ:
   * AO СѓРјРЅРѕР¶Р°Р» СЃРІРµС‚ РїРѕ РЅСѓР»РµРІРѕР№ РЅРѕСЂРјР°Р»Рё, Р° СЌРєСЂР°РЅРЅС‹Рµ РѕС‚СЂР°Р¶РµРЅРёСЏ РЅРµ Р·РЅР°Р»Рё, С‡С‚Рѕ
   * РѕС‚СЂР°Р¶Р°С‚СЊ. РџСЂРѕРІРµСЂРµРЅРѕ РЅР° Р¶РёРІРѕРј РјРёСЂРµ: 1119 materials, РїСЂРѕС€РёС‚Рѕ 0.
   *
   * РџРћР§Р•РњРЈ РџРћР’РўРћР РЇР•РўРЎРЇ. РњРѕРґРµР»Рё РїСЂРёС…РѕРґСЏС‚ РїРѕР·Р¶Рµ РїРѕСЃС‚СЂРѕР№РєРё: РїРµСЂСЃРѕРЅР°Р¶ РёРіСЂРѕРєР°,
   * РјРѕРЅСЃС‚СЂС‹, Р»РѕС€Р°РґРё, РєР°СЂР°РІР°РЅС‹. РџСЂРѕС€РёРІРєР° РЅРѕРІРѕРіРѕ РјР°С‚РµСЂРёР°Р»Р° РєРѕРјРїРёР»РёСЂСѓРµС‚ С€РµР№РґРµСЂ,
   * РїРѕСЌС‚РѕРјСѓ РїРѕРёСЃРє РёРґС‘С‚ СЂР°Р· РІ РџР•Р РРћР”_РџР РћРЁРР’РљР СЃРµРєСѓРЅРґ, Р° РЅРµ РІ РєР°Р¶РґРѕРј РєР°РґСЂРµ.
   */
  private patchWorldMaterials(_first?: boolean): void {
    const РѕС‚С‡С‘С‚ = this.deferred.patch(this.scene);
    // РЎСЂР°РІРЅРёРІР°РµРј СЃ РїСЂРѕС€Р»С‹Рј РѕС‚С‡С‘С‚РѕРј вЂ” Р»РѕРіРёСЂСѓРµРј С‚РѕР»СЊРєРѕ РїСЂРё РёР·РјРµРЅРµРЅРёРё
    const РёР·РјРµРЅРёР»РѕСЃСЊ = this.previousReport === null ||
      this.previousReport.РїСЂРѕС€РёС‚Рѕ !== РѕС‚С‡С‘С‚.РїСЂРѕС€РёС‚Рѕ ||
      this.previousReport.РІСЃРµРіРѕ !== РѕС‚С‡С‘С‚.РІСЃРµРіРѕ ||
      this.previousReport.РјРёРјРѕ.length !== РѕС‚С‡С‘С‚.РјРёРјРѕ.length;
    if (РёР·РјРµРЅРёР»РѕСЃСЊ) {
      console.info(
        `Otlozhennyy G-buffer: ${РѕС‚С‡С‘С‚.РїСЂРѕС€РёС‚Рѕ} iz ${РѕС‚С‡С‘С‚.РІСЃРµРіРѕ} materialov. `
        + `Bez kanalov ostalis: ${РѕС‚С‡С‘С‚.РјРёРјРѕ.length > 0 ? РѕС‚С‡С‘С‚.РјРёРјРѕ.join(', ') : 'all patched'}`,
      );
      if (РѕС‚С‡С‘С‚.РІСЃРµРіРѕ === 0) {
        console.warn('G-buffer patching: scenario empty, materials not found вЂ” this is normal at the beginning, but should be patched after buildCity');
      }
      // РџРѕРєР°Р·С‹РІР°РµРј СЃРїРёСЃРѕРє РїСЂРѕР±Р»РµРјРЅС‹С… materials РґР»СЏ РѕС‚Р»Р°РґРєРё
      if (РѕС‚С‡С‘С‚.РјРёРјРѕ.length > 0 && РѕС‚С‡С‘С‚.РјРёРјРѕ.length <= 20) {
        РѕС‚С‡С‘С‚.РјРёРјРѕ.forEach((name, i) => {
          console.debug(`  [G-buffer miss] ${name}: ${i + 1}/${РѕС‚С‡С‘С‚.РјРёРјРѕ.length}`);
        });
      } else if (РѕС‚С‡С‘С‚.РјРёРјРѕ.length > 20) {
        console.debug(`  [G-buffer miss] ... and more ${РѕС‚С‡С‘С‚.РјРёРјРѕ.length - 20} materials`);
      }
    }
    this.previousReport = { РїСЂРѕС€РёС‚Рѕ: РѕС‚С‡С‘С‚.РїСЂРѕС€РёС‚Рѕ, РІСЃРµРіРѕ: РѕС‚С‡С‘С‚.РІСЃРµРіРѕ, РјРёРјРѕ: РѕС‚С‡С‘С‚.РјРёРјРѕ };
  }

  // в”Ђв”Ђ РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  /**
   * РџРѕРєРѕР»РµРЅРёРµ РїРѕСЃС‚СЂРѕР№РєРё (В§390): РєР°Р¶РґР°СЏ РїРѕСЃС‚СЂРѕР№РєР° РјРёСЂР° Рё РєР°Р¶РґС‹Р№ dispose
   * СѓРІРµР»РёС‡РёРІР°СЋС‚ СЃС‡С‘С‚С‡РёРє. РўРѕС‡РєРё РѕР¶РёРґР°РЅРёСЏ РІРЅСѓС‚СЂРё РїРѕСЃС‚СЂРѕР№РєРё СЃРІРµСЂСЏСЋС‚ СЃРІРѕС‘
   * РїРѕРєРѕР»РµРЅРёРµ Рё Р±СЂРѕСЃР°СЋС‚, РµСЃР»Рё РјРёСЂ СѓСЃРїРµР»Рё РїРѕРєРёРЅСѓС‚СЊ (РІС‹С…РѕРґ/СЃРјРµСЂС‚СЊ РІРѕ РІСЂРµРјСЏ
   * Р·Р°РіСЂСѓР·РєРё) - РёРЅР°С‡Рµ РЅРµРґРѕСЃС‚СЂРѕРµРЅРЅС‹Р№ РјРёСЂ РїСЂРѕРґРѕР»Р¶Р°Р» Р±С‹ СЃС‚СЂРѕРёС‚СЊСЃСЏ РїРѕРІРµСЂС…
   * РЅРѕРІРѕРіРѕ РІС…РѕРґР°.
   */
  private initРџРѕРєРѕР»РµРЅРёРµ = 0;

  async init(
    container: HTMLElement,
    callbacks: World3DCallbacks,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    const РїРѕРєРѕР»РµРЅРёРµ = ++this.initРџРѕРєРѕР»РµРЅРёРµ;
    // РўРѕС‡РєР° РѕР¶РёРґР°РЅРёСЏ: РѕС‚РґР°С‚СЊ РєР°РґСЂ СЌРєСЂР°РЅСѓ (Р±Р°СЂ Рё РЅР°РґРїРёСЃРё Р¶РёРІСѓС‚), СЃРІРµСЂРёС‚СЊ
    // РїРѕРєРѕР»РµРЅРёРµ Рё РѕС‚С‡РёС‚Р°С‚СЊСЃСЏ РїСЂРѕРіСЂРµСЃСЃРѕРј.
    const РїР°СѓР·Р° = async (fraction: number): Promise<void> => {
      await РєР°РґСЂ();
      if (РїРѕРєРѕР»РµРЅРёРµ !== this.initРџРѕРєРѕР»РµРЅРёРµ) throw new Error('world_init_aborted');
      onProgress?.(fraction);
    };
    this.container = container;
    this.callbacks = callbacks;

    // Р§РёСЃС‚РёРј РєРѕР»Р»Р°Р№РґРµСЂС‹ РџР•Р Р•Р” РїРѕСЃС‚СЂРѕР№РєРѕР№ РјРёСЂР°.
    //
    // COLLIDERS Рё POCKET_COLLIDERS Р¶РёРІСѓС‚ РЅР° СѓСЂРѕРІРЅРµ РјРѕРґСѓР»СЏ, Р° `init()`
    // РІС‹Р·С‹РІР°РµС‚СЃСЏ РїСЂРё РєР°Р¶РґРѕРј РІС…РѕРґРµ РІ РјРёСЂ (СЃРјРµСЂС‚СЊ в†’ СЌРєСЂР°РЅ РїРѕС‚РµСЂРё СЃРІСЏР·Рё в†’
    // РІС‹Р±РѕСЂ РїРµСЂСЃРѕРЅР°Р¶Р° в†’ СЃРЅРѕРІР° РІС…РѕРґ). РћР±РЅСѓР»СЏС‚СЊ РёС… Р±С‹Р»Рѕ РЅРµРіРґРµ: РµРґРёРЅСЃС‚РІРµРЅРЅР°СЏ
    // С‡РёСЃС‚РєР° СЃС‚РѕСЏР»Р° РІРЅСѓС‚СЂРё `buildCity`, Рё С‚Р° РґРµР»Р°Р»Р° РЅРµ РѕР±РЅСѓР»РµРЅРёРµ, Р°
    // РєРѕРїРёСЂРѕРІР°РЅРёРµ: РѕРЅР° СЃРЅРёРјР°Р»Р° РІРµСЃСЊ РЅР°РєРѕРїР»РµРЅРЅС‹Р№ СЃРїРёСЃРѕРє РєР°Рє В«РєРѕР»Р»Р°Р№РґРµСЂС‹
    // Р»Р°РЅРґС€Р°С„С‚Р°В», СЃС‚СЂРѕРёР»Р° РіРѕСЂРѕРґ Рё РІРѕР·РІСЂР°С‰Р°Р»Р° СЃРїРёСЃРѕРє РѕР±СЂР°С‚РЅРѕ С†РµР»РёРєРѕРј вЂ”
    // РІРјРµСЃС‚Рµ СЃ РєРѕР»Р»Р°Р№РґРµСЂР°РјРё РіРѕСЂРѕРґР° РѕС‚ РџР Р•Р”Р«Р”РЈР©Р•Р“Рћ РјРёСЂР°. РС‚РѕРі: РєР°Р¶РґС‹Р№
    // РїРѕРІС‚РѕСЂРЅС‹Р№ РІС…РѕРґ РїСЂРёРјРµСЂРЅРѕ СѓРґРІР°РёРІР°Р» СЃРїРёСЃРѕРє.
    //
    // РЎРїРёСЃРѕРє РЅРµ С‚РѕР»СЊРєРѕ СЂРѕСЃ, РЅРѕ Рё РїСЂРѕРІРµСЂСЏР»СЃСЏ РІ РєР°Р¶РґРѕРј РєР°РґСЂРµ РїРѕ С‚СЂРё РїСЂРѕС…РѕРґР°
    // (`resolveCircleList`), Р° РіРѕСЂРѕР¶Р°РЅРµ РїРµСЂРµР±РёСЂР°Р»Рё РµРіРѕ РґР»СЏ РєР°Р¶РґРѕРіРѕ
    // РєР°РЅРґРёРґР°С‚Р° РµС‰С‘ Рё РІ С€РµСЃС‚Рё РїСЂРѕС…РѕРґР°С…. Р РѕСЃС‚ СЃРїРёСЃРєР° Р±СЊС‘С‚ РїРѕ РєР°РґСЂСѓ РїСЂСЏРјРѕ
    // РїСЂРѕРїРѕСЂС†РёРѕРЅР°Р»СЊРЅРѕ, Рё РЅР° В«return to character selectВ» РёРіСЂРѕРє
    // РїРѕСЃС‚РµРїРµРЅРЅРѕ РїРѕР»СѓС‡Р°РµС‚ РІСЃС‘ Р±РѕР»РµРµ С‚СЏР¶С‘Р»СѓСЋ С„РёР·РёРєСѓ.
    COLLIDERS.length = 0;
    POCKET_COLLIDERS.length = 0;
    INTERIOR_COLLIDERS.length = 0;
    FAUNA_COLLIDERS.length = 0;
    CIV_COLLIDERS.length = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    // РњРЇР“РљРР• РўР•РќР. РўСѓС‚ Р±С‹Р»Р° РјРѕСЏ РѕС€РёР±РєР°, Рё РѕРЅР° СЃС‚РѕРёР»Р° Р»РёС€РЅРµРіРѕ РІС‹РєР°С‚Р°.
    //
    // РЇ РїСЂРѕС‡РёС‚Р°Р» РІ three.core.js СЃС‚СЂРѕРєСѓ `const PCFSoftShadowMap = 2`, СЂРµС€РёР»,
    // С‡С‚Рѕ С‚РёРї Р¶РёРІ, Рё Р·Р°РјРµРЅРёР» РёРј PCFShadowMap. РљРѕРЅСЃС‚Р°РЅС‚Р° РґРµР№СЃС‚РІРёС‚РµР»СЊРЅРѕ
    // РѕСЃС‚Р°Р»Р°СЃСЊ вЂ” Р° Р Р•РђР›РР—РђР¦РР Р·Р° РЅРµР№ Р±РѕР»СЊС€Рµ РЅРµС‚. three.module.js РїСЂСЏРјРѕ
    // РїСЂРµРґСѓРїСЂРµР¶РґР°РµС‚ РїСЂРё СѓСЃС‚Р°РЅРѕРІРєРµ С‚РёРїР°:
    //   if (this.type === PCFSoftShadowMap) {
    //     warn('WebGLShadowMap: PCFSoftShadowMap has been removed.
    //           Using PCFShadowMap instead.');
    // РўРѕ РµСЃС‚СЊ РёРіСЂР° С‚РёС…Рѕ СЂР°Р±РѕС‚Р°Р»Р° РЅР° PCFShadowMap Рё РїРёСЃР°Р»Р° РїСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ РІ
    // РєРѕРЅСЃРѕР»СЊ, Р° РёСЃС…РѕРґРЅС‹Р№ РєРѕРјРјРµРЅС‚Р°СЂРёР№ РїСЂРѕРµРєС‚Р° В«РјСЏРіРєРёРµ С‚РµРЅРё РІС‹СЂРµР·Р°РЅС‹В» Р±С‹Р»
    // РџР РђР’. РЇ РѕС‚РјРµРЅРёР» РІРµСЂРЅРѕРµ СѓС‚РІРµСЂР¶РґРµРЅРёРµ РїРѕ Р±РѕР»РµРµ СЃР»Р°Р±РѕР№ РїСЂРѕРІРµСЂРєРµ.
    //
    // Р§С‚Рѕ РѕСЃС‚Р°Р»РѕСЃСЊ РЅР° СЃР°РјРѕРј РґРµР»Рµ: VSMShadowMap. РћРЅ Р¶РёРІ (SHADOWMAP_TYPE_VSM,
    // РѕС‚РґРµР»СЊРЅС‹Рµ РІРµС‚РєРё РґР»СЏ С‚РѕС‡РµС‡РЅС‹С… РёСЃС‚РѕС‡РЅРёРєРѕРІ) Рё РµРґРёРЅСЃС‚РІРµРЅРЅС‹Р№ РґР°С‘С‚ РјСЏРіРєСѓСЋ
    // РєСЂРѕРјРєСѓ вЂ” С‡РµСЂРµР· shadow.radius Рё blurSamples. РџСЂРѕРІРµСЂРєР°, РєРѕС‚РѕСЂР°СЏ СЃС‚РѕРёС‚
    // СЂСЏРґРѕРј, С‚РµРїРµСЂСЊ СЃРјРѕС‚СЂРёС‚ РЅРµ РЅР° РѕР±СЉСЏРІР»РµРЅРёРµ РєРѕРЅСЃС‚Р°РЅС‚С‹, Р° РЅР° С‚Рѕ, СЂСѓРіР°РµС‚СЃСЏ Р»Рё
    // three РЅР° РІС‹Р±СЂР°РЅРЅС‹Р№ С‚РёРї.
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    // РўРћРќРђР›Р¬РќРђРЇ РљР РР’РђРЇ. Р‘РµР· РЅРµС‘ СЂРµРЅРґРµСЂ РѕС‚РґР°РІР°Р» РєР°РґСЂ РєР°Рє РµСЃС‚СЊ (NoToneMapping
    // вЂ” Р·РЅР°С‡РµРЅРёРµ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ), Рё РІСЃС‘, С‡С‚Рѕ СЏСЂС‡Рµ РµРґРёРЅРёС†С‹, СЃСЂРµР·Р°Р»РѕСЃСЊ РІ С‡РёСЃС‚РѕРµ
    // Р±РµР»РѕРµ: СЃРѕР»РЅРµС‡РЅС‹Рµ Р±Р»РёРєРё РЅР° РјРµС‚Р°Р»Р»Рµ, С„Р°РєРµР»С‹, РЅРµР±Рѕ РІ Р·РµРЅРёС‚Рµ. Р‘РµР»РѕРµ РїСЏС‚РЅРѕ
    // РІРјРµСЃС‚Рѕ РіСЂР°РґР°С†РёРё вЂ” СЃР°РјР°СЏ Р·Р°РјРµС‚РЅР°СЏ В«РЅРµСЂРµР°Р»РёСЃС‚РёС‡РЅРѕСЃС‚СЊВ» РєР°РґСЂР°, РїРѕС‚РѕРјСѓ С‡С‚Рѕ
    // РЅРё РѕРґРЅР° РєР°РјРµСЂР° С‚Р°Рє РЅРµ СЃРЅРёРјР°РµС‚.
    //
    // AgX вЂ” С‚Р° Р¶Рµ РєСЂРёРІР°СЏ, С‡С‚Рѕ РІ Blender СЃ 4.0: РєРёРЅРѕ-РєСЂРёРІР°СЏ СЃ РїР»РµРєСЃРѕРј
    // (РїР»РµС‡РѕРј) РІ СЃРІРµС‚Р°С…. РњРµСЃС‚Р°РјРё РѕРЅР° РЅР°РјРµСЂРµРЅРЅРѕ СѓРІРѕРґРёС‚ РЅР°СЃС‹С‰РµРЅРЅРѕСЃС‚СЊ РІ Р±РµР»РѕРµ,
    // РєР°Рє РїР»С‘РЅРєР°, РїРѕСЌС‚РѕРјСѓ Р±РµР»С‹Р№ РјРµС‚Р°Р»Р» РЅР° СЃРѕР»РЅС†Рµ РІС‹РіР»СЏРґРёС‚ РјРµС‚Р°Р»Р»РѕРј, Р° РЅРµ
    // Р»Р°РјРїРѕС‡РєРѕР№.
    //
    // Р­РєСЃРїРѕР·РёС†РёСЏ 1.4 вЂ” РєРѕРјРїРµРЅСЃР°С†РёСЏ: РєСЂРёРІР°СЏ Р·Р°С‚РµРјРЅСЏРµС‚ СЃРµСЂРµРґРёРЅСѓ РїСЂРёРјРµСЂРЅРѕ РЅР°
    // СЃС‚РѕР»СЊРєРѕ Р¶Рµ. Р‘РµР· РєРѕРјРїРµРЅСЃР°С†РёРё РІРµСЃСЊ РјРёСЂ СЃС‚Р°Р» Р±С‹ СЃРµСЂС‹Рј. РўРѕС‡РЅРѕРµ С‡РёСЃР»Рѕ
    // РїРѕРґР±РёСЂР°РµС‚СЃСЏ РіР»Р°Р·Р°РјРё; РµСЃР»Рё РјРёСЂ РїРѕРєР°Р¶РµС‚СЃСЏ С‚С‘РјРЅС‹Рј вЂ” Р·РґРµСЃСЊ РѕРґРёРЅ РјРЅРѕР¶РёС‚РµР»СЊ.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    // РђРЅРёР·РѕС‚СЂРѕРїРёСЏ РїРѕ РІРѕР·РјРѕР¶РЅРѕСЃС‚СЏРј Р¶РµР»РµР·Р°, Р° РЅРµ Р·Р°С€РёС‚Р°СЏ С‡РµС‚РІС‘СЂРєР°. Р—РµРјР»СЋ
    // РІРёРґРЅРѕ РїРѕС‡С‚Рё РІРґРѕР»СЊ, Рё СЃ 4 РѕРЅР° РїСЂРµРІСЂР°С‰Р°РµС‚СЃСЏ РІ РјС‹Р»СЊРЅСѓСЋ РјСѓС‚СЊ С‚Р°Рј, РєСѓРґР°
    // РёРіСЂРѕРє СЃРјРѕС‚СЂРёС‚. РЎС‚Р°РІРёРј Р”Рћ buildTerrain: С‚РµРєСЃС‚СѓСЂС‹ СЃРѕР·РґР°СЋС‚СЃСЏ С‚Р°Рј Рё
    // Р±РµСЂСѓС‚ СЌС‚Рѕ Р·РЅР°С‡РµРЅРёРµ РїСЂРё СЃРѕР·РґР°РЅРёРё.
    setTextureAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    // В§317: С‚Рѕ Р¶Рµ РґР»СЏ РЅР°СЃС‚РѕСЏС‰РёС… PBR-РїРѕРІРµСЂС…РЅРѕСЃС‚РµР№ (surfaces.ts). РњРѕРґСѓР»СЊ
    // РґРµСЂР¶РёС‚ СЃРІРѕРё С‚РµРєСЃС‚СѓСЂС‹ РѕС‚РґРµР»СЊРЅРѕ РѕС‚ РїСЂРѕС†РµРґСѓСЂРЅС‹С….
    setSurfaceAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.domElement.className = 'gl-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb9c4c9, 60, 420);

    this.camera = new THREE.PerspectiveCamera(62, container.clientWidth / container.clientHeight, 0.1, 1600);

    // РћРўР›РћР–Р•РќРќР«Р™ РџР РћРҐРћР” РІРјРµСЃС‚Рѕ RenderPass + SSAOPass.
    //
    // SSAOPass СЂРёСЃРѕРІР°Р» СЃС†РµРЅСѓ Р’РўРћР РћР™ СЂР°Р· РїРѕРґРјРµРЅРЅС‹Рј MeshNormalMaterial СЂР°РґРё
    // РЅРѕСЂРјР°Р»РµР№ Рё РіР»СѓР±РёРЅС‹, Рё РЅРѕСЂРјР°Р»Рё Сѓ РЅРµРіРѕ Р±С‹Р»Рё РіРµРѕРјРµС‚СЂРёС‡РµСЃРєРёРјРё: РєР°СЂС‚С‹
    // РЅРѕСЂРјР°Р»РµР№ РѕРЅ РЅРµ РІРёРґРµР», Рё AO Р»РµРіР»Рѕ РјРёРјРѕ С‚РµРєСЃС‚СѓСЂС‹ СЂРµР»СЊРµС„Р°. РўРµРїРµСЂСЊ
    // РЅРѕСЂРјР°Р»Рё Р±РµСЂСѓС‚СЃСЏ РёР· G-buffer РЅР°СЃС‚РѕСЏС‰РёРµ, РІС‚РѕСЂР°СЏ РѕС‚СЂРёСЃРѕРІРєР° РЅРµ РЅСѓР¶РЅР°, Р° AO
    // СѓРјРЅРѕР¶Р°РµС‚ С‚РѕР»СЊРєРѕ СЃРІРµС‚ РЅРµР±Р°, Р° РЅРµ РіРѕС‚РѕРІС‹Р№ С†РІРµС‚ (РёРЅР°С‡Рµ Р·Р°С‚РµРјРЅСЏР»РѕСЃСЊ Рё
    // СЃРѕР»РЅС†Рµ, Рё РєР°СЂС‚РёРЅРєР° РІ С‚РµРЅСЏС… СѓС…РѕРґРёР»Р° РІ РіСЂСЏР·СЊ).
    //
    // РћСЃРІРµС‰РµРЅРёРµ РѕСЃС‚Р°Р»РѕСЃСЊ forward: РїРµСЂРµРїРёСЃР°С‚СЊ PBR three РІРјРµСЃС‚Рµ СЃ VSM-С‚РµРЅСЏРјРё
    // Рё IBL РїРѕ PMREM-РєР°СЂС‚Рµ РЅРµР±Р° - РїСЏС‚СЊСЃРѕС‚ СЃС‚СЂРѕРє GLSL РІСЃР»РµРїСѓСЋ. РћР± СЌС‚РѕРј РІ
    // deferred/deferredPass.ts.
    this.deferred = new DeferredPass(
      this.scene, this.camera, container.clientWidth, container.clientHeight,
    );
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.deferred);
    // РџСЂРѕС€РёРІРєР° Р·РґРµСЃСЊ РќР• РґРµР»Р°РµС‚СЃСЏ: СЃС†РµРЅР° РЅР° СЌС‚РѕС‚ РјРѕРјРµРЅС‚ РїСѓСЃС‚Р°, Рё РѕС‚С‡С‘С‚ Р±С‹Р» Р±С‹
    // В«0 РёР· 0В». РњРёСЂ РїСЂРѕС€РёРІР°РµС‚СЃСЏ РЅРёР¶Рµ, РїРѕСЃР»Рµ РїРѕСЃС‚СЂРѕР№РєРё, вЂ” СЃРј. patchWorldMaterials.
    // SSR: screen-space reflections РґР»СЏ РІРѕРґС‹, РјРѕРєСЂРѕРіРѕ РєР°РјРЅСЏ, РјРµС‚Р°Р»Р»Р°, СЃС‚РµРєР»Р°.
    //
    // `selects: null` вЂ” СЌС‚Рѕ РќР• В«РґР»СЏ РІСЃРµС…, РєС‚Рѕ Р±Р»РµСЃС‚РёС‚В», СЌС‚Рѕ В«РґР»СЏ РІСЃРµР№
    // СЃС†РµРЅС‹В». РўР°Рє Рё РЅР°РїРёСЃР°РЅРѕ РІ СЃР°РјРѕР№ Р±РёР±Р»РёРѕС‚РµРєРµ, SSRPass.js:151:
    //   "Which 3D objects should be affected by SSR.
    //    If not set, the ENTIRE SCENE is affected."
    //
    // РЎРїРёСЃРѕРє РѕС‚СЂР°Р¶Р°СЋС‰РёС… РїРѕРґСЃС‚Р°РІР»СЏРµС‚ collectSsrReflectors() РЅРёР¶Рµ, РїРѕСЃР»Рµ
    // РїРѕСЃС‚СЂРѕР№РєРё РјРёСЂР°: СЃРїРёСЃРѕРє СЃРѕР±РёСЂР°РµС‚СЃСЏ РѕР±С…РѕРґРѕРј РіРѕС‚РѕРІРѕР№ СЃС†РµРЅС‹. Р’РѕРґР° СЃСЋРґР°
    // РЅРµ РїРѕРїР°РґР°РµС‚ вЂ” Сѓ РЅРµС‘ СЃРѕР±СЃС‚РІРµРЅРЅС‹Р№ С€РµР№РґРµСЂ СЃ РѕС‚СЂР°Р¶РµРЅРёСЏРјРё (В§208), РІС‚РѕСЂРѕР№
    // РїСЂРѕС…РѕРґ РїРѕРІРµСЂС… С‚РѕР»СЊРєРѕ РјРµС€Р°Р» Р±С‹.
    this.ssrPass = new SSRPass({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      width: container.clientWidth,
      height: container.clientHeight,
      selects: [],
      isBouncing: false,
      groundReflector: null,
    });
    this.ssrPass.opacity = 0.85;
    this.ssrPass.maxDistance = 100;
    this.ssrPass.thickness = 0.5;
    this.composer.addPass(this.ssrPass);
    // Bloom: СЃРІРµС‡РµРЅРёРµ СЏСЂРєРёС… РёСЃС‚РѕС‡РЅРёРєРѕРІ (С„Р°РєРµР»С‹, РѕРєРЅР°, РјР°РіРёСЏ, СЃРѕР»РЅС†Рµ).
    // РџРѕСЂРѕРі = 0.85: С‚РѕР»СЊРєРѕ РїРёРєСЃРµР»Рё СЏСЂС‡Рµ 0.85 (РїРѕСЃР»Рµ С‚РѕРЅР°Р»СЊРЅРѕРіРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ) СЃРІРµС‚СЏС‚СЃСЏ.
    // РЎРёР»Р° = 0.6, СЂР°РґРёСѓСЃ = 0.6, РїРѕСЂРѕРі = 0.85.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.6, // strength
      0.6, // radius
      0.85 // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // РЎРІРµС‚
    this.hemi = new THREE.HemisphereLight(0xbfd6e4, 0x6b5a42, 0.75);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe8c0, 1.5);
    this.sun.position.set(60, 90, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 260;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46;
    this.sun.shadow.bias = -0.0004;
    // Р Р°РґРёСѓСЃ СЂР°Р·РјС‹С‚РёСЏ вЂ” С‚РѕР»СЊРєРѕ РґР»СЏ VSM. РРјРµРЅРЅРѕ РѕРЅ РґР°С‘С‚ РјСЏРіРєСѓСЋ РєСЂРѕРјРєСѓ:
    // PCF Р±РµСЂС‘С‚ Р¶С‘СЃС‚РєСѓСЋ РІС‹Р±РѕСЂРєСѓ, Р° VSM СЂР°Р·РјС‹РІР°РµС‚ РїРѕ РїР»РѕС‰Р°РґРё.
    // Р’Р»РёСЏРµС‚ РЅР° РєСЂСѓРіР»РѕРµ РѕСЃРІРµС‰РµРЅРёРµ Рё РЅР° РєР°СЂС‚Сѓ С‚РµРЅРµР№, РЅРѕ РЅРµ РЅР° РіР»Р°РІРЅС‹Р№ РєР°РґСЂ.
    this.sun.shadow.radius = 3;
    this.sun.shadow.blurSamples = 12;
    this.scene.add(this.sun, this.sun.target);

    // РџР•Р РЎРћРќРђР–Р вЂ” Р’РџР•Р РЃР” Р”Р•РљРћР Рђ (В§343).
    //
    // РњРёСЂ СЃС‚СЂРѕРёС‚ СЃРѕС‚РЅРё РјРѕРґРµР»РµР№ РґРµРєРѕСЂР° (С‚РµСЂСЂРµР№РЅ, С„Р»РѕСЂР°, РґРѕРјР°), Рё Р±СЂР°СѓР·РµСЂ
    // РґРµСЂР¶РёС‚ С€РµСЃС‚СЊ СЃРѕРµРґРёРЅРµРЅРёР№ РЅР° С…РѕСЃС‚. РџРµСЂСЃРѕРЅР°Р¶РЅС‹Рµ GLB РІРµСЃСЏС‚ 0.6вЂ“1.2 РњР‘ Рё,
    // СЃС‚РѕСЏ РІ РѕР±С‰РµР№ РѕС‡РµСЂРµРґРё РїРѕСЃР»РµРґРЅРёРјРё, РїСЂРёРµР·Р¶Р°Р»Рё С‡РµСЂРµР· РґРµСЃСЏС‚РєРё СЃРµРєСѓРЅРґ РїРѕСЃР»Рµ
    // РґРѕРјРѕРІ вЂ” РёР»Рё РЅРµ РїСЂРёРµР·Р¶Р°Р»Рё РІРѕРІСЃРµ: Р·Р°РјРµСЂ В§342 РїРѕРєР°Р·Р°Р» Р’РЎР• РїРµСЂСЃРѕРЅР°Р¶РЅС‹Рµ
    // РјРѕРґРµР»Рё РІ С‚Р°Р№РјР°СѓС‚Рµ РїСЂРё СѓР¶Рµ СЃС‚РѕСЏС‰РёС… РіРѕСЂРѕР¶Р°РЅР°С…. РР·-Р·Р° СЌС‚РѕРіРѕ С‚РѕСЂРіРѕРІРµС† РІ
    // С†РµРЅС‚СЂРµ РїР»РѕС‰Р°РґРё СЃС‚РѕСЏР» РїСЂРѕС†РµРґСѓСЂРЅС‹Рј РєРѕРЅСѓСЃРѕРј (В§341).
    //
    // РўРµРїРµСЂСЊ РёС… Р·Р°РіСЂСѓР·РєР° РЅР°С‡РёРЅР°РµС‚СЃСЏ РґРѕ РїРѕСЃС‚СЂРѕР№РєРё РјРёСЂР°: С‚Рµ Р¶Рµ С€РµСЃС‚СЊ
    // СЃРѕРµРґРёРЅРµРЅРёР№ Р·Р°РЅРёРјР°СЋС‚ СЃРЅР°С‡Р°Р»Р° Р»СЋРґРё, Р° РґРµРєРѕСЂ РґРѕРµР·Р¶Р°РµС‚ СЃР»РµРґРѕРј. РРіСЂРѕРє
    // РІРёРґРёС‚ Р¶РёРІРѕР№ РіРѕСЂРѕРґ СЃСЂР°Р·Сѓ, Р° РґСЂРѕР±РЅРѕСЃС‚Рё РґРµРєРѕСЂР° РїРѕРґРѕР¶РґСѓС‚.
    await РїР°СѓР·Р°(0.25);
    preloadModels(['guard', 'merchant', 'citizen', 'crier', 'scholar', 'archer', 'warrior']);

    // РњРёСЂ
    await РїР°СѓР·Р°(0.3);
    buildTerrain(this.scene);
    await РїР°СѓР·Р°(0.36);
    buildScatter(this.scene);
    buildRoads(this.scene);
    const city = buildCity(this.scene);
    for (const [i, l] of (city.userData.lights as { x: number; z: number }[]).entries()) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(l.x, (l as { y?: number }).y ?? groundHeight(l.x, l.z) + 5.2, l.z);
      this.scene.add(light);
      // Р¤РђР—Рђ РЈ РљРђР–Р”РћР“Рћ Р¤РђРљР•Р›Рђ РЎР’РћРЇ.
      //
      // Р Р°РЅСЊС€Рµ С„Р°Р·Р° СЃС‡РёС‚Р°Р»Р°СЃСЊ РєР°Рє `base * 7`, Р° Сѓ РІСЃРµС… РіРѕСЂРѕРґСЃРєРёС… С„Р°РєРµР»РѕРІ `base`
      // РѕРґРёРЅР°РєРѕРІС‹Р№, С‚Рѕ РµСЃС‚СЊ РѕРЅРё РјРёРіР°Р»Рё СЃРёРЅС…СЂРѕРЅРЅРѕ вЂ” РґРІР° РґРµСЃСЏС‚РєР° РѕРіРЅРµР№ РІ РѕРґРЅРѕРј
      // РіРѕСЂРѕРґРµ РїСѓР»СЊСЃРёСЂРѕРІР°Р»Рё РІ С‚Р°РєС‚. РЈ РґРІСѓС… С„Р°РєРµР»РѕРІ Сѓ РІРѕСЂРѕС‚ СЌС‚Рѕ С‡РёС‚Р°Р»РѕСЃСЊ Р±С‹
      // РѕСЃРѕР±РµРЅРЅРѕ Р·Р°РјРµС‚РЅРѕ: РѕРЅРё СЃС‚РѕСЏС‚ СЂСЏРґРѕРј Рё СЃРјРѕС‚СЂРµР»Рё Р±С‹ РІ СѓРЅРёСЃРѕРЅ.
      this.torches.push({ light, base: 1.6, phase: i * 2.4 });
    }
    for (const d of buildTownBuildings(this.scene)) this.doorTargets.push(d);
    await РїР°СѓР·Р°(0.48);
    buildCamp(this.scene);
    buildWater(this.scene);
    // РџРѕСЃРµР»РµРЅРёСЏ: РїРѕСЂС‚, РєР°СЂР°РІР°РЅ-СЃР°СЂР°Р№, РґРµСЂРµРІРЅСЏ, С„РѕСЂС‚.
    const РѕРіРЅРёРџРѕСЃРµР»РµРЅРёР№ = buildSettlements(this.scene);
    // РЎРІРµС‚ РІ РїРѕСЃРµР»РµРЅРёСЏС… (В§251): РјР°СЏРє, РјР°СЏС‡РѕРє, С„РѕРЅР°СЂСЊ Сѓ РїРѕР»РµРЅРЅРёС†С‹ Рё С„РѕРЅР°СЂРё Сѓ
    // РІРѕСЂРѕС‚ С„РѕСЂС‚Р° РіРѕСЂРµР»Рё РЅР°СЂРёСЃРѕРІР°РЅРЅС‹РјРё С€Р°СЂР°РјРё, Р° РёСЃС‚РѕС‡РЅРёРєРѕРІ РЅРµ Р±С‹Р»Рѕ вЂ” РЅРѕС‡СЊСЋ
    // РїРѕСЂС‚, РґРµСЂРµРІРЅСЏ Рё С„РѕСЂС‚ СЃС‚РѕСЏР»Рё С‡С‘СЂРЅС‹РјРё СЃРёР»СѓСЌС‚Р°РјРё.
    for (const [i, РѕРіРѕРЅСЊ] of РѕРіРЅРёРџРѕСЃРµР»РµРЅРёР№.entries()) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(РѕРіРѕРЅСЊ.x, РѕРіРѕРЅСЊ.y, РѕРіРѕРЅСЊ.z);
      this.scene.add(light);
      this.torches.push({ light, base: 1.6, phase: i * 2.4 + 1.3 });
    }
    // Р“РѕСЂРѕРґР° СЂРµРіРёРѕРЅРѕРІ: РїРѕСЃРµР»РµРЅРёСЏ РІ С€РµСЃС‚Рё СЂРµРіРёРѕРЅР°С…, РіРґРµ РёС… РЅРµ Р±С‹Р»Рѕ.
    // РЎС‚РѕСЏС‚ РЅР° СЃРІРѕРёС… СЏРєРѕСЂСЏС…, РїРѕСЌС‚РѕРјСѓ РёРіСЂРѕРє, РІС‹Р±СЂР°РІС€РёР№ СЂРµРіРёРѕРЅ, РІРѕР·СЂРѕР¶РґР°РµС‚СЃСЏ
    // Сѓ РІРѕСЂРѕС‚ РіРѕСЂРѕРґР°, Р° РЅРµ РІ РїСѓСЃС‚РѕРј РїРѕР»Рµ.
    const РѕРіРЅРёР“РѕСЂРѕРґРѕРІ = buildRegionTowns(this.scene);
    // Р¤РѕРЅР°СЂРё РіРѕСЂРѕРґРѕРІ СЂРµРіРёРѕРЅРѕРІ (В§250): РіРѕСЂРѕРґР° СЃС‚РѕСЏР»Рё РІ С‚РµРјРЅРѕС‚Рµ вЂ” РґРѕРјР° Рё СЃС‚РµРЅС‹
    // РµСЃС‚СЊ, Р° СЃРІРµС‚Р° РЅРµС‚. РСЃС‚РѕС‡РЅРёРєРё СЃРѕР·РґР°СЋС‚СЃСЏ Р·РґРµСЃСЊ, РєР°Рє Рё РіРѕСЂРѕРґСЃРєРёРµ С„РѕРЅР°СЂРё,
    // Рё РіРѕСЂСЏС‚ РїРѕ РЅРѕС‡РЅРѕРјСѓ РїСЂР°РІРёР»Сѓ: РґРЅС‘Рј С‚РёС€Рµ, РЅРѕС‡СЊСЋ РІ РїРѕР»РЅСѓСЋ СЃРёР»Сѓ.
    for (const [i, РѕРіРѕРЅСЊ] of РѕРіРЅРёР“РѕСЂРѕРґРѕРІ.entries()) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(РѕРіРѕРЅСЊ.x, РѕРіРѕРЅСЊ.y, РѕРіРѕРЅСЊ.z);
      this.scene.add(light);
      this.torches.push({ light, base: 1.6, phase: i * 2.4 + 0.7 });
    }
    await РїР°СѓР·Р°(0.6);
    // РЈРєР°Р·Р°С‚РµР»Рё СЃР±РѕРєСѓ РѕС‚ РґРѕСЂРѕРі: В«Р·РґРµСЃСЊ РЅР°С‡РёРЅР°РµС‚СЃСЏ РїСѓС‚СЊ Рє РїРѕСЂС‚СѓВ».
    buildSignposts(this.scene);
    // РЎС‚РѕР» СЃ РґРѕСЃРєРѕР№ РІРѕ РґРІРѕСЂРµ РєР°СЂР°РІР°РЅ-СЃР°СЂР°СЏ: РєР°СЂР°РІР°РЅ Р¶РґС‘С‚ СѓС‚СЂР°, Р»СЋРґРё РёРіСЂР°СЋС‚.
    buildGameTable(this.scene);
    // РљРѕСЂРѕРІС‹ РЅР° РІС‹РїР°СЃРµ РІ Р»РµСЃРЅРѕР№ РґРµСЂРµРІРЅРµ.
    this.cowMixers = buildCows(this.scene);
    // РЎС‚Р°С‚СѓСЏ Сѓ Р±Р°Р·Р°СЂРЅРѕРіРѕ РєРІР°СЂС‚Р°Р»Р°: РІРёРґРЅРѕ СЃ СѓР»РёС†С‹, РЅРµ Р·Р°РЅРёРјР°РµС‚ РјРµСЃС‚Рѕ С‚РѕСЂРіРѕРІР»Рµ.
    buildBazaarStatue(this.scene);
    // Р”РІР° С„Р°РєРµР»Р° Сѓ РІРѕСЂРѕС‚ РєР°СЂР°РІР°РЅ-СЃР°СЂР°СЏ: РёРіСЂРѕРє РїСЂРѕС…РѕРґРёС‚ РјРµР¶РґСѓ РЅРёРјРё РІРЅСѓС‚СЂСЊ.
    // Р РµС€РµРЅРёРµ РІР»Р°РґРµР»СЊС†Р° вЂ” СЃРІРµС‚ РѕС‚ РЅРёС… РѕСЂР°РЅР¶РµРІС‹Р№ Рё СЏСЂРєРёР№, РїРѕСЌС‚РѕРјСѓ РёСЃС‚РѕС‡РЅРёРєРё
    // СЃРѕР·РґР°СЋС‚СЃСЏ Р·РґРµСЃСЊ, Р° РЅРµ РѕСЃС‚Р°СЋС‚СЃСЏ РЅР° РѕС‚РєСѓРї РіРѕСЂРѕРґСЃРєРёРј С„РѕРЅР°СЂСЏРј.
    for (const [i, РѕРіРѕРЅСЊ] of buildCaravanseraiTorches(this.scene).entries()) {
      const light = new THREE.PointLight(
        РўРћР Р§_РЎР’Р•Рў_Р¦Р’Р•Рў,
        0,
        РўРћР Р§_РЎР’Р•Рў_Р”РђР›Р¬РќРћРЎРўР¬,
        1.8,
      );
      light.position.set(РѕРіРѕРЅСЊ.x, РѕРіРѕРЅСЊ.y, РѕРіРѕРЅСЊ.z);
      this.scene.add(light);
      // Р¤Р°Р·Р° СЃРІРѕСЏ Сѓ РєР°Р¶РґРѕРіРѕ: РґРІР° С„Р°РєРµР»Р° РІ РґРІСѓС… С€Р°РіР°С… РґСЂСѓРі РѕС‚ РґСЂСѓРіР°, РјРёРіР°СЋС‰РёРµ
      // РІ С‚Р°РєС‚, С‡РёС‚Р°СЋС‚СЃСЏ РєР°Рє РѕРґРЅР° Р»Р°РјРїР°, Р° РЅРµ РєР°Рє РґРІР° РѕРіРЅСЏ.
      this.torches.push({ light, base: РўРћР Р§_РЎР’Р•Рў_РЇР РљРћРЎРўР¬, phase: 1.1 + i * 3.7 });
      // Р”С‹Рј РЅР°Рґ С„Р°РєРµР»РѕРј (В§255): РѕРіРѕРЅСЊ Р±РµР· РґС‹РјР° С‡РёС‚Р°РµС‚СЃСЏ РєР°Рє РЅР°СЂРёСЃРѕРІР°РЅРЅС‹Р№.
      this.РґС‹Рј.push({
        РґС‹Рј: createPuffs(this.scene, {
          РєРѕР»РёС‡РµСЃС‚РІРѕ: 12,
          С†РІРµС‚: 0x82796f,
          СЂР°Р·РјРµСЂ: 0.5,
          СЂРѕСЃС‚: 2.4,
          Р¶РёР·РЅСЊ: 3.2,
          РїРѕРґСЉС‘Рј: 1.0,
          СЂР°Р·Р±СЂРѕСЃ: 0.22,
          РЅРµРїСЂРѕР·СЂР°С‡РЅРѕСЃС‚СЊ: 0.46,
          Р·Р°С‚СѓС…Р°РЅРёРµ: 0.8,
        }),
        x: РѕРіРѕРЅСЊ.x,
        y: РѕРіРѕРЅСЊ.y + 0.2,
        z: РѕРіРѕРЅСЊ.z,
        С‚Р°Р№РјРµСЂ: 0,
      });
    }
    // Р¤Р°РєРµР»С‹ РІ РїСЂРѕС‘РјР°С… (21 РѕРєС‚СЏР±СЂСЏ 2026, В§226): РІРѕСЂРѕС‚Р° РґРІРѕСЂС†Р° Рё РІС…РѕРґ РІ
    // РіСЂРѕР±РЅРёС†Сѓ С‡РёС‚Р°Р»РёСЃСЊ С‡С‘СЂРЅС‹РјРё РїСЂРѕРІР°Р»Р°РјРё. РЎРІРµС‚ РІ РїСЂРѕС‘РјРµ РЅСѓР¶РµРЅ Рё Р”РќРЃРњ вЂ”
    // РїСЂРѕС…РѕРґ Р·Р°РєСЂС‹С‚ РѕС‚ СЃРѕР»РЅС†Р°, вЂ” РїРѕСЌС‚РѕРјСѓ СЌС‚Рё РёСЃС‚РѕС‡РЅРёРєРё РЅРµ РіР°СЃРЅСѓС‚, РєР°Рє
    // СѓР»РёС‡РЅС‹Рµ С„Р°РєРµР»С‹, Р° РіРѕСЂСЏС‚ РїРѕСЃС‚РѕСЏРЅРЅРѕ.
    for (const РѕРіРѕРЅСЊ of buildPassageTorches(this.scene)) {
      const light = new THREE.PointLight(
        РўРћР Р§_РЎР’Р•Рў_Р¦Р’Р•Рў,
        0,
        РўРћР Р§_РЎР’Р•Рў_Р”РђР›Р¬РќРћРЎРўР¬,
        1.8,
      );
      light.position.set(РѕРіРѕРЅСЊ.x, РѕРіРѕРЅСЊ.y, РѕРіРѕРЅСЊ.z);
      this.scene.add(light);
      // РЇСЂС‡Рµ СѓР»РёС‡РЅРѕРіРѕ С„Р°РєРµР»Р° РІРґРІРѕРµ: РїСЂРѕС…РѕРґ Р·Р°РєСЂС‹С‚ РѕС‚ СЃРѕР»РЅС†Р°, Рё РїСЂРё РіРѕСЂРѕРґСЃРєРѕР№
      // СЏСЂРєРѕСЃС‚Рё РѕРЅ РѕСЃС‚Р°РІР°Р»СЃСЏ С‡С‘СЂРЅС‹Рј РїСЂРѕРІР°Р»РѕРј РґР°Р¶Рµ СЃ РґРІСѓРјСЏ РѕРіРЅСЏРјРё.
      this.lamps.push({ light, base: РўРћР Р§_РЎР’Р•Рў_РЇР РљРћРЎРўР¬ * 2 });
    }
    // Р¤РѕРЅР°СЂРё РіСЂРѕР±РЅРёС†С‹: Р·РѕР»РѕС‚С‹Рµ С„РѕРЅР°СЂРё РЅР° СЃС‚РѕР»Р±Р°С… СЃС‚РѕСЏР»Рё, Р° СЃРІРµС‚Р° РЅРµ РґР°РІР°Р»Рё.
    for (const С„РѕРЅР°СЂСЊ of Р¤РћРќРђР Р_Р“Р РћР‘РќРР¦Р«) {
      const light = new THREE.PointLight(0xffb45a, 0, 16, 1.8);
      light.position.set(С„РѕРЅР°СЂСЊ.x, С„РѕРЅР°СЂСЊ.y, С„РѕРЅР°СЂСЊ.z);
      this.scene.add(light);
      this.lamps.push({ light, base: 2.6 });
    }
    // Р”РІР° РјРµС‡Р° Сѓ РєСѓР·РЅРёС†С‹ РґРµСЂРµРІРЅРё, РІРѕС‚РєРЅСѓС‚С‹Рµ РѕСЃС‚СЂРёС‘Рј РІ Р·РµРјР»СЋ.
    buildVillageSwords(this.scene);
    // Р”РІР° СЃСѓРЅРґСѓРєР° Сѓ С€Р°С‚СЂР° РІ Р±Р°Р·Р°СЂРЅРѕРј РєРІР°СЂС‚Р°Р»Рµ.
    buildBazaarChests(this.scene);
    // Р”РІРѕСЂ РјРµС‡РµС‚Рё СЃ РєСѓРїРѕР»РѕРј Рё РјРёРЅР°СЂРµС‚РѕРј: РїРµСЂРІРѕРµ Р·РґР°РЅРёРµ РёР· С€РµСЃС‚Рё, РєРѕС‚РѕСЂРѕРјСѓ
    // РІР»Р°РґРµР»РµС† РІРµР»РµР» РґРѕСЃС‚СЂРѕРёС‚СЊ СЌРєСЃС‚РµСЂСЊРµСЂ.
    // Р¤РѕРЅР°СЂРё Сѓ РІС…РѕРґР° РІ РјРµС‡РµС‚РЅС‹Р№ РґРІРѕСЂ (В§252): Р±С‹Р»Рё СЃС‚РѕР»Р± СЃ С‡Р°С€РµР№ Рё С€Р°СЂ РѕРіРЅСЏ вЂ”
    // Р±РµР· СЃС‚РµРєР»Р° Рё Р±РµР· РёСЃС‚РѕС‡РЅРёРєР° СЃРІРµС‚Р°. РўРµРїРµСЂСЊ РѕР±С‰РёР№ С„РѕРЅР°СЂСЊ Рё СЃРІРѕР№ СЃРІРµС‚.
    const РѕРіРЅРёР”РІРѕСЂР° = buildMosqueCourtyard(this.scene);
    for (const [i, РѕРіРѕРЅСЊ] of РѕРіРЅРёР”РІРѕСЂР°.entries()) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(РѕРіРѕРЅСЊ.x, РѕРіРѕРЅСЊ.y, РѕРіРѕРЅСЊ.z);
      this.scene.add(light);
      this.torches.push({ light, base: 1.6, phase: i * 2.4 + 2.1 });
    }
    // РђРєРІРµРґСѓРє РґРµСЂРµРІРЅРё: СЂР°Р·СЂСѓС€РµРЅРЅР°СЏ Р°СЂРєР°РґР° Рє РІРѕСЃС‚РѕРєСѓ РѕС‚ РЅРµС‘.
    buildAqueduct(this.scene);
    // РЁР°С‚С‘СЂ РІ Р±Р°Р·Р°СЂРЅРѕРј РєРІР°СЂС‚Р°Р»Рµ Рё РєСѓР·РЅРёС†Р° РІ РґРµСЂРµРІРЅРµ.
    buildTradeTent(this.scene);
    buildVillageForge(this.scene);
    // Р СѓРёРЅР° РІРѕСЂРѕС‚ РїРѕРїРµСЂС‘Рє СЋР¶РЅРѕР№ РґРѕСЂРѕРіРё, РЅРµ РґРѕС…РѕРґСЏ РіРѕСЂРѕРґСЃРєРёС… РІРѕСЂРѕС‚.
    buildRuinGate(this.scene);
    // Р‘Р°СЃС‚РёРѕРЅС‹ РїРѕ Р±РѕРєР°Рј РІРѕСЂРѕС‚ РіРѕСЂРЅРѕР№ РєСЂРµРїРѕСЃС‚Рё.
    buildFortBastions(this.scene);
    // Р СѓРёРЅС‹: РєР°РїРµР»Р»Р° Сѓ РњРµСЃРѕРїРѕС‚Р°РјРёРё Рё РґРІРѕСЂ Сѓ СЃРІСЏС‚РёР»РёС‰Р°.
    buildRuinChapel(this.scene);
    buildRuinCourt(this.scene);
    // РљР°РјРµРЅРЅР°СЏ Р°СЂРєР° Сѓ РґРµСЂРµРІРЅРё Рё С†РµСЂРєРѕРІРЅС‹Р№ РїСЂРѕС‘Рј РІ РљР°РІРєР°Р·Рµ.
    buildVillageArchway(this.scene);
    buildChurchDoorway(this.scene);
    // РљСѓРїРѕР»СЊРЅР°СЏ Р±Р°С€РЅСЏ Рє РІРѕСЃС‚РѕРєСѓ РѕС‚ РјРµС‡РµС‚Рё.
    buildOnionDomeTower(this.scene);
    // Р“РёР±РµР»СЊРЅС‹Р№ СЌС€Р°С„РѕС‚ Р·Р° РіРѕСЂРѕРґСЃРєРѕР№ СЃС‚РµРЅРѕР№, Сѓ РґРѕСЂРѕРіРё РЅР° РїРѕСЂС‚.
    buildGallows(this.scene);
    // РўРµР»РµРіР° РЅР° СЂС‹РЅРєРµ, С‡Р°СЃС‚РѕРєРѕР» Сѓ СЌС€Р°С„РѕС‚Р°, Р±Р°СЂСЂРёРєР°РґР° РЅР° РґРѕСЂРѕРіРµ Рє РїРѕСЂС‚Сѓ,
    // РјРµР»СЊРЅРёС†Р° Сѓ РєР°СЂР°РІР°РЅ-СЃР°СЂР°СЏ: С‡РµС‚С‹СЂРµ РјРѕРґРµР»Рё, РґРѕРІРµРґС‘РЅРЅС‹Рµ СЂСѓРєР°РјРё.
    buildMarketCart(this.scene);
    buildGallowsPalisade(this.scene);
    buildPortRoadBarricade(this.scene);
    buildCaravanseraiWindmill(this.scene);
    // РџР»СѓРі Сѓ РјРµР»СЊРЅРёС†С‹: С„РµСЂРјРµСЂСЃРєР°СЏ СЃРІСЏР·РєР° РєР°СЂР°РІР°РЅ-СЃР°СЂР°СЏ.
    buildMillPlough(this.scene);
    // РўРѕС‡РёР»Рѕ Сѓ РєСѓР·РЅРёС†С‹ РґРµСЂРµРІРЅРё.
    buildVillageGrindstone(this.scene);
    // Р”СѓР±С‹ Сѓ Р»РµСЃРЅРѕР№ РґРµСЂРµРІРЅРё.
    buildOaks(this.scene);
    // Р СѓС…РЅСѓРІС€РёР№ РјРѕСЃС‚ Сѓ СЂРµРєРё Рё СЃРєР°Р»С‹ РїРµСЂРµРІР°Р»Р°.
    buildRuinBridge(this.scene);
    buildPassRocks(this.scene);
    // РЎС‚РѕСЂРѕР¶РµРІР°СЏ Р±Р°С€РЅСЏ РЅР° РґР°Р»СЊРЅРµР№ РІРѕСЃС‚РѕС‡РЅРѕР№ РґРѕСЂРѕРіРµ.
    buildDesertTower(this.scene);
    const flame = this.scene.getObjectByName('campfire-flame');
    if (flame) {
      this.flames.push(flame as THREE.Mesh);
      const fireLight = new THREE.PointLight(0xff7a20, 0, 26, 1.6);
      fireLight.position.set(CAMP.x, groundHeight(CAMP.x, CAMP.z) + 1.6, CAMP.z);
      this.scene.add(fireLight);
      // РЎРІРµС‚ СЃР°РјРѕРіРѕ РєРѕСЃС‚СЂР° СЃС‚Р°Р» С‚РёС€Рµ: РіР»Р°РІРЅСѓСЋ СЂР°Р±РѕС‚Сѓ РїРѕ РѕСЃРІРµС‰РµРЅРёСЋ С‚РµРїРµСЂСЊ
      // РґРµР»Р°РµС‚ РЅР°РїСЂР°РІР»РµРЅРЅС‹Р№ РёСЃС‚РѕС‡РЅРёРє СЃ С‚РµРЅСЊСЋ (В§267).
      this.torches.push({ light: fireLight, base: 1.8, phase: 5.5 });
      // РўР•РќР¬ РћРў РљРћРЎРўР Рђ (В§267). РЈ РІСЃРµС… С€РµСЃС‚РёРґРµСЃСЏС‚Рё РґРµРІСЏС‚Рё РёСЃС‚РѕС‡РЅРёРєРѕРІ СЃРІРµС‚Р°
      // С‚РµРЅРµР№ РЅРµС‚, Рё РЅРѕС‡СЊСЋ РѕРіРѕРЅСЊ РЅРµ РѕС‚Р±СЂР°СЃС‹РІР°РµС‚ РЅРё РѕРґРЅРѕР№: СЃР°РјС‹Р№ Р·Р°РјРµС‚РЅС‹Р№
      // РЅРµРґРѕСЃС‡С‘С‚ СЃРІРµС‚Р° РІ РјРёСЂРµ.
      //
      // РўРµРЅСЊ РѕС‚ С‚РѕС‡РµС‡РЅРѕРіРѕ РёСЃС‚РѕС‡РЅРёРєР° вЂ” СЌС‚Рѕ РєСѓР±: С€РµСЃС‚СЊ РїСЂРѕС…РѕРґРѕРІ СЂРµРЅРґРµСЂР° РЅР°
      // РєР°Р¶РґС‹Р№ РёСЃС‚РѕС‡РЅРёРє, Р° РёСЃС‚РѕС‡РЅРёРєРѕРІ РґРµСЃСЏС‚РєРё. РџРѕСЌС‚РѕРјСѓ С‚РµРЅСЊ РѕС‚Р±СЂР°СЃС‹РІР°РµС‚ РћР”РРќ
      // РёСЃС‚РѕС‡РЅРёРє: РЅР°РїСЂР°РІР»РµРЅРЅС‹Р№ РєРѕРЅСѓСЃ РЅР°Рґ РєРѕСЃС‚СЂРѕРј РІ Р»Р°РіРµСЂРµ. РћРЅ СЃРІРµС‚РёС‚ РІРЅРёР·,
      // РєР°Рє Рё РґРѕР»Р¶РµРЅ СЃРІРµС‚РёС‚СЊ РѕРіРѕРЅСЊ, Рё РґР°С‘С‚ С‚РµРЅСЊ РѕС‚ РїР°Р»Р°С‚РѕРє Рё Р»СЋРґРµР№.
      //
      // РћСЃС‚Р°Р»СЊРЅС‹Рµ РёСЃС‚РѕС‡РЅРёРєРё С‚РµРЅРµР№ РЅРµ РёРјРµСЋС‚ вЂ” С‚Р°Рє Рё РѕСЃС‚Р°С‘С‚СЃСЏ: С‡РµСЃС‚РЅРѕ Рё
      // РІ СЂР°РјРєР°С… РєР°РґСЂР°.
      const С‚РµРЅСЊРљРѕСЃС‚СЂР° = new THREE.SpotLight(0xff7a20, 0, 26, 1.15, 0.55, 1.6);
      С‚РµРЅСЊРљРѕСЃС‚СЂР°.position.set(CAMP.x, groundHeight(CAMP.x, CAMP.z) + 1.5, CAMP.z);
      С‚РµРЅСЊРљРѕСЃС‚СЂР°.castShadow = true;
      С‚РµРЅСЊРљРѕСЃС‚СЂР°.shadow.mapSize.set(1024, 1024);
      С‚РµРЅСЊРљРѕСЃС‚СЂР°.shadow.camera.near = 0.4;
      С‚РµРЅСЊРљРѕСЃС‚СЂР°.shadow.camera.far = 26;
      С‚РµРЅСЊРљРѕСЃС‚СЂР°.shadow.bias = -0.002;
      С‚РµРЅСЊРљРѕСЃС‚СЂР°.target.position.set(CAMP.x, groundHeight(CAMP.x, CAMP.z), CAMP.z);
      this.scene.add(С‚РµРЅСЊРљРѕСЃС‚СЂР°, С‚РµРЅСЊРљРѕСЃС‚СЂР°.target);
      this.С‚РµРЅСЊРљРѕСЃС‚СЂР° = С‚РµРЅСЊРљРѕСЃС‚СЂР°;
      // Р”С‹Рј РЅР°Рґ РєРѕСЃС‚СЂРѕРј (В§255): РѕРіРѕРЅСЊ Р±РµР· РґС‹РјР° С‡РёС‚Р°РµС‚СЃСЏ РєР°Рє РЅР°СЂРёСЃРѕРІР°РЅРЅС‹Р№.
      this.РґС‹Рј.push({
        РґС‹Рј: createPuffs(this.scene, {
          РєРѕР»РёС‡РµСЃС‚РІРѕ: 20,
          С†РІРµС‚: 0x82796f,
          СЂР°Р·РјРµСЂ: 1.2,
          СЂРѕСЃС‚: 3.8,
          Р¶РёР·РЅСЊ: 4.4,
          РїРѕРґСЉС‘Рј: 1.3,
          СЂР°Р·Р±СЂРѕСЃ: 0.3,
          РЅРµРїСЂРѕР·СЂР°С‡РЅРѕСЃС‚СЊ: 0.6,
          Р·Р°С‚СѓС…Р°РЅРёРµ: 0.8,
        }),
        x: CAMP.x,
        y: groundHeight(CAMP.x, CAMP.z) + 1.4,
        z: CAMP.z,
        С‚Р°Р№РјРµСЂ: 0,
      });
    }

    // РќРµР±Рѕ, С„Р°СѓРЅР° Рё NPC РіРѕСЂРѕРґР°
    this.sky = createSky(this.scene);
    // С‡С‚РѕР±С‹ РїРµСЂРІС‹Р№ РєР°РґСЂ РЅРµ РїРѕРєР°Р·Р°Р» РјРёСЂ Р±РµР· РѕСЃРІРµС‰РµРЅРёСЏ.
    this.env = new SkyEnvironment(this.scene, this.renderer);
    await РїР°СѓР·Р°(0.72);
    this.fauna = createFauna(this.scene);
    this.npcs = createNpcs(this.scene);
    this.civilians = createCivilians(this.scene);
    // Р–РёС‚РµР»Рё С‚СЂС‘С… СЂРµРіРёРѕРЅР°Р»СЊРЅС‹С… РіРѕСЂРѕРґРѕРІ РЅР° РЅР°СЃС‚РѕСЏС‰РёС… РјРѕРґРµР»СЏС….
    this.townfolk = createTownfolk(this.scene);
    this.roadTraffic = createRoadTraffic(this.scene);
    // РџС‹Р»СЊРЅС‹Рµ РІРёС…СЂРё РІ РїСѓСЃС‚С‹РЅРµ (В§257): РІРµС‚РµСЂ РїРѕРґРЅРёРјР°РµС‚ РїРµСЃРѕРє СЃР°Рј РїРѕ СЃРµР±Рµ.
    this.РІРёС…СЂРё = createDustDevils(this.scene);
    // РћС‚Р±Р»РµСЃРєРё С„РѕРЅР°СЂРµР№ РЅР° РјРѕРєСЂРѕР№ Р·РµРјР»Рµ (В§276).
    this.РѕС‚Р±Р»РµСЃРєРё = createGlints(this.scene);
    // Р СЏР±СЊ РѕС‚ Р»РѕРґРѕРє Сѓ РїСЂРёС‡Р°Р»Р° (В§280).
    this.СЂСЏР±СЊ = createRipples(this.scene);
    // Р СЏР±СЊ РѕС‚ РґРѕР¶РґСЏ РІ Р»СѓР¶Р°С… (В§285): РІРѕРґР° РІ Р»СѓР¶Рµ РЅРµ Р·РµСЂРєР°Р»Рѕ, Р° Р¶РёРІР°СЏ РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ.
    this.СЂСЏР±СЊР›СѓР¶ = createPuddleRipples(this.scene);
    // РњР°СЂРµРІРѕ РЅР°Рґ РіРѕСЂРёР·РѕРЅС‚РѕРј РІ Р¶Р°СЂСѓ (В§265).
    this.РјР°СЂРµРІРѕ = createMirage(this.scene);
    // РџС‹Р»СЊ РЅР°Рґ РґРѕСЂРѕРіРѕР№ РІ Р¶Р°СЂСѓ (В§268).
    this.РїС‹Р»СЊР”РѕСЂРѕРіРё = createRoadDust(this.scene);
    // Р’РѕРґР° РІ РєРѕР»РµСЏС… РґРѕСЂРѕРіРё Рё Р»СѓР¶Рё РІ РїСЂРёРіРѕСЂРѕРґРµ (В§269).
    this.РІРѕРґР°Р”РѕСЂРѕРіРё = createRoadWater(this.scene);
    // РЎР»РµРґС‹ РєР°СЂР°РІР°РЅРѕРІ РЅР° РґРѕСЂРѕРіРµ (В§270).
    this.СЃР»РµРґС‹РљР°СЂР°РІР°РЅРѕРІ = createCaravanTracks(this.scene);
    // Р”С‹Рј РёР· РїРµС‡РЅС‹С… С‚СЂСѓР± (В§266): РіРѕСЂРѕРґ РёР· Р¶Р°СЂС‹ РІС‹РіР»СЏРґРµР» РІС‹РєР»СЋС‡РµРЅРЅС‹Рј.
    this.РґС‹РјРўСЂСѓР± = createPuffs(this.scene, {
      РєРѕР»РёС‡РµСЃС‚РІРѕ: 16,
      С†РІРµС‚: 0x8f8880,
      СЂР°Р·РјРµСЂ: 0.8,
      СЂРѕСЃС‚: 2.4,
      Р¶РёР·РЅСЊ: 4.2,
      РїРѕРґСЉС‘Рј: 1.1,
      СЂР°Р·Р±СЂРѕСЃ: 0.35,
      РЅРµРїСЂРѕР·СЂР°С‡РЅРѕСЃС‚СЊ: 0.3,
      Р·Р°С‚СѓС…Р°РЅРёРµ: 0.9,
    });
    // РџС‚РёС†С‹ РЅР°Рґ РїСѓСЃС‚С‹РЅРµР№ Рё РіРѕСЂРѕРґРѕРј (В§259): РЅРµР±Рѕ РЅРµ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј.
    this.РїС‚РёС†С‹ = createBirds(this.scene);
    this.weather = createWeather(this.scene, audio);
    await РїР°СѓР·Р°(0.8);
    this.interiors = createInteriors(this.scene);
    for (const d of this.interiors.clickTargets) this.doorTargets.push(d);
    // РРЅС‚РµСЂСЊРµСЂРЅС‹Рµ С†РµР»Рё (РёРЅС‚РµСЂР°РєС‚РёРІС‹, СЂР°Р·СЂСѓС€Р°РµРјРѕРµ, Р»РµСЃС‚РЅРёС†С‹) Р±РѕР»СЊС€Рµ РЅРµ
    // СЃРѕР±РёСЂР°СЋС‚СЃСЏ Р·РґРµСЃСЊ РѕРґРЅРёРј Р·Р°Р»РїРѕРј: РёС… РґРµСЂР¶РёС‚ refreshInteriorTargets()
    // Рё РѕР±РЅРѕРІР»СЏРµС‚ РЅР° РєР°Р¶РґРѕРј РІС…РѕРґРµ/РІС‹С…РѕРґРµ РёР· Р·РґР°РЅРёСЏ.
    buildPocketGround(this.scene);
    this.navigator = createNavigator(this.scene);
    // SSR РІРєР»СЋС‡Р°РµРј С‚РѕР»СЊРєРѕ С‚Р°Рј, РіРґРµ РѕС‚СЂР°Р¶РµРЅРёРµ Рё РїСЂР°РІРґР° РЅСѓР¶РЅРѕ. Р’СЂРµРјСЏ РІС‹Р·РѕРІР°
    // РЅРµ СЃР»СѓС‡Р°Р№РЅРѕ: СЃРїРёСЃРѕРє РѕС‚СЂР°Р¶Р°СЋС‰РёС… СЃРѕР±РёСЂР°РµС‚СЃСЏ РѕР±С…РѕРґРѕРј РіРѕС‚РѕРІРѕР№ СЃС†РµРЅС‹.
    this.collectSsrReflectors();
    // Р С‚РѕР»СЊРєРѕ С‚РµРїРµСЂСЊ РїСЂРѕС€РёРІР°РµРј G-buffer: РґРѕ СЌС‚РѕРіРѕ РјРµСЃС‚Р° СЃС†РµРЅС‹ РµС‰С‘ РЅРµС‚.
    this.patchWorldMaterials(true);

    // РџСЂРѕРіСЂРµРІ РіСЂР°С„РёРєРё (В§391): РєРѕРјРїРёР»СЏС†РёСЏ С€РµР№РґРµСЂРѕРІ РІСЃРµР№ СЃС†РµРЅС‹ Рё РїРµСЂРІР°СЏ
    // РІС‹РєР»Р°РґРєР° С‚РµРєСЃС‚СѓСЂ РІ GPU - СЃР°РјС‹Р№ С‚СЏР¶С‘Р»С‹Р№ РїРµСЂРІС‹Р№ РєР°РґСЂ. compileAsync
    // СЃС‚СЂРѕРёС‚ РїСЂРѕРіСЂР°РјРјС‹ РїР°СЂР°Р»Р»РµР»СЊРЅРѕ (KHR_parallel_shader_compile) Рё РЅРµ
    // Р±Р»РѕРєРёСЂСѓРµС‚ РіР»Р°РІРЅС‹Р№ РїРѕС‚РѕРє, РїРѕСЌС‚РѕРјСѓ Р±Р°СЂ Р¶РёРІ. Р‘РµР· РїСЂРѕРіСЂРµРІР° РёРіСЂРѕРє СЃС‚РѕСЏР»
    // РЅР° В«Р“РѕС‚РѕРІРѕВ» СЃ В«СЃС‚СЂР°РЅРёС†Р° РЅРµ РѕС‚РІРµС‡Р°РµС‚В»: РІСЃСЏ РєРѕРјРїРёР»СЏС†РёСЏ Р¶РґР°Р»Р° РµРіРѕ
    // РџРћРЎР›Р• СЃРєСЂС‹С‚РёСЏ Р·Р°РіСЂСѓР·РєРё.
    await РїР°СѓР·Р°(0.9);
    await this.renderer.compileAsync(this.scene, this.camera);
    onProgress?.(0.97);
    this.composer.render();

    // DEBUG: РІРёР·СѓР°Р»РёР·Р°С†РёСЏ РєРѕР»Р»Р°Р№РґРµСЂРѕРІ (РЅР°Р¶РјРёС‚Рµ Z РґР»СЏ РІРєР»СЋС‡РµРЅРёСЏ/РІС‹РєР»СЋС‡РµРЅРёСЏ)
    console.log(`[Collision] Total colliders: ${COLLIDERS.length}`);
    this.debugColliders = new THREE.Group();
    this.debugColliders.visible = false;
    const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.35 });
    for (const c of COLLIDERS) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, 4, 12), debugMat);
      cyl.position.set(c.x, groundHeight(c.x, c.z) + 2, c.z);
      this.debugColliders.add(cyl);
    }
    this.scene.add(this.debugColliders);

    // РљРѕР»СЊС†Рѕ С†РµР»Рё
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 28),
      new THREE.MeshBasicMaterial({ color: 0xba2a37, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);

    // РљРѕР»СЊС†Рѕ РІСЃРїР»РµСЃРєР° РїСЂРё РІС…РѕРґРµ РІ РІРѕРґСѓ
    this.splashMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 1.8, 20),
      new THREE.MeshBasicMaterial({ color: 0xaaddee, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.splashMesh.rotation.x = -Math.PI / 2;
    this.splashMesh.visible = false;
    this.scene.add(this.splashMesh);

    // FX-СЃР»РѕР№ Рё РїСЂРёС†РµР»
    this.fxLayer = document.createElement('div');
    this.fxLayer.className = 'fx-layer';
    container.appendChild(this.fxLayer);
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair hidden';
    container.appendChild(this.crosshair);
    this.targetNameEl = document.createElement('div');
    this.targetNameEl.className = 'target-name';
    container.appendChild(this.targetNameEl);
    // РџРѕРґСЃРєР°Р·РєР° РѕРєСЂСѓР¶РµРЅРёСЏ (В§370) вЂ” РіРѕС‚РѕРІС‹Р№ СЌР»РµРјРµРЅС‚ СЃС‚СЂР°РЅРёС†С‹: СЂРёСЃСѓРµРј С‚РµРєСЃС‚
    // РІ РЅРµРіРѕ, Р° РЅРµ СЃРѕР·РґР°С‘Рј СЃРІРѕР№, С‡С‚РѕР±С‹ СЃС‚РёР»Рё Р¶РёР»Рё РІ РѕРґРЅРѕРј РјРµСЃС‚Рµ.
    this.envHintEl = document.getElementById('env-hint');

    // РЎРѕР±С‹С‚РёСЏ
    window.addEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    // Р Р°Р·РјРµСЂ РєРѕРЅС‚РµР№РЅРµСЂР° РјРµРЅСЏРµС‚СЃСЏ Рё Р±РµР· resize РѕРєРЅР°: РїРѕР»РЅС‹Р№ СЌРєСЂР°РЅ Рё
    // СЌРєСЂР°РЅРЅС‹Р№ СЂРµР¶РёРј В«СЃ СЂР°РјРєРѕР№В» СѓРјРµРЅСЊС€Р°СЋС‚ РёРіСЂРѕРІСѓСЋ РѕР±Р»Р°СЃС‚СЊ РїРѕ-СЃРІРѕРµРјСѓ.
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(container);

    // РљР°С‡РµСЃС‚РІРѕ РіСЂР°С„РёРєРё вЂ” РёР· СЃРѕС…СЂР°РЅС‘РЅРЅС‹С… РЅР°СЃС‚СЂРѕРµРє
    this.setGraphics(getSettings().graphics);
  }

  /**
   * РџСЂРёРјРµРЅРёС‚СЊ СѓСЂРѕРІРµРЅСЊ РіСЂР°С„РёРєРё: СЂР°Р·СЂРµС€РµРЅРёРµ РєР°РґСЂР°, С‚РµРЅРё, РґР°Р»СЊРЅРѕСЃС‚СЊ
   * РїСЂРѕСЂРёСЃРѕРІРєРё, РїР»РѕС‚РЅРѕСЃС‚СЊ С‡Р°СЃС‚РёС† РїРѕРіРѕРґС‹. Р’С‹Р·С‹РІР°РµС‚СЃСЏ РїСЂРё РІС…РѕРґРµ РІ РјРёСЂ
   * Рё РЅР° Р»РµС‚Сѓ РёР· РїР°РЅРµР»Рё РЅР°СЃС‚СЂРѕРµРє.
   */
  setGraphics(level: GraphicsLevel, fogOn = getSettings().fog): void {
    if (!this.renderer || !this.scene || !this.sun || !this.camera) return;
    const p = graphicsProfile(level);

    // Р Р°Р·СЂРµС€РµРЅРёРµ РєР°РґСЂР°: <1 вЂ” СЃР¶Р°С‚С‹Р№ РєР°РґСЂ (Р±С‹СЃС‚СЂРѕ), >1 вЂ” СЃСѓРїРµСЂСЃСЌРјРїР»РёРЅРі (РєСЂР°СЃРёРІРѕ)
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(2.5, p.pixelScale * (devicePixelRatio || 1))));

    // РўРµРЅРё: СЃРјРµРЅР° СЂРµР¶РёРјР° С‚СЂРµР±СѓРµС‚ РїРµСЂРµСЃР±РѕСЂРєРё materials
    const shadowsChanged = this.renderer.shadowMap.enabled !== p.shadows;
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    // РўРµРЅРё РІС‹РєР»СЋС‡РµРЅС‹ - СЃР°РјС‹Р№ РґРµС€С‘РІС‹Р№ С‚РёРї. РРЅР°С‡Рµ С€РµР№РґРµСЂС‹ РїСЂРѕРґРѕР»Р¶Р°СЋС‚ СЃС‡РёС‚Р°С‚СЊ
    // СЂР°Р·РјС‹С‚РёРµ РІС…РѕР»РѕСЃС‚СѓСЋ: СЃРІРµС‚ С‚РµРЅСЊ РЅРµ Р±СЂРѕСЃР°РµС‚, Р° РїР»Р°С‚РёРј Р·Р° РЅРµС‘.
    const РЅСѓР¶РЅС‹Р№РўРёРї = p.shadows ? THREE.VSMShadowMap : THREE.BasicShadowMap;
    if (this.renderer.shadowMap.type !== РЅСѓР¶РЅС‹Р№РўРёРї) this.renderer.shadowMap.type = РЅСѓР¶РЅС‹Р№РўРёРї;
    if (shadowsChanged) {
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => { m.needsUpdate = true; });
        else if (mat) mat.needsUpdate = true;
      });
    }
    if (this.sun.shadow.mapSize.x !== p.shadowMapSize) {
      this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }

    // SSAO: С‚РµРїРµСЂСЊ РµРіРѕ СЃС‡РёС‚Р°РµС‚ РѕС‚Р»РѕР¶РµРЅРЅС‹Р№ РїСЂРѕС…РѕРґ РїРѕ G-buffer, Р° РЅРµ SSAOPass
    // РІС‚РѕСЂС‹Рј СЂРµРЅРґРµСЂРѕРј СЃС†РµРЅС‹. Р’С‹РєР»СЋС‡Р°РµС‚СЃСЏ С‚РµРј Р¶Рµ С„Р»Р°РіРѕРј РїСЂРѕС„РёР»СЏ.
    this.deferred?.setAoSettings({ intensity: p.ssao ? undefined : 0 });
    // SSR: screen-space reflections. Р’РєР»СЋС‡Р°РµРј/РІС‹РєР»СЋС‡Р°РµРј С‡РµСЂРµР· enabled Сѓ РїР°СЃСЃР°.
    if (this.ssrPass) this.ssrPass.enabled = p.ssr;
    // Bloom: СЃРІРµС‡РµРЅРёРµ СЏСЂРєРёС… РёСЃС‚РѕС‡РЅРёРєРѕРІ.
    if (this.bloomPass) this.bloomPass.enabled = p.bloom;

    // Р”Р°Р»СЊРЅРѕСЃС‚СЊ РїСЂРѕСЂРёСЃРѕРІРєРё. РўСѓРјР°РЅРѕРј РІРµРґР°РµС‚ РїРѕРіРѕРґР° Рё С…СЂР°РЅРёС‚ СЃРІРѕС‘ В«РґРѕРјР°С€РЅРµРµВ»
    // Р·РЅР°С‡РµРЅРёРµ far вЂ” РјРµРЅСЏРµРј РµРіРѕ Р¶Рµ, РёРЅР°С‡Рµ СЃРјРµРЅР° РїРѕРіРѕРґС‹ РІСЃС‘ РѕС‚РєР°С‚РёС‚.
    const fog = this.scene.fog as THREE.Fog | null;
    const fogFar = fogOn ? p.fogFar : p.fogFar * 4; // С‚СѓРјР°РЅ РІС‹РєР»СЋС‡РµРЅ вЂ” РїСЂРѕСЃС‚Рѕ РѕС‡РµРЅСЊ РґР°Р»РµРєРѕ
    if (fog) fog.far = fogFar;
    // РќРµР±Рѕ вЂ” СЃС„РµСЂР° СЂР°РґРёСѓСЃРѕРј SKY_RADIUS РІРѕРєСЂСѓРі РёРіСЂРѕРєР°. Р”Р°Р»СЊРЅСЏСЏ РїР»РѕСЃРєРѕСЃС‚СЊ
    // РєР°РјРµСЂС‹ РІСЃРµРіРґР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ Р±РѕР»СЊС€Рµ РЅРµС‘, РёРЅР°С‡Рµ С‡Р°СЃС‚СЊ РЅРµР±Р° РѕС‚СЃРµРєР°РµС‚СЃСЏ
    // Рё РЅР° С‚РѕРј РјРµСЃС‚Рµ РІРёРґРЅРѕ С‡С‘СЂРЅС‹Р№ РєСѓРїРѕР» (background Сѓ СЃС†РµРЅС‹ РїСѓСЃС‚РѕР№).
    // Р”Р°Р»СЊРЅСЏСЏ РїР»РѕСЃРєРѕСЃС‚СЊ РґРµСЂР¶РёС‚СЃСЏ СЂР°РґРё Р·РІС‘Р·Рґ Рё СЃРІРµС‚РёР» (РѕРЅРё РЅР° SKY_RADIUS), Р°
    // РЅРµ СЂР°РґРё РЅРµР±Р°: РЅРµР±Рѕ С‚РµРїРµСЂСЊ С„РѕРЅ СЃС†РµРЅС‹, С„РѕРЅ РЅРµ РіРµРѕРјРµС‚СЂРёСЏ Рё РїР»РѕСЃРєРѕСЃС‚СЊСЋ РЅРµ
    // РѕС‚СЃРµРєР°РµС‚СЃСЏ. Р•СЃР»Рё Р±С‹ РєСѓРїРѕР» РІРµСЂРЅСѓР»СЃСЏ, С‚СЂРµР±РѕРІР°РЅРёРµ В«РґР°Р»СЊС€Рµ SKY_RADIUSВ»
    // РїСЂРёС€Р»РѕСЃСЊ Р±С‹ РІРµСЂРЅСѓС‚СЊ РІРјРµСЃС‚Рµ СЃ РЅРёРј.
    this.camera.far = Math.max(SKY_RADIUS * 1.15, fogFar + 750);
    this.camera.updateProjectionMatrix();
    this.weather?.setQuality(fogFar, p.weather);

    this.onResize();
  }

  /** РџСЂРёРІСЏР·Р°С‚СЊ СЃРµС‚РµРІС‹Рµ СЃСѓС‰РЅРѕСЃС‚Рё Рё СЃРІРѕРµРіРѕ РёРіСЂРѕРєР° */
  attach(entities: World, me: PlayerEntity): void {
    this.entities = entities;
    this.me = me;
  }

  /** РџРѕР·Р° РєР°РјРµСЂС‹ вЂ” РґР»СЏ e2e-С…СѓРєР° window.__eos */
  getCameraPose(): { yaw: number; pitch: number; dist: number } {
    return { yaw: this.yaw, pitch: this.pitch, dist: this.dist };
  }

  /**
   * РЎС‚Р°РґРёСЏ Р°РєС‚РёРІРЅРѕР№ СЃРІСЏР·РєРё: 0 вЂ” РѕРєРЅР° РЅРµС‚, СЃРІСЏР·РєРё РЅРµС‚. Р§РёС‚Р°РµС‚ useSkill:
   * РЅР°РІС‹Рє РІ РѕРєРЅРµ РїРѕСЃР»Рµ РєР»РёРєР° вЂ” СЌС‚Рѕ Р·Р°РІРµСЂС€Р°СЋС‰Р°СЏ Р°С‚Р°РєР° СЃРІСЏР·РєРё.
   */
  getComboStage(): 0 | 1 | 2 {
    if (performance.now() - this.lastSwingAt > COMBO_WINDOW_MS) return 0;
    return this.comboStage;
  }

  /** РќР°РІС‹Рє-С„РёРЅРёС€РµСЂ Р·Р°РєСЂС‹РІР°РµС‚ СЃРІСЏР·РєСѓ: РѕРєРЅРѕ РЅРµ РІРёСЃРёС‚ Р·Р° СЌС„С„РµРєС‚РѕРј РЅР°РІС‹РєР°. */
  resetCombo(): void {
    this.lastSwingAt = 0;
  }

  /**
   * Р—Р°РјР°С… С„РёРЅРёС€РµСЂР°: РѕР±СЂР°С‚РЅС‹Р№, РєР°Рє РІС‚РѕСЂРѕР№ СѓРґР°СЂ, РїР»СЋСЃ СЌС„С„РµРєС‚ РЅР°РІС‹РєР° РїРѕРІРµСЂС….
   * РћС‚РґРµР»СЊРЅРѕРіРѕ РєР»РёРїР° С„РёРЅРёС€РµСЂР° РІ РїСЂРѕРµРєС‚Рµ РЅРµС‚, Рё РѕР±СЂР°С‚РЅС‹Р№ Р·Р°РјР°С… РїР»СЋСЃ РІСЃРїС‹С€РєР°
   * РЅР°РІС‹РєР° С‡РёС‚Р°СЋС‚СЃСЏ РєР°Рє Р·Р°РІРµСЂС€РµРЅРёРµ СЃРІСЏР·РєРё.
   */
  playFinisherSwing(): void {
    this.attackAnim = true;
    this.attackStage = 2;
  }

  setCameraPose(yaw: number, pitch: number, dist?: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    if (dist != null) this.dist = Math.min(15, Math.max(3.2, dist));
  }

  /** Р¦РµР»СЊ СЃС‚СЂРµР»РєРё-РЅР°РІРёРіР°С‚РѕСЂР° РЅР°Рґ РёРіСЂРѕРєРѕРј */
  setNavTarget(target: NavTarget | null): void {
    this.navigator?.setTarget(target);
  }

  /** РџРѕСЃС‚СЂРѕРµРЅРЅС‹Р№ РјР°СЂС€СЂСѓС‚ РЅР°РІРёРіР°С‚РѕСЂР° (РґР»СЏ РјРёРЅРё-РєР°СЂС‚С‹) */
  getNavRoute(): { x: number; z: number }[] {
    return this.navigator?.getRoute() ?? [];
  }

  /** РРіСЂРѕРІРѕР№ С‡Р°СЃ (0вЂ“23) РѕС‚ world:time вЂ” РІРµРґС‘С‚ СЃРѕР»РЅС†Рµ/Р»СѓРЅСѓ/Р·РІС‘Р·РґС‹ */
  setClock(hour: number): void {
    if (Number.isFinite(hour)) this.clockHour = ((hour % 24) + 24) % 24;
  }

  /** РђС‚Р°РєР° Р»СѓС‡РѕРј РёР· С†РµРЅС‚СЂР° СЌРєСЂР°РЅР° Р±РµР· РјС‹С€Рё (С‚РѕС‚ Р¶Рµ РїСѓС‚СЊ, С‡С‚Рѕ Сѓ Р›РљРњ) */
  attackFromCamera(): void {
    this.tryAttack();
  }

  /** РџРѕРґРїРёСЃРєР° РЅР° Р·Р°РјР°С… вЂ” РІС‹Р·С‹РІР°РµС‚СЃСЏ РёР· СЃР»РѕСЏ РїСЂРёР»РѕР¶РµРЅРёСЏ */
  setOnAttack(cb: (() => void) | null): void {
    this.onAttack = cb;
  }

  /** РџРѕРґРїРёСЃРєР° РЅР° РїРѕРІРѕСЂРѕС‚ РєР°РјРµСЂС‹ вЂ” РІС‹Р·С‹РІР°РµС‚СЃСЏ РёР· СЃР»РѕСЏ РїСЂРёР»РѕР¶РµРЅРёСЏ */
  setOnCamera(cb: (() => void) | null): void {
    this.onCamera = cb;
  }

  /** Р‘Р»РѕРє (РџРљРњ) вЂ” СЂР°РЅСЊС€Рµ РјРµРЅСЏР» С‚РѕР»СЊРєРѕ РїРѕР·Сѓ, СЃРµСЂРІРµСЂ Рѕ Р·Р°С‰РёС‚Рµ РЅРµ СѓР·РЅР°РІР°Р» */
  setOnBlock(cb: (() => void) | null): void {
    this.onBlock = cb;
  }

  /** РЈРєР»РѕРЅРµРЅРёРµ (РґРІРѕР№РЅРѕРµ РЅР°Р¶Р°С‚РёРµ РєР»Р°РІРёС€Рё РЅР°РїСЂР°РІР»РµРЅРёСЏ) */
  setOnDodge(cb: (() => void) | null): void {
    this.onDodge = cb;
  }

  // в”Ђв”Ђ РЎРѕР±С‹С‚РёСЏ РІРІРѕРґР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  private onResize = () => {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    // SSAO + SSR + Bloom С‚СЂРµР±СѓСЋС‚ РѕР±РЅРѕРІР»РµРЅРёСЏ СЂР°Р·РјРµСЂР° РїСЂРё РёР·РјРµРЅРµРЅРёРё РѕРєРЅР°
    this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
    // РћС‚Р»РѕР¶РµРЅРЅС‹Р№ РїСЂРѕС…РѕРґ РґРµСЂР¶РёС‚ СЃРІРѕРё С†РµР»Рё: Р±РµР· СЌС‚РѕРіРѕ G-buffer РѕСЃС‚Р°С‘С‚СЃСЏ
    // РїСЂРµР¶РЅРµРіРѕ СЂР°Р·РјРµСЂР°, Р° AO С‡РёС‚Р°РµС‚СЃСЏ РїРѕ РЅРµРІРµСЂРЅС‹Рј СЌРєСЂР°РЅРЅС‹Рј РєРѕРѕСЂРґРёРЅР°С‚Р°Рј.
    this.deferred?.setSize(this.container.clientWidth, this.container.clientHeight);
    this.ssrPass.setSize(this.container.clientWidth, this.container.clientHeight);
    this.bloomPass.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) {
      this.renderer.domElement.requestPointerLock();
      return;
    }
    if (e.button === 0) this.tryAttack();
    if (e.button === 2) {
      this.block = true;
      // РЎРѕРѕР±С‰Р°РµРј СЃРµСЂРІРµСЂСѓ. Р Р°РЅСЊС€Рµ РџРљРњ РјРµРЅСЏР» С‚РѕР»СЊРєРѕ РїРѕР·Сѓ РЅР° СЌРєСЂР°РЅРµ: СЃРµСЂРІРµСЂ Рѕ
      // Р±Р»РѕРєРµ РЅРµ СѓР·РЅР°РІР°Р», Рё РІРµСЃСЊ РјРµС…Р°РЅРёС‡РµСЃРєРёР№ Р±Р»РѕРє Р±С‹Р» РЅРµРґРѕСЃС‚РёР¶РёРј РёР· РёРіСЂС‹.
      this.onBlock?.();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) this.block = false;
  };

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    this.crosshair.classList.toggle('hidden', !this.locked);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    // РЁР°Рі С‚СѓС‚РѕСЂРёР°Р»Р° В«РєР°РјРµСЂР°В»: РЅР°СЃС‚РѕСЏС‰РёР№ РїРѕРІРѕСЂРѕС‚ РєР°РјРµСЂС‹, Р° РЅРµ РґСЂРѕР¶Р°РЅРёРµ РјС‹С€Рё
    if (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3) this.onCamera?.();
    this.yaw -= e.movementX * 0.0026;
    this.pitch = Math.min(1.25, Math.max(-0.5, this.pitch + e.movementY * 0.0022));
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.locked) return;
    e.preventDefault();
    this.dist = Math.min(15, Math.max(3.2, this.dist + e.deltaY * 0.008));
  };

  /** РџРѕРєР° РѕС‚РєСЂС‹С‚ С‡Р°С‚ РёР»Рё С„РѕРєСѓСЃ РІ РїРѕР»Рµ РІРІРѕРґР° вЂ” РґРІРёР¶РµРЅРёРµ Рё РїСЂС‹Р¶РѕРє РѕС‚РєР»СЋС‡РµРЅС‹ */
  private isTyping(): boolean {
    const el = document.activeElement;
    return chatVisible()
      || el instanceof HTMLInputElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLSelectElement;
  }

  /**
   * Р С‹РІРѕРє РїРѕ РґРІРѕР№РЅРѕРјСѓ РЅР°Р¶Р°С‚РёСЋ РєР»Р°РІРёС€Рё РЅР°РїСЂР°РІР»РµРЅРёСЏ.
   *
   * РљР»Р°РІРёС€Рё: W A S D Рё СЃС‚СЂРµР»РєРё. РџРѕРІС‚РѕСЂ РєР»Р°РІРёС€Рё (keydown РїСЂРё СѓРґРµСЂР¶Р°РЅРёРё) РѕС‚СЃРµРєР°РµС‚СЃСЏ
   * РІС‹С€Рµ - РІ keys РѕРЅР° СѓР¶Рµ РµСЃС‚СЊ, - РїРѕСЌС‚РѕРјСѓ РґРІРѕР№РЅС‹Рј РЅР°Р¶Р°С‚РёРµРј СЃС‡РёС‚Р°СЋС‚СЃСЏ РёРјРµРЅРЅРѕ
   * РґРІР° РѕСЃРѕР·РЅР°РЅРЅС‹С… РЅР°Р¶Р°С‚РёСЏ, Р° РЅРµ СѓРґРµСЂР¶Р°РЅРёРµ.
   */
  private maybeDodge(code: string): void {
    if (!DOUBLE_TAP_KEYS.has(code)) return;
    const now = Date.now();
    const last = this.lastTap.get(code) ?? 0;
    this.lastTap.set(code, now);
    if (now - last < World3D.DOUBLE_TAP_MS) {
      // Р’С‚РѕСЂРѕРµ РЅР°Р¶Р°С‚РёРµ СЃР±СЂР°СЃС‹РІР°РµРј, РёРЅР°С‡Рµ С‚СЂРµС‚РёР№ СЂР°Р· РїРѕРґСЂСЏРґ (СѓРґРµСЂР¶Р°РЅРёРµ
      // СЃ РїРµСЂРµР±РѕРµРј) СЂС‹РІРЅСѓР» Р±С‹ СЃРЅРѕРІР° С‡РµСЂРµР· РѕРґРЅСѓ РїР°СЂСѓ РЅР°Р¶Р°С‚РёР№.
      this.lastTap.delete(code);
      this.onDodge?.();
      this.applyDodgeImpulse();
    }
  }

  /**
   * Р С‹РІРѕРє РІ С‚Сѓ Р¶Рµ СЃС‚РѕСЂРѕРЅСѓ, РєСѓРґР° СЃРјРѕС‚СЂРёС‚ РїРµСЂСЃРѕРЅР°Р¶.
   *
   * РЎРµСЂРІРµСЂ РЅРµСѓСЏР·РІРёРјРѕСЃС‚СЊ РІРєР»СЋС‡Р°РµС‚ СЃР°Рј (СЃ РѕС‚РєР°С‚РѕРј Рё С‚СЂР°С‚РѕР№ СЃС‚Р°РјРёРЅС‹), Р° СЂС‹РІРѕРє
   * Р·РґРµСЃСЊ вЂ” РІРёРґРёРјРѕРµ РїРµСЂРµРјРµС‰РµРЅРёРµ. Р‘РµР· РЅРµРіРѕ РїРµСЂСЃРѕРЅР°Р¶ РЅР° 1.5 СЃРµРєСѓРЅРґС‹ СЃС‚Р°РЅРѕРІРёР»СЃСЏ
   * Р±С‹ РЅРµСѓСЏР·РІРёРјС‹Рј, СЃС‚РѕСЏ РЅР° РјРµСЃС‚Рµ, Рё СЌС‚Рѕ РІС‹РіР»СЏРґРµР»Рѕ Р±С‹ РєР°Рє Р·Р°РІРёСЃР°РЅРёРµ.
   *
   * РЎРєРѕСЂРѕСЃС‚СЊ СЂС‹РІРєР° РЅРµ РґРѕР»Р¶РЅР° Р»РѕРјР°С‚СЊ Р°РЅС‚РёС‡РёС‚ СЃРєРѕСЂРѕСЃС‚Рё РЅР° СЃРµСЂРІРµСЂРµ: РѕРЅР° РІС‹С€Рµ
   * Р±РµРіР° (7.6), РЅРѕ СЃРµСЂРІРµСЂ СЃС‡РёС‚Р°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРѕ СЃСЂРµРґРЅРµРјСѓ Р·Р° РёРЅС‚РµСЂРІР°Р», Р° СЂС‹РІРѕРє
   * РґР»РёС‚СЃСЏ РґРѕР»Рё СЃРµРєСѓРЅРґС‹ Рё РіР°СЃРёС‚СЃСЏ СЃСЂР°Р·Сѓ.
   */
  private applyDodgeImpulse(): void {
    const ix = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
      - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const iz = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
      - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    // РђРЅРёРјР°С†РёСЏ СѓРєР»РѕРЅРµРЅРёСЏ РЅР°С‡РёРЅР°РµС‚СЃСЏ Р·РґРµСЃСЊ Р¶Рµ, РґРѕ РїРѕРІРѕСЂРѕС‚Р° РЅР° СѓРіРѕР» РєР°РјРµСЂС‹:
    // СЃС‚РѕСЂРѕРЅР° С‡РёС‚Р°РµС‚СЃСЏ РїСЂСЏРјРѕ РёР· РЅР°Р¶Р°С‚С‹С… РєР»Р°РІРёС€, Р±РµР· РѕР±СЂР°С‚РЅРѕР№ С‚СЂРёРіРѕРЅРѕРјРµС‚СЂРёРё,
    // Р° РїРѕ РґРёР°РіРѕРЅР°Р»Рё Р±РµСЂС‘С‚СЃСЏ С‚Р° РѕСЃСЊ, РіРґРµ РЅР°Р¶Р°С‚РёРµ СЃРёР»СЊРЅРµРµ.
    if (this.me) {
      let СЃС‚РѕСЂРѕРЅР°: DodgeDirection = 'back';
      if (Math.abs(ix) >= Math.abs(iz) && ix !== 0) {
        СЃС‚РѕСЂРѕРЅР° = ix < 0 ? 'left' : 'right';
      } else if (iz !== 0) {
        СЃС‚РѕСЂРѕРЅР° = iz < 0 ? 'back' : 'forward';
      }
      this.rigs.get(this.me.id)?.rig.triggerDodge?.(СЃС‚РѕСЂРѕРЅР°);
    }
    // Р‘РµР· РЅР°РїСЂР°РІР»СЏСЋС‰РµР№ РєР»Р°РІРёС€Рё вЂ” РІ С‚Сѓ СЃС‚РѕСЂРѕРЅСѓ, РєСѓРґР° РїРѕРІС‘СЂРЅСѓС‚ РїРµСЂСЃРѕРЅР°Р¶
    const dx = ix !== 0 || iz !== 0 ? ix : Math.sin(this.yaw);
    const dz = ix !== 0 || iz !== 0 ? iz : Math.cos(this.yaw);
    const len = Math.hypot(dx, dz) || 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // РўРѕС‚ Р¶Рµ РїРѕРІРѕСЂРѕС‚, С‡С‚Рѕ Рё Сѓ С…РѕРґСЊР±С‹: ix/iz Р·Р°РґР°СЋС‚СЃСЏ РІ РѕСЃСЏС… РєР°РјРµСЂС‹.
    // Р Р°РЅСЊС€Рµ С‚СѓС‚ СЃС‚РѕСЏР»Рѕ В«+=В», С‚Рѕ РµСЃС‚СЊ РґРІР° СЂС‹РІРєР° РїРѕРґСЂСЏРґ СЃРєР»Р°РґС‹РІР°Р»Рё СЃРєРѕСЂРѕСЃС‚СЊ:
    // РІС‚РѕСЂРѕР№ СѓРґР°СЂ СѓРЅРѕСЃРёР» РІРґРІРѕРµ РґР°Р»СЊС€Рµ РїРµСЂРІРѕРіРѕ.
    this.dodgeDx = (dx / len) * cos - (dz / len) * sin;
    this.dodgeDz = -(dx / len) * sin - (dz / len) * cos;
    // РўРѕС‡РєР° СЃС‚Р°СЂС‚Р° Р±РµСЂС‘С‚СЃСЏ Сѓ Р¶РёРІРѕРіРѕ РёРіСЂРѕРєР°: Р±РµР· РЅРµРіРѕ (РІС‹РіСЂСѓР·РєР° СЃС†РµРЅС‹) СЂС‹РІРѕРє
    // СЃС‡РёС‚Р°С‚СЊ РЅРµ РѕС‚ С‡РµРіРѕ, Рё РїСЂРѕРІРµСЂРєР° Р±РµР¶РёС‚ РґР°Р»СЊС€Рµ СЃ РЅСѓР»РµРІС‹Рј СЃРјРµС‰РµРЅРёРµРј.
    if (this.me) {
      this.dodgeOx = this.me.pos.x;
      this.dodgeOz = this.me.pos.z;
    }
    this.dodgeStartAt = Date.now();
    this.dodgeT = 0;
    this.dodgeUntil = this.dodgeStartAt + DODGE_TIME_MS;
    audio.whoosh();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping()) return;
    if (this.keys.has(e.code)) return;
    this.keys.add(e.code);
    this.maybeDodge(e.code);
    // РЁР°Рі 3 СЃС‚РµР»СЃР°: F - РїРѕРїС‹С‚РєР° РєСЂР°Р¶Рё РєРѕС€РµР»СЊРєР°. Р—РґРµСЃСЊ С‚РѕР»СЊРєРѕ С„Р»Р°Рі: СЃРѕРєРµС‚ РІ
    // СЌС‚РѕРј РєР»Р°СЃСЃРµ РЅРµРґРѕСЃС‚СѓРїРµРЅ, РїРѕСЌС‚РѕРјСѓ Р·Р°РїСЂРѕСЃ СѓС…РѕРґРёС‚ РёР· world.ts РІ РёРіСЂРѕРІРѕРј
    // С†РёРєР»Рµ. Р¤Р»Р°Рі РѕРґРЅРѕСЂР°Р·РѕРІС‹Р№ Рё СЃР±СЂР°СЃС‹РІР°РµС‚СЃСЏ С‡С‚РµРЅРёРµРј - РёРЅР°С‡Рµ СѓРґРµСЂР¶Р°РЅРёРµ F
    // СЃР»Р°Р»Рѕ Р±С‹ РїРѕ РїРѕРїС‹С‚РєРµ РІ СЃРµРєСѓРЅРґСѓ.
    if (e.code === 'KeyF') {
      e.preventDefault();
      this.stealRequested = true;
    }
    // Dokumenty: E. Klavisha otdelnaya ot F namР•Р enno - oba deystviya
    // primenyayutsya k raznym tselyam, i odno nazhatie ne dolzhno delat oba.
    if (e.code === 'KeyE') {
      e.preventDefault();
      this.documentRequested = true;
    }
    if (e.code === 'Space' && this.me && this.grounded) {
      e.preventDefault();
      this.vy = JUMP_V;
      this.grounded = false;
      audio.jump();
    }
    // DEBUG: РїРµСЂРµРєР»СЋС‡РµРЅРёРµ РІРёР·СѓР°Р»РёР·Р°С†РёРё РєРѕР»Р»Р°Р№РґРµСЂРѕРІ
    if (e.code === 'KeyZ') {
      this.debugColliders.visible = !this.debugColliders.visible;
      console.log(`[Collision] Debug colliders: ${this.debugColliders.visible ? 'ON' : 'OFF'} (${COLLIDERS.length} total)`);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  private onBlur = () => {
    this.keys.clear();
    this.block = false;
  };

  // в”Ђв”Ђ РђС‚Р°РєР° Рё РїСЂРёС†РµР»РёРІР°РЅРёРµ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  /**
   * Р—Р°С…РІР°С‚ С†РµР»Рё: РєРѕРЅСѓСЃ РїСЂРёС†РµР»РёРІР°РЅРёСЏ РѕС‚ РєР°РјРµСЂС‹ (~12В°) + Р·Р°РїР°СЃ РїРѕ Р±Р»РёР·РѕСЃС‚Рё.
   * Р Р°Р±РѕС‚Р°РµС‚ РЅР°РґС‘Р¶РЅРµРµ Р»СѓС‡Р° РїРѕ РјРµС€Р°Рј: РЅРµ Р·Р°РІРёСЃРёС‚ РѕС‚ РІС‹СЃРѕС‚С‹ РїСЂРёС†РµР»Р°.
   */
  private acquireTarget(): string | null {
    if (!this.entities || !this.me) return null;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const camPos = this.camera.position;
    let best: string | null = null;
    let bestDot = 0.978; // ~12В°
    for (const [id, m] of this.entities.monsters) {
      if (m.deadAt) continue;
      const y = groundHeight(m.pos.x, m.pos.z) + 1.1;
      const to = new THREE.Vector3(m.pos.x - camPos.x, y - camPos.y, m.pos.z - camPos.z);
      const dist = to.length();
      if (dist > 26) continue;
      to.normalize();
      const dot = to.dot(forward);
      if (dot > bestDot) { bestDot = dot; best = id; }
    }
    if (best) return best;
    // Р¤РѕР»Р±СЌРє: Р±Р»РёР¶Р°Р№С€РёР№ РјРѕРЅСЃС‚СЂ РІРїР»РѕС‚РЅСѓСЋ Рє РёРіСЂРѕРєСѓ (Р·Р°РјР°С… В«РЅР°СѓРіР°РґВ»)
    let nearest: string | null = null;
    let nearestD = 3.4;
    for (const [id, m] of this.entities.monsters) {
      if (m.deadAt) continue;
      const d = Math.hypot(m.pos.x - this.me.pos.x, m.pos.z - this.me.pos.z);
      if (d < nearestD) { nearestD = d; nearest = id; }
    }
    return nearest;
  }

  private tryAttack(): void {
    if (this.attackCd > 0) return;
    // Р—Р°РјР°С… РїРѕ РґР°РЅРЅС‹Рј РѕСЂСѓР¶РёСЏ Рё СЃС‚РѕР№РєРё. РЎРµСЂРІРµСЂ СЃС‡РёС‚Р°РµС‚ РѕС‚РєР°С‚ С‚Р°Рє Р¶Рµ, РїРѕСЌС‚РѕРјСѓ
    // РєР»РёРµРЅС‚ РЅРµ РѕС‚РєР»РѕРЅСЏРµС‚ Р·Р°РєРѕРЅРЅС‹Р№ С‚РµРјРї Рё РЅРµ СЃРїР°РјРёС‚ РѕС‚РєР°Р·РѕРј В«СЃР»РёС€РєРѕРј Р±С‹СЃС‚СЂРѕВ».
    this.attackCd = this.swingSeconds();

    // РЎС‚Р°РґРёРё СЃРІСЏР·РєРё: РїРµСЂРІС‹Р№ РєР»РёРє вЂ” РїСЂСЏРјРѕР№ Р·Р°РјР°С…, РїРѕРІС‚РѕСЂРЅС‹Р№ РєР»РёРє РІ РѕРєРЅРµ вЂ”
    // РѕР±СЂР°С‚РЅС‹Р№. РўСЂРµС‚РёР№ РєР»РёРє РїРѕРґСЂСЏРґ СЃРІСЏР·РєСѓ РЅРµ РїСЂРѕРґРѕР»Р¶Р°РµС‚: Р·Р°РІРµСЂС€Р°СЋС‰Р°СЏ Р°С‚Р°РєР° вЂ”
    // СЌС‚Рѕ РєР»РёРє РїР»СЋСЃ РЅР°РІС‹Рє (СЃРј. useSkill), РїРѕСЌС‚РѕРјСѓ СЃС‡С‘С‚С‡РёРє С‡РµСЂРµРґСѓРµС‚СЃСЏ 1, 2,
    // 1, 2, РїРѕРєР° РѕРєРЅРѕ РЅРµ РІС‹Р№РґРµС‚ Рё СЃРІСЏР·РєР° РЅРµ РЅР°С‡РЅС‘С‚СЃСЏ Р·Р°РЅРѕРІРѕ СЃ РїРµСЂРІРѕР№.
    const now = performance.now();
    this.comboStage = now - this.lastSwingAt < COMBO_WINDOW_MS && this.comboStage === 1 ? 2 : 1;
    this.lastSwingAt = now;

    // РљСЂСЋС‡РѕРє РґР»СЏ СЃР»РѕСЏ РїСЂРёР»РѕР¶РµРЅРёСЏ (С‚СѓС‚РѕСЂРёР°Р» Р·Р°СЃС‡РёС‚С‹РІР°РµС‚ Р·Р°РјР°С…).
    // Р’С‹Р·С‹РІР°РµС‚СЃСЏ Р”Рћ РїСЂРѕРІРµСЂРєРё С†РµР»Рё: РёРіСЂРѕРє Р·Р°РјР°С…РЅСѓР»СЃСЏ вЂ” С€Р°Рі Р·Р°СЃС‡РёС‚Р°РЅ, РґР°Р¶Рµ РµСЃР»Рё
    // СЂСЏРґРѕРј РЅРёРєРѕРіРѕ РЅРµ Р±С‹Р»Рѕ. РџСЂСЏРјР°СЏ Р·Р°РІРёСЃРёРјРѕСЃС‚СЊ РѕС‚ tutorial.ts Р·РґРµСЃСЊ Р±С‹Р»Р° Р±С‹
    // РЅР°СЂСѓС€РµРЅРёРµРј СЃР»РѕС‘РІ: 3D-СЃР»РѕР№ РЅРёС‡РµРіРѕ РЅРµ РґРѕР»Р¶РµРЅ Р·РЅР°С‚СЊ РїСЂРѕ РёРЅС‚РµСЂС„РµР№СЃ.
    this.onAttack?.();

    // РљР»РёРє РїРѕ NPC РѕС‚РєСЂС‹РІР°РµС‚ СЃРІСЏР·Р°РЅРЅСѓСЋ РїР°РЅРµР»СЊ (РїСЂРёРѕСЂРёС‚РµС‚ РЅР°Рґ Р±РѕРµРј)
    // РЎРЅР°С‡Р°Р»Р° РєР»РёРє РїРѕ NPC РѕС‚РєСЂС‹РІР°РµС‚ РїР°РЅРµР»СЊ, Р·Р°С‚РµРј вЂ” РґРІРµСЂСЊ Р·РґР°РЅРёСЏ.
    if (this.pickNpc()) return;

    if (this.pickDoor()) return;

    if (this.pickInteractive()) return;

    if (this.pickDestructible()) return;

    // РњСЏРіРєРѕРµ РїСЂРёС†РµР»РёРІР°РЅРёРµ: РєРѕРЅСѓСЃ РѕС‚ РєР°РјРµСЂС‹, Р·Р°С‚РµРј Р±Р»РёР·РѕСЃС‚СЊ
    const id = this.acquireTarget();
    if (id && this.entities) {
      this.entities.targetId = id;
      const m = this.entities.monsters.get(id);
      if (m) this.callbacks?.onTarget(m.nameRu, m.hp, m.maxHp);
    }
    // Р—Р°РјР°С… РІСЃРµРіРґР° (РѕС‚РєР»РёРє РЅР° РєР»РёРє); РїР°РєРµС‚ Р°С‚Р°РєРё СѓС…РѕРґРёС‚ С‚РѕР»СЊРєРѕ РїСЂРё С†РµР»Рё
    this.attackAnim = true;
    this.attackStage = this.comboStage;
    audio.whoosh();
    if (this.entities?.targetId) this.callbacks?.onAttack();
  }

  /** Р›СѓС‡ РёР· С†РµРЅС‚СЂР° СЌРєСЂР°РЅР° РїРѕ NPC; РїСЂРё РїРѕРїР°РґР°РЅРёРё вЂ” РѕС‚РєСЂС‹С‚СЊ РїР°РЅРµР»СЊ */
  private pickNpc(): boolean {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    // РџСѓС‚РЅРёРєРё РЅР° РґРѕСЂРѕРіР°С… РєР»РёРєР°Р±РµР»СЊРЅС‹ РЅР°СЂР°РІРЅРµ СЃ РіРѕСЂРѕРґСЃРєРёРјРё NPC: С‚Рµ Р¶Рµ
    // userData, С‚РѕС‚ Р¶Рµ РѕР±СЂР°Р±РѕС‚С‡РёРє, С‚Р° Р¶Рµ РїР°РЅРµР»СЊ Р·Р°РґР°С‡. Р‘РµР· РЅРёС… В«СЃР»СѓС‡Р°Р№РЅС‹Рµ
    // РќРџРЎ СЃ РєРІРµСЃС‚Р°РјРёВ» Р±С‹Р»Рё Р±С‹ РїСЂРѕСЃС‚Рѕ С„РёРіСѓСЂРєР°РјРё, Рє РєРѕС‚РѕСЂС‹Рј РЅРµ РїРѕРґРѕР№С‚Рё.
    const hits = ray.intersectObjects(
      [...this.npcs.clickTargets, ...this.roadTraffic.clickTargets], true);
    // РќРµРІРёРґРёРјС‹Рµ С„РёРіСѓСЂС‹ РЅРµ РєР»РёРєР°Р±РµР»СЊРЅС‹: Р»СѓС‡ three.js РЅРµ СЃРјРѕС‚СЂРёС‚ РЅР° visible,
    // Рё РЅРѕС‡РЅРѕР№ РїР°С‚СЂСѓР»СЊ РґРЅС‘Рј РїРµСЂРµС…РІР°С‚С‹РІР°Р» Р±С‹ РєР»РёРє, СЃС‚РѕСЏ РїРµСЂРµРґ РІРёРґРёРјС‹Рј NPC.
    const РІРёРґРёРјС‹Рµ = hits.filter((h) => {
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        if (!o.visible) return false;
      }
      return true;
    });
    if (!РІРёРґРёРјС‹Рµ.length || РІРёРґРёРјС‹Рµ[0].distance > 22) return false;
    const panel = РІРёРґРёРјС‹Рµ[0].object.userData.npcPanel as string | undefined;
    const name = РІРёРґРёРјС‹Рµ[0].object.userData.npcName as string | undefined;
    const npcId = РІРёРґРёРјС‹Рµ[0].object.userData.npcId as string | undefined;
    if (!panel) return false;
    this.callbacks?.onNpc?.(panel, name ?? '', npcId ?? '');
    return true;
  }

  /** РљР»РёРє РїРѕ РёРЅС‚РµСЂР°РєС‚РёРІРЅРѕРјСѓ РѕР±СЉРµРєС‚Сѓ: СЏС‰РёРє, РєСѓРІС€РёРЅ, РЅР°РІРµСЃ. */
  private pickInteractive(): boolean {
    if (!this.me || !this.interactiveTargets.length) return false;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = ray.intersectObjects(this.interactiveTargets, true);
    if (!hits.length || hits[0].distance > 22) return false;
    const obj = hits[0].object;
    const ud = obj.userData as { interactiveKind?: string; interactiveState?: string };
    if (!ud.interactiveKind) return false;
    const objPos = obj.getWorldPosition(new THREE.Vector3());
    const dx = this.me.pos.x - objPos.x;
    const dz = this.me.pos.z - objPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 3.5) return false;

    // Р“РµР№РјРїР»РµР№РЅС‹Рµ РјРµС…Р°РЅРёРєРё РёРЅС‚РµСЂР°РєС‚РёРІРЅС‹С… РѕР±СЉРµРєС‚РѕРІ
    this.handleInteractiveMechanic(obj, ud);

    this.callbacks?.onInteractive?.(ud.interactiveKind, ud.interactiveState ?? 'intact', obj);
    return true;
  }

  /** РљР»РёРє РїРѕ СЂР°Р·СЂСѓС€Р°РµРјРѕРјСѓ РґРµРєРѕСЂСѓ: СЏС‰РёРє, Р±РѕС‡РєР°, РІР°Р·Р°, РјРµР±РµР»СЊ, РѕРєРЅРѕ. */
  private pickDestructible(): boolean {
    if (!this.me || !this.destructibleTargets.length) return false;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = ray.intersectObjects(this.destructibleTargets, true);
    if (!hits.length || hits[0].distance > 22) return false;
    // userData Р»РµР¶РёС‚ РЅР° Р“Р РЈРџРџР• СЂР°Р·СЂСѓС€Р°РµРјРѕРіРѕ РѕР±СЉРµРєС‚Р°, Р° hits[0].object СЌС‚Рѕ
    // mesh-РїРѕС‚РѕРјРѕРє (РєСЂС‹С€РєР° Р±РѕС‡РєРё, РїР»Р°РЅРєР° СЏС‰РёРєР°). РџРѕРґРЅРёРјР°РµРјСЃСЏ РѕС‚ РїРѕС‚РѕРјРєР° Рє
    // РїСЂРµРґРєСѓ, РєРѕС‚РѕСЂС‹Р№ РЅРµСЃС‘С‚ РґРµСЃС‚СЂСѓРєС‚РѕСЂРЅРѕРµ userData: СЂР°РЅСЊС€Рµ РїСЂРѕРІРµСЂРєР° СЃС‚РѕСЏР»Р°
    // Сѓ hit-РѕР±СЉРµРєС‚Р° РЅР°РїСЂСЏРјСѓСЋ, Рё РІСЃРµ РєР»РёРєРё РїРѕ СЂР°Р·СЂСѓС€Р°РµРјРѕРјСѓ РјРѕР»С‡Р° РіР»РѕС‚Р°Р»РёСЃСЊ.
    let target: THREE.Object3D | null = hits[0].object;
    while (target && !(target.userData as DestructibleData)?.kind) {
      target = target.parent;
    }
    if (!target) return false;
    const obj = target;
    const ud = obj.userData as DestructibleData;
    const objPos = obj.getWorldPosition(new THREE.Vector3());
    const dx = this.me.pos.x - objPos.x;
    const dz = this.me.pos.z - objPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 3.5) return false;

    // РќР°РЅРµСЃС‚Рё СѓСЂРѕРЅ СЂР°Р·СЂСѓС€Р°РµРјРѕРјСѓ РѕР±СЉРµРєС‚Сѓ
    const { broken, newState } = damageDestructible(obj, 25, 'physical');
    if (newState !== 'intact') {
      applyDestructibleVisuals(obj);
    }
    if (broken) {
      // Р­С„С„РµРєС‚ СЂР°Р·СЂСѓС€РµРЅРёСЏ
      const breakEffect = createBreakEffect(obj, obj.getWorldPosition(new THREE.Vector3()));
      this.scene.add(breakEffect);
      // РЈРґР°Р»РёС‚СЊ С‡РµСЂРµР· 3 СЃРµРє
      setTimeout(() => {
        this.scene.remove(breakEffect);
        breakEffect.traverse(child => {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else mat?.dispose();
        });
      }, 3000);
    }
    // РЈРІРµРґРѕРјРёС‚СЊ UI
    this.callbacks?.onInteractive?.(ud.kind, newState, obj);
    return true;
  }

  private handleInteractiveMechanic(obj: THREE.Object3D, ud: { interactiveKind?: string; interactiveState?: string }): void {
    const kind = ud.interactiveKind;
    const state = ud.interactiveState ?? 'intact';
    if (state !== 'intact') return; // СѓР¶Рµ СЃР»РѕРјР°РЅРѕ/РіРѕСЂРёС‚/РѕР±СЂСѓС€РёР»РѕСЃСЊ

    if (kind === 'crate') {
      // РўРѕР»РєР°РЅРёРµ СЏС‰РёРєР°: СЃРґРІРёРіР°РµРј РІ РЅР°РїСЂР°РІР»РµРЅРёРё РІР·РіР»СЏРґР° РёРіСЂРѕРєР°
      this.pushCrate(obj);
    } else if (kind === 'oil_jug') {
      // РџРѕРґР¶РѕРі РєСѓРІС€РёРЅР°: РµСЃР»Рё Сѓ РёРіСЂРѕРєР° РµСЃС‚СЊ РѕРіРЅРµРЅРЅС‹Р№ РЅР°РІС‹Рє/РїСЂРµРґРјРµС‚ вЂ” РїРѕРґР¶РёРіР°РµРј
      this.igniteOilJug(obj);
    } else if (kind === 'awning') {
      // РћР±СЂСѓС€РµРЅРёРµ РЅР°РІРµСЃР°: РµСЃР»Рё СѓРґР°СЂ РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЃРёР»СЊРЅС‹Р№ вЂ” СЂСѓС€РёС‚СЃСЏ
      this.collapseAwning(obj);
    }
  }

  /** РўРѕР»РєРЅСѓС‚СЊ СЏС‰РёРє РІ РЅР°РїСЂР°РІР»РµРЅРёРё РІР·РіР»СЏРґР° РёРіСЂРѕРєР°. */
  private pushCrate(obj: THREE.Object3D): void {
    const pushDist = 1.2; // РјРµС‚СЂРѕРІ Р·Р° РєР»РёРє
    const yaw = this.yaw;
    const newX = obj.position.x + Math.sin(yaw) * pushDist;
    const newZ = obj.position.z + Math.cos(yaw) * pushDist;
    // РџСЂРѕРІРµСЂРєР° РєРѕР»Р»РёР·РёР№: РЅРµ С‚РѕР»РєР°С‚СЊ СЃРєРІРѕР·СЊ СЃС‚РµРЅС‹
    if (!this.checkCrateCollision(newX, newZ, obj)) {
      obj.position.x = newX;
      obj.position.z = newZ;
      // РћР±РЅРѕРІРёС‚СЊ РєРѕР»Р»Р°Р№РґРµСЂС‹ РІ COLLIDERS
      this.updateCrateCollider(obj, newX, newZ);
    }
  }

  /** РџСЂРѕРІРµСЂРёС‚СЊ, РЅРµ РІСЃС‚Р°Р»РєРёРІР°РµС‚ Р»Рё СЏС‰РёРє РІ СЃС‚РµРЅСѓ/РѕР±СЉРµРєС‚. */
  private checkCrateCollision(x: number, z: number, ignoreObj: THREE.Object3D): boolean {
    const crateR = 0.6;
    for (const c of COLLIDERS) {
      // РёРіРЅРѕСЂРёСЂРѕРІР°С‚СЊ СЃРѕР±СЃС‚РІРµРЅРЅС‹Р№ РєРѕР»Р»Р°Р№РґРµСЂ
      if (Math.abs(c.x - ignoreObj.position.x) < 0.1 && Math.abs(c.z - ignoreObj.position.z) < 0.1) continue;
      if (Math.hypot(x - c.x, z - c.z) < crateR + c.r) return true;
    }
    return false;
  }

  /** РћР±РЅРѕРІРёС‚СЊ РїРѕР·РёС†РёСЋ РєРѕР»Р»Р°Р№РґРµСЂР° СЏС‰РёРєР°. */
  private updateCrateCollider(obj: THREE.Object3D, x: number, z: number): void {
    for (const c of COLLIDERS) {
      if (Math.abs(c.x - obj.position.x) < 0.1 && Math.abs(c.z - obj.position.z) < 0.1) {
        c.x = x; c.z = z; break;
      }
    }
  }

  /** РџРѕРґР¶РµС‡СЊ РєСѓРІС€РёРЅ СЃ РјР°СЃР»РѕРј. */
  private igniteOilJug(obj: THREE.Object3D): void {
    // РџСЂРѕРІРµСЂРєР°: РµСЃС‚СЊ Р»Рё Сѓ РёРіСЂРѕРєР° РѕРіРЅРµРЅРЅС‹Р№ РЅР°РІС‹Рє/РїСЂРµРґРјРµС‚ (СѓРїСЂРѕС‰С‘РЅРЅРѕ: РІСЃРµРіРґР° РїРѕРґР¶РёРіР°РµРј РїСЂРё РєР»РёРєРµ)
    // interactiveState вЂ” СЃРј. РєРѕРјРјРµРЅС‚Р°СЂРёР№ РІ collapseAwning: Р·Р°СЃР»РѕРЅ РїРѕРІС‚РѕСЂРѕРІ.
    obj.userData.state = 'burning';
    obj.userData.interactiveState = 'burning';
    // Р’РёР·СѓР°Р» РіРѕСЂРµРЅРёСЏ: РґРѕР±Р°РІРёС‚СЊ РїР»Р°РјСЏ/РґС‹Рј
    this.addBurningEffect(obj);
    // Р§РµСЂРµР· burnTime СЃРµРєСѓРЅРґ вЂ” РїСЂРµРІСЂР°С‚РёС‚СЊ РІ СЃРіРѕСЂРµРІС€РµРµ
    const burnTime = (obj.userData as any).burnTime ?? 10;
    setTimeout(() => {
      obj.userData.state = 'broken';
      this.removeBurningEffect(obj);
      this.addBrokenEffect(obj);
    }, burnTime * 1000);
  }

  /** Р”РѕР±Р°РІРёС‚СЊ СЌС„С„РµРєС‚ РіРѕСЂРµРЅРёСЏ Рє РєСѓРІС€РёРЅСѓ. */
  private addBurningEffect(obj: THREE.Object3D): void {
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.8, 8),
      M.fire
    );
    fire.position.y = 1.2;
    fire.userData = { isBurningEffect: true };
    obj.add(fire);
    // Р”С‹Рј: РїСЂРѕСЃС‚РѕР№ РјР°С‚РµСЂРёР°Р» РІРјРµСЃС‚Рѕ M.smoke (РЅРµС‚ РІ M)
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0x444444, transparent: true, opacity: 0.6, depthWrite: false
    });
    const smoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.4, 1.5, 8),
      smokeMat
    );
    smoke.position.y = 2.0;
    smoke.userData = { isBurningEffect: true };
    obj.add(smoke);
    // РЎРѕС…СЂР°РЅРёС‚СЊ РјР°С‚РµСЂРёР°Р» РґР»СЏ dispose
    (smoke as any)._smokeMat = smokeMat;
  }

  /** РЈР±СЂР°С‚СЊ СЌС„С„РµРєС‚ РіРѕСЂРµРЅРёСЏ. */
  private removeBurningEffect(obj: THREE.Object3D): void {
    obj.traverse(child => {
      if ((child as THREE.Mesh).userData?.isBurningEffect) {
        obj.remove(child);
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) {
          mat.forEach(m => m.dispose());
        } else if (mat) {
          mat.dispose();
        }
        // РЈРґР°Р»РёС‚СЊ РєР°СЃС‚РѕРјРЅС‹Р№ РјР°С‚РµСЂРёР°Р» РґС‹РјР°
        const smokeMat = (mesh as any)._smokeMat;
        if (smokeMat) smokeMat.dispose();
      }
    });
  }

  /** Р”РѕР±Р°РІРёС‚СЊ СЌС„С„РµРєС‚ СЃРіРѕСЂРµРІС€РµРіРѕ РєСѓРІС€РёРЅР°. */
  private addBrokenEffect(obj: THREE.Object3D): void {
    // РњРѕР¶РЅРѕ РґРѕР±Р°РІРёС‚СЊ РѕР±СѓРіР»РµРЅРЅС‹Р№ РІРёРґ РёР»Рё РѕСЃС‚Р°РІРёС‚СЊ РєР°Рє РµСЃС‚СЊ
    obj.traverse(child => {
      if (child instanceof THREE.Mesh && child.material) {
        (child.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      }
    });
  }

  /** РћР±СЂСѓС€РёС‚СЊ РЅР°РІРµСЃ. */
  private collapseAwning(obj: THREE.Object3D): void {
    // РћР±Р° РїРѕР»СЏ: state вЂ” СЃС‚Р°СЂРѕРµ РёРјСЏ, interactiveState вЂ” С‚Рѕ, С‡С‚Рѕ С‡РёС‚Р°РµС‚
    // РєРѕР»Р±СЌРє Рё Р·Р°СЃР»РѕРЅ РїРѕРІС‚РѕСЂРЅРѕРіРѕ СЃСЂР°Р±Р°С‚С‹РІР°РЅРёСЏ. Р‘РµР· РІС‚РѕСЂРѕРіРѕ РїРѕР»СЏ РѕР±СЂСѓС€РµРЅРЅС‹Р№
    // РЅР°РІРµСЃ РјРѕР¶РЅРѕ Р±С‹Р»Рѕ РѕР±СЂСѓС€Р°С‚СЊ СЃРЅРѕРІР°, РіРѕСЂСЏС‰РёР№ РєСѓРІС€РёРЅ вЂ” РїРѕРґР¶РёРіР°С‚СЊ Р·Р°РЅРѕРІРѕ.
    obj.userData.state = 'collapsed';
    obj.userData.interactiveState = 'collapsed';
    // РђРЅРёРјР°С†РёСЏ РѕР±СЂСѓС€РµРЅРёСЏ: РЅР°РєР»РѕРЅРёС‚СЊ СЃС‚РѕР№РєРё Рё СѓСЂРѕРЅРёС‚СЊ РєСЂС‹С€Сѓ
    this.animateAwningCollapse(obj);
  }

  /** РђРЅРёРјР°С†РёСЏ РѕР±СЂСѓС€РµРЅРёСЏ РЅР°РІРµСЃР°. */
  private animateAwningCollapse(obj: THREE.Object3D): void {
    const posts: THREE.Mesh[] = [];
    const roofRef: { current: THREE.Mesh | null } = { current: null };
    obj.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry as THREE.BufferGeometry;
        if (geo && geo.type === 'CylinderGeometry') posts.push(child);
        else if (geo && geo.type === 'BoxGeometry' && child.position.y > 2) roofRef.current = child;
      }
    });
    // РќР°РєР»РѕРЅРёС‚СЊ СЃС‚РѕР№РєРё
    posts.forEach((post, i) => {
      const targetRot = (i % 2 === 0) ? -0.8 : 0.8;
      // РџСЂРѕСЃС‚Р°СЏ Р°РЅРёРјР°С†РёСЏ Р±РµР· tween: СЃСЂР°Р·Сѓ РЅР°РєР»РѕРЅСЏРµРј
      post.rotation.x = targetRot;
      post.position.y *= 0.5;
    });
    // РЈСЂРѕРЅРёС‚СЊ РєСЂС‹С€Сѓ
    const roof = roofRef.current;
    if (roof) {
      roof.position.y = 0.8;
      roof.rotation.x = 0.3;
      roof.rotation.z = 0.2;
    }
  }

  /** РљР»РёРє РїРѕ РґРІРµСЂРё Р·РґР°РЅРёСЏ: С‚РѕР»СЊРєРѕ РґРµС‚РµРєС‚. РўРµР»РµРїРѕСЂС‚ вЂ” Р»РёС€СЊ РїРѕСЃР»Рµ ACK
   *  СЃРµСЂРІРµСЂР° (РёРЅР°С‡Рµ РїРµСЂРІС‹Р№ РїР°РєРµС‚ РёР· РєР°СЂРјР°РЅР° РѕРїРµСЂРµРґРёС‚ СЃР±СЂРѕСЃ С‚СЂРµРєРёРЅРіР°
   *  Рё Р°РЅС‚РёС‡РёС‚ РєРёРєРЅРµС‚ Р·Р° СЃРїРёРґС…Р°Рє). */
  private pickDoor(): boolean {
    if (!this.me || !this.doorTargets.length) return false;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = ray.intersectObjects(this.doorTargets, false);
    if (!hits.length || hits[0].distance > 22) return false;
    const ud = hits[0].object.userData as { doorBuilding?: string; doorAction?: string; doorName?: string; entranceId?: string; documentSpot?: string; documentName?: string };
    // РЎС‚РѕР» СЃ РґРѕРєСѓРјРµРЅС‚Р°РјРё РїСЂРѕРІРµСЂСЏРµС‚СЃСЏ Р”Рћ РґРІРµСЂРё: Сѓ РЅРµРіРѕ РЅРµС‚ doorBuilding, Рё Р±РµР·
    // СЌС‚РѕР№ РІРµС‚РєРё РєР»РёРє РїРѕ СЃС‚РѕР»Сѓ РїСЂРѕСЃС‚Рѕ РЅРёС‡РµРіРѕ РЅРµ РґРµР»Р°Р» Р±С‹.
    if (ud.documentSpot) {
      this.documentRequested = true;
      return true;
    }
    if (!ud.doorBuilding || (ud.doorAction !== 'enter' && ud.doorAction !== 'exit')) return false;
    this.callbacks?.onDoor?.(ud.doorAction, ud.doorBuilding, ud.doorName ?? ud.doorBuilding, ud.entranceId);
    return true;
  }

  /** РўРµР»РµРїРѕСЂС‚ РІРЅСѓС‚СЂСЊ РІ С‚РѕС‡РєСѓ РѕС‚ СЃРµСЂРІРµСЂР° (РІС‹Р·С‹РІР°С‚СЊ С‚РѕР»СЊРєРѕ РїРѕ ack). */
  /**
   * РЎРѕР±СЂР°С‚СЊ РёРЅС‚РµСЂСЊРµСЂРЅС‹Рµ С†РµР»Рё С‚РµРєСѓС‰РµР№ РєРѕРјРЅР°С‚С‹ Р·Р°РЅРѕРІРѕ. Р Р°РЅСЊС€Рµ СЃРїРёСЃРєРё
   * Р·Р°РїРѕР»РЅСЏР»РёСЃСЊ РѕРґРёРЅ СЂР°Р· РЅР° init (В§320): РїСЂРё РІС‹С…РѕРґРµ РёР· Р·РґР°РЅРёСЏ РѕРЅРё
   * РѕС‡РёС‰Р°Р»РёСЃСЊ Рё Р±РѕР»СЊС€Рµ РЅРµ РІРѕР·РІСЂР°С‰Р°Р»РёСЃСЊ - РІС‚РѕСЂРѕР№ РІРёР·РёС‚ С‚РµСЂСЏР» РєР»РёРєР°Р±РµР»СЊРЅРѕСЃС‚СЊ
   * СЏС‰РёРєРѕРІ, Р° РІРјРµСЃС‚Рµ СЃ РЅРёРјРё Рё Р»РµСЃС‚РЅРёС†. РўРµРїРµСЂСЊ РёСЃС‚РѕС‡РЅРёРє РёСЃС‚РёРЅС‹ - РєРѕРјРЅР°С‚РЅС‹Рµ
   * РјР°СЃСЃРёРІС‹, Рё С†РµР»Рё РїРµСЂРµСЃРѕР±РёСЂР°СЋС‚СЃСЏ РЅР° РєР°Р¶РґРѕРј РІС…РѕРґРµ/РІС‹С…РѕРґРµ.
   */
  private refreshInteriorTargets(): void {
    this.interactiveTargets.length = 0;
    this.climbTargets.length = 0;
    this.destructibleTargets.length = 0;
    if (!this.interiors.isInside()) return;
    const room = this.interiors.rooms.get(String(this.interiors.insideId() ?? ''));
    if (!room) return;
    this.interactiveTargets.push(...room.interactiveTargets);
    this.climbTargets.push(...room.climbTargets);
    this.destructibleTargets.push(...room.destructibleTargets);
  }

  /**
   * Р’РµСЂС…РЅСЏСЏ РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ РјРµР·РѕРЅРёРЅР° РїРѕРґ РЅРѕРіР°РјРё (В§324), РёР»Рё null.
   * feetY РѕС‚СЃРµРєР°РµС‚ РїР»Р°С‚С„РѕСЂРјСѓ, РґРѕ РєРѕС‚РѕСЂРѕР№ РґР°Р»РµРєРѕ СЃРЅРёР·Сѓ: РїРѕРґРїСЂС‹РіРЅСѓРІ СЃ
   * РїРѕР»Р° (1.44 Рј) РґРѕ РїР»Р°С‚С‹ 2.6 Рј РЅРµ РґРѕР»РµС‚Р°РµС€СЊ, С…РѕРґРёС‚СЊ РџРћР” РїР»Р°С‚С„РѕСЂРјРѕР№
   * РјРѕР¶РЅРѕ СЃРІРѕР±РѕРґРЅРѕ, Р° РІРѕС‚ РїР°РґРµРЅРёРµ РЅР° РїР»РёС‚Сѓ Рё С€Р°Рі РїРѕ РЅРµР№ Р·Р°СЃС‡РёС‚С‹РІР°СЋС‚СЃСЏ.
   */
  /**
   * Р’РµСЂС… С†РµР»РѕРіРѕ СЏС‰РёРєР° РїРѕРґ РЅРѕРіР°РјРё (В§385), РёР»Рё null.
   *
   * РџСЂР°РІРёР»Рѕ СЃС‚СѓРїРЅРµР№ С‚Рѕ Р¶Рµ, С‡С‚Рѕ Сѓ РјРµР·РѕРЅРёРЅР°: СЃС‚СѓРїРЅРё РЅР° РІРµСЂС…РЅРµР№ РіСЂР°РЅРё РёР»Рё
   * С‡СѓС‚СЊ РЅРёР¶Рµ - РїСЂС‹РіРЅСѓРІС€РёР№ СЃРЅРёР·Сѓ РѕРїРѕСЂСѓ РЅРµ РїРѕР»СѓС‡Р°РµС‚. РЎР»РѕРјР°РЅРЅС‹Р№ СЏС‰РёРє
   * РѕРїРѕСЂРѕР№ РЅРµ СЃР»СѓР¶РёС‚: РїРѕРґ РЅРѕРіР°РјРё РѕР±Р»РѕРјРєРё, Р° РЅРµ РЅР°СЃС‚РёР». РџРѕР·РёС†РёСЏ Р¶РёРІР°СЏ -
   * С‚РѕР»РєРЅСѓС‚С‹Р№ СЏС‰РёРє СѓРІРѕР·РёС‚ РѕРїРѕСЂСѓ СЃ СЃРѕР±РѕР№.
   */
  private crateTopAt(x: number, z: number, feetY: number): number | null {
    if (!this.interiors.isInside()) return null;
    let РІРµСЂС…: number | null = null;
    for (const obj of this.interactiveTargets) {
      const ud = obj.userData as { kind?: string; state?: string; size?: { w: number; h: number; d: number } };
      if (ud?.kind !== 'crate' || ud.state !== 'intact' || !ud.size) continue;
      const РїРѕР»РЁРёСЂРёРЅС‹ = ud.size.w / 2 + 0.25;
      const РїРѕР»Р“Р»СѓР±РёРЅС‹ = ud.size.d / 2 + 0.25;
      if (Math.abs(x - obj.position.x) > РїРѕР»РЁРёСЂРёРЅС‹ || Math.abs(z - obj.position.z) > РїРѕР»Р“Р»СѓР±РёРЅС‹) continue;
      const РІРµСЂС…РЇС‰РёРєР° = obj.position.y + ud.size.h / 2;
      if (feetY < РІРµСЂС…РЇС‰РёРєР° - 0.55) continue;
      РІРµСЂС… = РІРµСЂС… !== null ? Math.max(РІРµСЂС…, РІРµСЂС…РЇС‰РёРєР°) : РІРµСЂС…РЇС‰РёРєР°;
    }
    return РІРµСЂС…;
  }

  private platformTopAt(x: number, z: number, feetY: number): number | null {
    if (!this.interiors.isInside()) return null;
    const room = this.interiors.rooms.get(String(this.interiors.insideId() ?? ''));
    if (!room || !room.platforms.length) return null;
    let РІРµСЂС…: number | null = null;
    for (const p of room.platforms) {
      if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2 &&
          feetY > p.y - 0.55) {
        РІРµСЂС… = РІРµСЂС… !== null ? Math.max(РІРµСЂС…, p.y) : p.y;
      }
    }
    return РІРµСЂС…;
  }

  enterBuildingAt(id: string, target: { x: number; y: number; z: number }): boolean {
    if (!this.me) return false;
    const def = this.interiors.def(id);
    if (!def) return false;
    this.interiors.enter(id);
    this.refreshInteriorTargets();
    this.weather?.setInside(true);
    this.me.pos.x = target.x;
    this.me.pos.y = target.y;
    this.me.pos.z = target.z;
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** РўРµР»РµРїРѕСЂС‚ РЅР°СЂСѓР¶Сѓ РІ С‚РѕС‡РєСѓ РѕС‚ СЃРµСЂРІРµСЂР° (РІС‹Р·С‹РІР°С‚СЊ С‚РѕР»СЊРєРѕ РїРѕ ack). */
  exitBuildingAt(target: { x: number; y: number; z: number }): boolean {
    if (!this.me || !this.interiors.isInside()) return false;
    const def = this.interiors.insideDef();
    if (!def) return false;
    this.interiors.exit();
    this.weather?.setInside(false);
    this.refreshInteriorTargets();
    this.climb = null;
    this.me.pos.x = target.x;
    this.me.pos.y = target.y;
    this.me.pos.z = target.z;
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** Р›РѕРєР°Р»СЊРЅС‹Р№ РІС‹С…РѕРґ Р±РµР· СЃРµСЂРІРµСЂР°: СЂРµР·РёРЅРѕРІР°СЏ Р»РµРЅС‚Р° РїСЂРё РѕС‚РєР»РѕРЅРµРЅРёРё РґРІРёР¶РµРЅРёСЏ. */  exitBuildingLocal(): boolean {
    if (!this.me || !this.interiors.isInside()) return false;
    const def = this.interiors.insideDef();
    if (!def) return false;
    this.interiors.exit();
    // Р’РѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РїРѕРіРѕРґСѓ РїСЂРё РІС‹С…РѕРґРµ Р»РѕРєР°Р»СЊРЅРѕ (Р±РµР· СЃРµСЂРІРµСЂР°)
    if (!this.interiors.isInside()) this.weather?.setInside(false);
    this.refreshInteriorTargets();
    this.climb = null;
    this.me.pos.x = def.exitX;
    this.me.pos.z = def.exitZ;
    this.me.pos.y = groundHeight(def.exitX, def.exitZ);
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** РџРѕРіРѕРґР° РѕС‚ СЃРµСЂРІРµСЂР° (world:time): РґРѕР¶РґСЊ, РіСЂРѕР·Р°, РїРµСЃС‡Р°РЅР°СЏ Р±СѓСЂСЏ. */
  setWeather(w: string): void {
    this.weather?.setWeather(w);
    this.currentWeather = (w || 'clear') as WeatherKind;
    // РўСѓС‡Рё С‚РѕР¶Рµ РґРѕР»Р¶РЅС‹ Р·РЅР°С‚СЊ Рѕ РїРѕРіРѕРґРµ: СЂР°РЅСЊС€Рµ РЅРµР±Рѕ РІРѕРѕР±С‰Рµ РЅРµ РїРѕР»СѓС‡Р°Р»Рѕ
    // РєРѕРґ РїРѕРіРѕРґС‹, РїРѕСЌС‚РѕРјСѓ РІ РґРѕР¶РґСЊ Рё Р±СѓСЂСЋ РѕР±Р»Р°РєР° РѕСЃС‚Р°РІР°Р»РёСЃСЊ Р±РµР»С‹РјРё
    this.sky?.setWeather((w || 'clear') as WeatherKind);
  }

  isInsideBuilding(): boolean {
    return this.interiors.isInside();
  }

  /** Р’РѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ СЃРѕСЃС‚РѕСЏРЅРёРµ В«РІРЅСѓС‚СЂРёВ» РїРѕ РїРѕР·РёС†РёРё СЃРїР°РІРЅР° (РІС…РѕРґ РІ РјРёСЂ РІ РєР°СЂРјР°РЅРµ).
   *  Р‘РµР· С‚РµР»РµРїРѕСЂС‚Р° Рё Р±РµР· СЃРѕРєРµС‚Р°: СЃРµСЂРІРµСЂ СѓР¶Рµ СЃР±СЂРѕСЃРёР» С‚СЂРµРєРёРЅРі РїСЂРё AUTH.
   *  Р‘РµР· СЌС‚РѕРіРѕ РїРµСЂРІС‹Р№ С€Р°Рі РІ РєРѕРјРЅР°С‚Рµ СѓРїРёСЂР°Р»СЃСЏ РІ РєР»Р°РјРї РіСЂР°РЅРёС† Рё РґР°РІР°Р» РєРёРє. */
  enterBuildingLocalAt(x: number, z: number): string | null {
    if (!this.me) return null;
    const def = BUILDINGS.find((b) =>
      Math.abs(x - b.roomCx) <= 16 && Math.abs(z - b.roomCz) <= 16) ?? null;
    if (!def) return null;
    this.interiors.enter(def.id);
    this.refreshInteriorTargets();
    return t(def.nameKey);
  }

  /**
   * РџРѕРґРјРµРЅСЏРµС‚ РїСЂРѕС†РµРґСѓСЂРЅС‹Р№ СЂРёРі РёРіСЂРѕРєР° РЅР°СЃС‚РѕСЏС‰РµР№ РјРѕРґРµР»СЊСЋ, РєРѕРіРґР° РѕРЅР° РґРѕС€Р»Р°.
   *
   * РџРѕСЂСЏРґРѕРє РІР°Р¶РµРЅ: СЃРЅР°С‡Р°Р»Р° РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РїСЂРѕС†РµРґСѓСЂРЅС‹Р№ СЃРёР»СѓСЌС‚, Рё С‚РѕР»СЊРєРѕ РїРѕС‚РѕРј РѕРЅ
   * РјРµРЅСЏРµС‚СЃСЏ РЅР° РјРѕРґРµР»СЊ. РћР±СЂР°С‚РЅС‹Р№ РїРѕСЂСЏРґРѕРє РѕР·РЅР°С‡Р°Р» Р±С‹ РїСѓСЃС‚РѕС‚Сѓ РЅР° РјРµСЃС‚Рµ РёРіСЂРѕРєР° РІСЃС‘ С‚Рѕ
   * РІСЂРµРјСЏ, РїРѕРєР° РёРґС‘С‚ Р·Р°РіСЂСѓР·РєР° С„Р°Р№Р»Р°. РџРѕРґРјРµРЅР° СЃРѕС…СЂР°РЅСЏРµС‚ РїРѕР·РёС†РёСЋ, РїРѕРІРѕСЂРѕС‚ Рё
   * РІРёРґРёРјРѕСЃС‚СЊ, Р° РЅР°РґРµС‚РѕРµ СЃРЅР°СЂСЏР¶РµРЅРёРµ РїРµСЂРµРЅРѕСЃРёС‚СЃСЏ РЅР° РЅРѕРІС‹Р№ СЂРёРі: СЃР»РѕС‚С‹ С‚Рµ Р¶Рµ.
   */
  private upgradeToRealModel(id: string, charClass: string): void {
    const b = this.rigs.get(id);
    if (!b || b.realModelTried) return;
    b.realModelTried = true;
    void loadRealPlayerRig(charClass).then((real) => {
      const cur = this.rigs.get(id);
      if (!real || !cur || cur.kind !== 'player') {
        // РњРѕРґРµР»СЊ РЅРµ РїСЂРёС€Р»Р°: РѕСЃС‚Р°С‘РјСЃСЏ РЅР° РїР°Р»РѕС‡РєР°С…, Рё РѕС‚РјРµС‚РєСѓ СЃР±СЂР°СЃС‹РІР°РµРј, С‡С‚РѕР±С‹
        // РїРѕРїС‹С‚РєР° РјРѕРіР»Р° РїРѕРІС‚РѕСЂРёС‚СЊСЃСЏ вЂ” РЅР°РїСЂРёРјРµСЂ, РїРѕСЃР»Рµ СЃРјРµРЅС‹ РєР»Р°СЃСЃР°.
        if (cur && !real) cur.realModelTried = false;
        // Р—РђРњР•Р . РњРѕР»С‡Р°Р»РёРІС‹Р№ РѕС‚РєР°Р· вЂ” РїРѕР»РѕРІРёРЅР° РґРёР°РіРЅРѕСЃС‚РёРєРё: РїРѕ СЌРєСЂР°РЅСѓ РЅРµ РІРёРґРЅРѕ,
        // СЂРёСЃСѓРµС‚СЃСЏ РїСЂРѕС†РµРґСѓСЂРЅС‹Р№ СЃРёР»СѓСЌС‚ РёР»Рё РЅР°СЃС‚РѕСЏС‰Р°СЏ РјРѕРґРµР»СЊ. РћРґРЅР° СЃС‚СЂРѕРєР° РІ
        // РєРѕРЅСЃРѕР»СЊ РѕС‚РІРµС‡Р°РµС‚ РЅР° РІРѕРїСЂРѕСЃ, РєРѕС‚РѕСЂС‹Р№ РёРЅР°С‡Рµ РїСЂРёС…РѕРґРёС‚СЃСЏ СЂРµС€Р°С‚СЊ РїРѕ
        // РґРѕРіР°РґРєР°Рј (СЃРј. В§139-142).
        console.info(`[rig] player ${id}: real model NOT applied - procedural silhouette shown`);
        return;
      }
      const РїСЂРµР¶РЅРёР№ = cur.rig;
      real.group.position.copy(РїСЂРµР¶РЅРёР№.group.position);
      real.group.rotation.copy(РїСЂРµР¶РЅРёР№.group.rotation);
      real.group.visible = РїСЂРµР¶РЅРёР№.group.visible;
      real.group.userData.playerId = id;
      РїСЂРµР¶РЅРёР№.group.removeFromParent();
      РїСЂРµР¶РЅРёР№.dispose();
      this.safavidEquipment3D?.dispose();
      this.safavidEquipment3D = null;
      this.scene.add(real.group);
      cur.rig = real;
      // Р’С‚РѕСЂРѕР№ Р·Р°РјРµСЂ: РЅРµ В«РјРѕРґРµР»СЊ РїСЂРёС€Р»Р°В», Р° РљРђРљРћР“Рћ Р РђР—РњР•Р Рђ РѕРЅР° РІСЃС‚Р°Р»Р°.
      //
      // Р§РёСЃР»Рѕ РїРѕСЃР»Рµ add вЂ” СѓР¶Рµ СЃ СѓС‡С‘С‚РѕРј РІСЃРµС… РѕР±С‘СЂС‚РѕРє, РјР°СЃС€С‚Р°Р±РѕРІ РїРѕРґРіРѕРЅРєРё Рё
      // РїРѕРІРѕСЂРѕС‚Р°, С‚Рѕ РµСЃС‚СЊ СЂРѕРІРЅРѕ С‚Рѕ, С‡С‚Рѕ РІРёРґРЅРѕ РЅР° СЌРєСЂР°РЅРµ.
      //
      // Р’Р·СЏС‚Рѕ РќР• С‡РµСЂРµР· Box3.setFromObject(): С‚РѕС‚ Р±РµСЂС‘С‚ geometry.boundingBox,
      // С‚Рѕ РµСЃС‚СЊ РїРѕР·Сѓ РїРѕРєРѕСЏ, Рё РѕС‚РґР°С‘С‚ С‡РёСЃР»Рѕ, РЅРµ РїРѕС…РѕР¶РµРµ РЅРё РЅР° С‡С‚Рѕ РІРёРґРёРјРѕРµ.
      // РРјРµРЅРЅРѕ СЌС‚РёРј Р·Р°РјРµСЂРѕРј РїСЏС‚СЊ РіРёРїРѕС‚РµР· РїРѕРґСЂСЏРґ РґРѕРєР°Р·С‹РІР°Р»Рё, С‡С‚Рѕ С„РёРіСѓСЂР° СЂРёСЃСѓРµС‚СЃСЏ
      // РЅРµРїСЂР°РІРёР»СЊРЅРѕ, Рё С‚СЂРёР¶РґС‹ РїСЂРµРґР»Р°РіР°Р»Рё С‡РёРЅРёС‚СЊ РЅРµ С‚Рѕ. Р—РґРµСЃСЊ вЂ” РЅР°СЃС‚РѕСЏС‰РёР№ СЂРѕСЃС‚
      // РІ РїРѕР·Рµ, С‚РµРј Р¶Рµ СЃРїРѕСЃРѕР±РѕРј, С‡С‚Рѕ Рё РІ РїРѕРґРіРѕРЅРєРµ.
      console.info(
        `[rig] player ${id}: real model applied, ` +
          `height=${СЂРѕСЃС‚РџРѕР·С‹(real.group).toFixed(4)} ` +
          `groupScale=${real.group.scale.x.toFixed(4)} ` +
          `sceneChildren=${real.group.children.length}`,
      );
      if (id === this.me?.id) {
        // Р’РёРґ РѕСЂСѓР¶РёСЏ вЂ” РїРѕ РєР»Р°СЃСЃСѓ (РїРѕСЃРѕС… РјРёСЃС‚РёРєР° вЂ” РЅР°СЃС‚РѕСЏС‰РµР№ РјРѕРґРµР»СЊСЋ, РѕСЃС‚Р°Р»СЊРЅС‹Рµ
        // РїСЂРѕС†РµРґСѓСЂРЅС‹Рµ). РЎС‚Р°РІРёС‚СЃСЏ РґРѕ equipWeapon: РёРЅР°С‡Рµ РїРѕСЃС‚СЂРѕРёС‚СЃСЏ РјРµС‡.
        real.setWeaponKind(CLASS_WEAPON[charClass] ?? 'sword');
        if (this.localGear) {
          real.equipWeapon(this.localGear.weapon);
          real.setArmorTint(this.localGear.armorColor);
        } else {
          // РњРёСЃС‚РёРє СЃ РІРёРґРёРјС‹Рј РїРѕСЃРѕС…РѕРј: РїСЂСЏС‚Р°Р»Рё РїСЂРѕС†РµРґСѓСЂРЅС‹Р№, РЅР°СЃС‚РѕСЏС‰РёР№ РїРѕРєР°Р·С‹РІР°СЋС‚.
          real.equipWeapon(true);
        }
        real.equipShield(charClass === 'qizilbash');

        // 3D-СЌРєРёРїРёСЂРѕРІРєР° РЎРµС„РµРІРёРґРѕРІ: РїСЂРёРІСЏР·РєР° Рє РєРѕСЃС‚СЏРј (РѕСЂСѓР¶РёРµ РІ СЂСѓРєРµ, С€Р»РµРј РЅР° РіРѕР»РѕРІСѓ,
        // С…Р°Р»Р°С‚ Рё РїР»Р°С‰ РЅР° С‚РµР»Рѕ). РЎРѕР·РґР°С‘С‚СЃСЏ РѕРґРёРЅ СЂР°Р· РЅР° РјРѕРґРµР»СЊ.
        this.safavidEquipment3D = new SafavidEquipment3D(real.group);
        if (this.localGear) {
          void this.safavidEquipment3D.apply(this.localGear);
        }
      }
    });
  }

  // в”Ђв”Ђ РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ СЂРёРіРѕРІ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  private syncRigs(): void {
    if (!this.entities) return;
    const seen = new Set<string>();

    for (const [id, p] of this.entities.players) {
      seen.add(id);
      let b = this.rigs.get(id);
      if (!b) {
        b = { rig: buildPlayerRig(p.charClass), kind: 'player' };
        b.rig.group.userData.playerId = id;
        this.scene.add(b.rig.group);
        this.rigs.set(id, b);
        // РќР°СЃС‚РѕСЏС‰Р°СЏ РјРѕРґРµР»СЊ РїРѕРґСЃС‚Р°РІР»СЏРµС‚СЃСЏ РїРѕР·Р¶Рµ Рё С‚РѕР»СЊРєРѕ СЃРІРѕРµРјСѓ РёРіСЂРѕРєСѓ: РѕСЃС‚Р°Р»СЊРЅС‹Рј
        // РёРіСЂРѕРєР°Рј РѕРЅР° РїРѕРєР° РЅРµ РЅСѓР¶РЅР°, Р° С‚РѕР»РїРµ С‚РµРј Р±РѕР»РµРµ.
        if (id === this.me?.id) this.upgradeToRealModel(id, p.charClass);
      }
      // РЎРІРѕР№ РїРµСЂСЃРѕРЅР°Р¶: РІРёРґ вЂ” РёР· РЅР°РґРµС‚РѕРіРѕ, Р° РЅРµ РёР· РєР»Р°СЃСЃР°. РџСЂРёРјРµРЅСЏРµРј РЅР° РєР°Р¶РґРѕРј
      // РїСЂРѕС…РѕРґРµ, Р° РЅРµ С‚РѕР»СЊРєРѕ РїСЂРё СЃРѕР·РґР°РЅРёРё СЂРёРіР°: РёРіСЂРѕРє РЅР°РґРµРІР°РµС‚ Рё СЃРЅРёРјР°РµС‚
      // РІРµС‰Рё РЅР° С…РѕРґСѓ, Рё Р±РµР· СЌС‚РѕРіРѕ СЂРёРі РѕР±РЅРѕРІР»СЏР»СЃСЏ Р±С‹ С‚РѕР»СЊРєРѕ РїСЂРё РІС…РѕРґРµ РІ РёРіСЂСѓ
      if (id === this.me?.id) {
        // Р’РёРґ РѕСЂСѓР¶РёСЏ вЂ” РїРѕ РєР»Р°СЃСЃСѓ, РєР°Рє РїСЂРё СЃРѕР·РґР°РЅРёРё СЂРёРіР° РІС‹С€Рµ.
        b.rig.setWeaponKind?.(CLASS_WEAPON[p.charClass] ?? 'sword');
        if (this.localGear) {
          b.rig.equipWeapon(this.localGear.weapon);
          b.rig.setArmorTint(this.localGear.armorColor);
        } else {
          // Р­РєРёРїРёСЂРѕРІРєР° РµС‰С‘ РЅРµ РїСЂРёС€Р»Р° СЃ СЃРµСЂРІРµСЂР°: РїРѕРєР°Р·С‹РІР°РµРј С‚Рѕ, С‡С‚Рѕ РґР°С‘С‚ РєР»Р°СЃСЃ
          b.rig.equipWeapon(true);
        }
        // Р©РёС‚ РєР»Р°СЃСЃРѕРІС‹Р№: СЃР»РѕС‚Р° С‰РёС‚Р° РІ РёРіСЂРµ РЅРµС‚ (weapon, armor, accessory)
        b.rig.equipShield(p.charClass === 'qizilbash');
      }
      // Р’С‹СЃРѕС‚Р° С‚РµР»Р° вЂ” РёР· Р»РѕРіРёС‡РµСЃРєРѕР№ РїРѕР·РёС†РёРё (РјРѕСЃС‚С‹, РїР»Р°РІР°РЅРёРµ, РёРЅС‚РµСЂСЊРµСЂС‹),
      // Р° РЅРµ РёР· Р»Р°РЅРґС€Р°С„С‚Р°: РёРЅР°С‡Рµ С‚РµР»Рѕ В«СѓР»РµС‚Р°РµС‚В» РЅР° РіРѕСЂС‹ РІ РєР°СЂРјР°РЅРµ
      // Рё В«С‚РѕРЅРµС‚В» РЅР° РґРЅРµ РІ РІРѕРґРµ.
      // Р”Р»СЏ Р»РѕРєР°Р»СЊРЅРѕРіРѕ РёРіСЂРѕРєР° Р±РµСЂС‘Рј this.feetY вЂ” СЂРµР·СѓР»СЊС‚Р°С‚ С„РёР·РёРєРё С‚РµРєСѓС‰РµРіРѕ
      // РєР°РґСЂР° (РїР»Р°РІР°РЅРёРµ РґРµСЂР¶РёС‚ РЅР° РїРѕРІРµСЂС…РЅРѕСЃС‚Рё, РІРЅСѓС‚СЂРё Р·РґР°РЅРёСЏ вЂ” РїРѕР» РєРѕРјРЅР°С‚С‹).
      // Р”Р»СЏ РѕСЃС‚Р°Р»СЊРЅС‹С… вЂ” РїРѕР·РёС†РёСЋ, РїСЂРёС€РµРґС€СѓСЋ РїРѕ СЃРѕРєРµС‚Сѓ.
      const py = id === this.me?.id
        ? (Number.isFinite(this.feetY) ? this.feetY : groundHeight(p.pos.x, p.pos.z))
        : (Number.isFinite(p.pos.y) ? p.pos.y : groundHeight(p.pos.x, p.pos.z));
      b.rig.group.position.set(p.pos.x, py, p.pos.z);
    }

    for (const [id, m] of this.entities.monsters) {
      seen.add(id);
      let b = this.rigs.get(id);
      if (!b) {
        b = { rig: buildMonsterRig(m.monsterId), kind: 'monster' };
        b.rig.group.userData.monsterId = id;
        this.scene.add(b.rig.group);
        this.rigs.set(id, b);
        // РџСЂРѕС†РµРґСѓСЂРЅС‹Р№ СЂРёРі СЃС‚РѕРёС‚ СЃСЂР°Р·Сѓ, РЅР°СЃС‚РѕСЏС‰Р°СЏ РјРѕРґРµР»СЊ РµРґРµС‚ СЃР»РµРґРѕРј: РїСЂРёС€Р»Р° вЂ”
        // РїРѕРґРјРµРЅСЏРµРј, РЅРµС‚ вЂ” РѕСЃС‚Р°С‘С‚СЃСЏ РїСЂРѕС†РµРґСѓСЂРЅР°СЏ. РўРѕ Р¶Рµ, С‡С‚Рѕ upgradeToRealModel
        // Сѓ РёРіСЂРѕРєР°, С‚РѕР»СЊРєРѕ РїРѕ СЂРµРµСЃС‚СЂСѓ РјРѕРЅСЃС‚СЂРѕРІ.
        this.upgradeMonsterToRealModel(id, m.monsterId, b);
      }
      // РџРѕРґРІРѕРґРЅРѕРµ Р»Рё? Р¤Р»Р°Рі Рё РІС‹СЃРѕС‚Сѓ РЅР°Рґ РІРѕРґРѕР№ С€Р»С‘С‚ СЃРµСЂРІРµСЂ РїСЂРё СЃРїР°РІРЅРµ вЂ”
      // СЃРїРёСЃРѕРє СЃСѓС‰РµСЃС‚РІ РјРµРЅСЏРµС‚СЃСЏ, РєР»РёРµРЅС‚Сѓ Рѕ РЅС‘Рј Р·РЅР°С‚СЊ РЅРµ РЅСѓР¶РЅРѕ.
      if (m.aquatic) {
        b.aquatic = true;
        b.aquaticLift = m.aquaticSize ?? 0.25;
      }
      // Р–РёРІРѕР№ РјРѕРЅСЃС‚СЂ РЅРµ СѓС…РѕРґРёС‚ РїРѕРґ РІРѕРґСѓ: СЂР°РЅСЊС€Рµ С‚РµР»Рѕ СЃС‚Р°РІРёР»РѕСЃСЊ РїСЂСЏРјРѕ РЅР° РґРЅРѕ
      // (Сѓ РѕР·РµСЂР° РѕРЅРѕ РЅР° 3.2 Рј РЅРёР¶Рµ РїРѕРІРµСЂС…РЅРѕСЃС‚Рё) Рё СЂР°Р·Р±РѕР№РЅРёРє В«С‚РѕРЅСѓР»В», РѕСЃС‚Р°РІР°СЏСЃСЊ
      // РїРѕРґ РІРѕРґРѕР№. РўРµРїРµСЂСЊ РЅР° РіР»СѓР±РёРЅРµ РѕРЅ РґРµСЂР¶РёС‚СЃСЏ Сѓ РїРѕРІРµСЂС…РЅРѕСЃС‚Рё Рё РїР»С‹РІС‘С‚,
      // РЅР° РјРµР»РєРѕРІРѕРґСЊРµ РёРґС‘С‚ РїРѕ РґРЅСѓ вЂ” С‚Р°Рє Р¶Рµ, РєР°Рє СѓР¶Рµ СЃРґРµР»Р°РЅРѕ РґР»СЏ С„Р°СѓРЅС‹.
      const gy = groundHeight(m.pos.x, m.pos.z);
      const surf = waterSurfaceY(m.pos.x, m.pos.z);
      const mDepth = !m.deadAt && surf !== null ? surf - gy : 0;
      const swimM = mDepth > SWIM_MIN_DEPTH;
      b.monsterSwim = swimM;
      // РџРѕРґРІРѕРґРЅРѕРµ СЃСѓС‰РµСЃС‚РІРѕ С‚РѕСЂС‡РёС‚ РёР· РІРѕРґС‹, Р° РЅРµ РІРёСЃРёС‚ РїРѕРґ РЅРµР№: РёРіСЂРѕРє РґРѕР»Р¶РµРЅ
      // РІРёРґРµС‚СЊ, С‡С‚Рѕ РІ РѕР·РµСЂРµ С‡С‚Рѕ-С‚Рѕ РµСЃС‚СЊ, Рё РїРѕРґРїР»С‹РІР°С‚СЊ Рє РЅРµРјСѓ РЅР° РѕСЃРѕР·РЅР°РЅРЅРѕРј
      // СЂРёСЃРєРµ. РЎРїРёРЅР° РЅР°Рґ РІРѕРґРѕР№ вЂ” РєР°Рє Сѓ РЅР°СЃС‚РѕСЏС‰РµР№ СЂС‹Р±С‹.
      const aquaticM = b.aquatic === true;
      const y = swimM && surf !== null
        ? (aquaticM ? surf + (b.aquaticLift ?? 0) : surf - SWIM_FEET)
        : gy;
      b.rig.group.position.set(m.pos.x, y, m.pos.z);
      // РџРѕРІРѕСЂРѕС‚ Рє РЅР°РїСЂР°РІР»РµРЅРёСЋ РґРІРёР¶РµРЅРёСЏ
      const dx = m.target.x - m.pos.x, dz = m.target.z - m.pos.z;
      if (Math.hypot(dx, dz) > 0.1) {
        const want = Math.atan2(dx, dz);
        b.rig.group.rotation.y += shortestAngle(want - b.rig.group.rotation.y) * 0.12;
      }
    }

    // РЈРґР°Р»С‘РЅРЅС‹Рµ СЃСѓС‰РЅРѕСЃС‚Рё
    for (const [id, b] of this.rigs) {
      if (!seen.has(id)) {
        this.scene.remove(b.rig.group);
        b.rig.dispose();
        this.rigs.delete(id);
      }
    }
  }

  /**
   * РџРѕРґРјРµРЅСЏРµС‚ РїСЂРѕС†РµРґСѓСЂРЅС‹Р№ СЂРёРі РјРѕРЅСЃС‚СЂР° РЅР°СЃС‚РѕСЏС‰РµР№ РјРѕРґРµР»СЊСЋ, РєРѕРіРґР° С‚Р° РґРѕРµС…Р°Р»Р°.
   *
   * РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РѕСЃС‚Р°С‘С‚СЃСЏ СЃРёРЅС…СЂРѕРЅРЅРѕР№: Р¶РґР°С‚СЊ РјРѕРґРµР»СЊ РІ РїСЂРѕС…РѕРґРµ РєР°РґСЂР° РЅРµР»СЊР·СЏ вЂ”
   * СЂРёРі РїРѕСЏРІР»СЏР»СЃСЏ Р±С‹ РєР°РґСЂР°РјРё РїРѕР·Р¶Рµ Рё РјРѕРі Р·Р°РґРІРѕРёС‚СЊСЃСЏ. РџРѕРєР° С„Р°Р№Р» РµРґРµС‚, РјРѕРЅСЃС‚СЂ
   * С…РѕРґРёС‚ РЅР° РїСЂРѕС†РµРґСѓСЂРЅРѕР№ СЃР±РѕСЂРєРµ; РїРѕСЃР»Рµ РїРѕРґРјРµРЅС‹ Р°РЅРёРјР°С†РёРё (С€Р°Рі, Р±РµРі, СЃРјРµСЂС‚СЊ)
   * РІРµРґС‘С‚ СѓР¶Рµ RealRig СЃ С‚РµРј Р¶Рµ РёРЅС‚РµСЂС„РµР№СЃРѕРј. РћСЂСѓР¶РёРµ Сѓ РјРѕРґРµР»Рё СЃС‚Р°РІРёС‚СЃСЏ
   * РїСЂРѕС†РµРґСѓСЂРЅС‹Рј вЂ” С‚РµРј Р¶Рµ, С‡С‚Рѕ РЅРѕСЃРёР» СЂРёРі.
   */
  private upgradeMonsterToRealModel(id: string, monsterId: string, b: BoundRig): void {
    b.realModelTried = true;
    void loadRealMonsterRig(monsterId).then((real) => {
      // РњРѕРЅСЃС‚СЂ РјРѕРі СѓРјРµСЂРµС‚СЊ Рё РІС‹С‡РёСЃС‚РёС‚СЊСЃСЏ, РїРѕРєР° РјРѕРґРµР»СЊ РіСЂСѓР·РёР»Р°СЃСЊ: С‚РѕРіРґР°
      // РїРѕРґРјРµРЅСЏС‚СЊ РЅРµС‡РµРіРѕ, РЅРѕРІС‹Р№ СЂРёРі (РµСЃР»Рё РїРѕСЏРІРёР»СЃСЏ) СѓР¶Рµ Р·Р°РїСЂРѕСЃРёС‚ СЃРІРѕС‘.
      if (!real || this.rigs.get(id) !== b) return;
      real.group.userData.monsterId = id;
      real.equipWeapon(true);
      const parent = b.rig.group.parent;
      b.rig.dispose();
      if (parent) parent.add(real.group);
      b.rig = real;
    });
  }

  // в”Ђв”Ђ FX: РїР»Р°РІР°СЋС‰РёР№ СѓСЂРѕРЅ Рё СЌС„С„РµРєС‚С‹ РёР· entities.World в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  private syncFx(now: number): void {
    if (!this.entities) return;
    // РќРѕРІС‹Рµ С„Р»РѕР°С‚РµСЂС‹ -> DOM-СЌР»РµРјРµРЅС‚С‹, РїСЂРѕРµС†РёСЂСѓРµРјС‹Рµ РёР· 3D.
    // РЎРІРµСЂСЏРµРјСЃСЏ РїРѕ РїРѕСЂСЏРґРєРѕРІРѕРјСѓ РЅРѕРјРµСЂСѓ (f.seq), Р° РЅРµ РїРѕ РёРЅРґРµРєСЃСѓ РІ РјР°СЃСЃРёРІРµ:
    // РјР°СЃСЃРёРІ СѓРєРѕСЂР°С‡РёРІР°РµС‚СЃСЏ СЃ РЅР°С‡Р°Р»Р°, РёРЅРґРµРєСЃ Р±С‹ РЅР°РјРµСЂС‚РІРѕ В«Р·Р°Р»РёРїР°Р»В» Р·Р° РґР»РёРЅРѕР№
    // Рё С†РёС„СЂС‹ СѓСЂРѕРЅР° РїСЂРѕРїР°РґР°Р»Рё Р±С‹ С‡РµСЂРµР· РїР°СЂСѓ СЃРµРєСѓРЅРґ Р±РѕСЏ.
    const fl = this.entities.floaters;
    for (const f of fl) {
      if (f.seq <= this.lastFx.floater) continue;
      this.lastFx.floater = f.seq;
      const el = document.createElement('div');
      el.className = 'floater3d' + (f.crit ? ' crit' : '');
      el.textContent = f.text;
      el.style.color = f.color;
      el.dataset.born = String(f.born);
      el.dataset.x = String(f.x);
      el.dataset.z = String(f.y); // 2D-РєРѕРЅРІРµРЅС†РёСЏ: floater.y С…СЂР°РЅРёС‚ РєРѕРѕСЂРґРёРЅР°С‚Сѓ z
      this.fxLayer.appendChild(el);
      setTimeout(() => el.remove(), 1150);
    }

    // РќРѕРІС‹Рµ СЌС„С„РµРєС‚С‹ -> С‡Р°СЃС‚РёС†С‹ (2D-РєРѕРЅРІРµРЅС†РёСЏ: y С…СЂР°РЅРёС‚ РєРѕРѕСЂРґРёРЅР°С‚Сѓ z)
    const ef = this.entities.effects;
    for (const e of ef) {
      if (e.seq <= this.lastFx.effect) continue;
      this.lastFx.effect = e.seq;
      if (e.kind === 'heal') this.burst(e.x2, e.y2, 0x6ecf7a, 10);
      else this.burst(e.x2, e.y2, e.kind === 'slash' ? 0xf4d26c : 0xe07a4a, 8);
    }

    // РџРѕР·РёС†РёРё С„Р»РѕР°С‚РµСЂРѕРІ
    for (const el of Array.from(this.fxLayer.children) as HTMLElement[]) {
      const age = (now - Number(el.dataset.born)) / 1100;
      const x = Number(el.dataset.x), z = Number(el.dataset.z);
      const p = new THREE.Vector3(x, groundHeight(x, z) + 2.1 + age * 1.1, z).project(this.camera);
      el.style.transform = `translate(-50%,-50%) translate(${(p.x * 0.5 + 0.5) * this.container.clientWidth}px, ${(-p.y * 0.5 + 0.5) * this.container.clientHeight}px)`;
      el.style.opacity = String(1 - age);
    }
  }

  private burst(x: number, z: number, color: number, count: number): void {
    const y = groundHeight(x, z) + 1.3;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const geo = new THREE.SphereGeometry(0.09, 6, 6);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(geo, mat.clone());
      p.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 2 + Math.random() * 2.5, Math.sin(a) * (1 + Math.random() * 2));
      this.scene.add(p);
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / 420;
        if (t >= 1) { this.scene.remove(p); return; }
        v.y -= 9 * 0.016;
        p.position.addScaledVector(v, 0.016);
        (p.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        requestAnimationFrame(tick);
      };
      tick();
    }
  }

  /** РџСѓР·С‹СЂС‘Рє РїСЂРё РїР»Р°РІР°РЅРёРё: РјР°Р»РµРЅСЊРєР°СЏ РїРѕР»СѓРїСЂРѕР·СЂР°С‡РЅР°СЏ СЃС„РµСЂР°, РІСЃРїР»С‹РІР°РµС‚ Рё РёСЃС‡РµР·Р°РµС‚ */
  private spawnBubble(x: number, y: number, z: number): void {
    const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.06, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xccddff, transparent: true, opacity: 0.5 });
    const b = new THREE.Mesh(geo, mat);
    b.position.set(x + (Math.random() - 0.5) * 0.8, y - 0.2, z + (Math.random() - 0.5) * 0.8);
    this.scene.add(b);
    const start = performance.now();
    const vy = 1.5 + Math.random();
    const vx = (Math.random() - 0.5) * 0.4;
    const vz = (Math.random() - 0.5) * 0.4;
    const tick = () => {
      const t = (performance.now() - start) / 900;
      if (t >= 1) { this.scene.remove(b); b.geometry.dispose(); return; }
      b.position.x += vx * 0.016;
      b.position.y += vy * 0.016;
      b.position.z += vz * 0.016;
      b.scale.setScalar(1 + t * 0.5);
      mat.opacity = 0.5 * (1 - t);
      requestAnimationFrame(tick);
    };
    tick();
  }

  /** Р’С‹С‚Р°Р»РєРёРІР°РµС‚ С‚РѕС‡РєСѓ РёР· С†РёР»РёРЅРґСЂРёС‡РµСЃРєРёС… РєРѕР»Р»Р°Р№РґРµСЂРѕРІ РїРѕСЃС‚СЂРѕРµРє (РїСЂРѕС…РѕРґС‹ вЂ” РґР»СЏ СѓРіР»РѕРІ) */
  /**
   * РџРѕРґСЃРєР°Р·РєР° РѕРєСЂСѓР¶РµРЅРёСЏ (В§370): С‡С‚Рѕ РїРѕРґ РїСЂРёС†РµР»РѕРј Рё С‡С‚Рѕ СЃ РЅРёРј РјРѕР¶РЅРѕ РґРµР»Р°С‚СЊ.
   *
   * Р›СѓС‡ С‚РѕС‚ Р¶Рµ, С‡С‚Рѕ Сѓ РєР»РёРєР° (С†РµРЅС‚СЂ СЌРєСЂР°РЅР°), РЅРѕ РґРёСЃС‚Р°РЅС†РёСЏ РґР°Р»СЊС€Рµ вЂ” СѓРІРёРґРµС‚СЊ
   * РјРѕР¶РЅРѕ СЂР°РЅСЊС€Рµ, С‡РµРј РґРѕС‚СЏРЅСѓС‚СЊСЃСЏ. РЎРєСЂС‹С‚С‹Р№/СѓР¶Рµ РЅРµ intact РѕР±СЉРµРєС‚ РїРѕРґСЃРєР°Р·РєРё
   * РЅРµ РґР°С‘С‚: СЃР»РѕРјР°РЅРЅРѕРµ РЅРµ РјР°РЅРёРїСѓР»РёСЂСѓСЋС‚. РўРµРєСЃС‚ вЂ” С‡РµСЂРµР· onInteractiveHint:
   * РґРІРёР¶РѕРє РЅРµ Р·РЅР°РµС‚ РїРµСЂРµРІРѕРґРѕРІ, СЃС‚СЂРѕРєСѓ РґР°С‘С‚ РјРёСЂ (РєР°Рє tOr РґР»СЏ РґР°РЅРЅС‹С…).
   */
  private updateEnvHint(): void {
    const el = this.envHintEl;
    if (!el) return;
    let kind: string | null = null;
    if (this.me && this.interactiveTargets.length) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
      const hits = ray.intersectObjects(this.interactiveTargets, true);
      const hit = hits[0];
      if (hit && hit.distance <= 26) {
        let target: THREE.Object3D | null = hit.object;
        while (target && !(target.userData as { interactiveKind?: string })?.interactiveKind) {
          target = target.parent;
        }
        const ud = target?.userData as { interactiveKind?: string; interactiveState?: string } | undefined;
        if (ud?.interactiveKind && (ud.interactiveState ?? 'intact') === 'intact') {
          kind = ud.interactiveKind;
        }
      }
    }
    if (kind === this.envHintKind) return;
    this.envHintKind = kind;
    if (!kind) {
      el.classList.add('hidden');
      return;
    }
    el.textContent = this.callbacks?.onInteractiveHint?.(kind) ?? '';
    el.classList.toggle('hidden', !el.textContent);
  }

  /** РљР°РєРѕР№ РІРёРґ РѕРєСЂСѓР¶РµРЅРёСЏ СЃРµР№С‡Р°СЃ РїРѕРґ РїСЂРёС†РµР»РѕРј (РґР»СЏ РіР°С€РµРЅРёСЏ РїРѕРІС‚РѕСЂРЅС‹С… РєР°РґСЂРѕРІ) */
  private envHintKind: string | null = null;

  /**
   * РџСЂРѕРІРµСЂРєР° С‚РѕС‡РєРё РЅР° В«РІРЅСѓС‚СЂРё РїСЂРµРїСЏС‚СЃС‚РІРёСЏВ» РґР»СЏ Р»СѓС‡Р° РєР°РјРµСЂС‹ (В§369).
   *
   * РўРѕР»СЊРєРѕ СЃС‚Р°С‚РёС‡РЅС‹Рµ СЃС‚РµРЅС‹: Р·РІРµСЂРё Рё РіРѕСЂРѕР¶Р°РЅРµ РґРІРёР¶СѓС‚СЃСЏ, Рё РєР°РјРµСЂР°, РґС‘СЂРіР°СЋС‰Р°СЏСЃСЏ
   * РѕС‚ РєР°Р¶РґРѕРіРѕ РїСЂРѕС…РѕР¶РµРіРѕ, Р±С‹Р»Р° Р±С‹ С…СѓР¶Рµ СЃС‚РµРЅС‹. РљР РЈР“Р›Р«Р• РєРѕР»Р»Р°Р№РґРµСЂС‹ вЂ” СЃС‚РµРЅС‹
   * РІРµСЂС‚РёРєР°Р»СЊРЅС‹, Р»СѓС‡ РІ РіРѕСЂРёР·РѕРЅС‚Р°Р»СЊРЅРѕР№ РїР»РѕСЃРєРѕСЃС‚Рё С‡РµСЃС‚РµРЅ.
   */
  private РєР°РјРµСЂР°Р—Р°РєСЂС‹С‚Р°(x: number, z: number): boolean {
    const СЃРїРёСЃРєРё = [COLLIDERS, INTERIOR_COLLIDERS, POCKET_COLLIDERS];
    for (const СЃРїРёСЃРѕРє of СЃРїРёСЃРєРё) {
      for (const c of СЃРїРёСЃРѕРє) {
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz < (c.r + CAMERA_R) * (c.r + CAMERA_R)) return true;
      }
    }
    return false;
  }

  /**
   * РќР°РёР±РѕР»СЊС€Р°СЏ РґРёСЃС‚Р°РЅС†РёСЏ РєР°РјРµСЂС‹, РЅР° РєРѕС‚РѕСЂСѓСЋ РЅРёС‡РµРіРѕ РЅРµ Р·Р°РіРѕСЂР°Р¶РёРІР°РµС‚ (В§369).
   *
   * Р›СѓС‡ РѕС‚ РёРіСЂРѕРєР° Рє Р¶РµР»Р°РµРјРѕР№ С‚РѕС‡РєРµ, СЃСЌРјРїР»РёСЂРѕРІР°РЅРёРµ СЃ С€Р°РіРѕРј
   * CAMERA_SAMPLE_STEP. Р‘С‹СЃС‚СЂС‹Р№ РїСѓС‚СЊ: Р¶РµР»Р°РµРјР°СЏ С‚РѕС‡РєР° СЃРІРѕР±РѕРґРЅР° вЂ” Р»СѓС‡ РЅРµ РёРґС‘С‚
   * РІРѕРІСЃРµ (Р·Р° РіРѕСЂРѕРґРѕРј СЌС‚Рѕ РєР°Р¶РґС‹Р№ РєР°РґСЂ).
   */
  private СЂР°Р·СЂРµС€С‘РЅРЅР°СЏР”РёСЃС‚Р°РЅС†РёСЏ(РёРіСЂРѕРє: { x: number; z: number }, Р¶РµР»Р°РµРјР°СЏ: number): number {
    const inside = this.interiors.isInside();
    const РїРѕС‚РѕР»РѕРє = inside ? Math.min(Р¶РµР»Р°РµРјР°СЏ, CAMERA_INDOOR_MAX) : Р¶РµР»Р°РµРјР°СЏ;
    const dirX = Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirZ = Math.cos(this.yaw) * Math.cos(this.pitch);
    if (!this.РєР°РјРµСЂР°Р—Р°РєСЂС‹С‚Р°(РёРіСЂРѕРє.x + dirX * РїРѕС‚РѕР»РѕРє, РёРіСЂРѕРє.z + dirZ * РїРѕС‚РѕР»РѕРє)) {
      return РїРѕС‚РѕР»РѕРє;
    }
    for (let d = РїРѕС‚РѕР»РѕРє - CAMERA_SAMPLE_STEP; d >= CAMERA_SAMPLE_MIN; d -= CAMERA_SAMPLE_STEP) {
      if (!this.РєР°РјРµСЂР°Р—Р°РєСЂС‹С‚Р°(РёРіСЂРѕРє.x + dirX * d, РёРіСЂРѕРє.z + dirZ * d)) {
        return d;
      }
    }
    return CAMERA_SAMPLE_MIN;
  }

  private resolveCollisions(p: { x: number; z: number }, radius: number): void {
    this.resolveCircleList(p, radius, COLLIDERS);
    this.resolveCircleList(p, radius, FAUNA_COLLIDERS);
    // РљРѕР»Р»Р°Р№РґРµСЂС‹ РёРЅС‚РµСЂСЊРµСЂР° Р¶РёРІСѓС‚ РІ РєР°СЂРјР°РЅРµ РјРёСЂР° вЂ” СЃРЅР°СЂСѓР¶Рё СЃРїРёСЃРѕРє РїСѓСЃС‚.
    this.resolveCircleList(p, radius, INTERIOR_COLLIDERS);
    // Р—Р°Р±РѕСЂ РєР°СЂРјР°РЅР° РґРµСЂР¶РёС‚ РёРіСЂРѕРєР° РЅР° РїР»Р°С‚Рѕ, РґР°Р¶Рµ РµСЃР»Рё РѕРЅ РєР°Рє-С‚Рѕ РІС‹С€РµР» РёР· РєРѕРјРЅР°С‚С‹.
    this.resolveCircleList(p, radius, POCKET_COLLIDERS);
    // Р“РѕСЂРѕР¶Р°РЅРµ: СЃРєРІРѕР·СЊ РЅРёС… РЅРµ РїСЂРѕР№С‚Рё.
    this.resolveCircleList(p, radius, CIV_COLLIDERS);
  }

  private resolveCircleList(
    p: { x: number; z: number }, radius: number, list: { x: number; z: number; r: number }[],
  ): void {
    if (!list.length) return;
    for (let pass = 0; pass < 3; pass++) {
      let pushed = false;
      for (const c of list) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min) {
          if (d > 1e-4) {
            p.x = c.x + (dx / d) * min;
            p.z = c.z + (dz / d) * min;
          } else {
            p.x = c.x + min; // СЂРѕРІРЅРѕ РІ С†РµРЅС‚СЂРµ вЂ” С‚РѕР»РєР°РµРј РЅР° РІРѕСЃС‚РѕРє
          }
          pushed = true;
        }
      }
      if (!pushed) break;
    }
  }

  // в”Ђв”Ђ Р“Р»Р°РІРЅС‹Р№ Р°РїРґРµР№С‚ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  update(dt: number, now: number, night: number): void {
    if (!this.entities || !this.me) return;
    if ((night >= 1) !== this.wasNight) {
      this.wasNight = night >= 1;
      audio.setNight(this.wasNight);
    }
    const me = this.me;

    if (this.exhaustedFlash > 0) this.exhaustedFlash -= dt;

    // в”Ђв”Ђ Р’РІРѕРґ РґРІРёР¶РµРЅРёСЏ (РѕС‚РЅРѕСЃРёС‚РµР»СЊРЅРѕ РєР°РјРµСЂС‹) в”Ђв”Ђ
    let ix = 0, iz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    // РњС‘СЂС‚РІС‹Р№ РЅРµ С…РѕРґРёС‚. Р­РєСЂР°РЅ СЃРјРµСЂС‚Рё Р·Р°РєСЂС‹РІР°РµС‚ РѕР±Р·РѕСЂ, РЅРѕ РєР»Р°РІРёС€Рё РїРѕРґ
    // СЂСѓРєРѕР№ РѕСЃС‚Р°СЋС‚СЃСЏ: Р±РµР· СЌС‚РѕР№ Р·Р°РіР»СѓС€РєРё РїРµСЂСЃРѕРЅР°Р¶ СѓРµР·Р¶Р°Р» РёР·-РїРѕРґ РѕРІРµСЂР»РµСЏ,
    // Рё РїСЂРё СЂРµСЃРїР°РІРЅРµ РЅР° РјРµСЃС‚Рµ Р±С‹Р»Рѕ РІРёРґРЅРѕ СЂС‹РІРѕРє РѕР±СЂР°С‚РЅРѕ.
    if (session.dead) { ix = 0; iz = 0; }
    if (this.keys.has('KeyQ')) this.yaw += dt * 2.2;
    if (this.keys.has('KeyE')) this.yaw -= dt * 2.2;
    // РљСЂРµРЅ РєР°РјРµСЂС‹: РїРѕРІРѕСЂРѕС‚ РІРѕРєСЂСѓРі РµС‘ СЃРѕР±СЃС‚РІРµРЅРЅРѕР№ РѕСЃРё, С‚Рѕ РµСЃС‚СЊ РЅР°РєР»РѕРЅ РіРѕСЂРёР·РѕРЅС‚Р°.
    // X Рё V: Z Р·Р°РЅСЏС‚ РїРѕРєР°Р·РѕРј РєРѕР»Р»Р°Р№РґРµСЂРѕРІ, Q Рё E Р·Р°РЅСЏС‚С‹ РѕР±Р»РµС‚РѕРј.
    //
    // РљСЂРµРЅ РќР• РґРІРёРіР°РµС‚ РїРµСЂСЃРѕРЅР°Р¶Р°: С€Р°Рі С‡РёС‚Р°РµС‚СЃСЏ РїРѕ this.yaw, Р° РєСЂРµРЅ Р¶РёРІС‘С‚ РІ СЃРІРѕС‘Рј РїРѕР»Рµ.
    // Р­С‚Рѕ РЅРµ СѓРєСЂР°С€РµРЅРёРµ, Р° С‚СЂРµР±РѕРІР°РЅРёРµ - РµСЃР»Рё Р±С‹ РєСЂРµРЅ РїРѕРїР°Р» РІ yaw, С‚Рѕ РїСЂРё РЅР°РєР»РѕРЅС‘РЅРЅРѕРј
    // СЌРєСЂР°РЅРµ РєРЅРѕРїРєРё СЃС‚Р°Р»Рё Р±С‹ РІРµСЃС‚Рё СЃРµР±СЏ В«РЅРµРїСЂР°РІРёР»СЊРЅРѕВ», Рё СЌС‚Рѕ СѓР¶Рµ Р±С‹Р»Рѕ Р±С‹ РЅР°СЃС‚РѕСЏС‰РµР№
    // РїРѕР»РѕРјРєРѕР№, Р° РЅРµ РЅРµСѓРґРѕР±СЃС‚РІРѕРј.
    if (this.keys.has('KeyX')) this.roll -= dt * ROLL_RATE;
    if (this.keys.has('KeyV')) this.roll += dt * ROLL_RATE;
    this.roll = Math.min(ROLL_LIMIT, Math.max(-ROLL_LIMIT, this.roll));
    this.crouch = !session.dead && (this.keys.has('KeyC') || this.keys.has('ControlLeft'));
    // РџРѕРґРєР°С‚ (В§385): РїСЂРёСЃРµРґ РќРђ РҐРћР”РЈ - РєРѕСЂРѕС‚РєРѕРµ СЃРєРѕР»СЊР¶РµРЅРёРµ РЅР° Р±РµРіРѕРІРѕР№
    // СЃРєРѕСЂРѕСЃС‚Рё, РєРѕС‚РѕСЂР°СЏ СЃР°РјР° РїРѕ СЃРµР±Рµ РІ РїСЂРµРґРµР»Р°С… Р°РЅС‚РёС‡РёС‚Р°. РЎС‚РѕСЏ РїРѕРґРєР°С‚
    // РЅРµ РІРєР»СЋС‡Р°РµС‚СЃСЏ: Р±СѓСЃС‚ Р±РµР· РґРІРёР¶РµРЅРёСЏ Р±С‹Р» Р±С‹ РѕР±С…РѕРґРѕРј РјРµРґР»РµРЅРЅРѕРіРѕ РїСЂРёСЃРµРґР°.
    if (this.crouch && !this.wasCrouch && this.grounded && !this.swimming && !this.climb) {
      this.slideTimer = 0.7;
    }
    this.wasCrouch = this.crouch;
    if (this.slideTimer > 0) this.slideTimer = Math.max(0, this.slideTimer - dt);

    // в”Ђв”Ђ Р›РµСЃС‚РЅРёС†С‹ (В§324): СѓРґРµСЂР¶Р°РЅРёРµ W СЂСЏРґРѕРј СЃ Р»РµСЃС‚РЅРёС†РµР№ РІ РёРЅС‚РµСЂСЊРµСЂРµ в”Ђв”Ђ
    // С†РµРїР»СЏРµС‚ Рє РЅРµР№. Р”Р°Р»СЊС€Рµ РґРІРёР¶РµРЅРёРµ РІРµСЂС‚РёРєР°Р»СЊРЅРѕРµ: W РІРІРµСЂС…, S РІРЅРёР·.
    // РЎС…РѕРґ - РЅР° РїР»Р°С‚С„РѕСЂРјРµ РёР»Рё РЅР° РїРѕР»Сѓ; Р»РµСЃС‚РЅРёС†Р° РЅРµ СЃС…РѕРґРёС‚ СЃ СѓСЃС‚СѓРїР°
    // СЃР°РјР°, С‡С‚РѕР±С‹ СЃР»СѓС‡Р°Р№РЅРѕРµ РЅР°Р¶Р°С‚РёРµ РЅРµ СЃРѕСЂРІР°Р»Рѕ РёРіСЂРѕРєР° СЃ РІС‹СЃРѕС‚С‹.
    if (!this.climb && !session.dead && this.interiors.isInside() &&
        (this.keys.has('KeyW') || this.keys.has('ArrowUp'))) {
      let Р±Р»РёР¶Р°Р№С€Р°СЏ: THREE.Object3D | null = null;
      let РґР°Р»СЊРЅРѕСЃС‚СЊ = 1.4;
      const РїРѕР·С‹ = new THREE.Vector3();
      for (const С†РµР»СЊ of this.climbTargets) {
        С†РµР»СЊ.getWorldPosition(РїРѕР·С‹);
        const d = Math.hypot(РїРѕР·С‹.x - me.pos.x, РїРѕР·С‹.z - me.pos.z);
        if (d < РґР°Р»СЊРЅРѕСЃС‚СЊ) { РґР°Р»СЊРЅРѕСЃС‚СЊ = d; Р±Р»РёР¶Р°Р№С€Р°СЏ = С†РµР»СЊ; }
      }
      const РІРµСЂС€РёРЅР° = (Р±Р»РёР¶Р°Р№С€Р°СЏ?.userData as { ladderTop?: number } | undefined)?.ladderTop ?? 0;
      // Р’РІРµСЂС… Р»РµР·РµРј СЃ РїРѕР»Р° РёР»Рё СЃ СЃРµСЂРµРґРёРЅС‹ РїРѕРґСЉС‘РјР°; РЅР° СѓСЂРѕРІРЅРµ РІРµСЂС€РёРЅС‹
      // С…РІР°С‚Р°РЅРёРµ СѓР¶Рµ РЅРµ РЅСѓР¶РЅРѕ - С‚Р°Рј СЃС‚РѕСЏС‚ РЅРѕРіРё, С…РѕРґСЊР±Р° Рё С‚Р°Рє СЂР°Р±РѕС‚Р°РµС‚.
      if (Р±Р»РёР¶Р°Р№С€Р°СЏ && РІРµСЂС€РёРЅР° > me.pos.y + 0.1) {
        this.climb = Р±Р»РёР¶Р°Р№С€Р°СЏ;
        this.vy = 0;
        this.grounded = false;
      }
    }
    // РќР° Р»РµСЃС‚РЅРёС†Рµ XZ Р·Р°РјРѕСЂРѕР¶РµРЅС‹: РµРґРёРЅСЃС‚РІРµРЅРЅРѕРµ РґРІРёР¶РµРЅРёРµ - РІРµСЂС‚РёРєР°Р»СЊРЅРѕРµ
    // (РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚СЃСЏ РІ Р±Р»РѕРєРµ В«Р’РµСЂС‚РёРєР°Р»СЊВ» РЅРёР¶Рµ РїРѕ this.keys, РїРѕСЌС‚РѕРјСѓ
    // РѕР±РЅСѓР»РµРЅРёРµ РІРІРѕРґР° РµРіРѕ РЅРµ Р·Р°РґРµРІР°РµС‚).
    if (this.climb) { ix = 0; iz = 0; }

    const len = Math.hypot(ix, iz);
    const onBridge = bridgeAt(me.pos.x, me.pos.z);
    const surfaceY = waterSurfaceY(me.pos.x, me.pos.z);
    // Р РµР°Р»СЊРЅР°СЏ РіР»СѓР±РёРЅР° = РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ РІРѕРґС‹ в€’ РґРЅРѕ РїРѕРґ РЅРѕРіР°РјРё.
    // Р Р°РЅСЊС€Рµ Р·РґРµСЃСЊ СЃС‚РѕСЏР»Р° РјР°СЃРєР° waterMask > 0.3, РёР·-Р·Р° С‡РµРіРѕ РІРѕ РІСЃРµР№ РјСЏРіРєРѕР№
    // РїСЂРёР±СЂРµР¶РЅРѕР№ Р·РѕРЅРµ РІРєР»СЋС‡Р°Р»СЃСЏ В«Р±СЂРѕРґВ» СЃ РЅРµРІРёРґРёРјС‹Рј РїРѕР»РѕРј Сѓ РїРѕРІРµСЂС…РЅРѕСЃС‚Рё вЂ”
    // РїРµСЂСЃРѕРЅР°Р¶ С…РѕРґРёР» РџРћ РІРѕРґРµ. РўРµРїРµСЂСЊ: РјРµР»РєРѕ вЂ” РёРґС‘Рј РїРѕ РЅР°СЃС‚РѕСЏС‰РµРјСѓ РґРЅСѓ
    // (РІРѕРґР° РїРѕ РїРѕСЏСЃ), РіР»СѓР±РѕРєРѕ вЂ” РїР»С‹РІС‘Рј, С‚РµР»Рѕ РїРѕРіСЂСѓР¶РµРЅРѕ, РіРѕР»РѕРІР° РЅР°Рґ РІРѕРґРѕР№.
    const bedY = this.interiors.isInside() ? Number.NaN : groundHeight(me.pos.x, me.pos.z);
    const depth = (surfaceY !== null && onBridge === null && !Number.isNaN(bedY))
      ? Math.max(0, surfaceY - bedY)
      : 0;
    this.swimming = depth > SWIM_MIN_DEPTH;
    const wading = depth > WADE_MIN_DEPTH && !this.swimming;
    // РЈСЃРёР»РµРЅРЅС‹Р№ Р±РµРі/РїР»С‹С‚СЊС‘ вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё С…РІР°С‚Р°РµС‚ РІС‹РЅРѕСЃР»РёРІРѕСЃС‚Рё
    const shifting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.sprintAllowed;
    // РЎРЅР°СЂСЏР¶РµРЅРёРµ РґР»СЏ РІРѕРґС‹ СЃРЅРёРјР°РµС‚ Р·Р°РјРµРґР»РµРЅРёРµ: СЃР°РїРѕРіРё/РїР»Р°С‰ СѓРјРµРЅСЊС€Р°СЋС‚
    // РјРЅРѕР¶РёС‚РµР»СЊ Р±СЂРѕРґР° Рё РїСЂРёР±Р°РІР»СЏСЋС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїР»Р°РІР°РЅРёСЏ. Р›РѕРґРєР° РґР°С‘С‚ СЃРІРѕР№
    // Р±РѕРЅСѓСЃ вЂ” Р±РµСЂС‘С‚СЃСЏ Р»СѓС‡С€РёР№ РёР· РґРІСѓС…, Р° РЅРµ СЃСѓРјРјР° (РёРЅР°С‡Рµ Р»РѕРґРєР° РґР°Р»Р° Р±С‹
    // Р±РѕР»СЊС€Рµ 1 Рё РІРѕРґР° РїРµСЂРµСЃС‚Р°Р»Р° Р±С‹ С‚РѕСЂРјРѕР·РёС‚СЊ СЃРѕРІСЃРµРј РїСЂРё Р»СЋР±РѕРј СЃРЅР°СЂСЏР¶РµРЅРёРё)
    const waterBonus = Math.max(this.waterSpeedBonus, this.boatWaterSpeed);
    const wadeMult = WADE_MULT + (1 - WADE_MULT) * waterBonus;
    const swimSpeed = SWIM_SPEED + (WALK_SPEED - SWIM_SPEED) * waterBonus;
    const swimSprint = SWIM_SPRINT + (RUN_SPEED - SWIM_SPRINT) * waterBonus;
    const boatSpeed = this.boatId ? this.boatSwimSpeed : 0;
    // РЎРєР°РєСѓРЅ РјРµРЅСЏРµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РЅР° СЃСѓС€Рµ: С€Р°РіРѕРј вЂ” РµРіРѕ РїРѕР»РЅР°СЏ, Р±РµРіРѕРј вЂ” РІ 1.4 СЂР°Р·Р°
    // Р±РѕР»СЊС€Рµ. Р’ РІРѕРґРµ СЃРєР°РєСѓРЅ РЅРµ РїРѕРјРѕРіР°РµС‚ (С‚Р°Рј Р»РѕРґРєР° Рё СЃР°РїРѕРіРё), РёРЅР°С‡Рµ РєРѕРЅСЊ
    // СѓСЃРєРѕСЂСЏР» Р±С‹ РµС‰С‘ Рё РїР»Р°РІР»РµРЅРёРµ.
    // РџСЂРёСЃРµРґР°РЅРёРµ РІСЃРµРіРґР° РѕСЃС‚Р°РІР»СЏРµС‚ РїРµС€СѓСЋ СЃРєРѕСЂРѕСЃС‚СЊ: СЌС‚Рѕ В«РєСЂР°РґСѓСЃСЊ С‚РёС…РѕВ», Рё
    // РІРµСЂС…РѕРј РєСЂР°СЃС‚СЊСЃСЏ Р±РµСЃСЃРјС‹СЃР»РµРЅРЅРѕ.
    // РџРѕРіРѕРґР° С‚РѕСЂРјРѕР·РёС‚ СЃСѓС€Сѓ С†РµР»РёРєРѕРј вЂ” С€Р°Рі, Р±РµРі Рё СЃРєР°РєСѓРЅР°: РІ РїРµСЃС‡Р°РЅСѓСЋ Р±СѓСЂСЋ
    // РїСЂРѕС‚РёРІ РІРµС‚СЂР° РЅРµ СЃРєР°С‡СѓС‚. Р С‹РІРѕРє Рё РІРѕРґР° РїРѕРіРѕРґСѓ РЅРµ С‡РёС‚Р°СЋС‚ (СЃРј. speedMod).
    const landWalk = (this.mountSpeed > 0 ? this.mountSpeed : WALK_SPEED) * this.speedMod;
    const landRun = (this.mountSpeed > 0 ? this.mountSpeed * MOUNT_SPRINT_MULT : RUN_SPEED) * this.speedMod;
    const speed = (this.swimming
      ? (shifting ? Math.max(swimSprint, boatSpeed * 1.25) : Math.max(swimSpeed, boatSpeed))
      : this.slideTimer > 0 ? landRun : this.crouch ? CROUCH_SPEED : shifting ? landRun : landWalk)
      * (wading ? wadeMult : 1);
    // РќР°РїСЂР°РІР»РµРЅРёРµ РєР°РјРµСЂС‹ РІ РјРёСЂРµ (РЅСѓР¶РЅРѕ Рё РґР»СЏ РїРѕРІРѕСЂРѕС‚Р° СЂРёРіР° РЅРёР¶Рµ)
    // РџРѕРєР° РёРґС‘С‚ СЂС‹РІРѕРє, С…РѕРґСЊР±Р° РЅРµ РїСЂРёРјРµРЅСЏРµС‚СЃСЏ: СЂС‹РІРѕРє РёРґС‘С‚ РѕС‚РґРµР»СЊРЅС‹Рј
    // РїРµСЂРµРјРµС‰РµРЅРёРµРј, Р° РЅРµ РґРѕР±Р°РІРєРѕР№ Рє Р±РµРіСѓ. РРЅР°С‡Рµ РїРёРє СЃРєРѕСЂРѕСЃС‚Рё СЃС‚Р°РЅРѕРІРёС‚СЃСЏ
    // DODGE_SPEED + RUN_SPEED = 22.6 РїСЂРё РїСЂРµРґРµР»Рµ Р°РЅС‚Рё-С‡РёС‚Р° 15.6, Рё С‡РµСЃС‚РЅС‹Р№
    // СЂС‹РІРѕРє РѕР±СЉСЏРІР»СЏРµС‚СЃСЏ С‡РёС‚РµСЂСЃС‚РІРѕРј. РџСЂРѕРІРµСЂСЏРµС‚СЃСЏ С‡РёСЃР»Р°РјРё РІ dodgeFeel.test.ts.
    const Р±РµР¶РёС‚Р С‹РІРѕРє = Date.now() < this.dodgeUntil && (this.dodgeDx !== 0 || this.dodgeDz !== 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    if (len > 0 && !Р±РµР¶РёС‚Р С‹РІРѕРє) {
      ix /= len; iz /= len;
      const wx = ix * cos - iz * sin;
      const wz = -ix * sin - iz * cos;
      me.pos.x += wx * speed * dt;
      me.pos.z += wz * speed * dt;
      this.lastDir = { x: wx, y: 0, z: wz };
      // Р“СЂР°РЅРёС†С‹ РјРёСЂР°
      // Р“СЂР°РЅРёС†С‹ РјРёСЂР° вЂ” С‚РѕР»СЊРєРѕ СЃРЅР°СЂСѓР¶Рё: РєР°СЂРјР°РЅ РёРЅС‚РµСЂСЊРµСЂРѕРІ РІРЅРµ СЌС‚РёС… РїСЂРµРґРµР»РѕРІ,
      // РІРЅСѓС‚СЂРё РєРѕРјРЅР°С‚С‹ РёРіСЂРѕРєР° РґРµСЂР¶Р°С‚ СЃС‚РµРЅС‹-РєРѕР»Р»Р°Р№РґРµСЂС‹.
      if (!this.interiors.isInside()) {
        me.pos.x = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.x));
        me.pos.z = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.z));
      }
      me.flipped = false;
    }

    // в”Ђв”Ђ Р С‹РІРѕРє в”Ђв”Ђ
    // РЎРєРѕСЂРѕСЃС‚СЊ РіР°СЃРЅРµС‚ Р»РёРЅРµР№РЅРѕ РґРѕ РєРѕРЅС†Р° СЂС‹РІРєР°. Р С‹РІРѕРє РїСЂРёРјРµРЅСЏРµС‚СЃСЏ Рё Р±РµР·
    // РЅР°Р¶Р°С‚С‹С… РєР»Р°РІРёС€, РїРѕСЌС‚РѕРјСѓ РґРІРёР¶РµРЅРёРµ СЃС‡РёС‚Р°РµС‚СЃСЏ РЅРµ В«С…РѕРґСЊР±Р° РїР»СЋСЃ СЂС‹РІРѕРєВ»,
    // Р° РѕС‚РґРµР»СЊРЅС‹Рј СЃРјРµС‰РµРЅРёРµРј РїРѕРІРµСЂС….
    if (Р±РµР¶РёС‚Р С‹РІРѕРє) {
      // РџСѓС‚СЊ СЂС‹РІРєР° РїРѕ РїСЂРѕС€РµРґС€РµР№ РґРѕР»Рµ РІСЂРµРјРµРЅРё: p(t) = v*T*(t - tВІ/2).
      // Р—Р° РєР°РґСЂ Р±РµСЂС‘С‚СЃСЏ Р РђР—РќРћРЎРўР¬ РїСѓС‚Рё, Р° РЅРµ РїСЂРёР±Р°РІР»РµРЅРёРµ С€Р°РіР°, РїРѕСЌС‚РѕРјСѓ РґР»РёРЅР°
      // РѕРґРёРЅР°РєРѕРІР° РїСЂРё 30 Рё РїСЂРё 144 РєР°РґСЂР°С…: СЂРѕРІРЅРѕ v*T/2 = 1.65 РјРµС‚СЂР°.
      const t = Math.min(1, Math.max(0, (Date.now() - this.dodgeStartAt) / DODGE_TIME_MS));
      const РїСѓС‚СЊ = (РґРѕР»СЏ: number): number =>
        DODGE_SPEED * (DODGE_TIME_MS / 1000) * (РґРѕР»СЏ - (РґРѕР»СЏ * РґРѕР»СЏ) / 2);
      const СЃРјРµС‰РµРЅРёРµ = РїСѓС‚СЊ(t) - РїСѓС‚СЊ(this.dodgeT);
      this.dodgeT = t;
      me.pos.x = this.dodgeOx + this.dodgeDx * СЃРјРµС‰РµРЅРёРµ;
      me.pos.z = this.dodgeOz + this.dodgeDz * СЃРјРµС‰РµРЅРёРµ;
      if (!this.interiors.isInside()) {
        me.pos.x = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.x));
        me.pos.z = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.z));
      }
      // Р”Р»СЏ Р°РЅРёРјР°С†РёРё РЅСѓР¶РЅР° РјРіРЅРѕРІРµРЅРЅР°СЏ СЃРєРѕСЂРѕСЃС‚СЊ вЂ” РїСЂРѕРёР·РІРѕРґРЅР°СЏ РїСѓС‚Рё: v*(1 - t).
      const СЃРєРѕСЂРѕСЃС‚СЊ = DODGE_SPEED * (1 - t);
      this.lastDir = {
        x: this.dodgeDx * СЃРєРѕСЂРѕСЃС‚СЊ,
        y: 0,
        z: this.dodgeDz * СЃРєРѕСЂРѕСЃС‚СЊ,
      };
    }

    // РЎС‚РѕР»РєРЅРѕРІРµРЅРёСЏ СЃ РїРѕСЃС‚СЂРѕР№РєР°РјРё вЂ” РєР°Р¶РґС‹Р№ РєР°РґСЂ (РІ С‚.С‡. РµСЃР»Рё Р·Р°С‚РѕР»РєР°Р»Рѕ РІ СЃС‚РµРЅСѓ)
    this.resolveCollisions(me.pos, PLAYER_R);

    // в”Ђв”Ђ Р’РµСЂС‚РёРєР°Р»СЊ: РїСЂС‹Р¶РѕРє / РїР»Р°РІР°РЅРёРµ / РјРѕСЃС‚ / Р·РµРјР»СЏ в”Ђв”Ђ
    // Р’РЅСѓС‚СЂРё Р·РґР°РЅРёСЏ РїРѕР» вЂ” РїРѕР» РєРѕРјРЅР°С‚С‹; РІ РєР°СЂРјР°РЅРµ РІРЅРµ РєРѕРјРЅР°С‚ вЂ” РїР»Р°С‚Рѕ.
    const pocketY = pocketGroundY(me.pos.x, me.pos.z);
    // РњРµР·РѕРЅРёРЅ (В§324): РІРµСЂС…РЅСЏСЏ РїР»РѕС‰Р°РґРєР° РїРѕРґ РЅРѕРіР°РјРё, РµСЃР»Рё СЃС‚СѓРїРЅРё Сѓ РЅРµС‘ РёР»Рё
    // С‡СѓС‚СЊ РЅРёР¶Рµ (РїР°РґРµРЅРёРµ РЅР° РїР»РёС‚Сѓ). null - РёРіСЂРѕРє РїРѕРґ РїР»Р°С‚С„РѕСЂРјРѕР№ Рё С…РѕРґРёС‚
    // РїРѕ РїРѕР»Сѓ РєРѕРјРЅР°С‚С‹.
    const РїР»Р°С‚С„РѕСЂРјР° = this.platformTopAt(me.pos.x, me.pos.z, me.pos.y);
    const groundY = this.interiors.isInside()
      ? this.interiors.floorY()
      : pocketY ?? groundHeight(me.pos.x, me.pos.z);
    // Р’РµСЂС… СЏС‰РёРєР° (В§385): С‚РѕР»РєР°РµРјС‹Р№ СЏС‰РёРє - РѕРїРѕСЂР° РїР°СЂРєСѓСЂР°. РџСЂС‹Р¶РѕРє СЃ РЅРµРіРѕ
    // (0.75 + 1.44) РґРѕ РјРµР·РѕРЅРёРЅР° (2.6) РЅРµ РґРѕСЃС‚Р°С‘С‚ - Р»РµСЃС‚РЅРёС†Р° РѕСЃС‚Р°С‘С‚СЃСЏ
    // РµРґРёРЅСЃС‚РІРµРЅРЅС‹Рј РїСѓС‚С‘Рј РЅР°РІРµСЂС…, РёРЅРІР°СЂРёР°РЅС‚ В§324 РґРµСЂР¶РёС‚СЃСЏ.
    const СЏС‰РёРє = this.crateTopAt(me.pos.x, me.pos.z, me.pos.y);
    // РџР»Р°С‚С„РѕСЂРјР° Р·Р°СЃС‡РёС‚С‹РІР°РµС‚СЃСЏ, С‚РѕР»СЊРєРѕ РїРѕРєР° РѕРЅР° РґРµР№СЃС‚РІРёС‚РµР»СЊРЅРѕ РІС‹С€Рµ РїРѕР»Р°
    // РєРѕРјРЅР°С‚С‹: РёРЅР°С‡Рµ РѕРЅР° В«РїРµСЂРµСЃРµРєР»Р°В» Р±С‹ РїРѕР».
    const РїРѕРґРќРѕРіР°РјРё = Math.max(
      РїР»Р°С‚С„РѕСЂРјР° !== null && this.interiors.isInside() && РїР»Р°С‚С„РѕСЂРјР° > groundY ? РїР»Р°С‚С„РѕСЂРјР° : 0,
      СЏС‰РёРє ?? 0,
      groundY,
    );
    const bridgeY = bridgeAt(me.pos.x, me.pos.z);
    // РќРµРІРёРґРёРјС‹Р№ РїРѕР» Сѓ РїРѕРІРµСЂС…РЅРѕСЃС‚Рё (wadeFloor) СѓР±СЂР°РЅ: РІ РјРµР»РєРѕР№ РІРѕРґРµ СЃС‚СѓРїРЅРё
    // СЃС‚РѕСЏС‚ РЅР° РќРђРЎРўРћРЇР©Р•Рњ РґРЅРµ, Рё РёРіСЂРѕРє СЂРµР°Р»СЊРЅРѕ РёРґС‘С‚ РїРѕ РїРѕСЏСЃ РІ РІРѕРґРµ, Р° РЅРµ
    // В«РіСѓР»СЏРµС‚В» РїРѕ РїРѕРІРµСЂС…РЅРѕСЃС‚Рё.
    const effectiveGroundY = bridgeY !== null ? bridgeY : РїРѕРґРќРѕРіР°РјРё;
    if (this.climb) {
      // в”Ђв”Ђ Р›Р°Р·Р°РЅРёРµ РїРѕ Р»РµСЃС‚РЅРёС†Рµ (В§324) в”Ђв”Ђ
      // XZ Р·Р°РјРѕСЂРѕР¶РµРЅС‹ (РІРІРѕРґ РѕР±РЅСѓР»С‘РЅ РІС‹С€Рµ), РґРІРёРіР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РІС‹СЃРѕС‚Р°:
      // W РІРІРµСЂС…, S РІРЅРёР·. Space РёРіРЅРѕСЂРёСЂСѓРµС‚СЃСЏ СЃР°Рј СЃРѕР±РѕР№: РїСЂС‹Р¶РѕРє С‚СЂРµР±СѓРµС‚
      // grounded, Р° РЅР° Р»РµСЃС‚РЅРёС†Рµ РѕРЅ СЃРЅСЏС‚. Р’РµСЂС€РёРЅР° Р»РµСЃС‚РЅРёС†С‹ = РІРµСЂС…РЅСЏСЏ
      // РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ РїР»Р°С‚С‹ РјРµР·РѕРЅРёРЅР° (ladderTop РёР· userData), РїРѕСЌС‚РѕРјСѓ СЃС…РѕРґ
      // СЃРІРµСЂС…Сѓ СЃС‚Р°РІРёС‚ РёРіСЂРѕРєР° СЂРѕРІРЅРѕ РЅР° РїР»Р°С‚Сѓ, Р±РµР· РїРѕР»СѓС€Р°РіР° РІ РїСѓСЃС‚РѕС‚Сѓ.
      if (session.dead) {
        // РњС‘СЂС‚РІС‹Р№ РЅРµ РґРµСЂР¶РёС‚СЃСЏ Р·Р° Р»РµСЃС‚РЅРёС†Сѓ: РѕС‚РїСѓСЃРєР°РµРј Рё РґР°С‘Рј СѓРїР°СЃС‚СЊ.
        this.climb = null;
        this.grounded = false;
      } else {
        const РІРµСЂС… = (this.climb.userData as { ladderTop?: number }).ladderTop ?? me.pos.y;
        let СЃРєРѕСЂРѕСЃС‚СЊ = 0;
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) СЃРєРѕСЂРѕСЃС‚СЊ = 2.8;
        else if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) СЃРєРѕСЂРѕСЃС‚СЊ = -3.2;
        me.pos.y += СЃРєРѕСЂРѕСЃС‚СЊ * dt;
        this.lastDir = { x: 0, y: 0, z: 0 };
        if (me.pos.y >= РІРµСЂС…) {
          me.pos.y = РІРµСЂС…;
          this.vy = 0;
          this.grounded = true;
          this.climb = null;
          audio.footstep(false);
        } else if (me.pos.y <= this.interiors.floorY()) {
          // РЎРѕС€РµР» РґРѕ СЃР°РјРѕРіРѕ РїРѕР»Р° РєРѕРјРЅР°С‚С‹: Р»РµСЃС‚РЅРёС†Р° РЅР°С‡РёРЅР°РµС‚СЃСЏ СЃ РїРѕР»Сѓ.
          me.pos.y = this.interiors.floorY();
          this.vy = 0;
          this.grounded = true;
          this.climb = null;
          audio.footstep(false);
        }
      }
    } else if (this.swimming) {
      // ... РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ Р»РѕРєР°Р»СЊРЅРѕРіРѕ РІРѕРґРѕС‘РјР°, Р° РЅРµ РІСЃРµРіРґР° РѕР·РµСЂР°
      const swimLevel = surfaceY ?? LAKE.level;
      // РўРµР»Рѕ РїРѕРіСЂСѓР¶РµРЅРѕ: РЅРѕРіРё РїРѕРґ РІРѕРґРѕР№, РіРѕР»РѕРІР° РЅР°Рґ РїРѕРІРµСЂС…РЅРѕСЃС‚СЊСЋ.
      const floatY = swimLevel - SWIM_FEET;
      me.pos.y += (floatY - me.pos.y) * Math.min(1, dt * 4);
      this.vy *= 0.85; // РіР°С€РµРЅРёРµ РІРµСЂС‚РёРєР°Р»СЊРЅРѕР№ СЃРєРѕСЂРѕСЃС‚Рё
      // РџСЂС‹Р¶РѕРє РІ РІРѕРґРµ = РІСЃРїР»С‹С‚РёРµ РІРІРµСЂС…
      if (this.keys.has('Space')) {
        this.vy = 3.5;
      }
      me.pos.y += this.vy * dt;
      // РќРµ РІС‹С€Рµ РїРѕРІРµСЂС…РЅРѕСЃС‚Рё (РёРЅР°С‡Рµ СЃРЅРѕРІР° В«С…РѕРґРёРј РїРѕ РІРѕРґРµВ») Рё РЅРµ РЅРёР¶Рµ РґРЅР°:
      const lo = Math.max(effectiveGroundY + 0.2, swimLevel - 1.9);
      const hi = swimLevel - 0.7;
      me.pos.y = Math.min(Math.max(me.pos.y, lo), hi);
      this.grounded = false;
    } else if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      me.pos.y += this.vy * dt;
      if (me.pos.y <= effectiveGroundY) {
        me.pos.y = effectiveGroundY;
        this.vy = 0;
        this.grounded = true;
        audio.footstep(true);
      }
    } else if (me.pos.y > effectiveGroundY + 0.45) {
      // РЁР°Рі СЃ РєСЂР°СЏ РјРµР·РѕРЅРёРЅР°/РјРѕСЃС‚Р°: РѕРїРѕСЂС‹ РїРѕРґ РЅРѕРіР°РјРё Р±РѕР»СЊС€Рµ РЅРµС‚, Рё РІРјРµСЃС‚Рѕ
      // РјРіРЅРѕРІРµРЅРЅРѕРіРѕ С‚РµР»РµРїРѕСЂС‚Р° РЅР° Р·РµРјР»СЋ РЅРёР¶Рµ РёРіСЂРѕРє СѓС…РѕРґРёС‚ РІ РїР°РґРµРЅРёРµ.
      // РџРѕСЂРѕРі 0.45 РїРµСЂРµРєР»РёРєР°РµС‚СЃСЏ СЃ РґРѕРїСѓСЃРєРѕРј СЃС‚СѓРїРµРЅРµР№: РѕР±С‹С‡РЅС‹Р№ СЂРµР»СЊРµС„
      // РІ СЌС‚РѕС‚ РїСЂРµРґРµР» РЅРµ РїРѕРїР°РґР°РµС‚, Р° РїР°РґРµРЅРёРµ СЃ РїР»Р°С‚С‹ 2.6 Рј - РґР°.
      this.grounded = false;
    } else {
      me.pos.y = effectiveGroundY;
      // РЁР°РіРё: РїРѕ РјРµР»РєРѕР№ РІРѕРґРµ вЂ” Р¶СѓСЂС‡Р°РЅРёРµ, РїРѕ Р·РµРјР»Рµ вЂ” РѕР±С‹С‡РЅС‹Р№ С€Р°Рі
      if (len > 0) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.stepTimer = speed > 6 ? 0.26 : 0.38;
          if (wading) audio.waterStep();
          else audio.footstep(speed > 6);
        }
      }
    }
    me.moving = len > 0;
    // Р’С‹СЃРѕС‚Р° С‚РµР»Р° РґР»СЏ СЂРёРіР°: С„РёР·РёРєР° (РјРѕСЃС‚/РІРѕРґР°/РїРѕР» РєРѕРјРЅР°С‚С‹), РЅРµ Р»Р°РЅРґС€Р°С„С‚
    this.feetY = me.pos.y;

    // в”Ђв”Ђ Р’РѕРґРЅС‹Рµ СЌС„С„РµРєС‚С‹: РІСЃРїР»РµСЃРє + РїСѓР·С‹СЂСЊРєРё в”Ђв”Ђ
    const inWater = wading || this.swimming;
    if (inWater && !this.wasInWater) {
      // Р’РѕС€Р»Рё РІ РІРѕРґСѓ вЂ” РІСЃРїР»РµСЃРє РЅР° РїРѕРІРµСЂС…РЅРѕСЃС‚Рё С‚РѕРіРѕ РІРѕРґРѕС‘РјР°, РіРґРµ СЃС‚РѕРёРј
      this.splashMesh.visible = true;
      this.splashMesh.position.set(me.pos.x, (surfaceY ?? LAKE.level) + 0.1, me.pos.z);
      (this.splashMesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
      this.splashMesh.scale.set(1, 1, 1);
      audio.splash();
    } else if (this.swimming) {
      // РџСѓР·С‹СЂСЊРєРё: РєР°Р¶РґС‹Рµ 0.4СЃ РїСЂРё РґРІРёР¶РµРЅРёРё
      if (me.moving) {
        this.bubbleTimer -= dt;
        if (this.bubbleTimer <= 0) {
          this.bubbleTimer = 0.4;
          this.spawnBubble(me.pos.x, me.pos.y, me.pos.z);
        }
      }
    }
    // РђРЅРёРјР°С†РёСЏ РІСЃРїР»РµСЃРєР°
    if (this.splashMesh.visible) {
      const mat = this.splashMesh.material as THREE.MeshBasicMaterial;
      mat.opacity -= dt * 1.2;
      this.splashMesh.scale.x += dt * 3;
      this.splashMesh.scale.z += dt * 3;
      if (mat.opacity <= 0) { this.splashMesh.visible = false; }
    }
    this.wasInWater = inWater;

    // в”Ђв”Ђ Р РёРіРё в”Ђв”Ђ
    this.syncRigs();
    for (const [id, b] of this.rigs) {
      const isMe = id === me.id;
      let moving = false, spd = 0, dead = false;
      if (b.kind === 'player') {
        const p = this.entities.players.get(id)!;
        moving = p.moving; spd = p.moving ? 5.5 : 0;
        // РўСЂСѓРї СЂРёСЃСѓРµС‚СЃСЏ РїРѕ СЃРѕСЃС‚РѕСЏРЅРёСЋ РёР· state, Р° РЅРµ РїРѕ РєР»Р°СЃСЃСѓ РѕРІРµСЂР»РµСЏ:
        // СЌРєСЂР°РЅ СЃРјРµСЂС‚Рё СЃС‚СЂРѕРёС‚ deathScreen, Рё 3D-СЃР»РѕР№ РЅРµ РґРѕР»Р¶РµРЅ Р·РЅР°С‚СЊ,
        // РєР°Рє РѕРЅ РІС‹РіР»СЏРґРёС‚ РІ DOM
        if (isMe) dead = session.dead;
      } else {
        const m = this.entities.monsters.get(id)!;
        moving = !m.deadAt && Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) > 0.15;
        spd = moving ? 3.4 : 0;
        dead = m.deadAt > 0;
        if (this.targetRingTarget === id && !dead) {
          // РљРѕР»СЊС†Рѕ С†РµР»Рё вЂ” РЅР°Рґ РїРѕРІРµСЂС…РЅРѕСЃС‚СЊСЋ РІРѕРґС‹, РµСЃР»Рё РјРѕРЅСЃС‚СЂ РІ РІРѕРґРµ,
          // РёРЅР°С‡Рµ РїСЂСЏРјРѕ РїРѕРґ РЅРѕРіР°РјРё (РёРЅР°С‡Рµ РєРѕР»СЊС†Рѕ СѓР№РґС‘С‚ РЅР° РґРЅРѕ РІРјРµСЃС‚Рµ СЃ РЅРёРј)
          const rs = waterSurfaceY(m.pos.x, m.pos.z);
          this.targetRing.position.set(
            m.pos.x,
            rs !== null ? rs + 0.06 : b.rig.group.position.y + 0.06,
            m.pos.z,
          );
          this.targetRing.rotation.z = now / 900;
          // РРјСЏ С†РµР»Рё РЅР°Рґ РєРѕР»СЊС†РѕРј, РїСЂРѕРµС†РёСЂСѓРµРјРѕРµ РЅР° СЌРєСЂР°РЅ
          const p = new THREE.Vector3(m.pos.x, m.pos.y + 2.6, m.pos.z).project(this.camera);
          const name = (m as any).nameRu ?? (m as any).name ?? '';
          this.targetNameEl.textContent = name;
          this.targetNameEl.style.display = '';
          this.targetNameEl.style.transform = `translate(-50%,-50%) translate(${(p.x * 0.5 + 0.5) * this.container.clientWidth}px, ${(-p.y * 0.5 + 0.5) * this.container.clientHeight}px)`;
          this.targetNameEl.style.opacity = String(Math.max(0, 1 - (p.z < -1 || p.z > 1 ? 1 : 0)));
        }
      }
// РџРµСЂСЃРѕРЅР°Р¶ СЂР°Р·РІС‘СЂРЅСѓС‚ РїРѕ РЅР°РїСЂР°РІР»РµРЅРёСЋ РґРІРёР¶РµРЅРёСЏ, Р° РЅРµ Р»РёС†РѕРј Рє РєР°РјРµСЂРµ.
//
// Р’РѕР·РІСЂР°С‰РµРЅРѕ РїРѕ СЂРµС€РµРЅРёСЋ РІР»Р°РґРµР»СЊС†Р°: РєРѕРіРґР° РєРѕСЂРїСѓСЃ РІСЃРµРіРґР° СЃРјРѕС‚СЂРёС‚ РІ РєР°РјРµСЂСѓ, С€Р°Рі РІРїРµСЂС‘Рґ
// РІС‹РіР»СЏРґРёС‚ С€Р°РіРѕРј РЅР°Р·Р°Рґ, Р° РїРѕРІРѕСЂРѕС‚ РјС‹С€Рё СЂР°СЃРєСЂСѓС‡РёРІР°РµС‚ РїРµСЂСЃРѕРЅР°Р¶Р° РЅР° РјРµСЃС‚Рµ. РџРѕ СЌС‚РѕРјСѓ Р¶Рµ
// РЅР°РїСЂР°РІР»РµРЅРёСЋ СЃС‡РёС‚Р°РµС‚СЃСЏ Рё СЂС‹РІРѕРє, РїРѕСЌС‚РѕРјСѓ РґРѕРІРѕСЂРѕС‚ РґРѕР»Р¶РµРЅ СЃРѕРІРїР°РґР°С‚СЊ СЃ РЅРёРј.
if (isMe && moving) {
  // ix Рё iz РїСЂРёС…РѕРґСЏС‚ РІ РѕСЃСЏС… РєР°РјРµСЂС‹, РїРѕСЌС‚РѕРјСѓ РІ РјРёСЂ РёС… РЅР°РґРѕ РїРѕРІРµСЂРЅСѓС‚СЊ РЅР° yaw.
  // РќР°РїСЂР°РІР»РµРЅРёРµ С‚Рѕ Р¶Рµ, С‡С‚Рѕ Сѓ С…РѕРґСЊР±С‹ Рё Сѓ СЂС‹РІРєР°, - РёРЅР°С‡Рµ РїРµСЂСЃРѕРЅР°Р¶ РїРѕР±РµР¶РёС‚ РЅРµ С‚СѓРґР°.
  const dx = ix, dz = iz;
  const want = Math.atan2(dx * cos - dz * sin, -(dx * sin + dz * cos));
  b.rig.group.rotation.y +=
    shortestAngle(want - b.rig.group.rotation.y) * Math.min(1, dt * FACE_TURN_RATE);
}
      const mSwim = b.kind === 'monster' && (b.monsterSwim === true);
      b.rig.update(dt, {
        moving,
        speed: spd,
        grounded: b.kind === 'monster' ? !mSwim : this.grounded,
        crouch: isMe && this.crouch,
        block: isMe && this.block,
        dead,
        swimming: b.kind === 'monster' ? mSwim : (isMe && this.swimming),
      });
      if (b.kind === 'player' && isMe && this.attackAnim) b.rig.triggerAttack(this.attackStage);
    }
    this.attackAnim = false;

    // в”Ђв”Ђ FX, РєРѕР»СЊС†Рѕ С†РµР»Рё в”Ђв”Ђ
    this.syncFx(now);
    if (this.entities.targetId && this.targetRingTarget !== this.entities.targetId) {
      const m = this.entities.monsters.get(this.entities.targetId);
      this.targetRing.visible = !!m;
      this.targetRingTarget = m ? this.entities.targetId : null;
    } else if (!this.entities.targetId) {
      this.targetRing.visible = false;
      this.targetRingTarget = null;
      this.targetNameEl.style.display = 'none';
    }

    // в”Ђв”Ђ РљР°РјРµСЂР° в”Ђв”Ђ
    const swimCamOffset = this.swimming ? 0.4 : 0;
    const swimLevel = waterSurfaceY(me.pos.x, me.pos.z) ?? LAKE.level;
    const targetY = this.swimming
      ? me.pos.y + 1.15                       // РІР·РіР»СЏРґ вЂ” РЅР° С‚РѕСЂСЃ РїР»РѕРІС†Р°, РЅРµ РЅР°Рґ РіРѕР»РѕРІРѕР№
      : me.pos.y + 1.55 + (this.crouch ? -0.4 : 0);
    // РЎС‚РµРЅР° РѕРіСЂР°РЅРёС‡РёРІР°РµС‚ Р¦Р•Р›Р¬, РєР°РјРµСЂР° РґРѕРµР·Р¶Р°РµС‚ РїР»Р°РІРЅРѕ (В§369): Р±РµР· СЌС‚РѕРіРѕ
    // СѓРїРѕСЂ РІ СЃС‚РµРЅСѓ РґС‘СЂРіР°Р» Р±С‹ РєР°РјРµСЂСѓ РєР°РґСЂРѕРј, Р° РёСЃС‡РµР·РЅРѕРІРµРЅРёРµ СЃС‚РµРЅС‹ вЂ”
    // РІС‹СЃС‚СЂРµР»РёРІР°Р» Р±С‹ РµС‘ РѕР±СЂР°С‚РЅРѕ РЅР° РїРѕР»РЅСѓСЋ РґРёСЃС‚Р°РЅС†РёСЋ.
    const СЂР°Р·СЂРµС€РµРЅРѕ = this.СЂР°Р·СЂРµС€С‘РЅРЅР°СЏР”РёСЃС‚Р°РЅС†РёСЏ(me.pos, this.dist);
    const СЃРєРѕСЂРѕСЃС‚СЊ = 1 - Math.exp(-CAMERA_PULL_RATE * dt);
    this.distCurrent += (СЂР°Р·СЂРµС€РµРЅРѕ - this.distCurrent) * СЃРєРѕСЂРѕСЃС‚СЊ;
    const camY = me.pos.y + 1.55 + swimCamOffset + Math.sin(this.pitch) * this.distCurrent;
    const camX = me.pos.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distCurrent;
    const camZ = me.pos.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distCurrent;
    // РЎС‚СЂР°С…РѕРІРєР° РїРѕСЃР»Рµ СЃРіР»Р°Р¶РёРІР°РЅРёСЏ: РєРѕР»Р»Р°Р№РґРµСЂС‹ вЂ” РїРѕСЃР»РµРґРЅСЏСЏ РёРЅСЃС‚Р°РЅС†РёСЏ, РµСЃР»Рё
    // СЃСЌРјРїР»С‹ РІСЃС‘ Р¶Рµ РїСЂРѕРїСѓСЃС‚РёР»Рё С‡С‚Рѕ-С‚Рѕ РјРµР¶РґСѓ РїСЂРѕР±Р°РјРё.
    const cam = { x: camX, z: camZ };
    this.resolveCollisions(cam, CAMERA_R);
    const camGround = this.interiors.isInside()
      ? this.interiors.floorY()
      : pocketGroundY(cam.x, cam.z) ?? groundHeight(cam.x, cam.z);
    // РљР°РјРµСЂР° РЅРµ РЅС‹СЂСЏРµС‚: РґРµСЂР¶РёРј РµС‘ РЅР°Рґ РїРѕРІРµСЂС…РЅРѕСЃС‚СЊСЋ РІРѕРґС‹ РІ С‚РѕС‡РєРµ РµС‘ СЃС‚РѕСЏРЅРёСЏ
    const camSurface = waterSurfaceY(cam.x, cam.z);
    const minY = Math.max(
      camGround + 0.5,
      camSurface !== null ? camSurface + 0.45 : -Infinity,
      this.swimming ? swimLevel + 0.6 : -Infinity,
    );
    this.camera.position.set(cam.x, Math.max(camY, minY), cam.z);
    this.camera.lookAt(me.pos.x, targetY, me.pos.z);
    // РџРѕРґСЃРєР°Р·РєР° РѕРєСЂСѓР¶РµРЅРёСЏ (В§370): РєР°РґСЂ РєР°РјРµСЂС‹ СѓСЃС‚Р°РЅРѕРІР»РµРЅ вЂ” Р»СѓС‡Рё С‡РµСЃС‚РЅС‹.
    this.updateEnvHint();
    // РљСЂРµРЅ РїРѕРІРµСЂС… РЅР°РІРµРґРµРЅРёСЏ. lookAt РІСЃРµРіРґР° СЃС‚Р°РІРёС‚ РєР°РјРµСЂСѓ СЂРѕРІРЅРѕ РїРѕ РіРѕСЂРёР·РѕРЅС‚Р°Р»Рё, РїРѕСЌС‚РѕРјСѓ
    // РЅР°РєР»РѕРЅ РіРѕСЂРёР·РѕРЅС‚Р° РІРѕР·РјРѕР¶РµРЅ С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ РЅРµРіРѕ, РїРѕРІРѕСЂРѕС‚РѕРј РІРѕРєСЂСѓРі СЃРѕР±СЃС‚РІРµРЅРЅРѕР№ РѕСЃРё
    // РєР°РјРµСЂС‹. РџРѕСЂСЏРґРѕРє РІР°Р¶РµРЅ: РЅР°РєР»РѕРЅ РґРѕ lookAt СЃС‚С‘СЂСЃСЏ Р±С‹ РЅР°РІРµРґРµРЅРёРµРј.
    if (this.roll !== 0) this.camera.rotateZ(this.roll);

    // в”Ђв”Ђ РЎРІРµС‚ Рё РІСЂРµРјСЏ СЃСѓС‚РѕРє в”Ђв”Ђ
    const dayI = 1 - night;
    this.sky.update(dt, now, this.clockHour / 24, { x: me.pos.x, z: me.pos.z });
    this.fauna.update(dt, now);
    // Р—РІРµСЂРё РІРЅРµ С„Р°СѓРЅС‹ (РІРѕР» Сѓ СЃРєР»Р°РґР°, Р»РѕС€Р°РґСЊ РєРѕРЅСЋС€РЅРё): РёС… РјРёРєСЃРµСЂС‹ С‚РёРєР°СЋС‚ Р·РґРµСЃСЊ.
    С‚РёРєР°С‚СЊР—РІРµСЂРµР№(dt);
    this.npcs.update(dt, now, this.camera.position, night);
    // РџРѕР·РёС†РёСЏ РёРіСЂРѕРєР° РЅСѓР¶РЅР° РіРѕСЂРѕР¶Р°РЅР°Рј, С‡С‚РѕР±С‹ РѕРЅРё РµРіРѕ РѕР±С…РѕРґРёР»Рё, Р° РЅРµ С€Р»Рё СЃРєРІРѕР·СЊ РЅРµРіРѕ.
    // night вЂ” С‚РѕС‚ Р¶Рµ С„Р°РєС‚РѕСЂ, С‡С‚Рѕ Сѓ sky Рё roadTraffic: Рє РЅРѕС‡Рё РіРѕСЂРѕРґ СЂР°СЃС…РѕРґРёС‚СЃСЏ
    // РїРѕ РґРѕРјР°Рј (В§351).
    this.civilians.update(dt, now, me.pos.x, me.pos.z, night);
    // РЎРјРµСЃРёС‚РµР»Рё Р¶РёС‚РµР»РµР№: Р±РµР· update РѕРЅРё СЃС‚РѕСЏС‚ СЃС‚РѕР»Р±РѕРј, Р° СЃС†РµРЅР° С„РѕСЂРјР°Р»СЊРЅРѕ Р¶РёРІР°.
    this.townfolk.update(dt, me.pos.x, me.pos.z);
    updateCows(this.cowMixers, dt);
    // РЎС‚СЂР°Р¶Рё РёРЅС‚РµСЂСЊРµСЂРѕРІ РЅР° РЅР°СЃС‚РѕСЏС‰РёС… РјРѕРґРµР»СЏС…: РёС… РјРёРєСЃРµСЂС‹ Р¶РёРІСѓС‚ РІ interiors,
    // РєР°РґСЂ РґРІРёРіР°РµС‚ РёС… РѕС‚СЃСЋРґР° вЂ” С‚РµРј Р¶Рµ СЃРїРѕСЃРѕР±РѕРј, С‡С‚Рѕ Рё РєРѕСЂРѕРІ.
    РѕР±РЅРѕРІРёС‚СЊРЎС‚СЂР°Р¶РµР№(dt);
    this.roadTraffic.update(dt, now, me.pos.x, me.pos.z, night);
    this.navigator.update(now, { x: me.pos.x, z: me.pos.z });

    // РЎРѕР»РЅС†Рµ/Р»СѓРЅР° РїРѕ РґСѓРіРµ: РёСЃС‚РѕС‡РЅРёРє СЃРІРµС‚Р° СЃР»РµРґСѓРµС‚ Р·Р° СЃРІРµС‚РёР»РѕРј.
    // РўСѓС‡Рё РіР°СЃСЏС‚ СЃРІРµС‚: РІ РіСЂРѕР·Сѓ РјРёСЂ РЅРµ РґРѕР»Р¶РµРЅ СЃРІРµС‚РёС‚СЊСЃСЏ РєР°Рє РІ РїРѕР»РґРµРЅСЊ.
    const sunDir = this.sky.sunDirection;

    const useMoon = sunDir.y < 0.05;
    const lightDir = useMoon ? sunDir.clone().multiplyScalar(-1) : sunDir;

    // РњР°СЂРµРІРѕ РІ Р¶Р°СЂСѓ (В§265): РЅР°Рґ РіРѕСЂРёР·РѕРЅС‚РѕРј РІ РїРѕР»РґРµРЅСЊ РІ СЏСЃРЅСѓСЋ РїРѕРіРѕРґСѓ. Р’ РїР°СЃРјСѓСЂРѕРє
    // Рё РІ РґРѕР¶РґСЊ РјР°СЂРµРІР° РЅРµС‚, РЅРѕС‡СЊСЋ вЂ” С‚РѕР¶Рµ.
    //
    // РџРѕРіРѕРґР° РїСЂРѕРІРµСЂСЏРµС‚СЃСЏ РЅРµ РїРѕ В«СЏСЃРЅРѕВ», Р° РїРѕ В«РЅРµ Р¶Р°СЂРєРѕВ»: РІ РјРёСЂРµ С‡Р°С‰Рµ РІСЃРµРіРѕ
    // СЃС‚РѕРёС‚ 'cloudy', Рё РїСЂРё РЅС‘Рј РјР°СЂРµРІРѕ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ вЂ” РѕР±Р»Р°РєР° РіР°СЃСЏС‚ СЃРѕР»РЅС†Рµ, РЅРѕ
    // РЅРµ Р¶Р°СЂ. Р“Р°СЃРёС‚ РµРіРѕ СѓР¶Рµ РїР°СЃРјСѓСЂРЅРѕСЃС‚СЊ РЅРµР±Р°.
    const РЅРµР–Р°СЂРєРѕ = this.currentWeather === 'rain' || this.currentWeather === 'storm'
      || this.currentWeather === 'snow' || this.currentWeather === 'sandstorm'
      || this.currentWeather === 'fog';
    const Р¶Р°СЂ = РЅРµР–Р°СЂРєРѕ
      ? 0
      : Math.max(0, Math.min(1, (sunDir.y - 0.12) / 0.45)) * (1 - night) * (1 - this.sky.overcast);
    this.РјР°СЂРµРІРѕ.update(dt, now, me.pos.x, me.pos.z, Р¶Р°СЂ);
    // РџС‹Р»СЊ РЅР°Рґ РґРѕСЂРѕРіРѕР№ (В§268): РѕРЅР° СЃС‚РѕРёС‚ С‚РѕР»СЊРєРѕ РЅР°Рґ РїРѕР»РѕС‚РЅРѕРј, Р° РЅРµ РЅР°Рґ РІСЃРµР№
    // РїСѓСЃС‚С‹РЅРµР№, Рё РїРѕСЏРІР»СЏРµС‚СЃСЏ РІ С‚РѕС‚ Р¶Рµ Р¶Р°СЂ, С‡С‚Рѕ Рё РјР°СЂРµРІРѕ.
    this.РїС‹Р»СЊР”РѕСЂРѕРіРё.update(dt, now, me.pos.x, me.pos.z, Р¶Р°СЂ);
    // Р”С‹Рј РёР· С‚СЂСѓР± (В§266): РєР»СѓР± РёР· СЃР»СѓС‡Р°Р№РЅРѕР№ С‚СЂСѓР±С‹, Рё РЅРµ С‡Р°С‰Рµ СЂР°Р·Р° РІ РїРѕР»СЃРµРєСѓРЅРґС‹.
    if (РґС‹РјРЅС‹РµРўСЂСѓР±С‹.length) {
      this.РґС‹РјРўСЂСѓР±РўР°Р№РјРµСЂ += dt;
      if (this.РґС‹РјРўСЂСѓР±РўР°Р№РјРµСЂ >= 0.5) {
        this.РґС‹РјРўСЂСѓР±РўР°Р№РјРµСЂ = 0;
        const С‚СЂСѓР±Р° = РґС‹РјРЅС‹РµРўСЂСѓР±С‹[Math.floor(Math.random() * РґС‹РјРЅС‹РµРўСЂСѓР±С‹.length)];
        // Р”С‹Рј РёР· РґР°Р»СЊРЅРµР№ С‚СЂСѓР±С‹ РЅРµ РІРёРґРЅРѕ: РѕРЅ СѓС€С‘Р» Р±С‹ РІ С‚СѓРјР°РЅ, Р° СЃС‚РѕРёР» Р±С‹ РєР°РґСЂ.
        if (Math.hypot(С‚СЂСѓР±Р°.x - me.pos.x, С‚СЂСѓР±Р°.z - me.pos.z) < 90) {
          this.РґС‹РјРўСЂСѓР±.РІСЃРїР»РµСЃРє(С‚СЂСѓР±Р°.x, С‚СЂСѓР±Р°.y, С‚СЂСѓР±Р°.z);
        }
      }
    }
    this.РґС‹РјРўСЂСѓР±.update(dt);
    // РўРµРЅСЊ РѕС‚ РєРѕСЃС‚СЂР° (В§267): С‚РµРЅСЊ СЃС‡РёС‚Р°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ СЂСЏРґРѕРј СЃ РєРѕСЃС‚СЂРѕРј вЂ” РІРґР°Р»Рё
    // РѕРіРѕРЅСЊ РІСЃС‘ СЂР°РІРЅРѕ РЅРµ РІРёРґРµРЅ, Р° РїСЂРѕС…РѕРґ СЂРµРЅРґРµСЂР° С‚РµРЅРµР№ СЃС‚РѕРёР» Р±С‹ РєР°РґСЂР°.
    if (this.С‚РµРЅСЊРљРѕСЃС‚СЂР°) {
      const РґРѕРљРѕСЃС‚СЂР° = Math.hypot(me.pos.x - CAMP.x, me.pos.z - CAMP.z);
      const СЂСЏРґРѕРј = РґРѕРљРѕСЃС‚СЂР° < 40;
      this.С‚РµРЅСЊРљРѕСЃС‚СЂР°.castShadow = СЂСЏРґРѕРј;
      this.С‚РµРЅСЊРљРѕСЃС‚СЂР°.intensity = СЂСЏРґРѕРј ? 2.2 : 0;
    }

    // HDRI-РѕРєСЂСѓР¶РµРЅРёРµ РїРµСЂРµСЃРѕР±РёСЂР°РµС‚СЃСЏ СЃР°РјРѕ, РєРѕРіРґР° РЅРµР±Рѕ РёР·РјРµРЅРёР»РѕСЃСЊ РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ.
    // РЎРѕСЃС‚РѕСЏРЅРёРµ СЃРѕР±РёСЂР°РµС‚СЃСЏ Р·РґРµСЃСЊ вЂ” СЂСЏРґРѕРј СЃ СЂР°СЃС‡С‘С‚РѕРј СЃРІРµС‚Р°, РїРѕС‚РѕРјСѓ С‡С‚Рѕ РѕР±Р°
    // С‡РёС‚Р°СЋС‚ РѕРґРЅРѕ Рё С‚Рѕ Р¶Рµ: РЅР°РїСЂР°РІР»РµРЅРёРµ РЅР° СЃРѕР»РЅС†Рµ, РіР»СѓР±РёРЅСѓ РЅРѕС‡Рё Рё РїР°СЃРјСѓСЂРЅРѕСЃС‚СЊ.
    const СЃРѕСЃС‚РѕСЏРЅРёРµРќРµР±Р°: SkyState = {
      sun: [sunDir.x, sunDir.y, sunDir.z],
      moon: [-sunDir.x, -sunDir.y, -sunDir.z],
      sunHeight: sunDir.y,
      night,
      overcast: this.sky.overcast,
      weather: this.currentWeather,
    };
    this.env.update(СЃРѕСЃС‚РѕСЏРЅРёРµРќРµР±Р°, dt);

    // Р’РѕРґР°. РњР°С‚РµСЂРёР°Р»РѕРІ С‚РµРїРµСЂСЊ С‡РµС‚С‹СЂРµ (РѕР·РµСЂРѕ, РїСЂСѓРґ, СЂРµРєР°, РјРѕСЂРµ) РїР»СЋСЃ РіРѕСЂРѕРґСЃРєР°СЏ
    // РјРµР»РєР°СЏ РІРѕРґР°, Рё Сѓ РєР°Р¶РґРѕРіРѕ СЃРІРѕР№ СѓСЂРѕРІРµРЅСЊ Рё СЃРІРѕСЏ РіР»СѓР±РёРЅР°, РїРѕСЌС‚РѕРјСѓ РѕР±С…РѕРґ РёРґС‘С‚
    // РїРѕ РІСЃРµРј. Р Р°РЅСЊС€Рµ Р±С‹Р» РѕРґРёРЅ РѕР±С‰РёР№ РјР°С‚РµСЂРёР°Р» СЃ СѓСЂРѕРІРЅРµРј РѕР·РµСЂР°: РјРѕСЂРµ РїРѕР»СѓС‡Р°Р»Рѕ
    // С‡СѓР¶РёРµ -3.2 Рј РіР»СѓР±РёРЅС‹ Рё СЂРёСЃРѕРІР°Р»РѕСЃСЊ С†РІРµС‚РѕРј РјРµР»РєРѕР№ Р»Р°РіСѓРЅС‹.
    //
    // Р’СЂРµРјСЏ Сѓ РІСЃРµС… РѕРґРЅРѕ Рё С‚Рѕ Р¶Рµ - РёРЅР°С‡Рµ РІРѕР»РЅС‹ РЅР° СЃС‚С‹РєРµ С‚РµР» СЂР°Р·РѕС€Р»РёСЃСЊ Р±С‹ С„Р°Р·РѕР№.
    this.waterTime += dt;
    const chop = chopFor(this.currentWeather);
    // Р¤РѕРЅР°СЂРё РЅР° РІРѕРґРµ (В§256): РІРѕРґР° РЅРµ Р·РЅР°Р»Р° РїСЂРѕ С‚РѕС‡РµС‡РЅС‹Рµ РёСЃС‚РѕС‡РЅРёРєРё, Рё РїСЂСѓРґ СЂСЏРґРѕРј
    // СЃ РіРѕСЂСЏС‰РёРј С„РѕРЅР°СЂС‘Рј РѕСЃС‚Р°РІР°Р»СЃСЏ С‡С‘СЂРЅС‹Рј. Р‘Р»РёР¶РЅРёРµ Рє РєР°РјРµСЂРµ Р»Р°РјРїС‹ (РІРѕСЃРµРјСЊ) РёРґСѓС‚
    // РІ С€РµР№РґРµСЂ СЂР°РІРЅРѕРјРµСЂРєР°РјРё: РґРѕ С€РµР№РґРµСЂР° РґРѕС…РѕРґРёС‚ С‚РѕР»СЊРєРѕ С‚Рѕ, С‡С‚Рѕ РІРёРґРЅРѕ.
    const Р»Р°РјРїС‹РЈР’РѕРґС‹: { d: number; light: THREE.PointLight }[] = [];
    for (const t of this.torches) {
      Р»Р°РјРїС‹РЈР’РѕРґС‹.push({ d: t.light.position.distanceTo(this.camera.position), light: t.light });
    }
    for (const l of this.lamps) {
      Р»Р°РјРїС‹РЈР’РѕРґС‹.push({ d: l.light.position.distanceTo(this.camera.position), light: l.light });
    }
    Р»Р°РјРїС‹РЈР’РѕРґС‹.sort((a, b) => a.d - b.d);
    const Р±Р»РёР¶РЅРёРµ = Р»Р°РјРїС‹РЈР’РѕРґС‹.slice(0, 8);
    for (const mat of waterMaterials) {
      const u = mat.uniforms;
      u.uTime.value = this.waterTime;
      u.uChop.value = chop;
      u.uSunDir.value.copy(lightDir).normalize();
      u.uSunColor.value.copy(this.sun.color);
      u.uSkyColor.value.copy(this.sky.horizonColor);
      u.uFogColor.value.copy(this.sky.horizonColor);
      u.uLampCount.value = Р±Р»РёР¶РЅРёРµ.length;
      for (let i = 0; i < Р±Р»РёР¶РЅРёРµ.length; i++) {
        u.uLampPos.value[i].copy(Р±Р»РёР¶РЅРёРµ[i].light.position);
        u.uLampColor.value[i]
          .copy(Р±Р»РёР¶РЅРёРµ[i].light.color)
          .multiplyScalar(Math.max(Р±Р»РёР¶РЅРёРµ[i].light.intensity, 0) * 0.6);
      }
    }
    // РЎРµС‚РєР° РјРѕСЂСЏ РµРґРµС‚ Р·Р° РєР°РјРµСЂРѕР№: РјРµР»РєР°СЏ РѕР±Р»Р°СЃС‚СЊ РѕР±СЏР·Р°РЅР° Р±С‹С‚СЊ РїРѕРґ РёРіСЂРѕРєРѕРј, Р° РЅРµ
    // РІ РјРёСЂРѕРІРѕРј РЅСѓР»Рµ, - РёРЅР°С‡Рµ, РѕС‚РѕР№РґСЏ РЅР° Р»РѕРґРєРµ РІРґРѕР»СЊ Р±РµСЂРµРіР°, РѕРЅ РѕРєР°Р·С‹РІР°РµС‚СЃСЏ РІ
    // РєСЂСѓРїРЅС‹С… С‚СЂРµСѓРіРѕР»СЊРЅРёРєР°С…, РіРґРµ РІРѕР»РЅСѓ СЂРёСЃРѕРІР°С‚СЊ РЅРµС‡РµРј.
    followSeaToCamera(this.camera.position.x);
    // Р‘Р°Р»Р°РЅСЃ СЃРІРµС‚Р° (Р·Р°РјРµСЂСЏРЅ РїРѕ РєР°РґСЂР°Рј СЃСѓС‚РѕРє, В§221): РґРЅС‘Рј РїРѕС‡С‚Рё РІСЃС‘ СЃРІРµС‚РёС‚
    // СЃРѕР»РЅС†Рµ (~3.2), РїРѕР»СѓСЃС„РµСЂР° Р»РёС€СЊ РїРѕРґСЃРІРµС‡РёРІР°РµС‚ С‚РµРЅРё (~0.13), Р° HDRI-РЅРµР±Рѕ
    // РґР°С‘С‚ РјСЏРіРєРёРµ РѕС‚СЂР°Р¶РµРЅРёСЏ (~0.25). Р Р°РЅСЊС€Рµ РїРѕР»СѓСЃС„РµСЂР° Рё env РґР°РІР°Р»Рё 0.83 /
    // 0.46 вЂ” РєР°РґСЂ В«РїР»С‹Р»В» РїР°СЃРјСѓСЂРЅРѕР№ СЃРµСЂРѕСЃС‚СЊСЋ РґР°Р¶Рµ РІ СЏСЃРЅС‹Р№ РїРѕР»РґРµРЅСЊ.
    // РќРѕС‡СЊ Р·Р°РјРµС‚РЅРѕ С‚РµРјРЅРµРµ СЃСѓРјРµСЂРµРє: Р»СѓРЅР° 0.12, Р° РЅРµ 0.32.
    const dim = 1 - this.sky.overcast * 0.45;
    this.sun.intensity = (useMoon ? 0.12 : 0.25 + dayI * 2.95) * dim;
    this.hemi.intensity = (0.05 + dayI * 0.08) * (1 - this.sky.overcast * 0.3);
    this.sun.color.setHex(useMoon ? 0x9db4e8 : night > 0.4 ? 0xffc98a : 0xffe8c0);
    if (this.sky.overcast > 0.3) {
      // Р’ РґРѕР¶РґСЊ Рё Р±СѓСЂСЋ СЃРІРµС‚ С…РѕР»РѕРґРЅРµРµ вЂ” С‚СѓС‡Рё РѕС‚СЂР°Р¶Р°СЋС‚ СЃРµСЂРѕРµ РЅРµР±Рѕ
      this.sun.color.lerp(new THREE.Color(0xb8c4d2), (this.sky.overcast - 0.3) / 0.7 * 0.5);
    }
    this.sun.position.set(
      me.pos.x + lightDir.x * 120,
      Math.max(24, lightDir.y * 120),
      me.pos.z + lightDir.z * 120,
    );
    this.sun.target.position.set(me.pos.x, 0, me.pos.z);
    // РўСѓРјР°РЅ РїРѕРґ С†РІРµС‚ РіРѕСЂРёР·РѕРЅС‚Р° вЂ” СЃС†РµРЅР° СЃР»РёРІР°РµС‚СЃСЏ СЃ РєСѓРїРѕР»РѕРј
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.sky.horizonColor);
    // Р“РѕРјРѕРЅ Р±Р°Р·Р°СЂР° вЂ” С‚РѕР»СЊРєРѕ РІ РіРѕСЂРѕРґРµ
    const inCity = Math.hypot(me.pos.x - CITY.x, me.pos.z - CITY.z) < CITY.radius + 12;
    if (inCity !== this.lastInCity) {
      this.lastInCity = inCity;
      audio.setCity(inCity);
    }
    // Р’РѕРґРѕРїР°Рґ: РїСЂРѕРєСЂСѓС‚РєР° С‚РµРєСЃС‚СѓСЂС‹ СЃС‚СЂСѓР№
    const waterfall = this.scene.getObjectByName('waterfall');
    if (waterfall) {
      const mat = (waterfall as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.offset.y = (mat.map.offset.y - dt * 0.55) % 1;
    }
    // Р¤Р°РєРµР»С‹ Рё РєРѕСЃС‚С‘СЂ
    // РџРѕРіРѕРґР° РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РїРѕСЃР»Рµ Р·Р°РїРёСЃРё С†РІРµС‚Р° С‚СѓРјР°РЅР° РёР· РЅРµР±Р°,
    // С‡С‚РѕР±С‹ РїРµСЃС‡Р°РЅР°СЏ Р±СѓСЂСЏ РјРѕРіР»Р° РїСЂРёРіР»СѓС€РёС‚СЊ РґР°Р»СЊРЅРѕСЃС‚СЊ РїРѕРІРµСЂС….
    this.weather.update(dt, me.pos.x, me.pos.z, me.pos.y, this.lastInCity);
    const torchOn = 0.35 + night * 0.65;
    for (const t of this.torches) {
      t.light.intensity = t.base * torchOn * (0.86 + Math.sin(now / 90 + t.phase) * 0.14);
    }
    // РЎРІРµС‚ РІ РїСЂРѕС‘РјР°С… Рё С„РѕРЅР°СЂРё РіРѕСЂСЏС‚ РїРѕСЃС‚РѕСЏРЅРЅРѕ: РїСЂРѕС…РѕРґ Р·Р°РєСЂС‹С‚ РѕС‚ СЃРѕР»РЅС†Р°, Рё
    // РґРЅС‘Рј С‚Р°Рј С‚РµРјРЅРѕ С‚Р°Рє Р¶Рµ, РєР°Рє РЅРѕС‡СЊСЋ.
    for (const l of this.lamps) {
      l.light.intensity = l.base;
    }
    for (const f of this.flames) {
      f.scale.y = 1 + Math.sin(now / 70) * 0.18;
    }
    // Р”С‹Рј РЅР°Рґ РѕРіРЅСЏРјРё (В§255): РєР»СѓР± РІС‹С…РѕРґРёС‚ РёР· РѕРіРЅСЏ Рё СѓС…РѕРґРёС‚ РІРІРµСЂС….
    for (const Рґ of this.РґС‹Рј) {
      Рґ.С‚Р°Р№РјРµСЂ += dt;
      if (Рґ.С‚Р°Р№РјРµСЂ >= 0.14) {
        Рґ.С‚Р°Р№РјРµСЂ = 0;
        Рґ.РґС‹Рј.РІСЃРїР»РµСЃРє(Рґ.x, Рґ.y, Рґ.z);
      }
      Рґ.РґС‹Рј.update(dt);
    }
    // Р§Р°Р№РєРё СЃР»РµС‚Р°СЋС‚ СЃ РїСЂРёС‡Р°Р»Р°, РєРѕРіРґР° РёРіСЂРѕРє РїРѕРґС…РѕРґРёС‚ (В§278): Р¶РёРІР°СЏ РїС‚РёС†Р° РѕС‚
    // С‡РµР»РѕРІРµРєР° СѓР»РµС‚Р°РµС‚, Р° РєР°РјРµРЅРЅР°СЏ вЂ” РЅРµС‚.
    for (const С‡ of С‡Р°Р№РєРёРќР°РџСЂРёС‡Р°Р»Рµ) {
      С‡.t += dt;
      const Р±Р»РёР·РєРѕ = Math.hypot(С‡.x - me.pos.x, С‡.z - me.pos.z) < 5;
      if (С‡.СЃРѕСЃС‚РѕСЏРЅРёРµ === 0 && Р±Р»РёР·РєРѕ) {
        // Р’Р·Р»С‘С‚: РІРІРµСЂС… Рё РІ СЃС‚РѕСЂРѕРЅСѓ РѕС‚ РёРіСЂРѕРєР°. РЎС‚РѕСЂРѕРЅР° вЂ” РїРѕ РґРµС‚РµСЂРјРёРЅРёСЂРѕРІР°РЅРЅРѕРјСѓ
        // РіРµРЅРµСЂР°С‚РѕСЂСѓ, Р° РЅРµ СЃР»СѓС‡Р°Р№РЅРѕ: РїРѕСЃР»Рµ РїРµСЂРµР·Р°РіСЂСѓР·РєРё СЃС‚СЂР°РЅРёС†С‹ С‡Р°Р№РєР° РґРѕР»Р¶РЅР°
        // СѓР»РµС‚РµС‚СЊ С‚Р°Рє Р¶Рµ.
        const Рє = hash2(Math.round(С‡.x), Math.round(С‡.z));
        const СѓРіРѕР» = Math.atan2(С‡.z - me.pos.z, С‡.x - me.pos.x) + (Рє - 0.5) * 1.4;
        С‡.СЃРѕСЃС‚РѕСЏРЅРёРµ = 1;
        С‡.t = 0;
        С‡.РіСЂСѓРїРїР°.userData.СѓРіРѕР» = СѓРіРѕР»;
      }
      if (С‡.СЃРѕСЃС‚РѕСЏРЅРёРµ === 1) {
        // РџРѕРґРЅРёРјР°РµС‚СЃСЏ Рё СѓС…РѕРґРёС‚: Р·Р° РїРѕР»С‚РѕСЂС‹ СЃРµРєСѓРЅРґС‹ вЂ” РјРµС‚СЂ РІРІРµСЂС… Рё С‚СЂРё РІ СЃС‚РѕСЂРѕРЅСѓ.
        const k = Math.min(1, С‡.t / 1.5);
        const СѓРіРѕР» = С‡.РіСЂСѓРїРїР°.userData.СѓРіРѕР» as number;
        С‡.РіСЂСѓРїРїР°.position.set(
          С‡.base.x + Math.cos(СѓРіРѕР») * 3 * k,
          С‡.base.y + 1.2 * k,
          С‡.base.z + Math.sin(СѓРіРѕР») * 3 * k,
        );
        С‡.РіСЂСѓРїРїР°.rotation.y = СѓРіРѕР» + Math.PI;
        if (С‡.t > 1.5) { С‡.СЃРѕСЃС‚РѕСЏРЅРёРµ = 2; С‡.t = 0; }
      } else if (С‡.СЃРѕСЃС‚РѕСЏРЅРёРµ === 2) {
        // РЈР»РµС‚РµР» Рё Р¶РґС‘С‚, РїРѕРєР° РѕС‚РѕР№РґС‘С€СЊ.
        if (С‡.t > 7) { С‡.СЃРѕСЃС‚РѕСЏРЅРёРµ = 3; С‡.t = 0; }
      } else if (С‡.СЃРѕСЃС‚РѕСЏРЅРёРµ === 3) {
        // Р’РѕР·РІСЂР°С‰Р°РµС‚СЃСЏ РЅР° РјРµСЃС‚Рѕ.
        const k = Math.max(0, 1 - С‡.t / 2);
        const СѓРіРѕР» = С‡.РіСЂСѓРїРїР°.userData.СѓРіРѕР» as number;
        С‡.РіСЂСѓРїРїР°.position.set(
          С‡.base.x + Math.cos(СѓРіРѕР») * 3 * k,
          С‡.base.y + 1.2 * k,
          С‡.base.z + Math.sin(СѓРіРѕР») * 3 * k,
        );
        if (С‡.t > 2) {
          С‡.СЃРѕСЃС‚РѕСЏРЅРёРµ = 0;
          С‡.РіСЂСѓРїРїР°.position.copy(С‡.base);
        }
      }
    }
    // Р›РѕРґРєРё Сѓ РїСЂРёС‡Р°Р»Р° РєР°С‡Р°СЋС‚СЃСЏ РІРјРµСЃС‚Рµ СЃ РІРѕРґРѕР№ (В§277).
    const Р»РѕРґРєРёРќР°Р’РѕРґРµ: { x: number; y: number; z: number }[] = [];
    for (const Р» of Р»РѕРґРєРёРЈРџРёСЂР°) {
      Р».РіСЂСѓРїРїР°.position.y = Р».y + Math.sin(now * 0.85 + Р».С„Р°Р·Р°) * 0.09;
      Р».РіСЂСѓРїРїР°.rotation.z = Math.sin(now * 0.62 + Р».С„Р°Р·Р°) * 0.035;
      Р».РіСЂСѓРїРїР°.rotation.x = Math.sin(now * 0.47 + Р».С„Р°Р·Р° * 1.7) * 0.02;
      // РњРёСЂРѕРІР°СЏ С‚РѕС‡РєР° Р»РѕРґРєРё вЂ” РґР»СЏ СЂСЏР±Рё (В§280).
      const РјРёСЂ = Р».РіСЂСѓРїРїР°.getWorldPosition(new THREE.Vector3());
      Р»РѕРґРєРёРќР°Р’РѕРґРµ.push({ x: РјРёСЂ.x, y: РјРёСЂ.y - 0.2, z: РјРёСЂ.z });
    }
    // Р СЏР±СЊ РѕС‚ Р»РѕРґРѕРє (В§280): РѕС‚ Р±РѕСЂС‚Р° СЂР°СЃС…РѕРґСЏС‚СЃСЏ РєСЂСѓРіРё.
    this.СЂСЏР±СЊ.update(dt, now, Р»РѕРґРєРёРќР°Р’РѕРґРµ);
    // РџС‹Р»СЊРЅС‹Рµ РІРёС…СЂРё (В§257): Р±СЂРѕРґСЏС‚ РїРѕ РїРµСЃРєСѓ СЂСЏРґРѕРј СЃ РёРіСЂРѕРєРѕРј.
    this.РІРёС…СЂРё.update(dt, now, me.pos.x, me.pos.z);
    // РџС‚РёС†С‹ (В§259): СЃС‚Р°СЏ РѕР±Р»РµС‚Р°РµС‚ РёРіСЂРѕРєР° РїРѕ РґСѓРіРµ.
    this.РїС‚РёС†С‹.update(dt, now, me.pos.x, me.pos.z, night, sunDir);
    // РњРѕРєСЂР°СЏ Р·РµРјР»СЏ (В§261) Рё СЃРЅРµРі РЅР° РЅРµР№ (В§262): РІ РґРѕР¶РґСЊ РїРµСЃРѕРє Рё РјРѕСЃС‚РѕРІР°СЏ
    // С‚РµРјРЅРµСЋС‚ Рё Р±Р»РµСЃС‚СЏС‚, РїРѕСЃР»Рµ РґРѕР¶РґСЏ РµС‰С‘ РЅРµРєРѕС‚РѕСЂРѕРµ РІСЂРµРјСЏ РјРѕРєСЂС‹Рµ; РІ СЃРЅРµРі Р·РµРјР»СЏ
    // Р±РµР»РµРµС‚, Рё СЃРЅРµРі Р»РµР¶РёС‚ РЅР° РЅРµР№ РґРѕР»РіРѕ вЂ” РґРѕР»СЊС€Рµ, С‡РµРј СЃРѕС…РЅРµС‚ РІРѕРґР°.
    const РёРґС‘С‚Р”РѕР¶РґСЊ = this.currentWeather === 'rain' || this.currentWeather === 'storm';
    if (РёРґС‘С‚Р”РѕР¶РґСЊ) this.РјРѕРєСЂРѕС‚Р° = Math.min(1, this.РјРѕРєСЂРѕС‚Р° + dt * 0.7);
    else this.РјРѕРєСЂРѕС‚Р° = Math.max(0, this.РјРѕРєСЂРѕС‚Р° - dt * 0.05);
    const РёРґС‘С‚РЎРЅРµРі = this.currentWeather === 'snow';
    if (РёРґС‘С‚РЎРЅРµРі) this.СЃРЅРµРі = Math.min(1, this.СЃРЅРµРі + dt * 0.25);
    else this.СЃРЅРµРі = Math.max(0, this.СЃРЅРµРі - dt * 0.02);
    // РџС‹Р»СЊ РѕС‚ Р±СѓСЂРё Р»РѕР¶РёС‚СЃСЏ РЅР° Р·РµРјР»СЋ (В§283): РІ РїРµСЃС‡Р°РЅРѕР№ Р±СѓСЂРµ Р·РµРјР»СЏ РЅРµ СЃРІРѕСЏ, Р°
    // СЂС‹Р¶Р°СЏ РѕС‚ РїС‹Р»Рё. РџС‹Р»СЊ РЅР°Р±РёСЂР°РµС‚СЃСЏ РЅРµ РјРіРЅРѕРІРµРЅРЅРѕ Рё СЃС…РѕРґРёС‚ РЅРµ СЃСЂР°Р·Сѓ.
    const РїС‹Р»РёС‚ = this.currentWeather === 'sandstorm';
    if (РїС‹Р»РёС‚) this.РїС‹Р»СЊ = Math.min(1, this.РїС‹Р»СЊ + dt * 0.5);
    else this.РїС‹Р»СЊ = Math.max(0, this.РїС‹Р»СЊ - dt * 0.25);
    setGroundState(this.РјРѕРєСЂРѕС‚Р°, this.СЃРЅРµРі, this.РїС‹Р»СЊ);
    // Р›СѓР¶Рё РЅР° РїР»РѕС‰Р°РґРё (В§264) Рё РІРѕРґР° РІ РєРѕР»РµСЏС… РґРѕСЂРѕРіРё, Р»СѓР¶Рё РІ РїСЂРёРіРѕСЂРѕРґРµ (В§269).
    // Р”РѕР¶РґСЊ РёРґС‘С‚ вЂ” РїРѕ Р»СѓР¶Р°Рј РёРґСѓС‚ РєСЂСѓРіРё РѕС‚ РєР°РїРµР»СЊ (В§285), Р° РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ РІРѕРґС‹
    // РїРµСЂРµСЃС‚Р°С‘С‚ Р±С‹С‚СЊ Р·РµСЂРєР°Р»РѕРј.
    const РґРѕР¶РґСЊ = this.currentWeather === 'rain' ? 1 : this.currentWeather === 'storm' ? 0.75 : 0;
    setPuddles(this.РјРѕРєСЂРѕС‚Р°, РґРѕР¶РґСЊ);
    this.СЂСЏР±СЊР›СѓР¶.update(dt, РґРѕР¶РґСЊ, this.РјРѕРєСЂРѕС‚Р°, me.pos.x, me.pos.z);
    this.РІРѕРґР°Р”РѕСЂРѕРіРё.update(dt, now, me.pos.x, me.pos.z, this.РјРѕРєСЂРѕС‚Р°);
    // РћС‚Р±Р»РµСЃРєРё С„РѕРЅР°СЂРµР№ РЅР° РјРѕРєСЂРѕР№ Р·РµРјР»Рµ (В§276): Р»Р°РјРїС‹ СЂСЏРґРѕРј СЃ РёРіСЂРѕРєРѕРј.
    const Р»Р°РјРїС‹Р”Р»СЏР‘Р»РµСЃРєР°: { x: number; y: number; z: number }[] = [];
    for (const t of this.torches) {
      Р»Р°РјРїС‹Р”Р»СЏР‘Р»РµСЃРєР°.push({ x: t.light.position.x, y: t.light.position.y, z: t.light.position.z });
    }
    for (const l of this.lamps) {
      Р»Р°РјРїС‹Р”Р»СЏР‘Р»РµСЃРєР°.push({ x: l.light.position.x, y: l.light.position.y, z: l.light.position.z });
    }
    this.РѕС‚Р±Р»РµСЃРєРё.update(dt, now, me.pos.x, me.pos.z, this.РјРѕРєСЂРѕС‚Р°, Р»Р°РјРїС‹Р”Р»СЏР‘Р»РµСЃРєР°);
    // РЎР»РµРґС‹ РєР°СЂР°РІР°РЅРѕРІ (В§270): РЅР° РјРѕРєСЂРѕРј РїРµСЃРєРµ РїСЂРѕСЃС‚СѓРїР°СЋС‚, РЅР° СЃСѓС…РѕРј вЂ” РµРґРІР°.
    this.СЃР»РµРґС‹РљР°СЂР°РІР°РЅРѕРІ.update(dt, now, me.pos.x, me.pos.z, this.РјРѕРєСЂРѕС‚Р°);
    // РЎРЅРµРі РЅР° Р·РµР»РµРЅРё Рё РєСЂС‹С€Р°С… (В§263): Р·РµРјР»СЏ Р±РµР»Р°СЏ, Р° РєСЂРѕРЅС‹ Рё С‡РµСЂРµРїРёС†Р° РµС‰С‘
    // Р»РµС‚РЅРёРµ вЂ” С‚Р°Рє СЃРЅРµРіРѕРїР°Рґ С‡РёС‚Р°РµС‚СЃСЏ РЅР°РїРѕР»РѕРІРёРЅСѓ РґРµРєРѕСЂР°С†РёРµР№.
    setSnowOnSurfaces(this.СЃРЅРµРі);
    // Р’РµС‚РµСЂ РєР°С‡Р°РµС‚ Р·РµР»РµРЅСЊ (В§258): РєСѓСЃС‚С‹, С‚СЂР°РІР° Рё РєСЂРѕРЅС‹ РґРµСЂРµРІСЊРµРІ СЃС‚РѕСЏР»Рё
    // РЅРµРїРѕРґРІРёР¶РЅРѕ, С…РѕС‚СЏ РІРµС‚РµСЂ РІ РјРёСЂРµ РµСЃС‚СЊ.
    //
    // РЎРР›Рђ Р’Р•РўР Рђ Р—РђР’РРЎРРў РћРў РџРћР“РћР”Р« (В§281). Р Р°РЅСЊС€Рµ РІ Р±СѓСЂРµ Р·РµР»РµРЅСЊ РєР°С‡Р°Р»Р°СЃСЊ
    // РІРґРІРѕРµ СЃРёР»СЊРЅРµРµ, Р° РІ С€С‚РёР»СЊ вЂ” С‚Р°Рє Р¶Рµ, РєР°Рє РІ Р±СѓСЂРµ: РІРµС‚РµСЂ РІ РјРёСЂРµ РѕРґРёРЅ, Рё
    // Р·РµР»РµРЅСЊ РµРіРѕ РЅРµ С‡СѓРІСЃС‚РІРѕРІР°Р»Р°. РўРµРїРµСЂСЊ РІ Р±СѓСЂРµ Р·РµР»РµРЅСЊ РјРµС‡РµС‚СЃСЏ, РІ С€С‚РёР»СЊ РµР»Рµ
    // Р·Р°РјРµС‚РЅРѕ, Р° РїРѕСЂС‹РІС‹ РёРґСѓС‚ С‡Р°С‰Рµ.
    const РІРµС‚РµСЂ = РІРµС‚РµСЂРЎРёР»С‹(this.currentWeather);
    for (const Рє of РєР°С‡Р°СЋС‰РёРµСЃСЏ) {
      // РўРѕР»СЊРєРѕ СЂСЏРґРѕРј СЃ РєР°РјРµСЂРѕР№: Р·Р° РіРѕСЂРёР·РѕРЅС‚РѕРј РєР°С‡Р°РЅРёРµ РЅРµ РІРёРґРЅРѕ, Р° СЃРїРёСЃРѕРє
      // СЂР°СЃС‚РµРЅРёР№ вЂ” РЅР° РІРµСЃСЊ РјРёСЂ.
      const dx = Рє.x - this.camera.position.x;
      const dz = Рє.z - this.camera.position.z;
      if (dx * dx + dz * dz > 4900) continue;
      // Р§РµРј СЃРёР»СЊРЅРµРµ РІРµС‚РµСЂ, С‚РµРј С‡Р°С‰Рµ РїРѕСЂС‹РІС‹.
      const Р±С‹СЃС‚СЂРѕ = 900 / РІРµС‚РµСЂ;
      const РїРѕСЂС‹РІ = Math.sin(now / Р±С‹СЃС‚СЂРѕ + Рє.С„Р°Р·Р°) * 0.6
        + Math.sin(now / (Р±С‹СЃС‚СЂРѕ * 0.48) + Рє.С„Р°Р·Р° * 2.3) * 0.4;
      const СЃРёР»Р° = Рє.Р°РјРїР»РёС‚СѓРґР° * РІРµС‚РµСЂ * (0.45 + 0.55 * РїРѕСЂС‹РІ);
      // РќР°РєР»РѕРЅ РїРѕ РІРµС‚СЂСѓ: РѕСЃСЊ РїРѕРІРѕСЂРѕС‚Р° РїРѕРїРµСЂС‘Рє РІРµС‚СЂР°.
      const РЅР°РєР»РѕРЅ = new THREE.Euler(
        Рє.Р±Р°Р·Р°.x + Math.sin(РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ) * СЃРёР»Р°,
        Рє.Р±Р°Р·Р°.y,
        Рє.Р±Р°Р·Р°.z + Math.cos(РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ) * СЃРёР»Р°,
      );
      if (Рє.РјР°С‚СЂРёС†С‹) {
        // РРЅСЃС‚Р°РЅСЃРЅРѕРµ РїРѕР»Рµ (InstancedMesh): РЅР°РєР»РѕРЅ РїРёС€РµРј РІ РјР°С‚СЂРёС†Сѓ РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ
        // СЌРєР·РµРјРїР»СЏСЂР° вЂ” РѕР±СЉРµРєС‚ РѕРґРёРЅ РЅР° РІСЃРµ, Р° С‚СЂСЏСЃС‘С‚СЃСЏ РЅР°РґРѕ РєР°Р¶РґРѕРµ РґРµСЂРµРІРѕ.
        const РјРµС€ = Рє.obj as THREE.InstancedMesh;
        const Рј = Рє.РјР°С‚СЂРёС†С‹[0];
        const РїРѕР·РёС†РёСЏ = new THREE.Vector3().setFromMatrixPosition(Рј);
        const РїРѕРІРѕСЂРѕС‚ = new THREE.Quaternion().setFromEuler(РЅР°РєР»РѕРЅ);
        const РјР°СЃС€С‚Р°Р± = new THREE.Vector3().setFromMatrixScale(Рј);
        const РёРЅРґРµРєСЃ = Рє.РёРЅРґРµРєСЃ ?? 0;
        РјРµС€.setMatrixAt(РёРЅРґРµРєСЃ, new THREE.Matrix4().compose(РїРѕР·РёС†РёСЏ, РїРѕРІРѕСЂРѕС‚, РјР°СЃС€С‚Р°Р±));
        РјРµС€.instanceMatrix.needsUpdate = true;
      } else {
        Рє.obj.rotation.set(
          Рє.Р±Р°Р·Р°.x + Math.sin(РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ) * СЃРёР»Р°,
          Рє.Р±Р°Р·Р°.y,
          Рє.Р±Р°Р·Р°.z + Math.cos(РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ) * СЃРёР»Р°,
        );
      }
    }
    // РћРіРЅРё С„РѕРЅР°СЂРµР№ РЅР°РєР»РѕРЅСЏСЋС‚СЃСЏ РїРѕ РІРµС‚СЂСѓ (В§282): РІ Р±СѓСЂСЋ РѕРіРѕРЅСЊ РІ С„РѕРЅР°СЂРµ
    // РєРѕР»С‹С€РµС‚СЃСЏ, Рё РЅРѕС‡РЅРѕР№ РіРѕСЂРѕРґ РІС‹РґР°С‘С‚ РїРѕРіРѕРґСѓ.
    for (const Рѕ of РѕРіРЅРёР¤РѕРЅР°СЂРµР№) {
      const С„Р°Р·Р° = Рѕ.base.x * 0.7 + Рѕ.base.z * 1.3;
      const РЅР°РєР»РѕРЅ = Math.sin(now / 620 + С„Р°Р·Р°) * 0.55 + Math.sin(now / 260 + С„Р°Р·Р° * 2.1) * 0.45;
      const СЃРґРІРёРі = РЅР°РєР»РѕРЅ * РІРµС‚РµСЂ * 0.06;
      Рѕ.mesh.position.set(
        Рѕ.base.x + Math.sin(РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ) * СЃРґРІРёРі,
        Рѕ.base.y,
        Рѕ.base.z + Math.cos(РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ) * СЃРґРІРёРі,
      );
      Рѕ.mesh.rotation.z = -Math.sin(РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ) * РЅР°РєР»РѕРЅ * РІРµС‚РµСЂ * 0.09;
      Рѕ.mesh.rotation.x = Math.cos(РќРђРџР РђР’Р›Р•РќРР•_Р’Р•РўР Рђ) * РЅР°РєР»РѕРЅ * РІРµС‚РµСЂ * 0.09;
    }

    if (this.attackCd > 0) this.attackCd -= dt;
    // РќРѕРІС‹Рµ РјР°С‚РµСЂРёР°Р»С‹ (РјРѕРЅСЃС‚СЂС‹, Р»РѕС€Р°РґРё, РєР°СЂР°РІР°РЅС‹) РїСЂРѕС€РёРІР°РµРј РїР°С‡РєРѕР№ СЂР°Р· РІ
    // РџР•Р РРћР”_РџР РћРЁРР’РљР СЃРµРєСѓРЅРґ: СЃРј. patchWorldMaterials.
    this.patchTimer += dt;
    if (this.patchTimer >= РџР•Р РРћР”_РџР РћРЁРР’РљР) {
      this.patchTimer = 0;
      this.patchWorldMaterials(false);
    }
    this.composer.render();
  }

  private attackAnim = false;

  dispose(): void {
    this.initРџРѕРєРѕР»РµРЅРёРµ++;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.ro?.disconnect();
    this.ro = null;
    if (document.pointerLockElement) document.exitPointerLock();
    for (const [, b] of this.rigs) b.rig.dispose();
    this.rigs.clear();
    this.sky?.dispose();
    // РћРєСЂСѓР¶РµРЅРёРµ вЂ” РїРѕСЃР»Рµ РЅРµР±Р° Рё РґРѕ СЂРµРЅРґРµСЂРµСЂР°: РµРіРѕ dispose() РѕР±СЂР°С‰Р°РµС‚СЃСЏ Рє
    // РіРµРЅРµСЂР°С‚РѕСЂСѓ PMREM, Р° С‚РѕС‚ Р¶РёРІС‘С‚ РЅР° СЂРµРЅРґРµСЂРµСЂРµ.
    this.env?.dispose();
    this.fauna?.dispose();
    this.npcs?.dispose();
    for (const Рґ of this.РґС‹Рј) Рґ.РґС‹Рј.dispose();
    this.РІРёС…СЂРё?.dispose();
    this.РѕС‚Р±Р»РµСЃРєРё?.dispose();
    this.СЂСЏР±СЊ?.dispose();
    this.РјР°СЂРµРІРѕ?.dispose();
    this.РїС‹Р»СЊР”РѕСЂРѕРіРё?.dispose();
    this.РІРѕРґР°Р”РѕСЂРѕРіРё?.dispose();
    this.СЃР»РµРґС‹РљР°СЂР°РІР°РЅРѕРІ?.dispose();
    this.РґС‹РјРўСЂСѓР±?.dispose();
    this.РїС‚РёС†С‹?.dispose();
    this.civilians?.dispose();
    this.townfolk?.dispose();
    this.weather?.dispose();
    this.interiors?.dispose();
    this.navigator?.dispose();
    // Р”РѕСЂРѕР¶РЅРѕРµ РґРІРёР¶РµРЅРёРµ С‚РѕР¶Рµ РЅСѓР¶РЅРѕ СЃРЅСЏС‚СЊ. Р•РіРѕ `dispose()` Р±С‹Р» РЅР°РїРёСЃР°РЅ, РЅРѕ РЅРµ
    // РІС‹Р·С‹РІР°Р»СЃСЏ РЅРёРѕС‚РєСѓРґР°: РєР°СЂР°РІР°РЅС‹ РѕСЃС‚Р°РІР°Р»РёСЃСЊ РІ СЃС‚Р°СЂРѕР№ СЃС†РµРЅРµ РІРјРµСЃС‚Рµ СЃРѕ СЃРІРѕРµР№
    // РіРµРѕРјРµС‚СЂРёРµР№, РјР°С‚РµСЂРёР°Р»Р°РјРё Рё С‚РµРєСЃС‚СѓСЂР°РјРё. РџСЂРё СЌС‚РѕРј `makePerson` СЃРѕР·РґР°С‘С‚
    // РЎР’РћР™ MeshStandardMaterial РЅР° РєР°Р¶РґС‹Р№ РєР°СЂР°РІР°РЅ (СЂРѕР±Р°, РєРѕР¶Р°, С€Р»СЏРїР°), С‚Р°Рє
    // С‡С‚Рѕ РЅР° РєР°Р¶РґС‹Р№ РІС…РѕРґ РІ РјРёСЂ СѓРµР·Р¶Р°Р»Р° РїР°С‡РєР° СѓРЅРёРєР°Р»СЊРЅС‹С… materials.
    this.roadTraffic?.dispose();
    // РњРёРєСЃРµСЂС‹ Р°РЅРёРјР°С†РёРё РєРѕСЂРѕРІ вЂ” РґРІСѓС…СѓСЂРѕРІРЅРµРІС‹Рµ СЃСЃС‹Р»РєРё РЅР° Р·Р°РіСЂСѓР¶РµРЅРЅС‹Рµ РєР»РёРїС‹;
    // Р±РµР· stop() Р°РЅРёРјР°С†РёРё РїСЂРѕРґРѕР»Р¶Р°СЋС‚ РєСЂСѓС‚РёС‚СЊСЃСЏ РґР»СЏ СЃРЅСЏС‚С‹С… СЃС†РµРЅС‹ РјРѕРґРµР»РµР№.
    for (const mx of this.cowMixers) mx.stopAllAction();
    // SSAO: РѕСЃРІРѕР±РѕР¶РґР°РµРј СЂРµРЅРґРµСЂ-С‚Р°СЂРіРµС‚С‹ РєРѕРјРїРѕР·РёС‚РѕСЂР°
    this.composer?.dispose();
    this.deferred?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.fxLayer?.remove();
    this.crosshair?.remove();
  }
}

function shortestAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

