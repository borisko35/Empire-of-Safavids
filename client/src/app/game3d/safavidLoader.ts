// ============================================================
// Safavid Asset Loader — загрузка исторических моделей Сефевидов
// ============================================================
// Загружает объединённый GLB с моделями одежды, доспехов и оружия,
// предоставляет функции для клонирования отдельных ассетов по имени.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SAFADIV_AVATAR_ASSETS, getSafavidAsset, type SafavidAssetDef } from '../assets/safavid/SafavidAssets';
import { BuildingMaterials, getBuildingMaterial, type BuildingMaterialDef } from '../assets/materials/BuildingMaterials';

export type SafavidLoadedAsset = {
  id: string;
  def: SafavidAssetDef;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: BuildingMaterialDef | undefined;
};

/** Кэш загруженных ассетов */
const loadedCache = new Map<string, SafavidLoadedAsset>();

/** Загрузчик GLB */
const loader = new GLTFLoader();

/** Базовый путь к моделям */
const MODEL_BASE = '/game/models/safavid/';

/** Статус загрузки */
let isLoading = false;
let loadPromise: Promise<void> | null = null;

/**
 * Загружает все ассеты Сефевидов из объединённого GLB.
 * Вызывается один раз при инициализации игры.
 */
export async function loadSafavidAssets(): Promise<void> {
  if (isLoading) return loadPromise!;
  if (loadedCache.size > 0) return;

  isLoading = true;
  loadPromise = (async () => {
    try {
      const gltf = await loader.loadAsync(MODEL_BASE + 'safavid_assets.glb');

      // Индексируем загруженные объекты по имени
      const objectsByName = new Map<string, THREE.Object3D>();
      gltf.scene.traverse((child) => {
        if (child.isMesh || child.isGroup) {
          objectsByName.set(child.name, child);
        }
      });

      // Создаём загруженные ассеты для каждого из каталога
      for (const [id, def] of Object.entries(SAFADIV_AVATAR_ASSETS)) {
        // Извлекаем имя объекта из modelPath (после #)
        const hashIndex = def.modelPath.indexOf('#');
        const objectName = hashIndex >= 0 ? def.modelPath.substring(hashIndex + 1) : def.id;

        const source = objectsByName.get(objectName);
        if (!source) {
          console.warn(`[SafavidLoader] Object "${objectName}" not found in GLB for asset "${id}"`);
          continue;
        }

        // Клонируем 그룹 и меш
        const group = source.clone() as THREE.Group;
        group.name = id;

        // Найдём меш в клонированном gruppo
        let mesh: THREE.Mesh | null = null;
        group.traverse((child) => {
          if (child.isMesh && !mesh) mesh = child as THREE.Mesh;
        });

        if (!mesh) {
          console.warn(`[SafavidLoader] No mesh found for asset "${id}"`);
          continue;
        }

        // Применяем материал из BuildingMaterials если есть ссылка
        let materialDef: BuildingMaterialDef | undefined;
        if (def.materialRef) {
          materialDef = getBuildingMaterial(def.materialRef);
          if (materialDef) {
            const pbr = materialDef.pbrSettings;
            const meshMaterial = new THREE.MeshStandardMaterial({
              color: pbr.color ?? def.defaultColor ?? 0xffffff,
              roughness: pbr.roughness ?? 0.7,
              metalness: pbr.metalness ?? 0.0,
              transparent: pbr.transparent ?? false,
              opacity: pbr.opacity ?? 1.0,
            });
            mesh.material = meshMaterial;
          }
        }

        // Если нет материала, используем цвет по умолчанию
        if (!mesh.material || mesh.material === (source as THREE.Mesh).material) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: def.defaultColor ?? 0xffffff,
          });
        }

        loadedCache.set(id, {
          id,
          def,
          group,
          mesh,
          material: materialDef,
        });
      }

      console.log(`[SafavidLoader] Loaded ${loadedCache.size} Safavid assets`);
    } catch (err) {
      console.error('[SafavidLoader] Failed to load assets:', err);
      throw err;
    } finally {
      isLoading = false;
    }
  })();

  return loadPromise;
}

/**
 * Получить загруженный ассет по ID (клонированный, готов к placement в сцене).
 * Возвращает новый Group с мешем, который можно добавить в scene.
 */
export function getSafavidAssetInstance(id: string): THREE.Group | null {
  const cached = loadedCache.get(id);
  if (!cached) return null;

  // Клонируем группу для независимого placement
  const instance = cached.group.clone();
  instance.name = id;

  // Клонируем меш и материал для независимости
  instance.traverse((child) => {
    if (child.isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry = mesh.geometry.clone();
      mesh.material = mesh.material.clone();
      mesh.material.name = `${id}_material`;
    }
  });

  return instance;
}

/** Проверить, загружен ли ассет */
export function isSafavidAssetLoaded(id: string): boolean {
  return loadedCache.has(id);
}

/** Получить все загруженные ID */
export function getLoadedSafavidAssetIds(): string[] {
  return Array.from(loadedCache.keys());
}

/** Очистить кэш */
export function clearSafavidAssetCache(): void {
  loadedCache.clear();
}