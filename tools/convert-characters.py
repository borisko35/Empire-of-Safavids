#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert-characters.py — конвейер скелетных персонажей FBX → GLB для веба.

ЧЕГО ЭТОТ ФАЙЛ ВОССТАНАВЛИВАЕТ. Персонажи «Enemies and monsters» (монголы,
янычары, османский солдат) и ящерица лежат в репозитории исходными FBX и в
игру не доехали: convert-assets.py умеет только статику (DECOR), а общий
загрузчик realRig играет общие Mixamo-клипы на скелете модели — значит,
персонажу нужен GLB со скелетом. Этот файл — тот конвертер.

КАК ПОЛЬЗОВАТЬСЯ.

    blender --background --factory-startup \
        --python tools/convert-characters.py -- <вход.fbx> <выход.glb> [ключи]

Ключи:

    --max-tex 512          сторона текстуры по большей стороне (0 — не трогать)
    --clip-only            оставить только арматуру с действием (клип без меша,
                           как Mixamo-клипы проекта)
    --keep ШАБЛОН          оставить действия, чьё имя подходит регулярному
                           выражению, остальные выбросить. Звери Quaternius
                           везут по 12-13 клипов (атаки, хиты, прыжки), а игре
                           нужны четыре-пять: без отбора файл весит вдвое больше.

ОТЧЁТ. В stdout печатаются: размер GLB, число костей, ПЕРВЫЕ ИМЕНА КОСТЕЙ
(по ним видно, лягут ли общие клипы: скелет должен быть Mixamo,
`mixamorig:*`), число мешей, текстур и действий. Если кости названы иначе —
клипы на модель не встанут, и модель оставят процедурной; это видно сразу.
"""

import bpy
import re
import sys
import os


def log(*a):
    print(*a, flush=True)


argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
if len(argv) < 2:
    log("НУЖНЫ ВХОД И ВЫХОД: <вход.fbx> <выход.glb> [--max-tex 512] [--clip-only]")
    sys.exit(1)

вход, выход = argv[0], argv[1]
max_tex = 512
clip_only = False
keep = None
i = 2
while i < len(argv):
    if argv[i] == "--max-tex" and i + 1 < len(argv):
        max_tex = int(argv[i + 1])
        i += 2
        continue
    if argv[i] == "--clip-only":
        clip_only = True
        i += 1
        continue
    if argv[i] == "--keep" and i + 1 < len(argv):
        keep = re.compile(argv[i + 1])
        i += 2
        continue
    log("НЕИЗВЕСТНЫЙ КЛЮЧ:", argv[i])
    i += 1

bpy.ops.wm.read_factory_settings(use_empty=True)

# Вход бывает двух сортов: исходный FBX (Mixamo, монстры) и готовый GLB
# (звери Quaternius, скачанные сразу в glTF) — по расширению.
if вход.lower().endswith(".glb") or вход.lower().endswith(".gltf"):
    bpy.ops.import_scene.gltf(filepath=вход)
else:
    bpy.ops.import_scene.fbx(filepath=вход)

# ── Отчёт по скелету ─────────────────────────────────────────────
арматуры = [o for o in bpy.data.objects if o.type == "ARMATURE"]
кости = list(арматуры[0].data.bones) if арматуры else []
мешей = sum(1 for o in bpy.data.objects if o.type == "MESH")
действия = list(bpy.data.actions)

if clip_only:
    # Клип живёт отдельно от меша (как Mixamo-клипы проекта): остаётся одна
    # арматура с действием, геометрия и текстуры выбрасываются.
    for o in list(bpy.data.objects):
        if o.type != "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)

if keep:
    # Отбор действий. Удаление из bpy.data.actions недостаточно: дорожки NLA
    # держат ссылки на действия, и экспортёр вытащил бы их обратно. Поэтому
    # сначала чистятся страпы NLA, потом сами действия.
    for арматура in арматуры:
        for трек in list(арматура.animation_data.nla_tracks) if арматура.animation_data else []:
            for страп in list(трек.strips):
                if страп.action and not keep.search(страп.action.name):
                    трек.strips.remove(страп)
    выброшено = []
    for действие in list(bpy.data.actions):
        if not keep.search(действие.name):
            выброшено.append(действие.name)
            bpy.data.actions.remove(действие)
    log(f"отбор --keep {keep.pattern}: оставлено {len(list(bpy.data.actions))}, выброшено {len(выброшено)}")

# ── Текстуры: ужать по большей стороне ───────────────────────────
текстур = 0
для_текстур = [] if clip_only else list(bpy.data.images)
for img in для_текстур:
    if img.size[0] == 0 or img.size[1] == 0:
        continue
    w, h = img.size
    m = max(w, h)
    if max_tex and m > max_tex:
        k = max_tex / m
        img.scale(max(1, int(w * k)), max(1, int(h * k)))
    текстур += 1

# ── Экспорт ──────────────────────────────────────────────────────
os.makedirs(os.path.dirname(os.path.abspath(выход)), exist_ok=True)


def экспорт(изображения):
    bpy.ops.export_scene.gltf(
        filepath=выход,
        export_format="GLB",
        export_animations=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format=изображения,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )


try:
    экспорт("WEBP")
except Exception as e:
    log("WEBP не вышел, экспорт в PNG:", e)
    экспорт("PNG")

размер = os.path.getsize(выход)
имена_костей = ";".join(b.name for b in кости[:12])
# После --keep часть объектов из действия уже удалена — их имена читать нельзя.
# Живой список берём из bpy.data.actions заново.
живые_действия = [a.name for a in bpy.data.actions]
log(
    f"GLB {выход}: {размер} байт; костей={len(кости)} мешей={мешей} "
    f"текстур={текстур} действий={len(живые_действия)} "
    f"действия={живые_действия}"
)
log(f"КОСТИ[{имена_костей}]")
if clip_only and not живые_действия:
    log("ВНИМАНИЕ: clip-only, но действий нет — клип пустой, файл бесполезен")
