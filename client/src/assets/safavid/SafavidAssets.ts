// ============================================================
// Safavid Era Historical Assets Catalog — Empire of Safavids
// ============================================================
// Историческая одежда, доспехи и оружие Сефевидов.
// Создано в Blender, экспортировано как GLB.
// Использует three.js для загрузки и рендеринга в игре.
//
// Каждый ассет имеет:
// - id: уникальный идентификатор
// - name: название
// - nameRu/nameAz: переводы
// - type: тип ассета (clothing, armor, weapon)
// - category: категория (robe, turban, coat, mail, helmet, sword, dagger, mace, bow)
// - modelPath: путь к GLB модели
// - materials: используемые материалы (ссылка на BuildingMaterials)
// - description: описание на 3 языках
// - stats: характеристики предмета (для доспехов и оружия)

export type SafavidAssetType = 'clothing' | 'armor' | 'weapon';
export type SafavidAssetCategory =
  | 'robe'       // халат/кафтан
  | 'turban'     // тюрбан
  | 'coat'       // верхняя одежда
  | 'mail'       // кольчуга
  | 'helmet'     // шлем
  | 'sword'      // меч
  | 'dagger'     // кинжал
  | 'mace'       // булава
  | 'bow';       // лук

export interface SafavidAssetDef {
  id: string;
  name: string;
  nameRu: string;
  nameAz: string;
  type: SafavidAssetType;
  category: SafavidAssetCategory;
  modelPath: string;
  /** Ссылка на материал из BuildingMaterials (если применимо) */
  materialRef?: string;
  /** Цвет по умолчанию для окраски */
  defaultColor?: number;
  /** Описание */
  description: string;
  descriptionRu: string;
  descriptionAz: string;
  /** Характеристики предмета */
  stats?: {
    defense?: number;      // для доспехов
    damage?: number;       // для оружия
    weight?: number;       // вес предмета
    durability?: number;   // прочность
  };
}

/** Каталог исторических ассетов Сефевидов */
export const SAFADIV_AVATAR_ASSETS: Record<string, SafavidAssetDef> = {

  // === ОДЕЖДА (Clothing) ===

  'qaba_royal': {
    id: 'qaba_royal',
    name: 'Royal Qaba',
    nameRu: 'Королевский кафтан',
    nameAz: 'Krəli qaba',
    type: 'clothing',
    category: 'robe',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Qaba_Royal',
    materialRef: 'Fabric_Velvet_DeepRed',
    defaultColor: 0x500505,
    description: 'Long velvet coat worn by Safavid nobility and courtiers.',
    descriptionRu: 'Длинный бархатный кафтан, который носили сефевидские аристократы и придворные.',
    descriptionAz: 'Seferavid aristokratları və rəhnər counciləri giyəcək uzun kətən qaba.',
    stats: { weight: 2.5, durability: 80 }
  },

  'turban_safavid': {
    id: 'turban_safavid',
    name: 'Safavid Turban',
    nameRu: 'Сефевидский тюрбан',
    nameAz: 'Seferavid türbanı',
    type: 'clothing',
    category: 'turban',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Turban_Safavid',
    materialRef: 'Fabric_Silk_Royal',
    defaultColor: 0x201030,
    description: 'Traditional silk turban worn by Safavid nobles and religious scholars.',
    descriptionRu: 'Традиционный шелковый тюрбан, который носили сефевидские аристократы и религиозные ученые.',
    descriptionAz: 'Seferavid aristokratları və dini əlimlər tərəfindən giyilən gelenəkli zülf towers.',
    stats: { weight: 0.3, durability: 60 }
  },

  'chogha_outer': {
    id: 'chogha_outer',
    name: 'Chogha Outer Coat',
    nameRu: 'Чога — верхнее платье',
    nameAz: 'Choga üst soup',
    type: 'clothing',
    category: 'coat',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Chogha_Outer',
    materialRef: 'Fabric_Wool',
    defaultColor: 0x605548,
    description: 'Long woolen outer coat for cold weather, common among Safavid soldiers and officials.',
    descriptionRu: 'Длинный шерстяной верхний плащ для холодной погоды, распространен среди сефевидских солдат и чиновников.',
    descriptionAz: 'Soyuq hava üçün uzun pawn üst soup, Seferavid asker və rəhbərlər arasında yaygın.',
    stats: { weight: 1.8, durability: 70 }
  },

  // === ДОСПЕХИ (Armor) ===

  'zireh_mail': {
    id: 'zireh_mail',
    name: 'Zireh Mail Shirt',
    nameRu: 'Зире — кольчужная рубаха',
    nameAz: 'Zireh zıngırlı gömlek',
    type: 'armor',
    category: 'mail',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Zireh_Mail_Shirt',
    materialRef: 'Mail_Chain',
    defaultColor: 0x9999A0,
    description: 'Traditional Persian mail armor providing flexible protection.',
    descriptionRu: 'Традиционная персидская кольчужная броня, обеспечивающая гибкую защиту.',
    descriptionAz: 'Gelenekli fars zıngırlı paltı, esnek müdafiə təmin edir.',
    stats: { defense: 25, weight: 8.0, durability: 100 }
  },

  'kolah_khud_helmet': {
    id: 'kolah_khud_helmet',
    name: 'Kolah-e Khud Helmet',
    nameRu: 'Колах-е-Худ — сефевидский шлем',
    nameAz: 'Kolah-e Khud Seferavid şələmi',
    type: 'armor',
    category: 'helmet',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Kolah_Khud_Helmet',
    materialRef: 'Metal_Steel',
    defaultColor: 0x707080,
    description: 'Safavid steel helmet with nasal guard and mail aventail for neck protection.',
    descriptionRu: 'Сефевидный стальной шлем с назальником и кольчужным aventail для защиты шеи.',
    descriptionAz: 'Seferavid pulad şələmi, burun qoruyucusu və zıngırlı boynun qoruyucusu ilə.',
    stats: { defense: 15, weight: 1.5, durability: 90 }
  },

  // === ОРУЖИЕ (Weapon) ===

  'shamshir_persian': {
    id: 'shamshir_persian',
    name: 'Shamshir',
    nameRu: 'Шамшир — персидский изогнутый меч',
    nameAz: 'Shamshir fars səvvəl θərxi qılıcı',
    type: 'weapon',
    category: 'sword',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Shamshir_Persian_Sword',
    materialRef: 'Metal_Steel',
    defaultColor: 0x707080,
    description: 'Curved Persian saber with distinctive radical curve, signature weapon of Safavid cavalry.',
    descriptionRu: 'Изогнутый персидский сабль с характерным радиусным изгибом, фирменное оружие сефевидской кавалерии.',
    descriptionAz: 'Hər xil bucaqlı fars şamşir, Seferavid süvarisinin işarəli silahlanması.',
    stats: { damage: 35, weight: 1.2, durability: 85 }
  },

  'qame_persian': {
    id: 'qame_persian',
    name: 'Qame',
    nameRu: 'Каме — персидский кинжал',
    nameAz: 'Qame fars xəncəri',
    type: 'weapon',
    category: 'dagger',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Qame_Persian_Dagger',
    materialRef: 'Metal_Steel',
    defaultColor: 0x707080,
    description: 'Short Persian dagger with double-edged blade, used for close combat.',
    descriptionRu: 'Короткий персидский кинжал с двуострым лезвием, используется для ближнего боя.',
    descriptionAz: 'Qısaca fars xəncər, iki qirmizi láhəsi ilə, qrüb-kuya möhrizəsində istifadə olunur.',
    stats: { damage: 18, weight: 0.4, durability: 60 }
  },

  'mace_safavid': {
    id: 'mace_safavid',
    name: 'Safavid Mace',
    nameRu: 'Сефевидская булава',
    nameAz: 'Seferavid gurz',
    type: 'weapon',
    category: 'mace',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Mace_Safavid',
    materialRef: 'Metal_Iron',
    defaultColor: 0x505055,
    description: 'Heavy iron mace with flanged head, effective against armored opponents.',
    descriptionRu: 'Тяжелая железная булава с ободной головкой, эффективна против противника в доспехах.',
    descriptionAz: 'Ağır demir gurz, Border başlı, paltılı müsahibəyə efficacy-yə məxsus.',
    stats: { damage: 40, weight: 2.0, durability: 95 }
  },

  'bow_persian': {
    id: 'bow_persian',
    name: 'Persian Composite Bow',
    nameRu: 'Персидский композитный лук',
    nameAz: 'Fars birləşdirilmiş kamani',
    type: 'weapon',
    category: 'bow',
    modelPath: '/assets/models/safavid/safavid_assets.glb#Bow_Stave',
    defaultColor: 0x8B4513,
    description: 'Traditional Persian composite bow used by Safavid archers.',
    descriptionRu: 'Традиционный персидский композитный лук, используемый сефевидскими лучниками.',
    descriptionAz: 'Gelenekli fars birləşdirilmiş kaman, Seferavid okçuları tərəfindən istifadə olunur.',
    stats: { damage: 28, weight: 0.8, durability: 75 }
  }

};

// ============================================================
// Helper Functions
// ============================================================

/** Получить ассет по ID */
export function getSafavidAsset(id: string): SafavidAssetDef | undefined {
  return SAFADIV_AVATAR_ASSETS[id];
}

/** Получить ассеты по типу */
export function getSafavidAssetsByType(type: SafavidAssetType): SafavidAssetDef[] {
  return Object.values(SAFADIV_AVATAR_ASSETS).filter(
    (asset) => asset.type === type
  );
}

/** Получить ассеты по категории */
export function getSafavidAssetsByCategory(category: SafavidAssetCategory): SafavidAssetDef[] {
  return Object.values(SAFADIV_AVATAR_ASSETS).filter(
    (asset) => asset.category === category
  );
}

/** Получить все ассеты */
export function getAllSafavidAssets(): SafavidAssetDef[] {
  return Object.values(SAFADIV_AVATAR_ASSETS);
}

/** Получить уникальные типы */
export function getSafavidAssetTypes(): SafavidAssetType[] {
  return [...new Set(Object.values(SAFADIV_AVATAR_ASSETS).map((a) => a.type))];
}

/** Получить уникальные категории */
export function getSafavidAssetCategories(): SafavidAssetCategory[] {
  return [...new Set(Object.values(SAFADIV_AVATAR_ASSETS).map((a) => a.category))];
}