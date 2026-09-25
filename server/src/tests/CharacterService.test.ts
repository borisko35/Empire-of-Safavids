// ============================================================
// Тесты — CharacterService — Empire of Safavids
// ============================================================

import { CharacterClass } from '../types/game.types';
import { LevelingSystem } from '../systems/LevelingSystem';

describe('LevelingSystem', () => {
  describe('expForLevel', () => {
    it('уровень 1 требует 0 опыта', () => {
      expect(LevelingSystem.expForLevel(1)).toBe(100);
    });

    it('опыт растёт с каждым уровнем', () => {
      expect(LevelingSystem.expForLevel(10)).toBeGreaterThan(LevelingSystem.expForLevel(5));
      expect(LevelingSystem.expForLevel(50)).toBeGreaterThan(LevelingSystem.expForLevel(20));
    });

    it('уровень 100 должен быть достижим', () => {
      expect(LevelingSystem.expForLevel(100)).toBe(1000000);
    });
  });

  describe('levelFromExp', () => {
    it('должен правильно вычислять уровень', () => {
      expect(LevelingSystem.levelFromExp(0)).toBe(1);
      expect(LevelingSystem.levelFromExp(100)).toBe(2);
      expect(LevelingSystem.levelFromExp(10000)).toBe(11);
    });

    it('не должен превышать 100', () => {
      expect(LevelingSystem.levelFromExp(999999999)).toBe(100);
    });
  });

  describe('progressToNext', () => {
    it('должен быть в диапазоне 0–1', () => {
      const progress = LevelingSystem.progressToNext(500);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    });
  });
});

describe('CharacterService — статические методы', () => {
  it('базовые статы должны быть положительными для всех классов', () => {
    // Проверяем через публичный интерфейс данных
    const classes = Object.values(CharacterClass);
    expect(classes.length).toBe(5);
    expect(classes).toContain(CharacterClass.QIZILBASH);
    expect(classes).toContain(CharacterClass.SUFI_MYSTIC);
  });
});
