// ============================================================
// Тесты — AntiCheatSystem — Empire of Safavids
// ============================================================

import { AntiCheatSystem } from '../systems/AntiCheatSystem';

describe('AntiCheatSystem', () => {
  let ac: AntiCheatSystem;

  beforeEach(() => {
    ac = new AntiCheatSystem();
  });

  describe('validateMovement', () => {
    it('должен пропускать нормальное движение', () => {
      const id = 'player1';
      const t0 = Date.now();
      ac.validateMovement(id, { x: 0, y: 0, z: 0 }, t0);
      const result = ac.validateMovement(id, { x: 5, y: 0, z: 0 }, t0 + 1000);
      expect(result.valid).toBe(true);
    });

    it('должен отклонять speed hack', () => {
      const id = 'cheater1';
      const t0 = Date.now();
      ac.validateMovement(id, { x: 0, y: 0, z: 0 }, t0);
      // 1000 единиц за  1 секунду = скорость 1000 u/s
      const result = ac.validateMovement(id, { x: 1000, y: 0, z: 0 }, t0 + 1000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Speed hack');
    });

    it('должен отклонять телепорт', () => {
      const id = 'teleporter';
      const t0 = Date.now();
      ac.validateMovement(id, { x: 0, y: 0, z: 0 }, t0);
      // 500 единиц за 0.1 секунды
      const result = ac.validateMovement(id, { x: 500, y: 0, z: 0 }, t0 + 100);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Teleport');
    });
  });

  describe('validateDamage', () => {
    it('должен пропускать нормальный урон', () => {
      const result = ac.validateDamage('p1', 100, 80);
      expect(result.valid).toBe(true);
    });

    it('должен отклонять damage hack', () => {
      const result = ac.validateDamage('p1', 999999, 100);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Damage hack');
    });
  });

  describe('validatePacketRate', () => {
    it('должен пропускать нормальный рейт', () => {
      const id = 'normal';
      const t0 = Date.now();
      for (let i = 0; i < 10; i++) {
        const r = ac.validatePacketRate(id, t0 + i);
        expect(r.valid).toBe(true);
      }
    });

    it('должен отклонять packet flood', () => {
      const id = 'flooder';
      const t0 = Date.now();
      let lastResult: { valid: boolean; reason?: string } = { valid: true };
      for (let i = 0; i < 50; i++) {
        lastResult = ac.validatePacketRate(id, t0 + i);
      }
      expect(lastResult.valid).toBe(false);
    });
  });
});
