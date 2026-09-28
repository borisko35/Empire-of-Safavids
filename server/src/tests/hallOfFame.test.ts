// Зал славы: история побед наконец-то видна игроку.
//
// ЧТО БЫЛО. Таблица world_boss_kills наполнялась — каждая победа над
// мировым боссом писалась отдельной строкой. Смотреть на неё было некому:
// панели не существовало, маршрута не было. То есть история копилась
// впустую, и единственным, кто знал о ней, был тот, кто заглянул в базу.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');
const src = (p: string): string => stripComments(read(p));

const route = src('server/src/routes/hallOfFame.ts');
const serverIndex = src('server/src/index/index.ts');
const api = src('client/src/app/api.ts');
const panels = src('client/src/app/panels.ts');
const hub = src('client/src/app/hub.ts');
const html = read('client/src/app/index.html');

describe('Зал славы: маршрут есть и подключён', () => {
  it('маршрут отдаёт топ по таблице world_boss_kills', () => {
    expect(route).toMatch(/FROM world_boss_kills/);
    expect(route).toMatch(/COUNT\(\*\) AS kills/);
  });

  it('маршрут подключён к серверу', () => {
    // Написать файл маршрута и забыть подключить — обычное дело, и снаружи
    // это выглядит как «панель пустая»
    expect(serverIndex).toMatch(/hallOfFameRouter/);
    expect(serverIndex).toMatch(/app\.use\('\/api\/hall-of-fame', hallOfFameRouter\)/);
  });

  it('показывает имя, класс и гильдию', () => {
    // Раньше на замену имени стояла заглушка, которая отдавала пустую строку
    expect(route).toMatch(/c\.name AS character_name/);
    expect(route).toMatch(/g\.name AS guild_name/);
    expect(route).not.toMatch(/characterName: r\.class_name \? '' : ''/);
  });

  it('порядок — по числу побед, при равенстве по более ранней', () => {
    expect(route).toMatch(/ORDER BY kills DESC, last_kill ASC/);
  });

  it('показывает настоящие числа, а не строки', () => {
    // COUNT в Postgres возвращает bigint, то есть строку. Без Number()
    // в интерфейсе было бы «1», «10», «100» рядом с «9» — по алфавиту
    expect(route).toMatch(/kills: Number\(r\.kills\)/);
  });

  it('список ограничен, иначе он не список', () => {
    expect(route).toMatch(/DEFAULT_LIMIT = 20/);
    expect(route).toMatch(/Math\.min\(50, Math\.floor\(raw\)\)/);
  });
});

describe('Зал славы: панель в игре', () => {
  it('обёртка API зовёт живой маршрут', () => {
    expect(api).toMatch(/hallOfFame: \(limit = 20\)/);
    expect(api).toMatch(/\/api\/hall-of-fame\/bosses\?limit=/);
  });

  it('панель зарегистрирована в диспетчере', () => {
    expect(panels).toMatch(/'panel-hall-of-fame': loadHallOfFame/);
  });

  it('разметка панели есть', () => {
    expect(html).toMatch(/id="panel-hall-of-fame"/);
  });

  it('вход есть в хабе панелей', () => {
    // Хаб — единственное место, где перечислены панели. Панель без входа
    // в хаб существует, но её нельзя открыть
    expect(hub).toMatch(/id: 'panel-hall-of-fame'/);
    expect(hub).toMatch(/titleKey: 'hub\.hall_of_fame'/);
  });
});

describe('Зал славы: не выдумывает то, чего не мерили', () => {
  it('доли урона в панели нет', () => {
    // top_damage заполняется одним победителем: сервер не собирает расклад
    // по урону за бой. Показывать проценты значило бы показать игроку
    // цифру, которую никто не измерял
    expect(panels).not.toMatch(/top_damage|topDamage/);
  });

  it('и в маршруте её нет', () => {
    expect(route).not.toMatch(/top_damage AS/);
  });
});

describe('Зал славы: пустой список не выглядит поломкой', () => {
  it('пустое состояние переведено, а не зашито строкой', () => {
    // Раньше в панелях текст часто лежал по-русски прямо в коде — и
    // игрок с английским или азербайджанским языком видел чужой текст
    expect(panels).toMatch(/t\('hall\.empty'\)/);
    expect(panels).not.toMatch(/Ещё никто не повалил/);
  });
});
