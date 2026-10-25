# Asset Licenses

This document tracks all third-party assets used in the project.
All third-party assets must be reviewed before being added to the repository or shipped in a build.

## Purpose
This project uses original code and may also include third-party assets.
Third-party assets are allowed only if their license is compatible with the project and its distribution model.

## Rules
- Do not add assets without confirming the license.
- Do not use assets marked as "personal use only", "non-commercial", or "not for redistribution".
- Do not commit files into the public repository if the license forbids public distribution.
- If attribution is required, include it in the credits or project documentation.
- If the license is unclear, mark the asset as "Needs review" and do not use it until confirmed.

## Status Legend
- Approved: license confirmed and suitable.
- Needs review: license unclear or requires confirmation.
- Rejected: not suitable for the project.

## Asset Inventory

| Category | Asset Name | Source | License | Status | Notes / Attribution |
|----------|------------|--------|---------|--------|-------------------|
| 3D Models | Kenney Castle Kit | https://kenney.nl/assets/castle-kit | CC0 / Public Domain | Approved | Downloaded 2026-10-25 to `Assets/_downloads/kenney_castle-kit` (License.txt inside, CC0 stated). Not wired into the game build. |
| 3D Models | Kenney Furniture Kit | https://kenney.nl/assets/furniture-kit | CC0 / Public Domain | Approved | Downloaded 2026-10-25 to `Assets/_downloads/kenney_furniture-kit` (License.txt inside, CC0 stated). Not wired into the game build. |
| 3D Models | Poly Haven - Environment Pack | https://polyhaven.com/ | CC0 | Approved | Verified 2026-10-25 on polyhaven.com/license: all Poly Haven assets are CC0. Already in use (HDRI "Qwantani", 12 PBR surface sets) and recorded in THIRD_PARTY.md. |
| 3D Models | OpenGameArt asset | https://opengameart.org/ | Varies by asset | Needs review | Only use assets explicitly marked with a compatible license. |
| UI | Kenney UI Pack | https://kenney.nl/assets/ui-pack | CC0 / Public Domain | Approved | Downloaded 2026-10-25 to `Assets/_downloads/kenney_ui-pack` (License.txt inside, CC0 stated). Good for game UI and menu graphics. Not wired into the game build. |
| Icons | Lucide | https://lucide.dev/ | ISC | Approved | lucide-static 1.61.0 downloaded 2026-10-25 to `Assets/_downloads/lucide-static` (package/LICENSE: ISC). Suitable for UI icons. Not wired into the game build. |
| Icons | Heroicons | https://heroicons.com/ | MIT | Approved | v2.2.0 release archive downloaded 2026-10-25 to `Assets/_downloads/heroicons-2.2.0` (LICENSE: MIT, Tailwind Labs). Suitable for UI icons. Not wired into the game build. |
| Fonts | Google Fonts / Fontsource | https://fonts.google.com/ | SIL OFL / Apache / MIT | Approved | Safe for web and UI text. |
| Sounds | Kenney RPG Audio | https://kenney.nl/assets/rpg-audio | CC0 / Public Domain | Approved | Downloaded 2026-10-25 to `Assets/_downloads/kenney_rpg-audio` (License.txt inside, CC0 stated). Good for SFX. Not wired into the game build. |
| Sounds | Kenney Interface Sounds | https://kenney.nl/assets/interface-sounds | CC0 / Public Domain | Approved | Downloaded 2026-10-25 to `Assets/_downloads/kenney_interface-sounds` (License.txt inside, CC0 stated). Good for SFX. Not wired into the game build. |
| Music | Mixkit | https://mixkit.co/ | Royalty-free / per-track | Needs review | Verify each track's rights before use. |
| Music | Pixabay | https://pixabay.com/ | Varies by track | Needs review | Check for commercial use and redistribution restrictions. |
| Music | YouTube Audio Library | https://studio.youtube.com/ | Track-specific | Needs review | License must be verified per track. |

## Approved Sources
- Kenney
- Lucide
- Heroicons
- Fontsource
- Google Fonts

## Restricted / Rejected Sources
- Unclear licensing
- "Personal use only"
- "Non-commercial only"
- Assets without published license
- Assets whose public redistribution is forbidden

## Notes
- Every asset must be recorded here before it is added to the project.
- Assets that are not confirmed should not be placed in the repository.
- If attribution is required, the attribution must be included in project credits or docs.
- This file is not legal advice; it is an internal compliance checklist.

## Review Workflow
1. Download asset.
2. Confirm license.
3. Add source + license to this file.
4. Mark status.
5. If uncertain, reject the asset.
6. Keep local copy of source and license information.

## Local Downloads (2026-10-25)

Downloaded per this workflow into `Assets/_downloads/` with a README.md
listing source URLs and license files. The whole `Assets/` directory is
git-ignored on purpose, so these copies live locally and none of them are
wired into the game build. Pulling any of them into the build or the
repository requires a row in `THIRD_PARTY.md` first (its rule: a new
third-party asset gets its line before the commit).

Checked and deliberately NOT downloaded:
- Fonts (Google Fonts / Fontsource): the game uses system font stacks only
  (`client/web/css/main.css`: Georgia / Segoe UI) — no third-party font is
  in use, so nothing to download.
- Music (Mixkit, Pixabay, YouTube Audio Library) and OpenGameArt: per-track
  licenses, still "Needs review" — not downloaded until a specific track is
  confirmed compatible.
