/**
 * Custom garment shown as a HOLLOW, realistic shell: two sheets (photo front,
 * photo/blank back) whose depth comes from a real garment's own depth field
 * graded onto the upload's silhouette (src/lib/templateDepth.ts), or from the
 * Poisson balloon when that fit is refused — Z-only displacement either way, so
 * inch/UV accuracy is untouched. Plus inward-facing LINING duplicates of both
 * sheets: through the neck/hem alpha openings you see the darkened inside of the
 * opposite panel with real parallax, and two single-sided interior catch planes
 * cover only the degenerate straight-through ray.
 *
 * SHADING — the other half of "why does an upload look flatter than the catalog
 * meshes". The photo arrives with a full lighting solution already baked in, so
 * the materials sample the DE-LIT albedo the shell hands back
 * (src/lib/photoLight.ts) and let the scene's lights be the only lights; what
 * was removed comes back four ways, split by what it physically is:
 *   · the SHADOW half of the baked lighting → `aoMap`, the photo's own form
 *     (hood shadow, the roll under a sleeve, the pocket). This is the term the
 *     shell's geometry cannot possibly produce, and shipping without it is what
 *     made an uploaded garment read as a paper cutout.
 *   · mid-frequency folds → real Z displacement in the sheet;
 *   · high-pass wrinkles → the normal map;
 *   · the openings and the measured cavity → vertex colours.
 * The HIGHLIGHT half is the one thing that never comes back: it has to move
 * when the camera does, and the scene makes a real one.
 *
 * `alphaToCoverage` resolves the alpha-tested outline against the canvas' MSAA
 * samples instead of the hard per-pixel cut alphaTest gives on its own — the
 * silhouette is the one edge a viewer studies, and it is the cheapest realism
 * in the file.
 *
 * `CustomGarment` is the entry point: it tries to build the shell from the front
 * cutout (strictly gated inside `canvasToSilhouette`), otherwise it falls back
 * to the proven curved `CustomCard` — so uploads without a clean cutout keep the
 * old, safe look.
 */
import { useCallback, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '@/state/store'
import type { CardSource } from '@/lib/types'
import {
  buildDelitMaps,
  buildInflatedShell,
  buildWrinkleNormalCanvas,
  canvasToSilhouette,
  type InflatedShell,
} from '@/lib/silhouette'
import { registerBackPanel } from '@/lib/backRegister'
import { applyWeaveBump, WEAVE_DEFAULTS } from './clothShading'
import {
  garmentTint,
  mixHex,
  useNormalMapTexture,
  useOcclusionTexture,
  useSilhouetteTexture,
  useSourceTexture,
} from './textures'
import { fabricNormalTexture } from './fabric'
import { CustomCard } from './CustomCard'

/**
 * Last-resort colour for the blank reverse, used only when the front photo
 * cannot be sampled at all (a tainted or zero-sized canvas). The real blank
 * back is flooded with the GARMENT'S OWN colour, measured off the front
 * (`garmentTint`) — a fixed slate is right for a navy tee and a lie about a
 * white polo or a red vest, and it is the first thing a customer sees when they
 * orbit past 90°.
 */
const BLANK_BACK_FALLBACK = '#242A33'
/** Emissive floor for the blank back, as a fraction of its own colour: enough
 *  that a black garment's reverse is not a silhouette-shaped hole, small enough
 *  that a white one does not glow. */
const BLANK_BACK_EMIT_MIX = 0.12
/** The unprinted REVERSE of cloth reads lighter and flatter than its outside
 *  face; the lining is then multiplied by LINING_TINT on top, so without this
 *  lift a dark garment's lining is pitch black and indistinguishable from the
 *  interior catch plane — no hollow parallax read at all. */
const BLANK_LINING_MIX = 0.55
const INTERIOR = '#14181F'
const INTERIOR_EMIT = '#0E1218'
/**
 * Sheen is the fibre's own forward scatter, so its colour must be the
 * GARMENT'S, a shade lighter — the same rule GarmentModel applies to the
 * catalog meshes, and for the same measured reason: a fixed near-white sheen
 * behaves as an additive film and renders a dark garment brown. The shell
 * already measures the garment colour off the photo (`garmentTint`) for the
 * blank back; the sheen rides the same measurement.
 */
const SHEEN_WHITEN = 0.35
/** Drape octave for the weave bump: the shell carries SOME geometric folds
 *  (its own drape term + the photo's mid-frequency relief) AND a wrinkle normal
 *  map taken off the photograph itself, so it asks for less than the
 *  smooth-balloon tee (0.026) and about as much as the fold-simulated hoodie.
 *  Every octave past the first is a contradicting set of wrinkles. */
const SHELL_FOLD_STRENGTH = 0.012
/** Thread-scale grain, reduced from the catalog default (0.035): the shell
 *  already layers a photo wrinkle normal map, and at full strength the
 *  procedural grain reads as a uniform tile over it AND tilts the mean normal
 *  enough to dim the flat colour — both flagged by render review. */
const SHELL_WEAVE_STRENGTH = 0.022
/**
 * How much of the photo's own form shading comes back as occlusion.
 *
 * 1.0 replays exactly what the de-lighting removed, on the indirect light only.
 * The stage is environment-dominated, so that is most of the garment's
 * radiance and the shell recovers the hood shadow, the roll under a sleeve and
 * the pocket — none of which its geometry contains. It is deliberately not
 * higher: past 1 the map darkens further than the photograph ever was, and the
 * one thing this term must not do is invent occlusion.
 */
const PHOTO_AO_INTENSITY = 1
/** Lining multiply — the inside of a garment sits in its own shadow. #adadad
 *  sRGB ≈ 0.42 LINEAR (material.color is sRGB→linear converted; #6b6b6b would
 *  be a 0.15 multiply and, stacked with the baked ×0.6 lining AO, pitch black). */
const LINING_TINT = '#adadad'
/**
 * ONE FABRIC FOR THE WHOLE GARMENT. The front sheet, the reverse and the two rim
 * ribbons used to carry three different roughness/sheen sets (0.86/0.55/0.85,
 * 0.9/0.4/0.9, 0.92/0.35/0.9), so orbiting past 90° changed the CLOTH and not
 * just the view — and, worse, rimFront and rimBack are welded to the SAME
 * isoline, which put a specular discontinuity down the one edge the rim exists
 * to make believable. Values are cotton jersey: nearly matte, with a wide fuzz
 * lobe (the fibre is a near-Lambertian retroreflector, so a tight sheen beads on
 * every ridge instead of grazing the whole panel).
 */
const CLOTH = { roughness: 0.9, sheen: 0.45, sheenRoughness: 0.93 } as const

/** Build (and dispose) an inflated shell from the front cutout; null when ungated. */
function useInflatedShell(front: CardSource | null, wIn: number, hIn: number): InflatedShell | null {
  const canvas = front?.canvas ?? null
  const photo = front?.photo ?? null
  const version = front?.version ?? 0
  const shell = useMemo<InflatedShell | null>(() => {
    if (!canvas) return null
    const sil = canvasToSilhouette(canvas, wIn, hIn)
    const built = sil ? buildInflatedShell(canvas, sil, wIn, hIn, { photo }) : null
    // Explicit tangents for the wrinkle map. Without them three derives a
    // tangent frame per fragment from screen-space derivatives, which swims as
    // the garment turns — the folds appear to crawl over the cloth. The sheets
    // carry index + position + normal + uv, which is exactly what this needs.
    // PREVIEW ONLY: the AR bake builds its own shell and strips tangents
    // (arExport.sanitizeGarmentGeometry), so nothing here can reach a GLB.
    if (built)
      for (const g of [built.front, built.back, built.liningFront, built.liningBack])
        g?.computeTangents()
    return built
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, photo, version, wIn, hIn])

  useEffect(
    () => () => {
      shell?.front.dispose()
      shell?.back.dispose()
      shell?.interior?.dispose()
      shell?.interiorFront?.dispose()
      shell?.liningFront?.dispose()
      shell?.liningBack?.dispose()
      shell?.rimFront?.dispose()
      shell?.rimBack?.dispose()
    },
    [shell],
  )
  return shell
}

interface ExtrudedGarmentProps {
  shell: InflatedShell
  front: CardSource
  back: CardSource | null
  /** The back photo is a RECONSTRUCTION of the front, not a photograph
   *  (CustomSideSetup.origin === 'generated'). */
  backGenerated?: boolean
  envIntensity?: number
  heightIn: number
  widthIn: number
  onMeasured?: (heightIn: number, widthIn?: number) => void
}

function ExtrudedGarment({
  shell,
  front,
  back: suppliedBack,
  backGenerated = false,
  envIntensity = 1,
  heightIn,
  widthIn,
  onMeasured,
}: ExtrudedGarmentProps) {
  // ALBEDO, not the photo: the shell divided the photo's own baked studio
  // lighting out (falling back to the composite when the photo was already
  // flat). The lining samples the same texture, so the inside of the panel is
  // de-lit too and cannot contradict the outside.
  const frontTex = useSourceTexture(
    useMemo(
      () => ({ canvas: shell.albedoCanvas ?? front.canvas, version: front.version }),
      [shell.albedoCanvas, front.canvas, front.version],
    ),
  )
  // REGISTER THE REVERSE onto the front's frame before anything reads it. The
  // back sheet is the FRONT's silhouette sampled at `1 − u`, so a back
  // photograph framed even slightly differently lands off its own outline —
  // and because the pair is squared up by BOTTOM-PADDING the shorter canvas,
  // the whole of that difference collects at the hem, where it shows as the
  // reverse panel stopping short over a dark rim. `registerBackPanel` returns a
  // canvas in the front's pixel frame whose alpha IS the front's, so the two
  // panels cut identically and the rim and lining inherit the fix for free.
  // Null means the two photographs cannot be the same garment; the blank tinted
  // reverse below is then the honest answer.
  const registered = useMemo(
    () =>
      suppliedBack ? registerBackPanel(front.canvas, suppliedBack.canvas, suppliedBack.photo ?? null) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suppliedBack?.canvas, suppliedBack?.photo, suppliedBack?.version, front.canvas, front.version],
  )
  const back =
    suppliedBack && registered
      ? { ...suppliedBack, canvas: registered.canvas, photo: registered.photo ?? undefined }
      : null
  const backCanvas = back?.canvas ?? null
  const backVersion = back?.version ?? 0
  // The back photo is a second lightbox shot and needs the same correction; it
  // has no wrinkle band to share a blur with, so it pays for its own pass.
  //
  // A GENERATED back is EXEMPT, for the same reason arExport.ts exempts it:
  // there is no lightbox gradient in it to divide out. Its only low-frequency
  // content IS the reconstruction — the front's drape, deliberately mirrored in
  // — so de-lighting flattens the one thing that makes it look like cloth, and
  // then normalises against the baked "APERÇU · PREVIEW" mark, the only thing
  // left varying. Measured on the shipped 202358 reconstruction: the pass fires
  // (it is a no-op, `null`, on 202356's real supplier back) and moves 0.030 RMS
  // / 0.094 peak luminance, so the studio 3D back and the AR back were visibly
  // different renderings of the same garment.
  const backMaps = useMemo(
    () =>
      backCanvas && !backGenerated
        ? buildDelitMaps(backCanvas, back?.photo ?? null)
        : { albedo: null, occlusion: null },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backCanvas, backVersion, backGenerated, back?.photo],
  )
  const backTex = useSourceTexture(
    useMemo(
      () => (back ? { canvas: backMaps.albedo ?? back.canvas, version: back.version } : null),
      [back, backMaps],
    ),
  )
  // Missing back → the front's alpha silhouette flooded with THIS GARMENT'S
  // colour, measured off the front photo rather than assumed. Off the BARE
  // photo where there is one: the mean is stable under a small logo but a
  // full-chest print would drag the reverse of a white tee toward the ink.
  const tint = useMemo(
    () => garmentTint(front.photo ?? front.canvas, BLANK_BACK_FALLBACK),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [front.photo, front.canvas, front.version],
  )
  const blankBackTex = useSilhouetteTexture(back ? null : front, tint)
  // Lighter flood for the blank back's LINING (visible through the neck).
  const blankLiningTex = useSilhouetteTexture(
    back ? null : front,
    useMemo(() => mixHex(tint, '#ffffff', BLANK_LINING_MIX), [tint]),
  )

  // Photo wrinkle + knit-grain normal map for the front (built by the shell).
  const frontN = useNormalMapTexture(shell.normalMapCanvas ?? null)
  // The back photo gets its own map. No pre-mirror: the back sheet samples
  // u→1−u and the tangent frame flips with the mirrored UVs, so a map generated
  // in the photo's own pixel space stays consistent. Built from the ORIGINAL
  // photo, never the de-lit one: de-lighting removes exactly the low-frequency
  // signal the map's high-pass would have discarded anyway, and doing it twice
  // only costs a pass.
  //
  // A GENERATED BACK IS NOT A PHOTO AND MUST NOT BE READ AS ONE. When the
  // supplier had no back shot, ingest reconstructs one by mirroring the front's
  // silhouette and flooding it with the garment colour — so its high-pass
  // carries no folds at all, only the baked "APERÇU · PREVIEW" mark, and
  // building a normal map from it would emboss that text into the cloth as
  // relief. The front's map is the right answer and not merely a safe one: the
  // generated back IS the front mirrored, and the back sheet already samples
  // u→1−u, so the front's wrinkles land exactly on the pixels they came from.
  const backNCanvas = useMemo(
    () =>
      backCanvas && back && !backGenerated ? buildWrinkleNormalCanvas(back.photo ?? backCanvas) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backCanvas, back?.photo, backVersion, backGenerated],
  )
  const backOwnN = useNormalMapTexture(backNCanvas)
  const backN = backGenerated ? frontN : backOwnN

  // The photo's own form shading, back as occlusion (see
  // photoLight.DelightResult.occlusion). This is the term that decides whether
  // an uploaded garment reads as cloth or as a cutout, so it is bound on every
  // surface that samples the corresponding albedo — the sheet AND the lining
  // behind it, which would otherwise contradict its own outside face through
  // the collar.
  const frontAO = useOcclusionTexture(shell.occlusionCanvas ?? null)
  const backAO = useOcclusionTexture(backGenerated ? null : backMaps.occlusion)
  // Procedural weave fallback (blank back / shells built without a photo map).
  const fabricN = useMemo(() => fabricNormalTexture(front.wIn / 0.9, front.hIn / 0.9), [front.wIn, front.hIn])
  useEffect(() => () => fabricN.dispose(), [fabricN])

  // Report the WIDTH too, not just the height. The key light's shadow frustum
  // is sized from the largest reported extent (Stage.KeyLight), and a laid-flat
  // upload is routinely wider than it is tall — sleeves spread, ~40 x 27 in on
  // a hoodie flat-lay. Reporting height alone let index.tsx fall back to
  // `height * 0.9`, so the shoulders and sleeve tips fell outside the shadow
  // camera and their shadow terminated on a straight line across the cloth.
  // Inert before these meshes cast; a real artefact the moment they do.
  useEffect(() => {
    onMeasured?.(heightIn, widthIn)
  }, [heightIn, widthIn, onMeasured])

  // The knit micro-relief + wandering drape octave the catalog meshes get
  // (clothShading.ts) — triplanar and UV-free, so it composes on top of the
  // photo wrinkle map and needs no tangent frame on the rims. Attached via a
  // one-shot ref: it must be installed before the material's first compile,
  // and the commit that creates the material runs before the next R3F frame.
  // (The `clothified` flag absorbs R3F calling a callback ref for both the
  // fiber and its alternate, which would otherwise chain onBeforeCompile.)
  //
  // The shared cache key does NOT mean one program for the whole scene —
  // three builds its key from every standard material parameter and only then
  // appends this suffix, and these materials differ (alphaTest, normalMap,
  // vertexColors) from the catalog cloth and from the rims. What the suffix
  // guarantees is the thing that would actually be a bug: cloth can never be
  // served a cached non-cloth program that happens to match on parameters.
  // No one-shot guard: `applyWeaveBump` is idempotent and updates its uniforms
  // on a repeat call, which is what keeps `foldHalfHeightIn` and the weave
  // strength live when the upload's height changes or a panel gains/loses its
  // photo wrinkle map without the material being recreated.
  const makeClothify = useCallback(
    (weave: number) => (m: THREE.MeshPhysicalMaterial | null) => {
      if (!m) return
      applyWeaveBump(m, {
        ...WEAVE_DEFAULTS,
        strength: weave,
        foldStrength: SHELL_FOLD_STRENGTH,
        // The sheets are centred on the content bbox (Y = (0.5 − fy)·contentHIn),
        // so half the content height is exactly the ramp the drape needs to know
        // the shoulders from the hem.
        foldHalfHeightIn: shell.contentHIn / 2,
      })
    },
    [shell.contentHIn],
  )
  const clothify = useMemo(() => makeClothify(SHELL_WEAVE_STRENGTH), [makeClothify])
  /**
   * ONE GRAIN PER SURFACE. Where a panel has no photo-derived wrinkle map it
   * falls back to `fabric.ts`'s tiled plain weave — 8 px over a 128 px canvas
   * tiled at wIn/0.9, i.e. a 0.056 in period — while the shader octave runs at
   * 0.045 in on the same material. Two axis-aligned sine grids that close
   * together beat at 1/|1/0.045 − 1/0.056| = 0.225 in: a regular quilted lattice
   * at exactly goose-pimple scale, and visible the moment a customer zooms in to
   * look at the fabric. The texture is the better of the two here (it survives
   * the shader octave's Nyquist fade at normal framing), so the shader keeps
   * only its drape.
   */
  const clothifyDrapeOnly = useMemo(() => makeClothify(0), [makeClothify])
  const sheenTint = useMemo(() => mixHex(tint, '#ffffff', SHEEN_WHITEN), [tint])

  if (!frontTex) return null

  return (
    <group>
      {/* Front cap = photo, bulged. Alpha-tested opaque so the silhouette is
          crisp and front/back/lining/interior depth-sort correctly.
          castShadow/receiveShadow: the sleeve's shadow on the ribs is the cue
          that says "solid object" — the same reason the catalog meshes cast
          into the key light. Alpha-tested depth is honoured by three's shadow
          depth-material variants, so the cutout casts its silhouette, not its
          quad. */}
      <mesh geometry={shell.front} castShadow receiveShadow>
        <meshPhysicalMaterial
          ref={frontN ? clothify : clothifyDrapeOnly}
          map={frontTex}
          vertexColors
          normalMap={frontN ?? fabricN}
          normalScale={frontN ? [0.6, 0.6] : [0.35, 0.35]}
          aoMap={frontAO ?? undefined}
          aoMapIntensity={PHOTO_AO_INTENSITY}
          transparent={false}
          alphaTest={0.45}
          alphaToCoverage
          {...CLOTH}
          metalness={0}
          sheenColor={sheenTint}
          envMapIntensity={envIntensity}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Back cap = back photo, or a blank fabric silhouette. */}
      <mesh geometry={shell.back} castShadow receiveShadow>
        {back && backTex ? (
          <meshPhysicalMaterial
            ref={backN ? clothify : clothifyDrapeOnly}
            map={backTex}
            vertexColors
            normalMap={backN ?? fabricN}
            normalScale={backN ? [0.6, 0.6] : [0.35, 0.35]}
            aoMap={backAO ?? undefined}
            aoMapIntensity={PHOTO_AO_INTENSITY}
            transparent={false}
            alphaTest={0.45}
            alphaToCoverage
            {...CLOTH}
            metalness={0}
            sheenColor={sheenTint}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        ) : (
          <meshPhysicalMaterial
            ref={clothifyDrapeOnly}
            map={blankBackTex ?? undefined}
            color={blankBackTex ? '#ffffff' : tint}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.35, 0.35]}
            transparent={false}
            alphaTest={0.45}
            alphaToCoverage
            emissive={mixHex('#000000', tint, BLANK_BACK_EMIT_MIX)}
            {...CLOTH}
            metalness={0}
            sheenColor={sheenTint}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        )}
      </mesh>

      {/* Interior LININGS — the hollow read. Same photo, multiplied down to a
          self-shadowed inside (winding already faces into the cavity, AO ×0.6
          is baked into their vertex colors). Matte: no sheen, high rough. */}
      {/* receiveShadow, but never castShadow: the linings are the surfaces the
          neck opening actually reveals, so they are what the rim skirt's
          shadow should land on — the collar cavity read every render review
          called a flat dark blob. Casting FROM them would only add a second
          silhouette into the map from geometry nobody can see. */}
      {shell.liningFront && (
        <mesh geometry={shell.liningFront} receiveShadow>
          <meshStandardMaterial
            map={frontTex}
            color={LINING_TINT}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.3, 0.3]}
            aoMap={frontAO ?? undefined}
            aoMapIntensity={PHOTO_AO_INTENSITY}
            transparent={false}
            alphaTest={0.45}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity * 0.5}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
      {shell.liningBack && (
        <mesh geometry={shell.liningBack} receiveShadow>
          <meshStandardMaterial
            map={back && backTex ? backTex : (blankLiningTex ?? undefined)}
            color={LINING_TINT}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.3, 0.3]}
            aoMap={back ? (backAO ?? undefined) : undefined}
            aoMapIntensity={PHOTO_AO_INTENSITY}
            transparent={false}
            alphaTest={0.45}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity * 0.5}
            side={THREE.FrontSide}
          />
        </mesh>
      )}

      {/* CLOTH THICKNESS. The rim strip closes the seam the two sheets used to
          leave open (0.25–0.55 in of nothing at the outline) and gives the
          collar / armhole / cuff a real 0.06 in edge. It reuses the sheets'
          own textures at a UV inset 0.16 in inside the cut, so it is a real
          photograph of the cloth rather than a tint.
          NO alphaTest: the rim is not a surface with a cut in it, it IS the
          cut — welded to the isoline the sheets' alpha makes, so every fragment
          of it is cloth. Tested against that same matte it deletes itself (all
          of a crossing's rings share one uv, so it samples at a mip where the
          edge is a texel wide), and the darkened lining showed through the seam
          instead on 48–84 % of the scanlines.
          No normalMap either: a 3-px band does not need a wrinkle map, and its
          derived tangent frame swims worst exactly there. The aoMap IS shared
          with the sheet, though: the rim samples the sheet's texture at an
          inset UV, and a strip welded to the silhouette but lit differently
          from the cloth it belongs to draws a bright outline round the
          garment — the same class of seam artefact the rim exists to remove. */}
      {/* The weave bump is safe here where a normal MAP is not: it is
          triplanar in object space with an analytic gradient, so it needs no
          tangent frame — exactly the thing a 3-px band cannot supply. */}
      {shell.rimFront && (
        <mesh geometry={shell.rimFront} castShadow receiveShadow>
          <meshPhysicalMaterial
            ref={clothify}
            map={frontTex}
            vertexColors
            aoMap={frontAO ?? undefined}
            aoMapIntensity={PHOTO_AO_INTENSITY}
            transparent={false}
            {...CLOTH}
            metalness={0}
            sheenColor={sheenTint}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
      {shell.rimBack && (
        <mesh geometry={shell.rimBack} castShadow receiveShadow>
          <meshPhysicalMaterial
            ref={clothify}
            map={back && backTex ? backTex : (blankBackTex ?? undefined)}
            color={back && backTex ? '#ffffff' : blankBackTex ? '#ffffff' : tint}
            vertexColors
            aoMap={back ? (backAO ?? undefined) : undefined}
            aoMapIntensity={PHOTO_AO_INTENSITY}
            transparent={false}
            {...CLOTH}
            metalness={0}
            sheenColor={sheenTint}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        </mesh>
      )}

      {/* Interior catch planes: cover the straight-through ray only (all four
          sheets share the same alpha holes). Single-sided per view direction
          so neither can halo through the rim from the wrong side. */}
      {shell.interior && (
        <mesh geometry={shell.interior}>
          <meshStandardMaterial
            color={INTERIOR}
            emissive={INTERIOR_EMIT}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
      {shell.interiorFront && (
        <mesh geometry={shell.interiorFront}>
          <meshStandardMaterial
            color={INTERIOR}
            emissive={INTERIOR_EMIT}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
    </group>
  )
}

export interface CustomGarmentProps {
  front: CardSource | null
  back: CardSource | null
  envIntensity?: number
  onMeasured?: (heightIn: number, widthIn?: number) => void
}

/**
 * The uploaded garment shown as a real, hollow 3D garment: the inflated shell
 * (silhouette.ts) wearing a shipped garment's own depth — chest full under the
 * shoulders, shoulders rolling off, a collar dip, sleeve tubes — with a visible
 * interior through the neck opening. Prominent and clear for editing; the AR
 * try-on then bakes the SAME shell, so what the customer orbits here is what
 * they see on their body. Falls back to the curved card when the upload has no
 * clean cutout.
 */
export function CustomGarment({ front, back, envIntensity = 1, onMeasured }: CustomGarmentProps) {
  // A back-only upload faces FORWARD (parity with 2D / poster / AR), never a
  // blank front card.
  const fwd = front ?? back
  const rev = front ? back : null
  const wIn = fwd?.wIn ?? 20
  const hIn = fwd?.hIn ?? 24
  const shell = useInflatedShell(fwd, wIn, hIn)
  // Provenance of the REVERSE panel, read from the design rather than passed:
  // a CardSource is a canvas and a size, and widening it (or the props of
  // src/three/index.tsx) to carry one boolean would touch the shared 3D
  // contract for a fact only this component uses. Safe here because
  // `CustomGarment` has exactly one caller — src/three/index.tsx, driven by
  // Scene3D from this same design. The board renders its own garments
  // (BoardGarment) and never comes through here.
  const backGenerated = useStore((s) => s.design.custom?.back?.origin === 'generated')

  // Dev probe: which rung of the depth ladder the on-screen garment is on.
  useEffect(() => {
    if (import.meta.env.DEV)
      (window as unknown as { __custom3d?: string }).__custom3d =
        shell && fwd ? `${shell.depthSource}:${shell.shape}` : 'card'
  }, [shell, fwd])

  if (shell && fwd) {
    return (
      <ExtrudedGarment
        shell={shell}
        front={fwd}
        back={rev}
        backGenerated={!!rev && backGenerated}
        envIntensity={envIntensity}
        heightIn={Math.max(hIn, rev?.hIn ?? hIn)}
        widthIn={Math.max(wIn, rev?.wIn ?? wIn)}
        onMeasured={onMeasured}
      />
    )
  }
  return <CustomCard front={fwd} back={rev} envIntensity={envIntensity} onMeasured={onMeasured} />
}
