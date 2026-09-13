// ============================================================
// Стрелка-навигатор по активному квесту — Empire of Safavids
// ============================================================
// Золотая стрелка парит над игроком и поворачивается к цели
// текущего квеста (ближайший нужный монстр, NPC или ориентир
// региона). Цель выставляет world.ts (резолвер по целям квеста).

import * as THREE from 'three';

export interface NavTarget {
  x: number;
  z: number;
  label: string;
}

export interface NavigatorHandle {
  setTarget(target: NavTarget | null): void;
  update(now: number, player: { x: number; z: number }): void;
  dispose(): void;
}

export function createNavigator(scene: THREE.Scene): NavigatorHandle {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc9a84c, emissive: 0xd89118, emissiveIntensity: 0.9,
    roughness: 0.35, metalness: 0.35,
  });
  // Древко и наконечник (стрелка смотрит вдоль +Z)
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 1.0), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 4), mat);
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.75;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.12), mat);
  tail.position.z = -0.5;
  group.add(shaft, head, tail);
  group.visible = false;
  scene.add(group);

  let target: NavTarget | null = null;

  return {
    setTarget(t: NavTarget | null): void {
      target = t;
      group.visible = !!t;
    },

    update(now: number, player: { x: number; z: number }): void {
      if (!target) return;
      // Курс на цель (горизонтальный) + покачивание над головой
      group.rotation.y = Math.atan2(target.x - player.x, target.z - player.z);
      group.position.set(player.x, 3.15 + Math.sin(now / 300) * 0.14, player.z);
      mat.emissiveIntensity = 0.8 + Math.sin(now / 170) * 0.3;
    },

    dispose(): void {
      shaft.geometry.dispose();
      head.geometry.dispose();
      tail.geometry.dispose();
      mat.dispose();
      scene.remove(group);
    },
  };
}
