// Character Creation UI
// Empire of Sefevids

import { VOCATIONS, type Vocation, type Attributes } from './creation-data';
import { t } from '../i18n';
import { api } from '../api';
import { toast } from '../hud';

// DOM Elements
const creationScreen = document.getElementById('creation-screen') as HTMLDivElement;
const gameScreen = document.getElementById('game-screen') as HTMLDivElement;

const vocationSelect = document.getElementById('vocation-select') as HTMLSelectElement;
const faceEyeShape = document.getElementById('face-eye-shape') as HTMLInputElement;
const faceNoseShape = document.getElementById('face-nose-shape') as HTMLInputElement;
const faceMouthShape = document.getElementById('face-mouth-shape') as HTMLInputElement;
const faceJawShape = document.getElementById('face-jaw-shape') as HTMLInputElement;
const hairStyle = document.getElementById('hair-style') as HTMLInputElement;
const hairColor = document.getElementById('hair-color') as HTMLInputElement;
const strPoints = document.getElementById('str-points') as HTMLSpanElement;
const dexPoints = document.getElementById('dex-points') as HTMLSpanElement;
const intPoints = document.getElementById('int-points') as HTMLSpanElement;
const conPoints = document.getElementById('con-points') as HTMLSpanElement;
const sprPoints = document.getElementById('spr-points') as HTMLSpanElement;

const attributePointsDisplay = document.getElementById('attribute-points') as HTMLSpanElement;
const strInput = document.getElementById('str-input') as HTMLInputElement;
const dexInput = document.getElementById('dex-input') as HTMLInputElement;
const intInput = document.getElementById('int-input') as HTMLInputElement;
const conInput = document.getElementById('con-input') as HTMLInputElement;
const sprInput = document.getElementById('spr-input') as HTMLInputElement;

const createCharacterBtn = document.getElementById('create-character-btn') as HTMLButtonElement;
const confirmVocationBtn = document.getElementById('confirm-vocation-btn') as HTMLButtonElement;
const pvpArenaBtn = document.getElementById('pvp-arena-btn') as HTMLButtonElement | null;

// State - use mutable types
let formData = {
  vocation: 'warrior' as Vocation,
  face: { eyeShape: 1, noseShape: 1, mouthShape: 1, jawShape: 1 } as const,
  hair: { style: 1, color: 'black' },
  attributes: { str: 12, dex: 8, int: 5, con: 15, spr: 6 }
};

let availablePoints: number = 30; // Points to distribute

// Initialize vocation select
function initVocationSelect(): void {
  vocationSelect.innerHTML = '';
  for (const vocation of Object.keys(VOCATIONS) as Vocation[]) {
    const option = document.createElement('option');
    option.value = vocation;
    option.text = VOCATIONS[vocation].name;
    vocationSelect.appendChild(option);
  }
  vocationSelect.value = formData.vocation;
}

// Update vocation display
function updateVocationDisplay(): void {
  const vocation: Vocation = vocationSelect.value as Vocation;
  const vocData = VOCATIONS[vocation];
  if (vocData) {
    // Update attribute starting points based on vocation
    formData.attributes = { ...vocData.startingAttributes } as Attributes;
    availablePoints = 30; // Reset points
    updateAttributeDisplay();
  }
}

// Update attribute display
function updateAttributeDisplay(): void {
  strPoints.textContent = formData.attributes.str.toString();
  dexPoints.textContent = formData.attributes.dex.toString();
  intPoints.textContent = formData.attributes.int.toString();
  conPoints.textContent = formData.attributes.con.toString();
  sprPoints.textContent = formData.attributes.spr.toString();
  attributePointsDisplay.textContent = availablePoints.toString();
  
  // Update inputs
  strInput.value = formData.attributes.str.toString();
  dexInput.value = formData.attributes.dex.toString();
  intInput.value = formData.attributes.int.toString();
  conInput.value = formData.attributes.con.toString();
  sprInput.value = formData.attributes.spr.toString();
}

// Vocation change handler
vocationSelect.addEventListener('change', (e) => {
  const select = e.target as HTMLSelectElement;
  if (select) {
    formData.vocation = select.value as Vocation;
    updateVocationDisplay();
  }
});

// Face customization handlers
[faceEyeShape, faceNoseShape, faceMouthShape, faceJawShape].forEach(input => {
  input.addEventListener('change', (e) => {
    const value = parseInt((e.target as HTMLInputElement).value);
    const field = input.id.replace('face-', '').toLowerCase() as keyof typeof formData.face;
    (formData.face as any)[field] = value;
  });
});

// Hair customization handlers
hairStyle.addEventListener('change', (e) => {
  const value = parseInt((e.target as HTMLInputElement).value);
  formData.hair.style = value;
});

hairColor.addEventListener('change', (e) => {
  const value = (e.target as HTMLInputElement).value;
  formData.hair.color = value;
});

// Attribute input handlers
[strInput, dexInput, intInput, conInput, sprInput].forEach(input => {
  input.addEventListener('change', (e) => {
    const value = parseInt((e.target as HTMLInputElement).value) || 0;
    const attr = input.id.replace('-input', '') as keyof Attributes;
    if (value >= 1 && value <= 20) {
      const oldValue = formData.attributes[attr] || 0;
      const delta = value - oldValue;
      availablePoints += delta;
      formData.attributes[attr] = value;
      updateAttributeDisplay();
    }
  });
});

// Initialize creation screen
export function initCreationScreen(): void {
  // Set up event listeners and initial state
  initVocationSelect();
  updateAttributeDisplay();
  
  // Hide creation screen initially
  creationScreen.style.display = 'block';
  gameScreen.style.display = 'none';
  
  // Create character button
  createCharacterBtn.addEventListener('click', () => {
    // Create the character
    const character: any = {
      id: Math.random().toString(36).substr(2, 9),
      vocation: formData.vocation,
      name: prompt('Enter your character name:', 'Hero') || 'Hero',
      attributes: formData.attributes,
      currentHp: formData.attributes.con * 10,
      currentMp: formData.attributes.spr * 5,
      maxHp: formData.attributes.con * 10,
      maxMp: formData.attributes.spr * 5,
      equipment: VOCATIONS[formData.vocation].startingEquipment,
      level: 1,
      currentXp: 0,
      maxXp: 100
    };
    
    // Store character and transition to game
    localStorage.setItem('created_character', JSON.stringify(character));
    transitionToGame(character);
  });
  
  // PvP Arena button
  if (pvpArenaBtn) {
    pvpArenaBtn.addEventListener('click', () => {
      // Check if character is created
      const char = JSON.parse(localStorage.getItem('created_character') || '{}');
      if (!char.id) {
        alert('Сначала создайте персонажа!');
        return;
      }
      // Request matchmaking from server
      void api.pvpFindMatch(char.id).then(res => {
        if (res && res.match) {
          const match = res.match;
          // Show matchmaking status
          const opponentName = match.opponent ? match.opponent.name : 'Ожидание соперника';
          toast(`Поиск Opponenta: ${opponentName}`, 'info');
        } else {
          toast(t('pvp.wait_opponent'), 'info');
        }
      }).catch(err => {
        toast((err as Error).message, 'error');
      });
    });
  }
  
  // Confirm vocation button
  confirmVocationBtn.addEventListener('click', () => {
    formData.vocation = vocationSelect.value as Vocation;
    updateVocationDisplay();
    // Show creation complete message
    alert('Вocation подтвержден! ' + VOCATIONS[formData.vocation].description);
  });
}

// Transition to game
function transitionToGame(character: any): void {
  creationScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  
  // Initialize character in game
  console.log('Character created:', character);
  
  // Dispatch event for game initialization
  const event = new CustomEvent('character:created', { detail: character });
  document.dispatchEvent(event);
}