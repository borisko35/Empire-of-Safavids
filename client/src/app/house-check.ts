// Диагностический рендер дома: GLB рядом с силуэтом человека 1.9 м.
// Простая сцена БЕЗ композера — программный рендер тянет её мгновенно,
// в отличие от полного пайплайна игры. Кадр уходит на shot-server.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { сВходом } from './game3d/modelAccess';
import { декодерDraco } from './game3d/draco';

const параметры = new URLSearchParams(location.search);
const модель = параметры.get('m') ?? 'decor/persian-house-base.glb';
const имя = параметры.get('shot') ?? 'house';

const сцена = new THREE.Scene();
сцена.background = new THREE.Color(0x30343c);
const камера = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
камера.position.set(14, 7, 16);
камера.lookAt(0, 2.2, 0);

const рендер = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
рендер.setSize(1280, 720);
рендер.toneMapping = THREE.NeutralToneMapping;
рендер.toneMappingExposure = 1.15;
document.body.appendChild(рендер.domElement);
const статус = document.createElement('div');
статус.style.cssText = 'position:fixed;top:8px;left:8px;color:#e8c37a;font:13px monospace;z-index:9';
document.body.appendChild(статус);
статус.textContent = 'загрузка модели…';

сцена.add(new THREE.HemisphereLight(0xbfd6e4, 0x6b5a42, 0.95));
const солнце = new THREE.DirectionalLight(0xffe8c0, 1.5);
солнце.position.set(8, 12, 6);
сцена.add(солнце);

// Земля-сетка: квадрат = 1 м. Сразу видно масштаб дверей и окон.
const сетка = new THREE.GridHelper(30, 30, 0x888888, 0x555555);
сцена.add(сетка);

// Человеческий силуэт 1.9 м: два бокса (ноги+торс) и голова.
const человек = new THREE.Group();
const тело = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.55, 0.3), new THREE.MeshStandardMaterial({ color: 0xc46a3a }));
тело.position.y = 0.775 + 0.35;
const голова = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd8a878 }));
голова.position.y = 1.83;
человек.add(тело, голова);
человек.position.set(2.6, 0, 1.5);
сцена.add(человек);

const l = сВходом(new GLTFLoader());
l.setDRACOLoader(декодерDraco());
l.load(`/game/models/${модель}`, (gltf) => {
  const дом = gltf.scene;
  статус.textContent = 'модель загружена';
  сцена.add(дом);
  // Подпись габаритов в консоль
  const box = new THREE.Box3().setFromObject(дом);
  const размер = box.getSize(new THREE.Vector3());
  статус.textContent += ` — габарит ${размер.x.toFixed(2)} x ${размер.y.toFixed(2)} x ${размер.z.toFixed(2)}`;
  // Рендер СИНХРОННО: панель браузера бывает скрыта, rAF в ней не тикает,
  // и кадр никогда не рисуется. Один вызов здесь — кадр есть всегда.
  рендер.render(сцена, камера);
  const данные = рендер.domElement.toDataURL('image/jpeg', 0.92);
  void fetch(`http://127.0.0.1:8099/shot?name=${encodeURIComponent(имя)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: данные,
  });
}, undefined, (e) => {
  статус.textContent = 'ОШИБКА загрузки модели: ' + String((e as Error)?.message ?? e).slice(0, 120);
});
