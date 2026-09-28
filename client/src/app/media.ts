// ============================================================
// Загрузка фото и видео (панель сотрудника) — Empire of Safavids
// ============================================================
// Разработчик, админ и модератор заливают снимки и ролики и получают
// готовую ссылку, которую можно вставить на страницу сайта.
//
// ПОЧЕМУ ФАЙЛ ШЛЁТСЯ «КАК ЕСТЬ», А НЕ ФОРМОЙ:
// на сервере нет библиотеки для разбора multipart, а ставить новую
// зависимость перед выкаткой — риск. Тело запроса есть байты файла,
// имя лежит в заголовке X-Filename. Для видео это ещё и быстрее: нет
// накладных расходов на границы и промежуточные копии.
//
// ПРОГРЕСС СЧИТАЕТСЯ НА СТОРОНЕ БРАУЗЕРА: fetch не умеет отдавать ход
// загрузки, поэтому приходится считать отправленные куски через
// XMLHttpRequest. XHR умеет, и заодно позволяет отменить загрузку
// кнопкой «Отмена» — на видео в 300 МБ это необходимо.

import { t } from './i18n';
import { toast } from './hud';

export interface MediaFile {
  id: string;
  url: string;
  originalName: string;
  kind: 'image' | 'video';
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploadedBy: string | null;
  /** Показывается ли файл в галерее на сайте. Новый файл — всегда черновик */
  isPublic: boolean;
  /** Подпись под файлом в галерее */
  caption: string | null;
  /** Когда включили публикацию */
  publishedAt: string | null;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** Потолки на стороне клиента: такие же, как на сервере */
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 300 * 1024 * 1024;
/** Расширения для предварительной проверки. Сервер всё равно смотрит
 *  на сигнатуру файла, это только чтобы не грузить заведомо лишнее */
const OK_EXT = /\.(png|jpe?g|gif|webp|mp4|webm|mov)$/i;

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}${t('common.mb')}`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}${t('common.kb')}`;
  return `${bytes}${t('common.b')}`;
}

function token(): string {
  // Тот же токен, что и для остальных запросов
  const raw = localStorage.getItem('eos_token') ?? '';
  return raw;
}

/**
 * Загрузить один файл с прогрессом и отменой.
 *
 * Сделано на XHR, а не на fetch: только так виден прогресс и работает
 * прерывание. На видео в сотни мегабайт это разница между «понятно, что
 * происходит» и «висит, непонятно, живо ли».
 */
function uploadFile(
  file: File,
  onProgress: (sent: number, total: number) => void,
  registerCancel: (cancel: () => void) => void,
): Promise<MediaFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Тот же адрес, что у остального API: подставляем тот же префикс,
    // которым клиент ходит на сервер
    xhr.open('POST', apiUrl('/api/admin/media'));
    xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
    // Имя файла в заголовке: в теле лежат байты, места для имени нет
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    // Не даём браузеру угадывать тип: сервер всё равно смотрит на сигнатуру
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let data: { file?: MediaFile; error?: string } = {};
      try { data = JSON.parse(xhr.responseText) as typeof data; } catch { /* ответ не json */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.file) {
        onProgress(file.size, file.size);
        resolve(data.file);
      } else {
        reject(new Error(data.error || t('media.upload_failed')));
      }
    };
    xhr.onerror = () => reject(new Error(t('media.network_error')));
    xhr.onabort = () => reject(new Error(t('media.cancelled')));
    registerCancel(() => xhr.abort());
    xhr.send(file);
  });
}

/**
 * Адрес API. В api.ts запросы идут по относительным путям, поэтому и тут
 * путь остаётся относительным: работает и на боевом домене, и на локальной
 * раз��аботке без правок.
 */
function apiUrl(path: string): string {
  return path;
}

/** Отрисовать панель: зона загрузки, прогресс, список файлов */
export async function loadMediaPanel(): Promise<void> {
  const box = $('media-list');
  if (!box) return;
  box.innerHTML = '';

  const drop = document.createElement('div');
  drop.className = 'media-drop';
  drop.innerHTML = `<div class="media-drop-title">${t('media.drop_hint')}</div>`
    + `<div class="media-drop-sub">${t('media.drop_formats')}</div>`;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,video/mp4,video/webm';
  input.className = 'media-input';
  drop.append(input);
  box.append(drop);

  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) void runUpload(files, box);
  });

  // Перетаскивание: подсветка зоны, чтобы было видно, что она живая
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('media-drop--over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('media-drop--over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('media-drop--over');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void runUpload(files, box);
  });

  await renderList(box);
}

/**
 * Отрисовать список загруженного внутрь панели.
 *
 * ТУТ БЫЛА ПОЛОМКА, ИЗ-ЗА КОТОРОЙ ПАНЕЛЬ БЫЛА ПУСТОЙ. Список вставлялся
 * через replaceWith на сам контейнер #media-list, если вложенного списка ещё
 * нет: replaceWith ЗАМЕНЯЕТ элемент, а не дополняет его. Контейнер с зоной
 * загрузки исчезал, при следующем открытии getElementById('media-list')
 * возвращал null, функция выходила сразу — и панель оставалась пустой
 * навсегда, при живом сервере и рабочих правах.
 *
 * Теперь контейнер #media-list не трогаем: список создаём внутри один раз,
 * а при повторном вызове переиспользуем.
 */
async function renderList(box: HTMLElement): Promise<void> {
  // Уже есть вложенный список (повторное открытие) — переиспользуем его
  let holder = box.querySelector<HTMLElement>('#media-items');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'media-items';
    holder.className = 'media-items';
    box.append(holder);
  }
  holder.innerHTML = '';

  const res = await fetch(apiUrl('/api/admin/media'), {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    holder.innerHTML = `<div class="inv-empty">${t('media.load_failed')}</div>`;
    return;
  }
  const data = (await res.json()) as { files: MediaFile[]; usage: { count: number; bytes: number } };

  const usage = document.createElement('div');
  usage.className = 'media-usage';
  usage.textContent = `${t('media.total')}: ${data.usage.count} · ${humanSize(data.usage.bytes)}`;
  holder.append(usage);

  if (!data.files.length) {
    const empty = document.createElement('div');
    empty.className = 'inv-empty';
    empty.textContent = t('media.empty');
    holder.append(empty);
    return;
  }
  holder.append(...buildRows(data.files, box));
}

/** Собрать строки списка. Вынесено, чтобы renderList не разрастался */
function buildRows(files: MediaFile[], box: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'media-row';

    // Превью: картинка целиком, ролик — с кадром и проигрыванием при наведении
    const thumb = document.createElement('div');
    thumb.className = 'media-thumb';
    if (f.kind === 'image') {
      const img = document.createElement('img');
      img.src = f.url;
      img.alt = '';
      img.loading = 'lazy';
      thumb.append(img);
    } else {
      const vid = document.createElement('video');
      vid.src = f.url;
      vid.muted = true;
      vid.preload = 'metadata';
      vid.addEventListener('mouseenter', () => void vid.play().catch(() => {}));
      vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
      thumb.append(vid);
    }

    const info = document.createElement('div');
    info.className = 'media-info';
    const name = document.createElement('div');
    name.className = 'media-item-name';
    name.textContent = f.originalName;
    name.title = f.originalName;
    const meta = document.createElement('div');
    meta.className = 'media-status';
    const dims = f.width && f.height ? `${f.width}×${f.height} · ` : '';
    meta.textContent = `${f.kind === 'image' ? t('media.photo') : t('media.video')} · ${dims}${humanSize(f.sizeBytes)}`;
    const link = document.createElement('input');
    link.className = 'media-link';
    link.value = new URL(f.url, location.origin).href;
    link.readOnly = true;
    const copy = document.createElement('button');
    copy.className = 'media-copy';
    copy.type = 'button';
    copy.textContent = t('media.copy');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link.value);
        copy.textContent = t('media.copied');
      } catch {
        // Буфер может быть закрыт: выделяем ссылку, чтобы забрал вручную
        link.select();
        copy.textContent = t('media.copy_failed');
      }
      setTimeout(() => { copy.textContent = t('media.copy'); }, 2000);
    });
    const del = document.createElement('button');
    del.className = 'media-del';
    del.type = 'button';
    del.textContent = t('media.delete');
    del.addEventListener('click', async () => {
      if (!confirm(t('media.delete_confirm'))) return;
      del.disabled = true;
      const r = await fetch(apiUrl(`/api/admin/media/${f.id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (r.ok) {
        toast(t('media.deleted'), 'success');
        await renderList(box);
      } else {
        toast(t('media.delete_failed'), 'error');
        del.disabled = false;
      }
    });

    // Кнопки в одну строку: в узкой панели столбик съедал высоту,
    // а места там и так мало — сверху ещё превью
    const actions = document.createElement('div');
    actions.className = 'media-actions';
    actions.append(copy, del);

    // ── Публикация на сайте ──────────────────────────────────
    // Без этого панель была мёртвой деталью: залитый снимок никуда не
    // попадал, а страницы сайта собираются в образ и без пересборки не
    // меняются. Теперь сотрудник сам решает, показывать ли файл.
    const pub = document.createElement('div');
    pub.className = 'media-publish';

    const pubLabel = document.createElement('label');
    pubLabel.className = 'media-publish-label';
    const pubBox = document.createElement('input');
    pubBox.type = 'checkbox';
    pubBox.checked = f.isPublic;
    const pubText = document.createElement('span');
    pubText.textContent = t('media.publish');
    pubLabel.append(pubBox, pubText);

    const cap = document.createElement('input');
    cap.className = 'media-caption';
    cap.type = 'text';
    cap.maxLength = 200;
    cap.placeholder = t('media.caption_ph');
    cap.value = f.caption ?? '';

    const pubState = document.createElement('div');
    pubState.className = 'media-publish-state';
    pubState.textContent = f.isPublic ? t('media.published') : t('media.draft');

    // Одна отправка на оба поля: сотрудник пишет подпись и жмёт галочку,
    // а не галочку и потом отдельно кнопку «сохранить подпись»
    const send = async (): Promise<void> => {
      pubBox.disabled = true;
      cap.disabled = true;
      try {
        const r = await fetch(apiUrl(`/api/admin/media/${f.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify({ isPublic: pubBox.checked, caption: cap.value }),
        });
        if (!r.ok) {
          toast(t('media.publish_failed'), 'error');
          // Возвращаем галочку на место: иначе панель врала бы о состоянии
          pubBox.checked = f.isPublic;
          return;
        }
        f.isPublic = pubBox.checked;
        f.caption = cap.value.trim() || null;
        pubState.textContent = f.isPublic ? t('media.published') : t('media.draft');
        toast(t('media.publish_ok'), 'success');
      } catch {
        toast(t('media.publish_failed'), 'error');
        pubBox.checked = f.isPublic;
      } finally {
        pubBox.disabled = false;
        cap.disabled = false;
      }
    };
    pubBox.addEventListener('change', () => { void send(); });
    // Enter в подписи отправляет сразу — не заставляем искать галочку
    cap.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); void send(); }
    });

    pub.append(pubLabel, cap, pubState);

    info.append(name, meta, link, actions, pub);
    row.append(thumb, info);
    out.push(row);
  }
  return out;
}
/** По очереди: один большой ролик не должен блокировать остальные */
async function runUpload(files: File[], box: HTMLElement): Promise<void> {
  const listBox = box.querySelector('#media-items');
  for (const file of files) {
    // Предварительная проверка, чтобы не гонять заведомо лишнее
    if (!OK_EXT.test(file.name)) {
      toast(`${file.name}: ${t('media.bad_format')}`, 'error');
      continue;
    }
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name);
    const limit = isVideo ? MAX_VIDEO : MAX_IMAGE;
    if (file.size > limit) {
      toast(`${file.name}: ${t('media.too_big')} ${humanSize(limit)}`, 'error');
      continue;
    }

    const item = document.createElement('div');
    item.className = 'media-item';
    const name = document.createElement('div');
    name.className = 'media-item-name';
    name.textContent = file.name;
    const bar = document.createElement('div');
    bar.className = 'media-bar';
    const fill = document.createElement('i');
    bar.append(fill);
    const status = document.createElement('div');
    status.className = 'media-status';
    const cancel = document.createElement('button');
    cancel.className = 'media-cancel';
    cancel.type = 'button';
    cancel.textContent = t('media.cancel');
    item.append(name, bar, status, cancel);
    listBox?.prepend(item);

    let cancelFn: () => void = () => {};
    cancel.addEventListener('click', () => cancelFn());

    try {
      await uploadFile(
        file,
        (sent, total) => {
          fill.style.width = `${Math.round((sent / total) * 100)}%`;
          status.textContent = `${Math.round((sent / total) * 100)}% · ${humanSize(sent)} / ${humanSize(total)}`;
        },
        (fn) => { cancelFn = fn; },
      );
      item.classList.add('media-item--done');
      status.textContent = t('media.uploaded');
      cancel.remove();
      await renderList(box);
    } catch (err) {
      item.classList.add('media-item--error');
      status.textContent = (err as Error).message;
      cancel.remove();
    }
  }
}
