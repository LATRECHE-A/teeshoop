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
 * was removed comes back as real relief, split by frequency — mid-frequency
 * folds are geometry in the sheet, high-pass wrinkles + knit grain are the
 * normal map, and the openings are baked vertex AO. `alphaToCoverage` resolves
 * the alpha-tested outline against the canvas' MSAA samples instead of the hard
 * per-pixel cut alphaTest gives on its own — the silhouette is the one edge a
 * viewer studies, and it is the cheapest realism in the file.
 *
 * `CustomGarment` is the entry point: it tries to build the shell from the front
 * cutout (strictly gated inside `canvasToSilhouette`), otherwise it falls back
 * to the proven curved `CustomCard` — so uploads without a clean cutout keep the
 * old, safe look.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '@/state/store'
import type { CardSource } from '@/lib/types'
import {
  buildDelitCanvas,
  buildInflatedShell,
  buildWrinkleNormalCanvas,
  canvasToSilhouette,
  type InflatedShell,
} from '@/lib/silhouette'
import { garmentTint, mixHex, useNormalMapTexture, useSilhouetteTexture, useSourceTexture } from './textures'
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
const SHEEN = '#dfe6f2'
/** Lining multiply — the inside of a garment sits in its own shadow. #adadad
 *  sRGB ≈ 0.42 LINEAR (material.color is sRGB→linear converted; #6b6b6b would
 *  be a 0.15 multiply and, stacked with the baked ×0.6 lining AO, pitch black). */
const LINING_TINT = '#adadad'

/** Build (and dispose) an inflated shell from the front cutout; null when ungated. */
function useInflatedShell(front: CardSource | null, wIn: number, hIn: number): InflatedShell | null {
  const canvas = front?.canvas ?? null
  const version = front?.version ?? 0
  const shell = useMemo<InflatedShell | null>(() => {
    if (!canvas) return null
    const sil = canvasToSilhouette(canvas, wIn, hIn)
    const built = sil ? buildInflatedShell(canvas, sil, wIn, hIn) : null
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
  }, [canvas, version, wIn, hIn])

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
  onMeasured?: (heightIn: number) => void
}

function ExtrudedGarment({
  shell,
  front,
  back,
  backGenerated = false,
  envIntensity = 1,
  heightIn,
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
  const backDelit = useMemo(
    () => (backCanvas && !backGenerated ? buildDelitCanvas(backCanvas) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backCanvas, backVersion, backGenerated],
  )
  const backTex = useSourceTexture(
    useMemo(
      () => (back ? { canvas: backDelit ?? back.canvas, version: back.version } : null),
      [back, backDelit],
    ),
  )
  // Missing back → the front's alpha silhouette flooded with THIS GARMENT'S
  // colour, measured off the front photo rather than assumed.
  const tint = useMemo(
    () => garmentTint(front.canvas, BLANK_BACK_FALLBACK),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [front.canvas, front.version],
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
      backCanvas && back && !backGenerated
        ? buildWrinkleNormalCanvas(backCanvas, back.wIn, back.hIn)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backCanvas, backVersion, backGenerated],
  )
  const backOwnN = useNormalMapTexture(backNCanvas)
  const backN = backGenerated ? frontN : backOwnN
  // Procedural weave fallback (blank back / shells built without a photo map).
  const fabricN = useMemo(() => fabricNormalTexture(front.wIn / 0.9, front.hIn / 0.9), [front.wIn, front.hIn])
  useEffect(() => () => fabricN.dispose(), [fabricN])

  useEffect(() => {
    onMeasured?.(heightIn)
  }, [heightIn, onMeasured])

  if (!frontTex) return null

  return (
    <group>
      {/* Front cap = photo, bulged. Alpha-tested opaque so the silhouette is
          crisp and front/back/lining/interior depth-sort correctly. */}
      <mesh geometry={shell.front}>
        <meshPhysicalMaterial
          map={frontTex}
          vertexColors
          normalMap={frontN ?? fabricN}
          normalScale={frontN ? [0.6, 0.6] : [0.35, 0.35]}
          transparent={false}
          alphaTest={0.45}
          alphaToCoverage
          roughness={0.86}
          metalness={0}
          sheen={0.55}
          sheenRoughness={0.85}
          sheenColor={SHEEN}
          envMapIntensity={envIntensity}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Back cap = back photo, or a blank fabric silhouette. */}
      <mesh geometry={shell.back}>
        {back && backTex ? (
          <meshPhysicalMaterial
            map={backTex}
            vertexColors
            normalMap={backN ?? fabricN}
            normalScale={backN ? [0.6, 0.6] : [0.35, 0.35]}
            transparent={false}
            alphaTest={0.45}
            alphaToCoverage
            roughness={0.9}
            metalness={0}
            sheen={0.4}
            sheenRoughness={0.9}
            sheenColor={SHEEN}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        ) : (
          <meshPhysicalMaterial
            map={blankBackTex ?? undefined}
            color={blankBackTex ? '#ffffff' : tint}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.35, 0.35]}
            transparent={false}
            alphaTest={0.45}
            alphaToCoverage
            emissive={mixHex('#000000', tint, BLANK_BACK_EMIT_MIX)}
            roughness={0.92}
            metalness={0}
            sheen={0.35}
            sheenRoughness={0.9}
            sheenColor={SHEEN}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        )}
      </mesh>

      {/* Interior LININGS — the hollow read. Same photo, multiplied down to a
          self-shadowed inside (winding already faces into the cavity, AO ×0.6
          is baked into their vertex colors). Matte: no sheen, high rough. */}
      {shell.liningFront && (
        <mesh geometry={shell.liningFront}>
          <meshStandardMaterial
            map={frontTex}
            color={LINING_TINT}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.3, 0.3]}
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
        <mesh geometry={shell.liningBack}>
          <meshStandardMaterial
            map={back && backTex ? backTex : (blankLiningTex ?? undefined)}
            color={LINING_TINT}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.3, 0.3]}
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
          derived tangent frame swims worst exactly there. */}
      {shell.rimFront && (
        <mesh geometry={shell.rimFront}>
          <meshPhysicalMaterial
            map={frontTex}
            vertexColors
            transparent={false}
            roughness={0.86}
            metalness={0}
            sheen={0.55}
            sheenRoughness={0.85}
            sheenColor={SHEEN}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
      {shell.rimBack && (
        <mesh geometry={shell.rimBack}>
          <meshPhysicalMaterial
            map={back && backTex ? backTex : (blankBackTex ?? undefined)}
            color={back && backTex ? '#ffffff' : blankBackTex ? '#ffffff' : tint}
            vertexColors
            transparent={false}
            roughness={0.9}
            metalness={0}
            sheen={0.4}
            sheenRoughness={0.9}
            sheenColor={SHEEN}
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
  onMeasured?: (heightIn: number) => void
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
        onMeasured={onMeasured}
      />
    )
  }
  return <CustomCard front={fwd} back={rev} envIntensity={envIntensity} onMeasured={onMeasured} />
}
