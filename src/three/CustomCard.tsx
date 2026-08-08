/**
 * Custom garment ("customer ships their own") — the CardSource composites are
 * shown as a gently curved card pair: front face, blank/back face and a dark
 * silhouette "rim" sandwiched between them for an extruded-thickness
 * illusion. 1 world unit = 1 inch; the card is wIn inches wide (measured
 * along the bent surface).
 */
import { useCallback, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { CardSource } from '@/lib/types'
import { registerBackPanel } from '@/lib/backRegister'
import { applyWeaveBump, WEAVE_DEFAULTS } from './clothShading'
import { garmentTint, mixHex, useSilhouetteTexture, useSourceTexture } from './textures'

/** Total cylindrical bend of the card, radians (~12°). */
const BEND = (12 * Math.PI) / 180
/**
 * Last-resort colour for the blank reverse, used only when the front photo
 * cannot be sampled at all (a tainted or zero-sized canvas). The real blank
 * back is flooded with the GARMENT'S OWN colour measured off the front, exactly
 * as the inflated shell and the AR bake do — this is the TIER-3 card, the thing
 * a customer sees when their upload could not be traced, and there is no reason
 * for the one rung of the ladder that already looks the least like a garment to
 * also be the only one that gets the colour wrong.
 */
const BLANK_BACK_FALLBACK = '#242A33'
/** Emissive floor for the blank reverse, as a fraction of its own colour
 *  (matches ExtrudedGarment's BLANK_BACK_EMIT_MIX). */
const BLANK_BACK_EMIT_MIX = 0.12
const RIM = '#161B22'

function makeCurvedCard(wIn: number, hIn: number): { geometry: THREE.PlaneGeometry; sagIn: number } {
  const radius = wIn / BEND
  const geometry = new THREE.PlaneGeometry(wIn, hIn, 48, 1)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const nor = geometry.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const theta = (pos.getX(i) / wIn) * BEND // -BEND/2 .. BEND/2
    pos.setXYZ(i, radius * Math.sin(theta), pos.getY(i), radius * (Math.cos(theta) - 1))
    nor.setXYZ(i, Math.sin(theta), 0, Math.cos(theta))
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, sagIn: radius * (1 - Math.cos(BEND / 2)) }
}

function useCurvedCard(wIn: number, hIn: number) {
  const card = useMemo(() => makeCurvedCard(wIn, hIn), [wIn, hIn])
  useEffect(() => () => card.geometry.dispose(), [card])
  return card
}

export interface CustomCardProps {
  front: CardSource | null
  back: CardSource | null
  /** Scene lighting multiplier for the card's env-map response. */
  envIntensity?: number
  onMeasured?: (heightIn: number, widthIn?: number) => void
}

export function CustomCard({ front, back: suppliedBack, envIntensity = 1, onMeasured }: CustomCardProps) {
  // The two faces used to be two independently sized planes, both centred on
  // y = 0, so a reverse photograph framed differently from the front sat at a
  // different height AND a different size — the back visibly peeking out above
  // the front's shoulder on the basket board. Registering it into the front's
  // frame makes the pair one garment: same plane size, shoulders aligned.
  // Same registration as the shell and the AR bake, with no options — a
  // π-rotated plane IS `uv.x = 1 − u` in world terms (PlaneGeometry puts u = 0
  // at local −X, and the rotation maps that to world +X while the front's u = 0
  // stays at world −X), so the reverse wants exactly the pre-mirrored layout the
  // shell's back sheet wants. The AR bake feeds this same curved card from the
  // registered canvas, so anything but the default here is preview ≠ phone.
  const registered = useMemo(
    () =>
      front && suppliedBack
        ? registerBackPanel(front.canvas, suppliedBack.canvas, suppliedBack.photo ?? null)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [front?.canvas, front?.version, suppliedBack?.canvas, suppliedBack?.photo, suppliedBack?.version],
  )
  const back =
    suppliedBack && registered
      ? { ...suppliedBack, canvas: registered.canvas, photo: registered.photo ?? undefined, wIn: front!.wIn, hIn: front!.hIn }
      : suppliedBack && front
        ? null // framings too far apart to be one garment — blank tinted reverse
        : suppliedBack
  const primary = front ?? back
  const frontTex = useSourceTexture(front)
  // Note: the back face is a π-rotated plane, and that rotation alone makes
  // its texture read correctly from behind (no u-flip needed — verified with
  // the harness "BACK" wordmark).
  const backTex = useSourceTexture(back)
  // Missing back → the front's alpha silhouette flooded with THIS GARMENT'S
  // own colour, measured off the photo rather than assumed.
  const tint = useMemo(
    () => (primary ? garmentTint(primary.canvas, BLANK_BACK_FALLBACK) : BLANK_BACK_FALLBACK),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primary?.canvas, primary?.version],
  )
  const blankBackTex = useSilhouetteTexture(back ? null : front, tint)
  const rimTex = useSilhouetteTexture(primary, RIM)

  const wIn = primary?.wIn ?? 20
  const hIn = primary?.hIn ?? 24
  const backWIn = back?.wIn ?? wIn
  const backHIn = back?.hIn ?? hIn

  const frontCard = useCurvedCard(wIn, hIn)
  const backCard = useCurvedCard(backWIn, backHIn)

  // Cloth grain + sheen so even the tier-3 card reads as fabric, not paper.
  // Same shared program key as ExtrudedGarment/GarmentModel; applyWeaveBump is
  // idempotent, so re-attaching with a new height just rewrites its uniforms.
  const clothify = useCallback(
    (m: THREE.MeshPhysicalMaterial | null) => {
      if (!m) return
      // The card has NO geometric relief at all — it is a bent plane — so the
      // drape octave is the only thing standing between it and paper, and it
      // gets the largest share any surface here is allowed (see the ≤6° macro
      // budget in clothShading.WEAVE_DEFAULTS).
      applyWeaveBump(m, {
        ...WEAVE_DEFAULTS,
        strength: 0.022,
        foldStrength: 0.026,
        foldHalfHeightIn: hIn / 2,
      })
    },
    [hIn],
  )
  const sheenTint = useMemo(() => mixHex(tint, '#ffffff', 0.35), [tint])

  // Keep the two faces from intersecting: each face's edges curve backwards
  // by sagIn, so the slab must be a bit thicker than twice that.
  const thickness = Math.max(1.1, 2.3 * Math.max(frontCard.sagIn, backCard.sagIn))

  // Width as well as height — see the note in ExtrudedGarment: the key light's
  // shadow frustum is sized from the largest reported extent, and these cards
  // now cast into it.
  useEffect(() => {
    onMeasured?.(Math.max(hIn, backHIn), Math.max(wIn, backWIn))
  }, [hIn, backHIn, wIn, backWIn, onMeasured])

  if (!primary) return null

  return (
    <group>
      {(front ? frontTex : rimTex) && (
        <mesh geometry={frontCard.geometry} position={[0, 0, thickness / 2]} castShadow receiveShadow>
          <meshPhysicalMaterial
            ref={clothify}
            map={front ? frontTex : rimTex}
            alphaTest={0.35}
            roughness={0.85}
            metalness={0}
            sheen={0.4}
            sheenRoughness={0.85}
            sheenColor={sheenTint}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
      {/* Dark mid layer, slightly enlarged: reads as the slab's edge.
          The emissive floor keeps it legible over the near-black app bg. */}
      {rimTex && (
        <mesh geometry={frontCard.geometry} scale={[1.02, 1.015, 1]}>
          <meshStandardMaterial
            map={rimTex}
            alphaTest={0.35}
            roughness={0.95}
            metalness={0}
            emissive="#10141B"
            envMapIntensity={envIntensity}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {(back ? backTex : blankBackTex) && (
        <group rotation={[0, Math.PI, 0]} position={[0, 0, -thickness / 2]}>
          <mesh geometry={back ? backCard.geometry : frontCard.geometry} castShadow receiveShadow>
            <meshPhysicalMaterial
              ref={clothify}
              map={back ? backTex : blankBackTex}
              alphaTest={0.35}
              roughness={0.9}
              metalness={0}
              sheen={0.35}
              sheenRoughness={0.9}
              sheenColor={sheenTint}
              // The blank reverse would otherwise crush to the backdrop under
              // the moody rear lighting; the floor is a fraction of the
              // garment's OWN colour, so a black tee's back stops being a
              // silhouette-shaped hole without a white one glowing. alphaTest
              // already confines fragments to the silhouette cutout.
              emissive={back ? '#000000' : mixHex('#000000', tint, BLANK_BACK_EMIT_MIX)}
              envMapIntensity={envIntensity}
              side={THREE.FrontSide}
            />
          </mesh>
        </group>
      )}
    </group>
  )
}
