// ============================================================
// Building Materials Catalog — Empire of Safavids
// ============================================================
// Реальные материалы для зданий, построек и архитектуры.
// Использует three.js PBR материалы для реалистичного вида.
// 
// Каждый материал имеет:
// - id: уникальный идентификатор
// - name: название
// - nameRu/nameAz: переводы
// - type: тип материала (stone, wood, brick и т.д.)
// - pbrSettings: настройки PBR (roughness, metalness, color и т.д.)
// - category: категория (wall, roof, floor, detail и т.д.)

export type MaterialCategory = 
  | 'wall' 
  | 'roof' 
  | 'floor' 
  | 'detail' 
  | 'window' 
  | 'door' 
  | 'decoration'
  /**
   * Несущие элементы (балки, опоры): не стена и не пол, а каркас.
   * wood_beams живёт в этой категории.
   */
  | 'structural';

export type BuildingMaterialType = 
  | 'stone' 
  | 'brick' 
  | 'wood' 
  | 'concrete' 
  | 'metal' 
  | 'glass' 
  | 'thatched' 
  | 'carpet';

export interface BuildingMaterialDef {
  id: string;
  name: string;
  nameRu: string;
  nameAz: string;
  type: BuildingMaterialType;
  category: MaterialCategory;
  /** PBR настройки */
  pbrSettings: {
    color: number; // hex color (0xFFFFFF)
    roughness: number; // 0 = glossy, 1 = matte
    metalness: number; // 0 = non-metal, 1 = metal
    opacity?: number; // 0-1
    transparent?: boolean;
  };
  /** Размеры текстуры (если есть) */
  textureSizes?: {
    width: number;
    height: number;
  };
  /** Описание */
  description: string;
  descriptionRu: string;
  descriptionAz: string;
}

/** Каталог материалов для зданий */
export const BUILDING_MATERIALS: Record<string, BuildingMaterialDef> = {
  // === Камень ===
  'stone_brick': {
    id: 'stone_brick',
    name: 'Stone Brick',
    nameRu: 'Каменный кирпич',
    nameAz: 'Təmir tuğası',
    type: 'stone',
    category: 'wall',
    pbrSettings: {
      color: 0x8B7D6B,
      roughness: 0.7,
      metalness: 0.1,
    },
    description: 'Durable building material made from fired clay.',
    descriptionRu: 'Прочный строительный материал из обожженной глины.',
    descriptionAz: 'Dayanma malıclardan qurilgan ýer.',
  },
  'stone_blocks': {
    id: 'stone_blocks',
    name: 'Cut Stone Blocks',
    nameRu: 'Обработанный камень',
    nameAz: 'Hasıl olingan shanlik',
    type: 'stone',
    category: 'wall',
    pbrSettings: {
      color: 0x9E9E9E,
      roughness: 0.5,
      metalness: 0.0,
    },
    description: 'Squared stone blocks for premium construction.',
    descriptionRu: 'Квадратные каменные блоки для премиум-строительства.',
    descriptionAz: 'Premium qurilish uchun kvadratli shanliklar.',
  },
  
  // === Дерево ===
  'wood_planks': {
    id: 'wood_planks',
    name: 'Wood Planks',
    nameRu: 'Доски',
    nameAz: 'Sudaklar',
    type: 'wood',
    category: 'wall',
    pbrSettings: {
      color: 0xD2B48C,
      roughness: 0.5,
      metalness: 0.0,
    },
    description: 'Flat wooden planks for walls and flooring.',
    descriptionRu: 'Плоские доски для стен и напольного покрытия.',
    descriptionAz: 'Duvar ve flooring ıçin düz ahşap boardlar.',
  },
  'wood_beams': {
    id: 'wood_beams',
    name: 'Exposed Beams',
    nameRu: 'Обрезные бревна',
    nameAz: 'Çürük chemir',
    type: 'wood',
    category: 'structural',
    pbrSettings: {
      color: 0xC1440E,
      roughness: 0.6,
      metalness: 0.0,
    },
    description: 'Heavy timber beams for structural support.',
    descriptionRu: 'Тяжелые деревянные бревна для структурной поддержки.',
    descriptionAz: 'Rahbariqi assistance uchun Sami məhdudiyyətli.',
  },
  
  // === Кирпич ===
  'brick_red': {
    id: 'brick_red',
    name: 'Red Brick',
    nameRu: 'Красный кирпич',
    nameAz: 'Kızıl tuğası',
    type: 'brick',
    category: 'wall',
    pbrSettings: {
      color: 0xA45A5A,
      roughness: 0.8,
      metalness: 0.0,
    },
    description: 'Classic red brick for construction.',
    descriptionRu: 'Классический красный кирпич для construction.',
    descriptionAz: 'Clasik kırmızı tuğas.',
  },
  'brick_old': {
    id: 'brick_old',
    name: 'Weathered Brick',
    nameRu: 'Поврежденный кирпич',
    nameAz: 'Xariciyin etkilimişdir tuğası',
    type: 'brick',
    category: 'wall',
    pbrSettings: {
      color: 0x7A4A3F,
      roughness: 0.9,
      metalness: 0.0,
    },
    description: 'Aged brick with wear texture.',
    descriptionRu: 'Износившийся кирпич с текстурой износа.',
    descriptionAz: 'İncirlenmiş tuğas aşındarma ilə.',
  },
  
  // === Стекло ===
  'glass_clear': {
    id: 'glass_clear',
    name: 'Clear Glass',
    nameRu: 'Чистое стекло',
    nameAz: 'Açık cam',
    type: 'glass',
    category: 'window',
    pbrSettings: {
      color: 0xFFFFFF,
      roughness: 0.0,
      metalness: 0.0,
      opacity: 0.9,
      transparent: true,
    },
    description: 'Transparent glass for windows.',
    descriptionRu: 'Прозрачное стекло для окон.',
    descriptionAz: 'Pencereler için cam.',
  },
  'glass_tinted': {
    id: 'glass_tinted',
    name: 'Tinted Glass',
    nameRu: 'Тонированное стекло',
    nameAz: 'Renkli cam',
    type: 'glass',
    category: 'window',
    pbrSettings: {
      color: 0xFFCCCC,
      roughness: 0.1,
      metalness: 0.0,
      opacity: 0.7,
      transparent: true,
    },
    description: 'Colored glass for windows with UV protection.',
    descriptionRu: 'У protégé стекло для окон с защитой от УФ-излучения.',
    descriptionAz: 'UV koruması için renkli cam pencereler.',
  },
  
  // === Хвост roofs ===
  'thatched_roof': {
    id: 'thatched_roof',
    name: 'Thatch Roof',
    nameRu: 'Сaloneцкая крыша',
    nameAz: 'Takıc çatı',
    type: 'thatched',
    category: 'roof',
    pbrSettings: {
      color: 0x5D4037,
      roughness: 0.9,
      metalness: 0.0,
    },
    description: 'Traditional straw/thatch roofing.',
    descriptionRu: 'Традиционная соломенная крыша.',
    descriptionAz: 'Gelenekli solom çatı.',
  },
  'tile_roof': {
    id: 'tile_roof',
    name: 'Tile Roof',
    nameRu: 'Керамическая крыша',
    nameAz: 'Keramik çatı',
    type: 'thatched',
    category: 'roof',
    pbrSettings: {
      color: 0xE57373,
      roughness: 0.6,
      metalness: 0.0,
    },
    description: 'Ceramic tiles for roofing.',
    descriptionRu: 'Кeramическая крыша.',
    descriptionAz: 'Keramik çatı.',
  },
  
  // === Полы ===
  'floor_stone': {
    id: 'floor_stone',
    name: 'Stone Floor',
    nameRu: 'Каменный пол',
    nameAz: 'Shanlı dəkkän',
    type: 'stone',
    category: 'floor',
    pbrSettings: {
      color: 0x6B705C,
      roughness: 0.8,
      metalness: 0.0,
    },
    description: 'Durable stone flooring.',
    descriptionRu: 'Прочный каменный пол.',
    descriptionAz: 'Dayanma dəkkän.',
  },
  'floor_wood': {
    id: 'floor_wood',
    name: 'Wood Floor',
    nameRu: 'Деревянный пол',
    nameAz: 'Ahşap dəkkän',
    type: 'wood',
    category: 'floor',
    pbrSettings: {
      color: 0xF5F5DC,
      roughness: 0.4,
      metalness: 0.0,
    },
    description: 'Polished wooden flooring.',
    descriptionRu: 'Шлифованный деревянный пол.',
    descriptionAz: 'Yaşamış ahşap dəkkän.',
  },
};

// ============================================================
// Helper Functions
// ============================================================

/** Получить материал по ID */
export function getBuildingMaterial(id: string): BuildingMaterialDef | undefined {
  return BUILDING_MATERIALS[id];
}

/** Получить материалы по категории */
export function getMaterialsByCategory(category: MaterialCategory): BuildingMaterialDef[] {
  return Object.values(BUILDING_MATERIALS).filter(
    (mat) => mat.category === category
  );
}

/** Получить материалы по типу */
export function getMaterialsByType(type: BuildingMaterialType): BuildingMaterialDef[] {
  return Object.values(BUILDING_MATERIALS).filter(
    (mat) => mat.type === type
  );
}

/** Получить все материалы */
export function getAllMaterials(): BuildingMaterialDef[] {
  return Object.values(BUILDING_MATERIALS);
}

/** Получить уникальные типы материалов */
export function getUniqueTypes(): BuildingMaterialType[] {
  return Object.values(BUILDING_MATERIALS).map((mat) => mat.type);
}

/** Получить уникальные категории */
export function getUniqueCategories(): MaterialCategory[] {
  return Object.values(BUILDING_MATERIALS).map((mat) => mat.category);
}