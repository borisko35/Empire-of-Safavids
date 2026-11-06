// ============================================================
// Safavid Asset Loader — загрузка исторических моделей Сефевидов
// ============================================================
// Загружает объединённый GLB с моделями одежды, доспехов и оружия,
// предоставляет функции для клонирования отдельных ассетов по имени.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { сВходом } from './modelAccess';
import { SAFADIV_AVATAR_ASSETS, type SafavidAssetDef } from '../../assets/safavid/SafavidAssets';
import { getBuildingMaterial, type BuildingMaterialDef } from '../../assets/materials/BuildingMaterials';

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
      // Заголовок входа ставится перед КАЖДОЙ загрузкой, а не один раз при
      // создании загрузчика: игрок может выйти и войти другим аккаунтом без
      // перезагрузки страницы, и загрузчик со старым токеном молча перестал
      // бы отдавать модели (§ вход моделей закрыт auth_request в nginx).
      const gltf = await сВходом(loader).loadAsync(MODEL_BASE + 'safavid_assets.glb');

      // Индексируем загруженные объекты по имени
      const objectsByName = new Map<string, THREE.Object3D>();
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
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

        // Клонируем группу и меш
        const group = source.clone() as THREE.Group;
        group.name = id;

        // Найдём меш в клонированной группе
        let mesh: THREE.Mesh | null = null;
        group.traverse((child) => {
          if (child instanceof THREE.Mesh && !mesh) mesh = child;
        });

        // Замыкание выше не сужает тип: TS считает mesh всегда null.
        const finalMesh = mesh as THREE.Mesh | null;
        if (!finalMesh) {
          console.warn(`[SafavidLoader] No mesh found for asset "${id}"`);
          continue;
        }

        // Применяем материал из BuildingMaterials если есть ссылка
        let materialDef: BuildingMaterialDef | undefined;
        if (def.materialRef) {
          materialDef = getBuildingMaterial(def.materialRef);
          if (materialDef) {
            const pbr = materialDef.pbrSettings;
            finalMesh.material = new THREE.MeshStandardMaterial({
              color: pbr.color ?? def.defaultColor ?? 0xffffff,
              roughness: pbr.roughness ?? 0.7,
              metalness: pbr.metalness ?? 0.0,
              transparent: pbr.transparent ?? false,
              opacity: pbr.opacity ?? 1.0,
            });
          }
        }

        // Если нет материала, используем цвет по умолчанию
        const current = finalMesh.material as THREE.MeshStandardMaterial | undefined;
        if (!current || current === (source as THREE.Mesh).material) {
          finalMesh.material = new THREE.MeshStandardMaterial({
            color: def.defaultColor ?? 0xffffff,
          });
        }

        loadedCache.set(id, {
          id,
          def,
          group,
          mesh: finalMesh,
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
    if (child instanceof THREE.Mesh) {
      child.geometry = child.geometry.clone();
      const mat = child.material;
      child.material = Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => { m.name = `${id}_material`; });
      } else {
        child.material.name = `${id}_material`;
      }
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