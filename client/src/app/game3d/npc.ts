// ============================================================
// NPC всех поселений — Empire of Safavids
// ============================================================
// Исфахан (площадь), приозёрный порт, караван-сарай в пустыне,
// лесная деревня и горный форт. Риги из rig.ts, над головой — имя
// и золотой маркер «!» у квестодателей. Клик по NPC (луч из камеры)
// открывает связанную панель — маппинг в panel.

import * as THREE from 'three';
import { buildHumanoid, HumanoidCfg } from './rig';
import { CITY, PORT, CARAVANSERAI, VILLAGE, FORT, COLLIDERS, groundHeight } from './terrain';

export interface NpcDef {
  id: string;
  nameRu: string;
  /** Панель HUD, которую открывает клик по NPC */
  panel: string;
  /** Квестодатель: рисуем золотой маркер «!» */
  quest: boolean;
  /** Смещение от origin поселения */
  dx: number;
  dz: number;
  look: HumanoidCfg;
}

export interface NpcGroup {
  origin: { x: number; z: number };
  npcs: NpcDef[];
}

const GUARD = (robe = 0x8b1a1a): HumanoidCfg => ({ robe, robeDark: 0x5e1212, hat: 'helmet', hatColor: 0xb2b8c4, weapon: 'sword', shield: true, scale: 1.04 });

export const NPC_GROUPS: NpcGroup[] = [
  // ── Исфахан ──
  {
    origin: CITY,
    npcs: [
      { id: 'npc_quest_crier', nameRu: 'Глашатай Шаха', panel: 'panel-quests', quest: true, dx: -8, dz: 10, look: { robe: 0x3f5a7a, robeDark: 0x2c4258, hat: 'turban', hatColor: 0xd9c27a, weapon: 'none', scale: 1 } },
      { id: 'npc_guard_east', nameRu: 'Стражник Рустам', panel: 'panel-dungeons', quest: true, dx: 20, dz: 16, look: GUARD() },
      { id: 'npc_guard_west', nameRu: 'Стражник Бахрам', panel: 'panel-dungeons', quest: false, dx: -24, dz: -6, look: GUARD() },
      { id: 'npc_bazaar_merchant', nameRu: 'Торговец Джафар', panel: 'panel-shop', quest: true, dx: 15, dz: 2, look: { robe: 0x2e8b8b, robeDark: 0x1f6161, hat: 'turban', hatColor: 0xe8e0d0, weapon: 'dagger', scale: 1 } },
      { id: 'npc_auctioneer', nameRu: 'Аукционист', panel: 'panel-auction', quest: false, dx: 16, dz: -10, look: { robe: 0x7a5fd0, robeDark: 0x5a449c, hat: 'turban', hatColor: 0xc9a84c, weapon: 'none', scale: 0.98 } },
      { id: 'npc_craftsman', nameRu: 'Кузнец Омар', panel: 'panel-craft', quest: true, dx: -14, dz: -14, look: { robe: 0x6e563a, robeDark: 0x4c3a22, hat: 'cap', hatColor: 0x2a2a30, weapon: 'none', scale: 1.05 } },
      { id: 'npc_caravan_master', nameRu: 'Караван-баши Юсуф', panel: 'panel-trade', quest: true, dx: -4, dz: 22, look: { robe: 0x9c6b2f, robeDark: 0x6e4a20, hat: 'turban', hatColor: 0xb59d72, weapon: 'sword', scale: 1.02 } },
      { id: 'npc_poet', nameRu: 'Поэт Хафиз', panel: 'panel-quests', quest: false, dx: 6, dz: -20, look: { robe: 0xe8e0d0, robeDark: 0xbdb4a2, hat: 'turban', hatColor: 0x2e8b8b, weapon: 'none', scale: 0.96 } },
      { id: 'npc_guard_gate', nameRu: 'Привратник', panel: 'panel-party', quest: false, dx: 26, dz: 6, look: GUARD(0x50565e) },
  // ── Стражники городских ворот (проход на юго-западе) ──
  { id: 'npc_gate_guard_l', nameRu: 'Стражник Фарид', panel: 'panel-dungeons', quest: false, dx: -43.1, dz: -36.5, look: { robe: 0x8b1a1a, robeDark: 0x5e1212, hat: 'helmet', hatColor: 0xb2b8c4, weapon: 'sword', shield: true, scale: 1.04 } },
  { id: 'npc_gate_guard_r', nameRu: 'Стражник Кавус', panel: 'panel-dungeons', quest: false, dx: -46.5, dz: -32.1, look: { robe: 0x8b1a1a, robeDark: 0x5e1212, hat: 'helmet', hatColor: 0xb2b8c4, weapon: 'sword', shield: true, scale: 1.04 } },
  { id: 'npc_gate_archer_l', nameRu: 'Лучник Марван', panel: 'panel-party', quest: false, dx: -46.0, dz: -39.5, look: { robe: 0x605040, robeDark: 0x40362c, hat: 'hood', hatColor: 0x4c3a22, weapon: 'bow', scale: 1 } },
  { id: 'npc_gate_archer_r', nameRu: 'Лучник Данияр', panel: 'panel-party', quest: false, dx: -50.1, dz: -34.1, look: { robe: 0x605040, robeDark: 0x40362c, hat: 'hood', hatColor: 0x4c3a22, weapon: 'bow', scale: 1 } },
      { id: 'npc_mystic', nameRu: 'Суфий Мевлана', panel: 'panel-quests', quest: true, dx: 2, dz: -26, look: { robe: 0xd9c27a, robeDark: 0xa8954f, hat: 'hood', hatColor: 0x7a5f3c, weapon: 'staff', scale: 0.98 } },
    ],
  },
  // ── Приозёрный порт ──
  {
    origin: PORT,
    npcs: [
      { id: 'npc_fisherman', nameRu: 'Рыбак Тигран', panel: 'panel-quests', quest: true, dx: -3, dz: 6, look: { robe: 0x3d6a8a, robeDark: 0x2a4c63, hat: 'cap', hatColor: 0x8a6a42, weapon: 'none', scale: 1 } },
      { id: 'npc_harbor_master', nameRu: 'Хозяйка пристани Лейла', panel: 'panel-trade', quest: true, dx: 6, dz: 3, look: { robe: 0x2e8b8b, robeDark: 0x1f6161, hat: 'turban', hatColor: 0xe8e0d0, weapon: 'dagger', scale: 0.97 } },
      { id: 'npc_port_guard', nameRu: 'Дозорный моря', panel: 'panel-dungeons', quest: false, dx: -9, dz: -4, look: GUARD(0x2a4c63) },
      { id: 'npc_sailor', nameRu: 'Кок Салим', panel: 'panel-shop', quest: false, dx: 10, dz: -6, look: { robe: 0xb5763a, robeDark: 0x8a5628, hat: 'cap', hatColor: 0x4c3a22, weapon: 'none', scale: 1.02 } },
    ],
  },
  // ── Караван-сарай в пустыне ──
  {
    origin: CARAVANSERAI,
    npcs: [
      { id: 'npc_desert_master', nameRu: 'Караван-баши Рахим', panel: 'panel-trade', quest: true, dx: 5, dz: 9, look: { robe: 0x9c6b2f, robeDark: 0x6e4a20, hat: 'turban', hatColor: 0xb59d72, weapon: 'sword', scale: 1.03 } },
      { id: 'npc_desert_scout', nameRu: 'Проводник Захра', panel: 'panel-quests', quest: true, dx: -7, dz: 5, look: { robe: 0xc2a15a, robeDark: 0x96793d, hat: 'hood', hatColor: 0x8a6a42, weapon: 'bow', scale: 0.98 } },
      { id: 'npc_desert_guard', nameRu: 'Стражник каравана', panel: 'panel-dungeons', quest: false, dx: 10, dz: -6, look: GUARD(0x6e4a20) },
      { id: 'npc_desert_merchant', nameRu: 'Торгаш Фарид', panel: 'panel-shop', quest: false, dx: -3, dz: -9, look: { robe: 0x7a5fd0, robeDark: 0x5a449c, hat: 'turban', hatColor: 0xe8e0d0, weapon: 'dagger', scale: 0.97 } },
    ],
  },
  // ── Лесная деревня ──
  {
    origin: VILLAGE,
    npcs: [
      { id: 'npc_forester', nameRu: 'Лесничий Давид', panel: 'panel-quests', quest: true, dx: 4, dz: 6, look: { robe: 0x3d5230, robeDark: 0x2a3a20, hat: 'cap', hatColor: 0x4c3a22, weapon: 'bow', scale: 1.02 } },
      { id: 'npc_woodcutter', nameRu: 'Дровосек Гурген', panel: 'panel-craft', quest: false, dx: -6, dz: 3, look: { robe: 0x6e563a, robeDark: 0x4c3a22, hat: 'none', hatColor: 0x2c201a, weapon: 'sword', scale: 1.08 } },
      { id: 'npc_healer', nameRu: 'Целительница Нарэ', panel: 'panel-quests', quest: true, dx: 2, dz: -7, look: { robe: 0xe8e0d0, robeDark: 0xbdb4a2, hat: 'hood', hatColor: 0x8a6a42, weapon: 'staff', scale: 0.96 } },
      { id: 'npc_village_trader', nameRu: 'Торговка Ануш', panel: 'panel-shop', quest: false, dx: -4, dz: -5, look: { robe: 0x8b4a6a, robeDark: 0x6a3550, hat: 'turban', hatColor: 0xd9c27a, weapon: 'none', scale: 0.95 } },
    ],
  },
  // ── Горный форт ──
  {
    origin: FORT,
    npcs: [
      { id: 'npc_fort_commander', nameRu: 'Комендант Ашот', panel: 'panel-dungeons', quest: true, dx: 0, dz: 9, look: GUARD(0x5a449c) },
      { id: 'npc_fort_smith', nameRu: 'Оружейник Вахтанг', panel: 'panel-craft', quest: false, dx: -8, dz: 4, look: { robe: 0x4c3a22, robeDark: 0x332616, hat: 'cap', hatColor: 0x2a2a30, weapon: 'none', scale: 1.06 } },
      { id: 'npc_fort_guard', nameRu: 'Горный стрелок', panel: 'panel-party', quest: false, dx: 8, dz: 5, look: GUARD(0x605040) },
      { id: 'npc_fort_guide', nameRu: 'Проводник Сирина', panel: 'panel-quests', quest: true, dx: 4, dz: -4, look: { robe: 0x9db4e8, robeDark: 0x6a80b0, hat: 'hood', hatColor: 0xb2b8c4, weapon: 'bow', scale: 0.97 } },
    ],
  },
];

function textSprite(text: string): THREE.Sprite {
  // Холст с запасом: длинные имена («Караван-баши Юсуф») не должны
  // обрезаться краем текстуры
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 26px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(text).width;
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1a1208';
  ctx.strokeText(text, 256, 34);
  ctx.fillStyle = '#f5f0e8';
  ctx.fillText(text, 256, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  // Ширина в мире — по фактической длине текста (короткие имена не тянутся)
  const worldW = Math.max(2.4, ((textWidth + 34) / 64) * 0.78);
  sprite.scale.set(worldW, 0.78, 1);
  return sprite;
}

function questMarker(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 52px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#2a1c08';
  ctx.strokeText('!', 32, 34);
  ctx.fillStyle = '#ffc94a';
  ctx.fillText('!', 32, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(0.85, 0.85, 1);
  return sprite;
}

export interface NpcsHandle {
  update(dt: number, now: number): void;
  /** Меши для луча клика (по userData.npcPanel и userData.npcName) */
  clickTargets: THREE.Object3D[];
  dispose(): void;
}

export function createNpcs(scene: THREE.Scene): NpcsHandle {
  const group = new THREE.Group();
  const clickTargets: THREE.Object3D[] = [];
  const markers: { sprite: THREE.Sprite; phase: number; baseY: number }[] = [];
  const rigs: { update: (dt: number, p: { moving: boolean; speed: number; grounded: boolean; crouch: boolean; block: boolean; dead: boolean }) => void }[] = [];

  for (const { origin, npcs } of NPC_GROUPS) {
    for (const def of npcs) {
      const x = origin.x + def.dx;
      const z = origin.z + def.dz;
      const y = groundHeight(x, z);

      const rig = buildHumanoid(def.look);
      rig.group.position.set(x, y, z);
      // Лицом к центру поселения
      rig.group.rotation.y = Math.atan2(origin.x - x, origin.z - z) + Math.PI;
      rig.group.traverse(o => {
        o.userData.npcPanel = def.panel;
        o.userData.npcName = def.nameRu;
      });
      group.add(rig.group);
      rigs.push({ update: (dt, p) => rig.update(dt, p) });
      clickTargets.push(rig.group);
      COLLIDERS.push({ x, z, r: 0.55 });

      // Имя над головой
      const name = textSprite(def.nameRu);
      name.position.set(x, y + 2.35, z);
      group.add(name);

      // Маркер квеста «!»
      if (def.quest) {
        const marker = questMarker();
        marker.position.set(x, y + 3.15, z);
        group.add(marker);
        markers.push({ sprite: marker, phase: Math.random() * Math.PI * 2, baseY: y + 3.15 });
      }
    }
  }

  scene.add(group);

  function update(dt: number, now: number): void {
    for (const r of rigs) {
      r.update(dt, { moving: false, speed: 0, grounded: true, crouch: false, block: false, dead: false });
    }
    for (const m of markers) {
      m.sprite.position.y = m.baseY + Math.sin(now / 380 + m.phase) * 0.14;
    }
  }

  function dispose(): void {
    for (const t of clickTargets) {
      t.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    scene.remove(group);
  }

  return { update, clickTargets, dispose };
}
