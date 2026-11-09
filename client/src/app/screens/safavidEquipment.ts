// ============================================================
// Safavid Equipment Panel — набор одежды, доспехов и оружия
// ============================================================
// Позволяет игроку подобрать историческую экипировку Сефевидов
// при создании персонажа: халат, тюрбан, кольчуга, шлем, меч,
// кинжал, булава, лук. Каждый предмет — 3D-модель из Blender.

import * as THREE from 'three';
import {
  getSafavidAssetsByType,
  type SafavidAssetDef,
} from '../../assets/safavid/SafavidAssets';
import { getSafavidAssetInstance, getLoadedSafavidAssetIds, loadSafavidAssets } from '../game3d/safavidLoader';

export type EquipmentSlot = 'robe' | 'turban' | 'coat' | 'mail' | 'helmet' | 'weapon';

/**
 * Стартовый набор исторической одежды.
 *
 * БЫЛО: все слоты по умолчанию null, и персонаж, созданный без правок
 * панели, уезжал на сервер с пустой экипировкой — в мире он выглядел
 * голым базовым мешем, хотя весь смысл системы в сефевидской одежде.
 *
 * ТЕПЕРЬ: солдатский набор рядового кызылбаша — верхний халат (чога),
 * тюрбан и шамшир. Кольчуга и шлем остаются null: они визуально тяжёлые,
 * их уместнее надевать по желанию. Игрок может поменять любой слот
 * радиокнопками до «Создать».
 */
const ОДЕТЫЙ_СТАРТ: Record<EquipmentSlot, string | null> = {
  robe: null,
  turban: 'turban_safavid',
  coat: 'chogha_outer',
  mail: null,
  helmet: null,
  weapon: 'shamshir_persian',
};

/** Текущий выбор экипировки */
export class SafavidEquipmentPanel {
  private container: HTMLElement | null = null;
  private selected: Record<EquipmentSlot, string | null> = { ...ОДЕТЫЙ_СТАРТ };

  /** Рендерит панель в указанный контейнер DOM */
  render(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) return;

    // Экран выбора персонажа показывается без перезагрузки страницы —
    // выход из игры ведёт ровно сюда, и render зовётся при каждом таком
    // показе. Контейнер — собственность панели, вычищаем после прошлого
    // показа: иначе панели накапливаются одна под другой, а радиокнопки
    // с одинаковыми name в двух панелях делят один выбор на обе.
    parent.replaceChildren();

    this.container = document.createElement('div');
    this.container.id = 'safavid-equipment-panel';
    this.container.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding: 20px;
      background: #1a1410;
      color: #e0e0e0;
      border-radius: 8px;
      border: 1px solid #3a2e22;
      font-family: sans-serif;
    `;

    // Заголовок
    const title = document.createElement('h3');
    title.textContent = 'Экипировка Сефевидов';
    title.style.cssText = 'margin: 0 0 16px 0; color: #00d4aa; grid-column: 1 / -1;';
    this.container.appendChild(title);

    // Слоты одежды
    const clothingAssets = getSafavidAssetsByType('clothing');
    const armorAssets = getSafavidAssetsByType('armor');
    const weaponAssets = getSafavidAssetsByType('weapon');

    this.renderCategory('Одежда', clothingAssets);
    this.renderCategory('Доспехи', armorAssets);
    this.renderCategory('Оружие', weaponAssets);

    parent.appendChild(this.container);
  }

  private renderCategory(label: string, assets: SafavidAssetDef[]): void {
    if (!this.container) return;

    // Заголовок категории
    const catTitle = document.createElement('h4');
    catTitle.textContent = label;
    catTitle.style.cssText = 'margin: 12px 0 8px 0; color: #888; grid-column: 1 / -1; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;';
    this.container.appendChild(catTitle);

    // Контейнер предметов категории
    const itemsWrap = document.createElement('div');
    itemsWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px; grid-column: 1 / -1;';
    this.container.appendChild(itemsWrap);

    for (const asset of assets) {
      const slot = this.assetToSlot(asset);
      if (!slot) continue;

      const item = document.createElement('label');
      item.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px;
        background: #2a221a;
        border: 1px solid #3a2e22;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 13px;
      `;

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `eq-${slot}`;
      input.value = asset.id;
      input.checked = this.selected[slot] === asset.id;
      input.style.cssText = 'accent-color: #00d4aa; margin: 0;';

      input.addEventListener('change', () => {
        this.selected[slot] = asset.id;
        this.updateSelectionVisuals();
      });

      const name = document.createElement('span');
      name.textContent = this.getLocalizedName(asset);

      const stats = this.getStatsText(asset);
      if (stats) {
        const statSpan = document.createElement('span');
        statSpan.textContent = stats;
        statSpan.style.cssText = 'margin-left: auto; font-size: 11px; color: #00d4aa;';
        item.appendChild(statSpan);
      }

      item.appendChild(input);
      item.appendChild(name);
      itemsWrap.appendChild(item);
    }
  }

  private assetToSlot(asset: SafavidAssetDef): EquipmentSlot | null {
    switch (asset.category) {
      case 'robe': return 'robe';
      case 'turban': return 'turban';
      case 'coat': return 'coat';
      case 'mail': return 'mail';
      case 'helmet': return 'helmet';
      case 'sword': case 'dagger': case 'mace': case 'bow': return 'weapon';
      default: return null;
    }
  }

  private getLocalizedName(asset: SafavidAssetDef): string {
    // Предпочитаем русский, потом английский, потом азербайджанский
    const lang = (document.documentElement.lang || 'ru').slice(0, 2);
    if (lang === 'ru' && asset.nameRu) return asset.nameRu;
    if (lang === 'en') return asset.name;
    if (lang === 'az' && asset.nameAz) return asset.nameAz;
    return asset.name;
  }

  private getStatsText(asset: SafavidAssetDef): string | undefined {
    if (!asset.stats) return undefined;
    const parts: string[] = [];
    if (asset.stats.defense !== undefined) parts.push(`Защита: ${asset.stats.defense}`);
    if (asset.stats.damage !== undefined) parts.push(`Урон: ${asset.stats.damage}`);
    if (asset.stats.weight !== undefined) parts.push(`Вес: ${asset.stats.weight}кг`);
    return parts.join('  ·  ');
  }

  private updateSelectionVisuals(): void {
    if (!this.container) return;
    const radios = this.container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    for (const radio of radios) {
      const label = radio.parentElement as HTMLLabelElement | null;
      if (!label) continue;
      if (radio.checked) {
        label.style.borderColor = '#00d4aa';
        label.style.background = '#3a2e22';
      } else {
        label.style.borderColor = '#3a2e22';
        label.style.background = '#2a221a';
      }
    }
  }

  /** Получить выбранную экипировку (для отправки на сервер или применения к персонажу) */
  getSelection(): Record<EquipmentSlot, string | null> {
    return { ...this.selected };
  }

  /** Применить выбранную экипировку к 3D-персонажу в сцене */
  async applyToScene(scene: any): Promise<void> {
    // В первый раз панель открывается до всякого мира: если попытка загрузки
    // в boot() прошла без токена и кончилась 401, здесь она повторяется —
    // токен к этому моменту у сеанса уже есть. Иначе превью молча рисовало
    // голого персонажа, хотя слоты выбраны.
    if (!getLoadedSafavidAssetIds().length) {
      try {
        await loadSafavidAssets();
      } catch (err) {
        console.warn('[SafavidPanel] Asset bundle unreachable, preview without outfit:', err);
      }
    }

    // Удаляем старую экипировку если была
    const old = scene.getObjectByName('safavid-equipment');
    if (old) scene.remove(old);

    const equipmentGroup = new THREE.Group();
    equipmentGroup.name = 'safavid-equipment';

    for (const assetId of Object.values(this.selected)) {
      if (!assetId) continue;
      const instance = getSafavidAssetInstance(assetId);
      if (instance) {
        equipmentGroup.add(instance);
      }
    }

    scene.add(equipmentGroup);
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
  }
}

// Экспорт singleton
export const safavidEquipment = new SafavidEquipmentPanel();