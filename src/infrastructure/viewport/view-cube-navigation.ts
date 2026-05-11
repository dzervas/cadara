import {
  VIEW_NAVIGATION_PRESETS,
  type ViewNavigationCornerPresetId,
  type ViewNavigationFacePresetId,
} from "@/infrastructure/viewport/view-navigation";

interface ViewCubeFaceTarget {
  presetId: ViewNavigationFacePresetId;
  label: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  labelUp: readonly [number, number, number];
}

interface ViewCubeCornerTarget {
  presetId: ViewNavigationCornerPresetId;
  position: readonly [number, number, number];
}

const FACE_TARGET_DISTANCE = 0.66;
const CORNER_TARGET_DISTANCE = 0.52;

export const VIEW_CUBE_FACE_TARGETS = [
  {
    presetId: "front",
    label: VIEW_NAVIGATION_PRESETS.front.label!,
    position: [0, -FACE_TARGET_DISTANCE, 0],
    rotation: [Math.PI / 2, 0, 0],
    labelUp: [0, 0, 1],
  },
  {
    presetId: "back",
    label: VIEW_NAVIGATION_PRESETS.back.label!,
    position: [0, FACE_TARGET_DISTANCE, 0],
    rotation: [-Math.PI / 2, 0, 0],
    labelUp: [0, 0, 1],
  },
  {
    presetId: "right",
    label: VIEW_NAVIGATION_PRESETS.right.label!,
    position: [FACE_TARGET_DISTANCE, 0, 0],
    rotation: [0, Math.PI / 2, 0],
    labelUp: [0, 0, 1],
  },
  {
    presetId: "left",
    label: VIEW_NAVIGATION_PRESETS.left.label!,
    position: [-FACE_TARGET_DISTANCE, 0, 0],
    rotation: [0, -Math.PI / 2, 0],
    labelUp: [0, 0, 1],
  },
  {
    presetId: "top",
    label: VIEW_NAVIGATION_PRESETS.top.label!,
    position: [0, 0, FACE_TARGET_DISTANCE],
    rotation: [0, 0, 0],
    labelUp: [0, 1, 0],
  },
  {
    presetId: "bottom",
    label: VIEW_NAVIGATION_PRESETS.bottom.label!,
    position: [0, 0, -FACE_TARGET_DISTANCE],
    rotation: [Math.PI, 0, 0],
    labelUp: [0, -1, 0],
  },
] as const satisfies readonly ViewCubeFaceTarget[];

const VIEW_CUBE_CORNER_PRESET_IDS = [
  "frontRightTop",
  "frontLeftTop",
  "backRightTop",
  "backLeftTop",
  "frontRightBottom",
  "frontLeftBottom",
  "backRightBottom",
  "backLeftBottom",
] as const satisfies readonly ViewNavigationCornerPresetId[];

export const VIEW_CUBE_CORNER_TARGETS: ViewCubeCornerTarget[] =
  VIEW_CUBE_CORNER_PRESET_IDS.map((presetId) => {
    const [x, y, z] = VIEW_NAVIGATION_PRESETS[presetId].direction;

    return {
      presetId,
      position: [
        x * CORNER_TARGET_DISTANCE,
        y * CORNER_TARGET_DISTANCE,
        z * CORNER_TARGET_DISTANCE,
      ],
    };
  });
