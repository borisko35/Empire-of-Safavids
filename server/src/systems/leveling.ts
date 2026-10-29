export const MAX_LEVEL = 200;

export const XP_TABLE: number[] = (() => {
  const table: number[] = [];
  let base = 100;
  for (let level = 1; level <= MAX_LEVEL; level++) {
    table.push(base);
    base = Math.floor(base * 1.15);
  }
  return table;
})();

export interface LevelData {
  currentLevel: number;
  currentXp: number;
  nextLevelXp: number;
}

export function gainXp(xp: number, currentXp: number, currentLevel: number): LevelData {
  let newXp = currentXp + xp;
  let newLevel = currentLevel;
  
  while (newLevel < MAX_LEVEL && newXp >= XP_TABLE[newLevel + 1]) {
    newXp -= XP_TABLE[newLevel + 1];
    newLevel++;
  }
  
  return {
    currentLevel: newLevel,
    currentXp: newXp,
    nextLevelXp: XP_TABLE[newLevel + 1] || 0
  };
}

export function getXPForNextLevel(level: number): number {
  return level + 1 < XP_TABLE.length ? XP_TABLE[level + 1] : 0;
}

export function getXPForCurrentLevel(level: number): number {
  return level < XP_TABLE.length ? XP_TABLE[level] : 0;
}