export type Vocation = "warrior" | "mage" | "archer";

export interface Attributes {
  str: number;
  dex: number;
  int: number;
  con: number;
  spr: number;
};

export interface VocationDefinition {
  id: Vocation;
  name: string;
  description: string;
  hpMultiplier: number;
  mpMultiplier: number;
  startingAttributes: Attributes;
  startingEquipment: string[];
  startingSkills: string[];
  skillTree: string[];
};

export const VOCATIONS: Record<Vocation, VocationDefinition> = {
  warrior: {
    id: "warrior",
    name: "Воин",
    description: "Высокий HP и защита щитом. Ближний бой с использованием ручного боя и блоков.",
    hpMultiplier: 1.5,
    mpMultiplier: 0.5,
    startingAttributes: { str: 12, dex: 8, int: 5, con: 15, spr: 6 },
    startingEquipment: ["iron_sword", "iron_shield", "iron_armor", "healing_potion"],
    startingSkills: ["shield_block", "power_strike"],
    skillTree: ["power_strike", "counter_attack", "defensive_stance", "berserk", "execution"]
  },
  mage: {
    id: "mage",
    name: "Маг",
    description: "Управление мани и.Elemental spells. Слабое HP, но сильный магический урон.",
    hpMultiplier: 0.8,
    mpMultiplier: 1.8,
    startingAttributes: { str: 6, dex: 8, int: 15, con: 8, spr: 12 },
    startingEquipment: [" wooden_staff", "cloth_robe", "mana_potion"],
    startingSkills: ["fire_bolt", "mana_regeneration"],
    skillTree: ["fire_ball", "ice_spike", "lightning_burst", "healing_spell", "magic_shield"]
  },
  archer: {
    id: "archer",
    name: "Арбалец",
    description: "Precision and critical hits. Средний HP, но высокий урон от дальних атак.",
    hpMultiplier: 1.2,
    mpMultiplier: 0.8,
    startingAttributes: { str: 10, dex: 15, int: 6, con: 10, spr: 7 },
    startingEquipment: ["shortbow", "leather_armor", "iron_sword", "healing_potion"],
    startingSkills: ["multi_shot", "quick_reload"],
    skillTree: ["power_shot", "critical_hit", "evade", "quick_draw", "barrage"]
  }
};

export interface CharacterCreationForm {
  vocation: Vocation;
  face: {
    eyeShape: number;
    noseShape: number;
    mouthShape: number;
    jawShape: number;
  };
  hair: {
    style: number;
    color: string;
  };
  attributes: Attributes;
};

export interface CreatedCharacter {
  id: string;
  vocation: Vocation;
  name: string;
  attributes: Attributes;
  currentHp: number;
  currentMp: number;
  maxHp: number;
  maxMp: number;
  equipment: string[];
  level: number;
  currentXp: number;
  maxXp: number;
};
