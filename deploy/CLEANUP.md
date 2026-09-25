# Empire of Safavids — СРОЧНАЯ ОЧИСТКА

## 🚨 Проблема: 17 GB занимают логи!

Папка `server/logs/` весит **17 GB** — это логи работы сервера. Их можно безопасно удалить.

---

## 🧹 Команда для очистки (выполни в PowerShell):

```powershell
# Очищаем логи (17 GB!)
Remove-Item "D:\My Projects\Empire of Sefevids\server\logs\*" -Recurse -Force

# Удаляем данные PostgreSQL (46 MB)
Remove-Item "D:\My Projects\Empire of Sefevids\server\.pg" -Recurse -Force

# Удаляем compiled.dist (1 MB)
Remove-Item "D:\My Projects\Empire of Sefevids\server\dist" -Recurse -Force

# Удаляем node_modules (77 MB) - переустановятся на VPS
Remove-Item "D:\My Projects\Empire of Sefevids\server\node_modules" -Recurse -Force

# Удаляем лишние папки проекта
Remove-Item "D:\My Projects\Empire of Sefevids\SDK" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "D:\My Projects\Empire of Sefevids\legacy" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "D:\My Projects\Empire of Sefevids\Samples" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "D:\My Projects\Empire of Sefevids\.vs" -Recurse -Force -ErrorAction SilentlyContinue

# Проверяем результат
Write-Host "=== Итоговый размер ==="
$total = (Get-ChildItem "D:\My Projects\Empire of Sefevids" -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB
Write-Host "Всего: $([math]::Round($total/1024, 2)) GB"
Write-Host ""
Write-Host "Освобождено: ~17.2 GB"
```

---

## 📊 Что было и станет:

| Папка | Было | Станет | Экономия |
|-------|------|--------|----------|
| server/logs | 17,240 MB | 0 | **17.2 GB** |
| server/.pg | 46 MB | 0 | 46 MB |
| server/dist | 1 MB | 0 | 1 MB |
| server/node_modules | 77 MB | 0 | 77 MB |
| SDK | 662 MB | 0 | 662 MB |
| legacy | 147 MB | 0 | 147 MB |
| Samples | 0.4 MB | 0 | 0.4 MB |
| .vs | 15 MB | 0 | 15 MB |
| **ИТОГО** | **~18 GB** | **~0.8 GB** | **~17 GB** |

---

## ✅ Что нужно оставить:

- `server/src/` — исходный код сервера
- `client/web/game/` — файлы игры
- `database/` — SQL миграции
- `shared/` — общие файлы
- `tools/` — утилиты сборки
- `site/` — сайт и установщик
- `deploy/` — скрипты деплоя