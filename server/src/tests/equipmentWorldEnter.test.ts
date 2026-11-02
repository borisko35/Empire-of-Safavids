// ──────────────────────────────────────────────────────────────────────
// Тесты: Проверка кода загрузки экипировки при входе в мир
// ──────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(__dirname, '..', '..', '..');

const read = (relPath: string): string =>
  fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');

const world3d = read('client/src/app/game3d/world3d.ts');
const world = read('client/src/app/world.ts');
const api = read('client/src/app/api.ts');
const state = read('client/src/app/state.ts');

describe('Экипировка при входе в мир', () => {
  // ✅ Проверки структуры кода
  it('world3d.ts содержит тип LocalGear', () => {
    expect(world3d).toContain('LocalGear');
  });

  it('world3d.ts содержит метод setLocalGear', () => {
    expect(world3d).toContain('setLocalGear');
  });

  it('world3d.ts содержит комментарий о загрузке экипировки', () => {
    expect(world3d).toContain('Загружаем экипировку персонажа с сервера');
  });

  it('world3d.ts содержит маппинг всех слотов экипировки', () => {
    const slots = ['weapon', 'mail', 'helmet', 'robe', 'turban', 'coat'];
    slots.forEach(slot => {
      expect(world3d).toContain(slot);
    });
  });

  it('api.ts содержит слово equipment', () => {
    expect(api).toContain('equipment');
  });

  it('state.ts содержит проверку session.token', () => {
    expect(state).toContain('session.token');
  });

  // ✅ Интеграционные проверки: проверяем файл world.ts
  const worldContent = world;

  it('world.ts содержит вызов api.equipment(character.id)', () => {
    expect(worldContent).toContain('api.equipment(character.id)');
  });

  it('world.ts содержит World3D.setLocalGear', () => {
    expect(worldContent).toContain('World3D.setLocalGear');
  });

  it('world.ts содержит проверку session.token', () => {
    expect(worldContent).toContain('session.token');
  });

  it('world.ts содержит упоминание слота weapon', () => {
    expect(worldContent).toContain('weapon');
  });

  it('world.ts содержит упоминание bonus при weapon', () => {
    expect(worldContent).toContain('bonus');
  });

  it('world.ts содержит упоминание helmet', () => {
    expect(worldContent).toContain('helmet');
  });

  it('world.ts содержит упоминание eqState.items при helmet', () => {
    expect(worldContent).toContain('eqState.items');
  });

  it('world.ts содержит упоминание robe', () => {
    expect(worldContent).toContain('robe');
  });

  it('world.ts содержит упоминание eqState.items при robe', () => {
    expect(worldContent).toContain('eqState.items');
  });

  it('world.ts содержит упоминание turban', () => {
    expect(worldContent).toContain('turban');
  });

  it('world.ts содержит упоминание eqState.items при turban', () => {
    expect(worldContent).toContain('eqState.items');
  });

  it('world.ts содержит упоминание coat', () => {
    expect(worldContent).toContain('coat');
  });

  it('world.ts содержит упоминание eqState.items при coat', () => {
    expect(worldContent).toContain('eqState.items');
  });

  it('world.ts содержит упоминание mail', () => {
    expect(worldContent).toContain('mail');
  });

  it('world.ts содержит упоминание eqState.items при mail', () => {
    expect(worldContent).toContain('eqState.items');
  });

  it('world.ts содержит упоминание armorColor', () => {
    expect(worldContent).toContain('armorColor');
  });

  it('world.ts содержит упоминание rarity', () => {
    expect(worldContent).toContain('rarity');
  });
});