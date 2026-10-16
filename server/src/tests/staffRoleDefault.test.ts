// Роль staff больше не достаётся вместе с аккаунтом.
//
// ЗАЧЕМ ФАЙЛ. Миграция 013 создала колонку так:
//
//   ALTER TABLE users ADD COLUMN admin_role VARCHAR(20) NOT NULL DEFAULT 'gm';
//
// 'gm' входит в SITE_STAFF_ROLES. Проверка siteStaffCheck смотрит на роль
// ОДНУ и не требует флага is_admin:
//
//   const byRole = SITE_STAFF_ROLES.has(row?.admin_role ?? '');
//   if (!row || (!row.is_admin && !byRole)) → 403
//
// То есть каждый аккаунт, созданный после той миграции, получал admin_role
// = 'gm' сам и проходил проверку персонала. На боевом сервере это было
// 37 аккаунтов из 37, включая 31 гостя. Гостю открывались:
//
//   PUT /api/site/content/news | announcement | maintenance
//   модерация форума, разбор жалоб
//
// Три места, где роль раздавалась лишнее, и все три проверяются здесь:
// миграция (DEFAULT), сервер (?? 'gm' в ответе) и клиент (|| 'gm').
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

function must(cond: boolean, why: string): void {
  if (!cond) throw new Error(why);
}

describe('Права сотрудника выдаются только осознанно', () => {
  const migration013 = read('database/migrations/013_admin.sql');
  const migration081 = read('database/migrations/081_staff_role_default.sql');
  const authService = read('server/src/services/AuthService.ts');
  const clientWorld = read('client/src/app/world.ts');

  it('миграция 081 убирает роль по умолчанию', () => {
    must(/ALTER TABLE users ALTER COLUMN admin_role DROP DEFAULT/.test(migration081),
      'DROP DEFAULT нет — новый аккаунт снова получит gm');
    must(/ALTER TABLE users ALTER COLUMN admin_role DROP NOT NULL/.test(migration081),
      'NOT NULL не снят — роль по умолчанию вернётся при вставке');
    must(/UPDATE users SET admin_role = NULL WHERE is_admin IS NOT TRUE/.test(migration081),
      'роль не снята у тех, кто не админ — дыра останется на старых аккаунтах');
  });

  it('роль по умолчанию не выдаётся новым аккаунтам', () => {
    // Миграция 013 остаётся в истории и применять её заново нельзя: если
    // файл перечитают, DEFAULT вернётся. Поэтому проверяем, что в 013
    // это место помечено, а не просто молча стоит.
    must(/DEFAULT 'gm'/.test(migration013),
      'ожидание не совпало: в 013 другой DEFAULT, проверка врёт');
    must(/081/.test(migration013),
      'миграция 013 не ссылается на 081 — тот, кто её перечитает, не узнает про отмену');
  });

  it('сервер не подставляет staff-роль в ответе', () => {
    must(/adminRole: user\.admin_role,/.test(authService),
      'сервер снова подставит роль по умолчанию');
    must(!/adminRole:[^,\n]*(\?\?|\|\|)\s*'gm'/.test(authService),
      'в ответе /api/auth/me роль по умолчанию вернулась');
  });

  it('клиент не считает гостя сотрудником', () => {
    must(/session\.isAdminRole = d\.adminRole \?\? '';/.test(clientWorld),
      "клиент снова ставит 'gm' пустому аккаунту");
    must(!/isAdminRole\s*=\s*d\.adminRole\s*\|\|\s*'gm'/.test(clientWorld),
      "в клиенте осталось || 'gm'");
  });

  it('проверка персонала по-прежнему требует роль ИЛИ флаг, а не роль одну', () => {
    // Сама функция не меняется — меняется наполнение ролей. Этот тест
    // нужен, чтобы правка не выглядела как «сделал и забыл»: если
    // когда-нибудь siteStaffCheck начнут проверять только роль, дыра
    // вернётся уже с другой стороны.
    const middleware = read('server/src/middleware/adminCheck.ts');
    must(/!row\.is_admin && !byRole/.test(middleware),
      'проверка персонала больше не смотрит на флаг — верьте только роли');
  });

  it('настоящие права всё ещё проверяются по флагу, а не по роли', () => {
    const middleware = read('server/src/middleware/adminCheck.ts');
    must(/if \(!row\?\.is_admin\)/.test(middleware),
      'adminCheck перестал требовать is_admin — это не проверка прав, а проверка роли');
  });
});