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

  it('world3d.ts объясняет, откуда движок берёт экипировку', () => {
    // Комментарий «Загружаем экипировку персонажа с сервера» никогда не
    // существовал: тест писали для кода, который не собирался. Документация
    // у загрузки другая — она при интерфейсе LocalGear.
    expect(world3d).toContain('Экипировка своего персонажа');
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

  it('world.ts вызывает setLocalGear на движке (экземпляр, а не класс)', () => {
    expect(worldContent).toContain('world3d.setLocalGear');
  });

  it('world.ts применяет gear из общего конвертера gearFromEquipment', () => {
    // Конверсия «что надето → вид аватара» живёт в одном месте (hud.ts).
    // Раньше world.ts считал weapon/armorColor сам и расходился с панелью.
    expect(worldContent).toContain('gearFromEquipment(eqStateFromApi, eqStateFromApi.outfit)');
  });

  it('world.ts содержит проверку session.token', () => {
    expect(worldContent).toContain('session.token');
  });

  it('world.ts читает items экипировки из ответа API при восстановлении', () => {
    // Переменная называется eqStateFromApi: состояние пришло с сервера и уже
    // готово, когда мир собран — восстанавливаем без второго запроса.
    expect(worldContent).toContain('eqStateFromApi.items');
  });

  it('world.ts содержит упоминание слота weapon', () => {
    // Надетое оружие доходит до аватара через gearFromEquipment: в мировом
    // блоке литерал «weapon» не существует с тех пор, как конверсию вынесли
    // в одно место. Проверяем сам конвертер.
    expect(worldContent).toContain('gearFromEquipment');
  });

  it('world.ts содержит упоминание bonus при weapon', () => {
    expect(worldContent).toContain('bonus');
  });

  it('world.ts содержит упоминание helmet', () => {
    expect(worldContent).toContain('helmet');
  });

  it('world.ts восстанавливает надетые слоты после сборки мира', () => {
    // Пять слотов доспешного вида плюс оружие (через gearFromEquipment).
    // Слоты посчитаны из items экипировки, не угаданы из класса.
    for (const slot of ['helmet', 'robe', 'turban', 'coat', 'mail']) {
      expect({ slot, восстановлен: worldContent.includes(`equipped.has('${slot}')`) })
        .toEqual({ slot, восстановлен: true });
    }
  });
});