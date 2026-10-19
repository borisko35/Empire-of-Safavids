# Откуда эти дорожки и что с ними можно делать

Папка — склад исходников, а не часть игры. В игре звучат шесть файлов: они
переименованы и лежат в `client/src/app/public/sounds`, отдаются по
`/game/sounds/<имя>` и уже опубликованы. Остальное — выбор на будущее.

С 20 октября 2026 фоновая музыка — CC0-трек RandomMind, а не дорожка
Zvukogram: чужая музыка из публичного репозитория убрана.

Разбор ниже нужен из-за одного: **репозиторий публичный**, и от источника
зависит, можно ли файл в нём держать.

## Итог одной строкой

| Источник | Файлов | Вес | Лицензия | В git |
|---|---|---|---|---|
| Kenney (набор звуков) | 18 | 0.2 МБ | CC0, public domain | да |
| RandomMind (OpenGameArt) | 6 | 29.5 МБ | CC0 1.0 | один: `ambient_music.mp3` |
| Zvukogram | 7 | 16.1 МБ | © 2024/2025 Zvukogram.com | нет |
| Pixabay (имена «автор-название-номер») | 7 | 52.0 МБ | Pixabay Content License | нет |
| **Всего** | **38** | **97.8 МБ** | | |

## Почему не «закоммитить всё»

Лицензия Pixabay содержит прямой запрет на раздачу контента отдельными
файлами: «You cannot sell or distribute Content (either in digital or
physical form) on a standalone basis (i.e. where no creative effort has been
applied to the content and it remains substantially the same form as it
exists on the Pixabay website)». Файл, положенный в публичный репозиторий
как есть, — ровно это: ни творческой работы над ним, ни изменения формы.
Внутри игры такой трек — часть большой работы, и это другое дело.

У дорожек Zvukogram в тегах стоит `TPE1/TPUB: Zvukogram.com` и
`TCOP: © 2024 Zvukogram.com` (у двух — 2025) — чужой копирайт. Условия
сервиса я не проверял по их сайту (страницы лицензии отдают 404), а
публиковать чужой файл по догадке нечего. Поэтому в git их нет.

Техническое правило в `.gitignore` — `/Sounds and music/*.mp3`. Оно простое,
но опирается на факт, а не на вкус: все чужие дорожки пришли в mp3, а весь
свободный набор Kenney — в ogg. Настоящее правило — по источнику, и оно
здесь.

Кроме лицензии есть и вторая причина не тащить всё в историю: 68 МБ, из
которых 30 МБ — один трек, который игра не использует. История git — это
навсегда.

## Kenney — CC0, отслеживается

`ARTIST=Kenney` в комментариях Vorbis; ассеты Kenney распространяются под
CC0, то есть без ограничений и без обязательной атрибуции. У пятнадцати из
восемнадцати этот тег есть, у трёх (`doorClose_2`, `footstep04`,
`explosionCrunch_001`) тегов нет вовсе — они опознаны по именам внутри тех же
наборов Kenney. Отгружаются как:

| Исходник | В игре |
|---|---|
| `rollover1.ogg` | `click.ogg` |
| `doorClose_2.ogg` | `door.ogg` |
| `explosionCrunch_001.ogg` | `explosion.ogg` |
| `footstep_carpet_000.ogg` | `footstep.ogg` |
| `impactMetal_medium_002.ogg` | `impact.ogg` |

Остальные тринадцать — те же наборы шагов (трава, снег), удары (железо,
дерево, руда, доска), `knifeSlice2.ogg`, `footstep04.ogg` — лежат в
запасниках на случай, если понадобится другой звук на то же событие.
Совпадение исходника и файла в игре проверено хешем MD5, а не по имени.

## RandomMind — CC0, отгружается

Шесть дорожек, 29.5 МБ, добавлены 20 октября 2026. Автор — RandomMind на
OpenGameArt; в тегах части файлов он записан с опечаткой «RandomMynd», так
что источник брался не из тега, а со страницы.

| Файл | Вес | Страница | Что это |
|---|---|---|---|
| `Loop_Market_Day.mp3` | 2.5 МБ | [Medieval: Market Day](https://opengameart.org/content/medieval-market-day) | **отгружается как `ambient_music.mp3`** — готовая зацикленная версия |
| `battle.mp3` | 3.0 МБ | [Medieval: Battle](https://opengameart.org/content/medieval-battle) | запас: боевая тема (бой сейчас озвучивает синтез в коде) |
| `The_Bards_Tale.mp3` | 3.6 МБ | [Medieval: The Bard's Tale](https://opengameart.org/content/medieval-the-bards-tale) | запас |
| `The_Old_Tower_Inn.mp3` | 2.4 МБ | [Medieval: The Old Tower Inn](https://opengameart.org/content/medieval-the-old-tower-inn) | запас |
| `Rising_Moon.mp3` | 5.1 МБ | [Fantasy: Rising Moon](https://opengameart.org/content/fantasy-rising-moon) | запас |
| `VistulaShort.mp3` | 11.5 МБ | [Sea and river wave sounds](https://opengameart.org/content/sea-and-river-wave-sounds) | запас: шум реки, это не музыка |

Лицензия проверена по страницам, а не по названию: у каждой записи стоит
значок `license_images/cc0.png`, то есть CC0 1.0 — без обязательной подписи.
Файлы сверены с оригиналами по размеру: `battle.mp3` — 3 158 907 байт (на
странице 3.2 МБ), `Loop_Market_Day.mp3` — 2 596 640, `The_Bards_Tale.mp3` —
3 810 344, `The_Old_Tower_Inn.mp3` — 2 535 801, `Rising_Moon.mp3` —
5 397 782, `VistulaShort.mp3` — 12 004 407.

MD5 отгружаемого файла: `E0A3A42CE9074BE1EA3188CA5004712F`
(2 596 640 байт) — это `Loop_Market_Day.mp3` с OpenGameArt, переименованный
в `ambient_music.mp3`. CC0 разрешает и переименование, и правку; имя автора
оставлено в этой таблице и в комментарии у `bgMusicFile` потому, что так
принято, а не потому, что требуется.

Почему взята зацикленная версия: `audio.ts` ставит `a.loop = true`, а у
обычного трека на стыке слышен щелчок.

## Zvukogram — 7 дорожек, 16.1 МБ, не публикуется

Фоновой музыки у игры сейчас одна (`ambient_music.mp3`), и это как раз
дорожка Zvukogram:

| Исходник | Название в теге | Что это |
|---|---|---|
| `medieval-revelry_91094.mp3` | Средневековый Танец | **отгружается как `ambient_music.mp3`** |
| `medieval-reverie_90244.mp3` | Звуки средневековья | запас |
| `desert-dreams_91432.mp3` | Песни Пустыни | запас |
| `echoes-of-the-past_90242.mp3` | Средневековые шепоты | запас |
| `jubilant-fairgrounds_91091.mp3` | Веселье на Ярмарке | запас |
| `teplo-srednevekovogo-ochaga-3-8812be.mp3` | Тепло средневекового очага | запас |
| `vechnyy-gul-srednevekovykh-sten-12-41b8a3.mp3` | Вечный гул средневековых стен | запас |

**Было отгружено, больше не отгружается.** До 20 октября 2026 в игре играла
именно эта дорожка (`medieval-revelry_91094.mp3`) под именем
`ambient_music.mp3`: чужая музыка Zvukogram лежала в публичном репозитории и
отдавалась игрокам. 20 октября её заменил CC0-трек RandomMind — раздел выше.

Чего замена не делает: файл остаётся в истории git, и новый клон репозитория
его всё ещё содержит. Убрать его оттуда можно только переписыванием истории
с force-push — это отдельное решение, и сейчас оно не принято. Важно, что
файл больше не отдаётся игрокам и не попадает в свежую сборку.

## Pixabay — 7 дорожек, 52.0 МБ, не публикуется

Имена вида `<автор>-<название>-<номер>` — так отдаёт файлы Pixabay.
Тегов в этих mp3 нет вовсе, поэтому источник определён по имени.

| Файл | Вес | Что это |
|---|---|---|
| `natureseye-the-old-water-mill-meditation-8005.mp3` | 29.3 МБ | медитация, самая тяжёлая дорожка папки |
| `loswin23-rain-and-thunder-585637.mp3` | 7.5 МБ | дождь с грозой |
| `celeronbeats-midnight-rainstorm-amp-thunder-relaxation-575031.mp3` | 4.3 МБ | ночная гроза |
| `maksymmalko-fight-battle-airforce-navy-combat-music-259695.mp3` | 3.9 МБ | боевая музыка |
| `echoes_of_lumen-arabic-songs-596308.mp3` | 3.2 МБ | арабские мотивы |
| `hitslab-fighting-battle-warrior-drums-272176.mp3` | 2.0 МБ | боевые барабаны |
| `loswin23-forest-birds-chirping-581282.mp3` | 1.8 МБ | птицы в лесу |

## Чего здесь нет

Файл, который игра просит, но которого нет ни тут, ни в `public/sounds`,
вырастет в 404. Поэтому связка «код просит — файл есть» проверяется тестами
клиента, а не глазами.
