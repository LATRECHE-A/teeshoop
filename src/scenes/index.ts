/**
 * Scene registry — environments the garment can be previewed in (TODO: "add
 * different scenes with different lighting in 2D and 3D").
 *
 * ONE backdrop drives BOTH views: the Konva 2D stage and the R3F 3D canvas are
 * both transparent, so a CSS background on the shared stage container shows
 * through either. 3D additionally swaps the Lightformer rig, contact-shadow
 * tint and fog to match the environment's light.
 *
 * `studio` is the neutral default and the ONLY scene that follows the UI theme
 * (dark press-room / light paper); every other scene is a fixed "window" into
 * a place and reads the same in light or dark chrome.
 *
 * All 3D positions live in the drei <Environment> virtual scene (not garment
 * inches); magnitudes ~5–10 mirror the original studio rig.
 */

export type SceneId = 'studio' | 'beach' | 'forest' | 'city' | 'sunset' | 'night'
type ThemeName = 'dark' | 'light'

export const SCENE_IDS: SceneId[] = ['studio', 'beach', 'forest', 'city', 'sunset', 'night']

export interface LightformerSpec {
  form?: 'rect' | 'ring' | 'circle'
  intensity: number
  color: string
  position: [number, number, number]
  scale: number | [number, number, number]
  target?: [number, number, number]
}

export interface Scene3DConfig {
  lightformers: LightformerSpec[]
  /** Multiplies each garment material's envMapIntensity. */
  envIntensity: number
  shadowColor: string
  shadowOpacity: number
  /** Base fill so sides facing away never crush to pure black. */
  hemisphere?: { sky: string; ground: string; intensity: number }
}

export interface SceneDef {
  id: SceneId
  nameKey: string
  descKey: string
  /**
   * Shared stage backdrop. Returns a CSS `background` value applied behind both
   * canvases; empty string means "use the theme-aware .canvas-surface look".
   */
  backdrop: (theme: ThemeName) => string
  three: Scene3DConfig
}

// --- studio (default; the original press-room rig) -------------------------
const STUDIO: SceneDef = {
  id: 'studio',
  nameKey: 'scene.studio',
  descKey: 'scene.studio_desc',
  backdrop: () => '', // theme-aware .canvas-surface
  three: {
    envIntensity: 1.0,
    shadowColor: '#000000',
    shadowOpacity: 0.58,
    lightformers: [
      { form: 'rect', intensity: 5.2, color: '#fff6ec', position: [-5.5, 6.5, 6], scale: [8, 5.5, 1] },
      { form: 'rect', intensity: 2.6, color: '#a9cdff', position: [8.5, 2, -5], scale: [3.2, 8, 1] },
      { form: 'rect', intensity: 1.05, color: '#e9eef6', position: [3.5, -2.5, 7.5], scale: [8, 3.5, 1] },
      { form: 'ring', intensity: 0.7, color: '#ffffff', position: [0, 9, 0.5], scale: 6.5 },
      { form: 'rect', intensity: 0.5, color: '#35c7ff', position: [-8, 0, -6], scale: [2.5, 6, 1] },
      { form: 'rect', intensity: 1.5, color: '#e6ecf5', position: [-2, 4.5, -8], scale: [7, 4.5, 1] },
    ],
  },
}

// --- beach (bright warm sun, sky fill, sand bounce) ------------------------
const BEACH: SceneDef = {
  id: 'beach',
  nameKey: 'scene.beach',
  descKey: 'scene.beach_desc',
  backdrop: () =>
    'radial-gradient(62% 46% at 50% 20%, rgba(255,249,224,0.92), rgba(255,249,224,0) 60%),' +
    'linear-gradient(180deg, #63b6ec 0%, #9fd4ef 42%, #e4d3a6 58%, #d3bd88 100%)',
  three: {
    envIntensity: 1.25,
    shadowColor: '#6b5836',
    shadowOpacity: 0.5,
    hemisphere: { sky: '#bfe0ff', ground: '#e8d9b0', intensity: 0.28 },
    lightformers: [
      { form: 'rect', intensity: 7.5, color: '#fff2d6', position: [-6, 7, 5], scale: [7, 6, 1] },
      { form: 'rect', intensity: 3.2, color: '#bfe0ff', position: [5, 3, 7], scale: [10, 7, 1] },
      { form: 'rect', intensity: 1.6, color: '#f0e2bd', position: [0, -5, 6], scale: [10, 4, 1] },
      { form: 'ring', intensity: 1.2, color: '#ffffff', position: [0, 10, 0], scale: 7 },
      { form: 'rect', intensity: 2.0, color: '#cfe8ff', position: [7, 4, -6], scale: [3, 7, 1] },
      { form: 'rect', intensity: 1.6, color: '#dbeeff', position: [-3, 4, -8], scale: [7, 5, 1] },
    ],
  },
}

// --- forest (dappled green shade, cooler, dimmer) -------------------------
const FOREST: SceneDef = {
  id: 'forest',
  nameKey: 'scene.forest',
  descKey: 'scene.forest_desc',
  backdrop: () =>
    'radial-gradient(42% 30% at 34% 14%, rgba(214,255,188,0.28), rgba(214,255,188,0) 60%),' +
    'linear-gradient(180deg, #2f5d3a 0%, #3c6f45 42%, #294a30 100%)',
  three: {
    envIntensity: 0.9,
    shadowColor: '#16240f',
    shadowOpacity: 0.55,
    hemisphere: { sky: '#9fc27f', ground: '#24331d', intensity: 0.3 },
    lightformers: [
      { form: 'rect', intensity: 4.2, color: '#eaf6d8', position: [-5, 8, 5], scale: [5, 5, 1] },
      { form: 'rect', intensity: 1.8, color: '#7fae6e', position: [4, 2, 7], scale: [9, 7, 1] },
      { form: 'rect', intensity: 0.7, color: '#3f5a3a', position: [0, -5, 5], scale: [9, 4, 1] },
      { form: 'ring', intensity: 0.6, color: '#d8ecc0', position: [0, 9, 0.5], scale: 6 },
      { form: 'rect', intensity: 1.6, color: '#a9c6d8', position: [7, 3, -6], scale: [3, 7, 1] },
      { form: 'rect', intensity: 1.2, color: '#86a878', position: [-3, 4, -8], scale: [7, 5, 1] },
    ],
  },
}

// --- city (cool overcast + subtle neon kicks) -----------------------------
const CITY: SceneDef = {
  id: 'city',
  nameKey: 'scene.city',
  descKey: 'scene.city_desc',
  backdrop: () =>
    'linear-gradient(180deg, #9fb0c2 0%, #b8c4d0 44%, #6f7a86 100%)',
  three: {
    envIntensity: 1.05,
    shadowColor: '#10151d',
    shadowOpacity: 0.6,
    lightformers: [
      { form: 'rect', intensity: 5.0, color: '#eef3fb', position: [-5.5, 6.5, 6], scale: [8, 6, 1] },
      { form: 'rect', intensity: 2.6, color: '#c4d2e0', position: [5, 2, 7], scale: [9, 7, 1] },
      { form: 'rect', intensity: 1.0, color: '#b8bcc2', position: [0, -4, 6], scale: [9, 4, 1] },
      { form: 'ring', intensity: 0.8, color: '#ffffff', position: [0, 9, 0.5], scale: 6.5 },
      { form: 'rect', intensity: 0.9, color: '#ff3d8f', position: [-8, 0, -6], scale: [2.5, 6, 1] },
      { form: 'rect', intensity: 0.9, color: '#35c7ff', position: [8, 1, -6], scale: [2.5, 6, 1] },
      { form: 'rect', intensity: 1.3, color: '#d6dee8', position: [-2, 4.5, -8], scale: [7, 5, 1] },
    ],
  },
}

// --- sunset (golden hour, warm low key, magenta rim) ----------------------
const SUNSET: SceneDef = {
  id: 'sunset',
  nameKey: 'scene.sunset',
  descKey: 'scene.sunset_desc',
  backdrop: () =>
    'radial-gradient(54% 42% at 50% 72%, rgba(255,206,138,0.85), rgba(255,206,138,0) 62%),' +
    'linear-gradient(180deg, #3a2a4d 0%, #b8557a 32%, #f2a15a 64%, #f0c07a 100%)',
  three: {
    envIntensity: 1.15,
    shadowColor: '#3a1f2e',
    shadowOpacity: 0.5,
    hemisphere: { sky: '#ffb27a', ground: '#4a2b3a', intensity: 0.3 },
    lightformers: [
      { form: 'rect', intensity: 8.0, color: '#ffb86b', position: [-7, 2.5, 5], scale: [7, 5, 1] },
      { form: 'rect', intensity: 2.4, color: '#ff9ec4', position: [5, 3, 6], scale: [9, 7, 1] },
      { form: 'rect', intensity: 1.3, color: '#d98a4a', position: [0, -5, 6], scale: [9, 4, 1] },
      { form: 'rect', intensity: 2.8, color: '#ff5c9d', position: [7, 4, -6], scale: [3.5, 8, 1] },
      { form: 'rect', intensity: 1.4, color: '#7b6cff', position: [-3, 4, -8], scale: [7, 5, 1] },
      { form: 'ring', intensity: 0.6, color: '#ffd9a0', position: [0, 9, 0.5], scale: 6 },
    ],
  },
}

// --- night (dim blue, warm practicals, strong rim) ------------------------
const NIGHT: SceneDef = {
  id: 'night',
  nameKey: 'scene.night',
  descKey: 'scene.night_desc',
  backdrop: () =>
    'radial-gradient(64% 52% at 50% 30%, #1b2b52 0%, #0b1327 56%, #070b16 100%)',
  three: {
    envIntensity: 0.72,
    shadowColor: '#05070f',
    shadowOpacity: 0.62,
    hemisphere: { sky: '#2a3a63', ground: '#05070f', intensity: 0.35 },
    lightformers: [
      { form: 'rect', intensity: 2.6, color: '#b9c9ff', position: [-6, 7, 4], scale: [5, 5, 1] },
      { form: 'rect', intensity: 0.9, color: '#3a4e7a', position: [5, 2, 7], scale: [9, 7, 1] },
      { form: 'circle', intensity: 2.2, color: '#ffb877', position: [7, 1, 3], scale: 2.2 },
      { form: 'circle', intensity: 1.4, color: '#ffcf94', position: [-6, -1, 4], scale: 1.6 },
      { form: 'rect', intensity: 1.8, color: '#35c7ff', position: [8, 3, -6], scale: [2.5, 7, 1] },
      { form: 'rect', intensity: 1.0, color: '#2b3d6b', position: [-3, 4, -8], scale: [7, 5, 1] },
    ],
  },
}

export const SCENES: Record<SceneId, SceneDef> = {
  studio: STUDIO,
  beach: BEACH,
  forest: FOREST,
  city: CITY,
  sunset: SUNSET,
  night: NIGHT,
}

export function getScene(id: SceneId): SceneDef {
  return SCENES[id] ?? STUDIO
}

export function isSceneId(v: unknown): v is SceneId {
  return typeof v === 'string' && v in SCENES
}

/**
 * Stage background for a scene. Studio uses the theme-aware `.canvas-surface`
 * utility; every other scene supplies a fixed environment gradient.
 */
export function stageBackground(
  id: SceneId,
  theme: ThemeName,
): { className: string; style?: { background: string } } {
  const def = getScene(id)
  const bg = def.backdrop(theme)
  if (!bg) return { className: 'canvas-surface' }
  return { className: 'scene-surface', style: { background: bg } }
}
