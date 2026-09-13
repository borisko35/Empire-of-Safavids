// ============================================================
// NPC города — Empire of Safavids
// ============================================================
// Жители и квестодатели Исфахана: стража у ворот, торговцы у базара,
// ремесленник, аукционист, караван-баши, поэт. Риги из rig.ts,
// над головой — имя и золотой маркер «!» у квестодателей. Клик по
// NPC (луч из камеры) открывает связанную панель — маппинг в panel.

import * as THREE from 'three';
import { buildHumanoid, HumanoidCfg } from './rig';
import { CITY, COLLIDERS, terrainHeight } from './terrain';

export interface NpcDef {
  id: string;
  nameRu: string;
  /** Панель HUD, которую открывает клик по NPC */
  panel: string;
  /** Квестодатель: рисуем золотой маркер «!» */
  quest: boolean;
  /** Смещение от центра города */
  dx: number;
  dz: number;
  look: HumanoidCfg;
}

export const CITY_NPCS: NpcDef[] = [
  {
    id: 'npc_quest_crier', nameRu: 'Глашатай Шаха', panel: 'panel-quests', quest: true,
    dx: -8, dz: 10, look: { robe: 0x3f5a7a, robeDark: 0x2c4258, hat: 'turban', hatColor: 0xd9c27a, weapon: 'none', scale: 1 },
  },
  {
    id: 'npc_guard_east', nameRu: 'Стражник Рустам', panel: 'panel-dungeons', quest: true,
    dx: 20, dz: 16, look: { robe: 0x8b1a1a, robeDark: 0x5e1212, hat: 'helmet', hatColor: 0xb2b8c4, weapon: 'sword', shield: true, scale: 1.04 },
  },
  {
    id: 'npc_guard_west', nameRu: 'Стражник Бахрам', panel: 'panel-dungeons', quest: false,
    dx: -24, dz: -6, look: { robe: 0x8b1a1a, robeDark: 0x5e1212, hat: 'helmet', hatColor: 0xb2b8c4, weapon: 'sword', shield: true, scale: 1.04 },
  },
  {
    id: 'npc_bazaar_merchant', nameRu: 'Торговец Джафар', panel: 'panel-shop', quest: true,
    dx: 12, dz: -2, look: { robe: 0x2e8b8b, robeDark: 0x1f6161, hat: 'turban', hatColor: 0xe8e0d0, weapon: 'dagger', scale: 1 },
  },
  {
    id: 'npc_auctioneer', nameRu: 'Аукционист', panel: 'panel-auction', quest: false,
    dx: 16, dz: -10, look: { robe: 0x7a5fd0, robeDark: 0x5a449c, hat: 'turban', hatColor: 0xc9a84c, weapon: 'none', scale: 0.98 },
  },
  {
    id: 'npc_craftsman', nameRu: 'Кузнец Омар', panel: 'panel-craft', quest: true,
    dx: -14, dz: -14, look: { robe: 0x6e563a, robeDark: 0x4c3a22, hat: 'cap', hatColor: 0x2a2a30, weapon: 'none', scale: 1.05 },
  },
  {
    id: 'npc_caravan_master', nameRu: 'Караван-баши Юсуф', panel: 'panel-trade', quest: true,
    dx: -4, dz: 22, look: { robe: 0x9c6b2f, robeDark: 0x6e4a20, hat: 'turban', hatColor: 0xb59d72, weapon: 'sword', scale: 1.02 },
  },
  {
    id: 'npc_poet', nameRu: 'Поэт Хафиз', panel: 'panel-quests', quest: false,
    dx: 6, dz: -20, look: { robe: 0xe8e0d0, robeDark: 0xbdb4a2, hat: 'turban', hatColor: 0x2e8b8b, weapon: 'none', scale: 0.96 },
  },
  {
    id: 'npc_guard_gate', nameRu: 'Привратник', panel: 'panel-party', quest: false,
    dx: 26, dz: 6, look: { robe: 0x50565e, robeDark: 0x363b42, hat: 'helmet', hatColor: 0x8a909c, weapon: 'sword', shield: true, scale: 1 },
  },
  {
    id: 'npc_mystic', nameRu: 'Суфий Мевлана', panel: 'panel-quests', quest: true,
    dx: 2, dz: -26, look: { robe: 0xd9c27a, robeDark: 0xa8954f, hat: 'hood', hatColor: 0x7a5f3c, weapon: 'staff', scale: 0.98 },
  },
];

function textSprite(text: string, opts: { color: string; stroke: string; font: string }): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = opts.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = opts.stroke;
  ctx.strokeText(text, 128, 34);
  ctx.fillStyle = opts.color;
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(2.6, 0.65, 1);
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

  for (const def of CITY_NPCS) {
    const x = CITY.x + def.dx;
    const z = CITY.z + def.dz;
    const y = terrainHeight(x, z);

    const rig = buildHumanoid(def.look);
    rig.group.position.set(x, y, z);
    // Лицом к центру площади
    rig.group.rotation.y = Math.atan2(CITY.x - x, CITY.z - z) + Math.PI;
    rig.group.traverse(o => {
      o.userData.npcPanel = def.panel;
      o.userData.npcName = def.nameRu;
    });
    group.add(rig.group);
    rigs.push({ update: (dt, p) => rig.update(dt, p) });
    clickTargets.push(rig.group);
    COLLIDERS.push({ x, z, r: 0.55 });

    // Имя над головой
    const name = textSprite(def.nameRu, { color: '#f5f0e8', stroke: '#1a1208', font: 'bold 26px Georgia' });
    name.position.set(x, y + 2.35, z);
    name.scale.set(3.1, 0.78, 1);
    group.add(name);

    // Маркер квеста «!»
    if (def.quest) {
      const marker = questMarker();
      marker.position.set(x, y + 3.15, z);
      group.add(marker);
      markers.push({ sprite: marker, phase: Math.random() * Math.PI * 2, baseY: y + 3.15 });
    }
  }

  scene.add(group);

  function update(dt: number, now: number): void {
    // Лёгкая анимация покоя (дыхание/покачивание из рига)
    for (const r of rigs) {
      r.update(dt, { moving: false, speed: 0, grounded: true, crouch: false, block: false, dead: false });
    }
    // Подпрыгивающий маркер «!»
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
