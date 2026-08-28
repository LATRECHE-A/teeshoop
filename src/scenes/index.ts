/**
 * Scene registry: environments the garment can be previewed in (TODO: "add
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

/**
 * The one SHADOW-CASTING light. An environment map alone delivers light from
 * every direction at once, which is why the garment used to read as an
 * inflated shell: nothing was ever occluded, so a sleeve cast nothing onto the
 * body and a hood cast nothing into itself. This is the directional key that
 * puts those shadows back.
 *
 * `direction` is where the light comes FROM, in the same virtual-scene
 * magnitudes as the lightformers (it is normalised before use, so only the
 * bearing matters). Keep it pointing at roughly the scene's brightest
 * lightformer or the shading and the shadows will disagree.
 */
export interface KeyLightSpec {
  direction: [number, number, number]
  intensity: number
  color: string
  /** Shadow-map blur radius. Overcast/dappled scenes want a bigger number. */
  softness: number
}

/**
 * The SEPARATION light: a second directional, behind the garment and opposite
 * the key, that never casts a shadow.
 *
 * Not decoration. Measured on the shipped rig, a black tee (#191C20, the sample
 * design's own colourway) in the default studio scene had a p05 silhouette step
 * of 0,2 sRGB levels against the backdrop: its outline did not exist. A white
 * tee in `beach` measured 0,0, and a red one in `studio` 6,6. An environment map
 * plus one front key cannot produce an edge, because the surfaces at the
 * silhouette face away from both. A grazing back light is what a photographer
 * puts there, and it is the whole of the fix.
 */
export interface RimLightSpec {
  /** Where the light comes FROM, normalised before use. Behind the garment. */
  direction: [number, number, number]
  intensity: number
  color: string
}

/**
 * The floor the garment stands on.
 *
 * There was none, and that is why no render in this repository contained a
 * single shadow pixel: the contact-shadow rig WAS mounted and IS in frame, but
 * it darkens whatever is under it, and what was under it was a transparent
 * canvas over a #0c0f13 page. Black on black is nothing. A ground with a value
 * the shadow can take away is the difference between a garment photographed on
 * a surface and a cut-out pasted onto a gradient.
 *
 * `color` is the ground's albedo; it is lit by the same rig as the cloth, so it
 * picks up the scene. `radiusFactor` multiplies the garment's own width; it is
 * deliberately far larger than the frame, because the camera looks along the
 * floor from about 12 degrees above it and a disc that ends anywhere inside the
 * frustum draws a hard horizon straight across the garment's waist. The RADIAL
 * ALPHA ramp is what ends the floor, not its geometry.
 */
export interface GroundSpec {
  color: string
  /** …and for the light UI theme, where a dark floor would be a hole. */
  colorLight?: string
  roughness: number
  radiusFactor: number
}

export interface Scene3DConfig {
  lightformers: LightformerSpec[]
  /** Multiplies each garment material's envMapIntensity. */
  envIntensity: number
  shadowColor: string
  shadowOpacity: number
  /** Base fill so sides facing away never crush to pure black. */
  hemisphere?: { sky: string; ground: string; intensity: number }
  key: KeyLightSpec
  /**
   * The separation lights. A LIST, because one is not enough: a single kicker
   * only reaches the half of the silhouette whose normals face it, and measured
   * on the black tee the other half sat within 1,5 sRGB levels of the lit floor
   * over the worst 5 % of its rows while the median read 17. Two opposed
   * kickers is what a product photographer puts on a dark garment, and it is
   * the same reason.
   */
  rims?: RimLightSpec[]
  ground?: GroundSpec
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
    // The press room had no fill at all, and it is one of only two scenes that
    // did not. Measured on a black tee: p05 luminance 9,4 of 255 with the whole
    // garment living inside a 28-level band, i.e. a matte silhouette with no
    // shading in it. A hemisphere lights the normals facing away from the key
    // and the ones facing DOWN, which is also what was making the collar
    // opening the darkest thing in the frame.
    hemisphere: { sky: '#c8d4e6', ground: '#3a3a3c', intensity: 0.22 },
    lightformers: [
      // Neutral, not #fff6ec. The key is what a facing chest is lit by, so its
      // cast is what the customer reads as the garment's colour: measured, white
      // cloth came out (205,198,192), a 13-level warm tint on a colourway the
      // customer picked as #FFFFFF. A press room's diffuser is daylight-balanced.
      { form: 'rect', intensity: 5.2, color: '#fffdfa', position: [-5.5, 6.5, 6], scale: [8, 5.5, 1] },
      { form: 'rect', intensity: 2.6, color: '#a9cdff', position: [8.5, 2, -5], scale: [3.2, 8, 1] },
      { form: 'rect', intensity: 1.05, color: '#e9eef6', position: [3.5, -2.5, 7.5], scale: [8, 3.5, 1] },
      { form: 'ring', intensity: 0.7, color: '#ffffff', position: [0, 9, 0.5], scale: 6.5 },
      { form: 'rect', intensity: 0.5, color: '#35c7ff', position: [-8, 0, -6], scale: [2.5, 6, 1] },
      { form: 'rect', intensity: 1.5, color: '#e6ecf5', position: [-2, 4.5, -8], scale: [7, 4.5, 1] },
    ],
    // Aimed at the 5.2-intensity softbox above and to the left; a press room's
    // key is a big diffuser, hence the wide blur.
    key: { direction: [-5.5, 6.5, 6], intensity: 1.25, color: '#fffdfa', softness: 5 },
    // Behind and opposite: the cold kicker a product photographer puts on the
    // far side of the subject so it leaves the background.
    rims: [
      { direction: [7, 3.5, -7], intensity: 3.4, color: '#dce9ff' },
      { direction: [-7, 2.5, -6.5], intensity: 2.4, color: '#cfe0ff' },
    ],
    ground: { color: '#181c23', colorLight: '#dedad0', roughness: 0.96, radiusFactor: 7 },
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
    // Direct sun: the hardest, brightest key of the six.
    key: { direction: [-6, 7, 5], intensity: 2.1, color: '#fff2d6', softness: 2 },
    // Sky and sea behind: cool, and the reason a white tee stops dissolving
    // into a bright sky (measured p05 edge step 0,0 before this existed).
    rims: [
      { direction: [6, 3, -7], intensity: 2.2, color: '#bfe0ff' },
      { direction: [-6, 2.5, -6.5], intensity: 1.5, color: '#cfe8ff' },
    ],
    ground: { color: '#cbb489', roughness: 0.95, radiusFactor: 7 },
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
    // Sun through leaves: bright but broken up, so a wide penumbra.
    key: { direction: [-5, 8, 5], intensity: 1.15, color: '#eaf6d8', softness: 8 },
    rims: [
      { direction: [6, 3, -7], intensity: 1.9, color: '#cfe3b8' },
      { direction: [-6, 2.5, -6.5], intensity: 1.3, color: '#bcd3a4' },
    ],
    ground: { color: '#33402a', roughness: 0.97, radiusFactor: 7 },
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
    // The second scene that shipped with no fill; same measurement, same fix.
    hemisphere: { sky: '#cdd8e6', ground: '#4a505a', intensity: 0.24 },
    lightformers: [
      { form: 'rect', intensity: 5.0, color: '#eef3fb', position: [-5.5, 6.5, 6], scale: [8, 6, 1] },
      { form: 'rect', intensity: 2.6, color: '#c4d2e0', position: [5, 2, 7], scale: [9, 7, 1] },
      { form: 'rect', intensity: 1.0, color: '#b8bcc2', position: [0, -4, 6], scale: [9, 4, 1] },
      { form: 'ring', intensity: 0.8, color: '#ffffff', position: [0, 9, 0.5], scale: 6.5 },
      { form: 'rect', intensity: 0.9, color: '#ff3d8f', position: [-8, 0, -6], scale: [2.5, 6, 1] },
      { form: 'rect', intensity: 0.9, color: '#35c7ff', position: [8, 1, -6], scale: [2.5, 6, 1] },
      { form: 'rect', intensity: 1.3, color: '#d6dee8', position: [-2, 4.5, -8], scale: [7, 5, 1] },
    ],
    // Overcast: the sky IS the light source, so barely any shadow direction.
    key: { direction: [-5.5, 6.5, 6], intensity: 0.85, color: '#eef3fb', softness: 10 },
    rims: [
      { direction: [7, 3, -7], intensity: 2.1, color: '#d6e4f5' },
      { direction: [-7, 2.5, -6.5], intensity: 1.5, color: '#cddbee' },
    ],
    ground: { color: '#59626d', roughness: 0.9, radiusFactor: 7 },
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
    // Low golden sun: long, warm, fairly crisp.
    key: { direction: [-7, 2.5, 5], intensity: 1.9, color: '#ffb86b', softness: 3.5 },
    rims: [
      { direction: [7, 4, -6], intensity: 2.4, color: '#ff8fb8' },
      { direction: [-7, 2.5, -6], intensity: 1.6, color: '#ffb27a' },
    ],
    ground: { color: '#6b4b46', roughness: 0.93, radiusFactor: 7 },
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
    envIntensity: 1.35,
    shadowColor: '#05070f',
    shadowOpacity: 0.62,
    hemisphere: { sky: '#6076b4', ground: '#101636', intensity: 1.35 },
    lightformers: [
      { form: 'rect', intensity: 4.7, color: '#b9c9ff', position: [-6, 7, 4], scale: [5, 5, 1] },
      { form: 'rect', intensity: 1.6, color: '#3a4e7a', position: [5, 2, 7], scale: [9, 7, 1] },
      { form: 'circle', intensity: 4.0, color: '#ffb877', position: [7, 1, 3], scale: 2.2 },
      { form: 'circle', intensity: 2.5, color: '#ffcf94', position: [-6, -1, 4], scale: 1.6 },
      { form: 'rect', intensity: 3.2, color: '#35c7ff', position: [8, 3, -6], scale: [2.5, 7, 1] },
      { form: 'rect', intensity: 1.8, color: '#2b3d6b', position: [-3, 4, -8], scale: [7, 5, 1] },
    ],
    // Moon plus a warm practical to camera-right; dim and quite hard.
    key: { direction: [-6, 7, 4], intensity: 1.9, color: '#b9c9ff', softness: 4 },
    // THE HARDEST CASE IN THE SET: a dark garment on a dark stage. Measured on
    // the first lift, a #191C20 tee still came out at median luminance 15
    // against a page of 16, which is not a mood, it is a product the customer
    // cannot see. Night reads as night through its COLOUR, blue with two warm
    // practicals, not through darkness; the whole rig is roughly a stop and a
    // half up from where it shipped, and the rim carries more of the exposure
    // here than anywhere else.
    rims: [
      { direction: [7, 3, -6], intensity: 5.0, color: '#9fb6ff' },
      { direction: [-7, 2.5, -6], intensity: 3.2, color: '#8fa6ef' },
    ],
    ground: { color: '#10162a', roughness: 0.9, radiusFactor: 7 },
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
