// ============================================================
// Система крафтинга — Empire of Safavids
// ============================================================

export type CraftingCategory =
  | 'blacksmithing'   // Кузнечное дело
  | 'tailoring'       // Ткачество
  | 'alchemy'         // Алхимия
  | 'cooking'         // Кулинария
  | 'jewelcrafting'   // Ювелирное дело
  | 'carpentry';      // Плотницкое дело

export interface CraftingIngredient {
  itemId: string;
  quantity: number;
}

export interface CraftingRecipe {
  id: string;
  name: string;
  nameRu: string;
  category: CraftingCategory;
  resultItemId: string;
  resultQuantity: number;
  ingredients: CraftingIngredient[];
  craftingTime: number;   // секунды
  requiredLevel: number;  // уровень навыка крафтинга
  experienceGain: number;
  successRate: number;    // 0–1
  description: string;
}

export const CRAFTING_RECIPES: Record<string, CraftingRecipe> = {

  // ── КУЗНЕЧНОЕ ДЕЛО ──────────────────────────────────────────────
  'recipe_iron_sword': {
    id: 'recipe_iron_sword',
    name: 'Forge Iron Sword',
    nameRu: 'Ковка Железного Меча',
    category: 'blacksmithing',
    resultItemId: 'wpn_iron_sword',
    resultQuantity: 1,
    ingredients: [
      { itemId: 'mat_iron_ore', quantity: 10 },
    ],
    craftingTime: 30,
    requiredLevel: 1,
    experienceGain: 50,
    successRate: 0.95,
    description: 'Основной рецепт кузнеца.',
  },
  'recipe_qizilbash_saber': {
    id: 'recipe_qizilbash_saber',
    name: 'Forge Qizilbash Saber',
    nameRu: 'Ковка Сабли Кызылбаша',
    category: 'blacksmithing',
    resultItemId: 'wpn_qizilbash_saber',
    resultQuantity: 1,
    ingredients: [
      { itemId: 'mat_iron_ore', quantity: 50 },
      { itemId: 'mat_turquoise', quantity: 3 },
    ],
    craftingTime: 300,
    requiredLevel: 20,
    experienceGain: 500,
    successRate: 0.80,
    description: 'Требует мастерства кузнеца.',
  },
  'recipe_shah_blade': {
    id: 'recipe_shah_blade',
    name: "Forge Shah's Blade",
    nameRu: 'Ковка Клинка Шаха',
    category: 'blacksmithing',
    resultItemId: 'wpn_shah_blade',
    resultQuantity: 1,
    ingredients: [
      { itemId: 'mat_iron_ore', quantity: 200 },
      { itemId: 'mat_turquoise', quantity: 20 },
      { itemId: 'mat_dragon_scale', quantity: 5 },
    ],
    craftingTime: 3600,
    requiredLevel: 80,
    experienceGain: 10000,
    successRate: 0.50,
    description: 'Легендарный рецепт. Требует максимального уровня кузнеца.',
  },

  // ── ТКАЧЕСТВО ───────────────────────────────────────────────────
  'recipe_silk_robe': {
    id: 'recipe_silk_robe',
    name: 'Weave Isfahan Silk Robe',
    nameRu: 'Ткать Шёлковый Халат',
    category: 'tailoring',
    resultItemId: 'arm_silk_robe',
    resultQuantity: 1,
    ingredients: [
      { itemId: 'mat_silk', quantity: 30 },
      { itemId: 'mat_turquoise', quantity: 2 },
    ],
    craftingTime: 180,
    requiredLevel: 15,
    experienceGain: 300,
    successRate: 0.90,
    description: 'Роскошный халат для магов и дипломатов.',
  },
  'recipe_fur_coat': {
    id: 'recipe_fur_coat',
    name: 'Sew Fur Coat',
    nameRu: 'Сшить Меховую Шубу',
    category: 'tailoring',
    resultItemId: 'arm_fur_coat',
    resultQuantity: 1,
    ingredients: [
      { itemId: 'trophy_wolf_pelt', quantity: 12 },
      { itemId: 'trophy_wolf_fang', quantity: 2 },
      { itemId: 'mat_silk_thread', quantity: 4 },
    ],
    craftingTime: 240,
    requiredLevel: 10,
    experienceGain: 220,
    successRate: 0.85,
    description: 'Тёплая шуба из волчьих шкур. Греет и не боится мокрого снега.',
  },
  'recipe_hunter_amulet': {
    id: 'recipe_hunter_amulet',
    name: 'Set Hunter Amulet',
    nameRu: 'Собрать Амулет Охотника',
    category: 'jewelcrafting',
    resultItemId: 'acc_hunters_amulet',
    resultQuantity: 1,
    ingredients: [
      { itemId: 'trophy_wolf_fang', quantity: 4 },
      { itemId: 'trophy_scorpion_carapace', quantity: 3 },
      { itemId: 'mat_turquoise', quantity: 2 },
    ],
    craftingTime: 200,
    requiredLevel: 18,
    experienceGain: 260,
    successRate: 0.80,
    description: 'Амулет на счастье и удачу в сече. Клыки и панцирь — в оправу.',
  },

  // ── АЛХИМИЯ ─────────────────────────────────────────────────────
  'recipe_health_potion_s': {
    id: 'recipe_health_potion_s',
    name: 'Brew Small Health Potion',
    nameRu: 'Сварить Малое Зелье',
    category: 'alchemy',
    resultItemId: 'con_health_potion_s',
    resultQuantity: 3,
    ingredients: [
      { itemId: 'mat_saffron', quantity: 2 },
    ],
    craftingTime: 15,
    requiredLevel: 1,
    experienceGain: 20,
    successRate: 1.0,
    description: 'Базовый рецепт алхимика.',
  },
  'recipe_health_potion_m': {
    id: 'recipe_health_potion_m',
    name: 'Brew Medium Health Potion',
    nameRu: 'Сварить Среднее Зелье',
    category: 'alchemy',
    resultItemId: 'con_health_potion_m',
    resultQuantity: 2,
    ingredients: [
      { itemId: 'mat_saffron', quantity: 5 },
      { itemId: 'mat_turquoise', quantity: 1 },
    ],
    craftingTime: 30,
    requiredLevel: 10,
    experienceGain: 80,
    successRate: 0.95,
    description: 'Улучшенный рецепт алхимика.',
  },
  'recipe_mana_potion': {
    id: 'recipe_mana_potion',
    name: 'Brew Mana Elixir',
    nameRu: 'Сварить Эликсир Маны',
    category: 'alchemy',
    resultItemId: 'con_mana_potion',
    resultQuantity: 2,
    ingredients: [
      { itemId: 'mat_saffron', quantity: 3 },
      { itemId: 'mat_silk', quantity: 1 },
    ],
    craftingTime: 25,
    requiredLevel: 5,
    experienceGain: 50,
    successRate: 0.95,
    description: 'Рецепт для восстановления маны.',
  },

  // ── КУЛИНАРИЯ ───────────────────────────────────────────────────
  'recipe_persian_kebab': {
    id: 'recipe_persian_kebab',
    name: 'Cook Persian Kebab',
    nameRu: 'Приготовить Персидский Кебаб',
    category: 'cooking',
    resultItemId: 'con_stamina_food',
    resultQuantity: 5,
    ingredients: [
      { itemId: 'mat_saffron', quantity: 1 },
    ],
    craftingTime: 10,
    requiredLevel: 1,
    experienceGain: 15,
    successRate: 1.0,
    description: 'Быстрый рецепт персидской кухни.',
  },

  // ── ЮВЕЛИРНОЕ ДЕЛО ──────────────────────────────────────────────
  'recipe_turquoise_ring': {
    id: 'recipe_turquoise_ring',
    name: 'Craft Turquoise Ring',
    nameRu: 'Создать Бирюзовое Кольцо',
    category: 'jewelcrafting',
    resultItemId: 'acc_turquoise_ring',
    resultQuantity: 1,
    ingredients: [
      { itemId: 'mat_turquoise', quantity: 5 },
      { itemId: 'mat_iron_ore', quantity: 3 },
    ],
    craftingTime: 120,
    requiredLevel: 20,
    experienceGain: 200,
    successRate: 0.85,
    description: 'Изящное кольцо с нишапурской бирюзой.',
  },
};

export function getRecipe(id: string): CraftingRecipe | undefined {
  return CRAFTING_RECIPES[id];
}

export function getRecipesByCategory(category: CraftingCategory): CraftingRecipe[] {
  return Object.values(CRAFTING_RECIPES).filter(r => r.category === category);
}

export function getRecipesByLevel(maxLevel: number): CraftingRecipe[] {
  return Object.values(CRAFTING_RECIPES).filter(r => r.requiredLevel <= maxLevel);
}

export function canCraft(
  recipeId: string,
  inventory: Record<string, number>
): { canCraft: boolean; missing: { itemId: string; required: number; have: number }[] } {
  const recipe = CRAFTING_RECIPES[recipeId];
  if (!recipe) return { canCraft: false, missing: [] };

  const missing = recipe.ingredients
    .filter(ing => (inventory[ing.itemId] ?? 0) < ing.quantity)
    .map(ing => ({
      itemId: ing.itemId,
      required: ing.quantity,
      have: inventory[ing.itemId] ?? 0,
    }));

  return { canCraft: missing.length === 0, missing };
}
