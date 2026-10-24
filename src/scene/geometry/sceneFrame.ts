// Scene framing: heart centred at the origin (centimetres), anatomical camera presets and cut planes.
import * as THREE from "three";
import { specCenter } from "../asset-adapters/heartAsset";
import type { HeartAssetSpec } from "../asset-adapters/registry";
import type { CameraPreset, CutAxis } from "@/state/store";

export const CAMERA_DISTANCE = 46;

export interface CameraPose { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 }

/** Camera presets and cut planes for one asset (its LV frame and valves). */
export interface SceneFrame {
  cameraPose(preset: CameraPreset, distance?: number): CameraPose;
  cutPlane(axis: CutAxis, offset: number, out?: THREE.Plane): THREE.Plane;
}

const frames = new Map<string, SceneFrame>();

export function sceneFrame(spec: HeartAssetSpec): SceneFrame {
  let f = frames.get(spec.id);
  if (!f) frames.set(spec.id, (f = createFrame(spec)));
  return f;
}

function createFrame(spec: HeartAssetSpec): SceneFrame {
  const M = spec.manifest;
  const lv = M.deformation.lv;
  const center = specCenter(spec);
  const AXIS = new THREE.Vector3(...(lv.axis as [number, number, number])).normalize();
  const SEP = new THREE.Vector3(...(lv.septalDir as [number, number, number])).normalize();
  const ANT = new THREE.Vector3(...(lv.anteriorDir as [number, number, number])).normalize();
  const toWorld = (v: number[]) => new THREE.Vector3(v[0], v[1], v[2]).sub(center);

  function cameraPose(preset: CameraPreset, distance = CAMERA_DISTANCE): CameraPose {
    const o = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const at = (dir: THREE.Vector3, d = distance, target = o, u = up) => ({ position: target.clone().addScaledVector(dir.clone().normalize(), d), target: target.clone(), up: u.clone() });
    switch (preset) {
      case "anterior": return at(new THREE.Vector3(0, 0, 1));
      case "posterior": return at(new THREE.Vector3(0, 0, -1));
      case "left_lateral": return at(new THREE.Vector3(1, 0, 0));
      case "right_lateral": return at(new THREE.Vector3(-1, 0, 0));
      case "superior": return at(new THREE.Vector3(0, 1, 0.001), distance, o, new THREE.Vector3(0, 0, -1));
      case "inferior": return at(new THREE.Vector3(0, -1, 0.001), distance, o, new THREE.Vector3(0, 0, 1));
      case "four_chamber": {
        // apical four-chamber style: view the four-chamber cut from the anterior side, apex down
        const t = toWorld(lv.base).addScaledVector(AXIS, 2.5);
        return at(ANT.clone().addScaledVector(AXIS, 0.35), distance * 0.85, t, AXIS.clone().negate());
      }
      case "short_axis": {
        // look from the base toward the apex so the short-axis cut face (apical part kept) faces the camera
        const t = toWorld(lv.base).addScaledVector(AXIS, 4.2);
        return at(AXIS.clone().negate(), distance * 0.75, t, ANT.clone());
      }
      case "mitral_closeup": {
        // side view across the valve from the four-chamber cut: leaflets, chordae and the atrial side together
        const mv = M.valves.mitral_valve;
        const c = toWorld(mv.center).addScaledVector(new THREE.Vector3(...(mv.normal as [number, number, number])), -0.8);
        return at(ANT.clone().addScaledVector(SEP, -0.35), 21, c, AXIS.clone().negate());
      }
      case "aortic_closeup": {
        const av = M.valves.aortic_valve;
        const c = toWorld(av.center);
        return at(new THREE.Vector3(...(av.normal as [number, number, number])).addScaledVector(new THREE.Vector3(0, 0, 1), 0.6), 17, c, new THREE.Vector3(0, 0, -1));
      }
    }
  }

  /** Cutaway planes (world space). Three.js keeps the positive side of each plane. */
  function cutPlane(axis: CutAxis, offset: number, out = new THREE.Plane()): THREE.Plane {
    const span = 3.2;
    switch (axis) {
      case "coronal": return out.set(new THREE.Vector3(0, 0, -1), offset * span);
      case "sagittal": return out.set(new THREE.Vector3(-1, 0, 0), offset * span);
      case "short_axis": {
        const p = toWorld(lv.base).addScaledVector(AXIS, 4.2 + offset * 2.5);
        return out.setFromNormalAndCoplanarPoint(AXIS.clone(), p);
      }
      case "four_chamber": {
        const n = ANT.clone().negate();
        const p = toWorld(lv.base).addScaledVector(ANT, offset * span);
        return out.setFromNormalAndCoplanarPoint(n, p);
      }
    }
  }

  return { cameraPose, cutPlane };
}

export const DISABLED_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
