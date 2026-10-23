// Реэкспорт THREE для внутренних модулей, чтобы не тянуть three целиком в типы
import * as THREE from 'three';
export { THREE };
export type { Object3D, Group, Mesh, SkinnedMesh, AnimationMixer, AnimationClip, AnimationAction, Skeleton, Bone, Box3, Vector3, Quaternion, Euler, Matrix4, Material, Texture, Scene, Camera, Raycaster, Intersection } from 'three';