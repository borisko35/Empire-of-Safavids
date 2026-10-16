# Интеграция внешних ассетов в игру

## Звук (Sounds and music/)
Выбранные файлы скопированы в client/src/app/public/sounds/ и подключены в client/src/app/audio.ts:
- playFile(id, url) — клонирует аудио-элемент и проигрывает SFX с учётом громкости SFX.
- startFileMusic() / stopFileMusic() — запускают цикл ambient track и приглушают процедурную музыку.
- world.ts вызывает udio.playFile('click', '/game/sounds/click.ogg') при переключении панелей и udio.playFile('impact', '/game/sounds/impact.ogg') при ударе.

Чтобы добавить новые звуки: положите .ogg/.mp3 в Sounds and music/, скопируйте нужные в client/src/app/public/sounds/ и вызовите udio.playFile('key', '/game/sounds/file.ogg'). Имена файлов в URL должны совпадать.

## Материалы (Materials/)
- Архивы содержат исходники Unity/Unreal (.usdc, .mtlx, .blend, .tx) и PBR-текстуры. Браузерная игра использует GLTF/GLB + three.js.
- Путь интеграции: конвертация Blender → GLTF/GLB, помещение модели в client/src/app/public/models/ (форматы: .glb/.gltf), затем загрузка через GLTFLoader в game3d/*.
- 	ools/convert-assets.py требует Blender (py) — установите Blender локально (или сделайте конвертацию отдельно).
- Рекомендуется коммитить только конвертированные runtime-файлы, а исходники держать в Materials/ (они теперь не игнорируются) или в отдельном архиве/LFS, чтобы не раздувать репозиторий (пакеты по 20–350 МБ).

## Скриншоты (D:\\My Screenshot/)
Рекомендуется отсортировать по разрешению/назначению и копировать в client/web/assets/screenshots/ (WebP/сжатие). Для публикации на сайте проверяйте лицензии исходников.
