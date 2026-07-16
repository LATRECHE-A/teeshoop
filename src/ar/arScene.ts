/**
 * Imperative Three.js AR engine (module: AR) — the phone-side experience.
 *
 * Mirrors the app's "imperative engine + React chrome" pattern (cf.
 * EditorEngine/Konva): React owns UI + permissions, this class owns the WebGL
 * scene. Two modes:
 *
 *  • CAMERA-OVERLAY (default, works on iOS + Android): a full-bleed <video> of
 *    the rear camera behind a transparent WebGL canvas. Device-orientation adds
 *    parallax; one finger repositions, two fingers pinch-scale / twist. A
 *    screenshot composites the video frame + the GL canvas, so capture is
 *    reliable everywhere.
 *  • WEBXR (progressive, Android/Chrome): true world-anchored placement via
 *    hit-test + a reticle; tap to plant the figure on a real surface.
 *
 * 1 world unit = 1 inch (life-size prints). The mannequin wears the design as a
 * cylindrically-curved decal on the chest / back.
 */
import * as THREE from 'three'
import type { SizeIn } from '@/lib/types'
import { buildMannequin, type Gender, type Mannequin, type MannequinSide } from './mannequin'

/**
 * A cheap equirectangular soft-studio gradient used as the scene environment
 * for gentle image-based ambient + reflections. Built from pure three core (no
 * untyped examples import), so it stays typed and dependency-light.
 */
function makeGradientEnv(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, c.height)
  g.addColorStop(0.0, '#eef3fb') // sky
  g.addColorStop(0.45, '#c8d2df')
  g.addColorStop(0.6, '#9aa5b4') // horizon
  g.addColorStop(1.0, '#4a4640') // ground bounce
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  const tex = new THREE.CanvasTexture(c)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export interface ArTextures {
  front: HTMLCanvasElement | null
  back: HTMLCanvasElement | null
  frontIn: SizeIn
  backIn: SizeIn
}

export type ArMode = 'overlay' | 'xr'

export interface ArStatus {
  mode: ArMode
  placed: boolean
  motion: boolean
}

const GAP_BELOW_COLLAR = 2.6 // in, print top under the neckline
const DECAL_LIFT = 0.25 // in, above the fabric surface
const DECAL_BEND_MAX = THREE.MathUtils.degToRad(58)

/** A cylindrically-curved plane hugging the chest, sized in inches. */
function makeCurvedDecal(wIn: number, hIn: number, radius: number): THREE.PlaneGeometry {
  const bend = Math.min(DECAL_BEND_MAX, wIn / Math.max(radius, 1))
  const r = wIn / bend
  const geo = new THREE.PlaneGeometry(wIn, hIn, 40, 1)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nor = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const theta = (pos.getX(i) / wIn) * bend
    pos.setXYZ(i, r * Math.sin(theta), pos.getY(i), r * (Math.cos(theta) - 1))
    nor.setXYZ(i, Math.sin(theta), 0, Math.cos(theta))
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  geo.computeBoundingSphere()
  return geo
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.flipY = true
  tex.needsUpdate = true
  return tex
}

export class ArScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private env: THREE.Texture
  private key: THREE.DirectionalLight
  private ground: THREE.Mesh
  private video: HTMLVideoElement
  private stream: MediaStream | null = null

  /** World anchor the figure sits under; moved by placement/drag/XR. */
  private dolly: THREE.Group
  /** Figure yaw + user pinch scale live on this inner group. */
  private turn: THREE.Group
  private mannequin: Mannequin
  private decals = new THREE.Group()
  private textures: ArTextures
  private garmentColor = '#f4f5f7'
  private gender: Gender

  private mode: ArMode = 'overlay'
  private placed = true // overlay: always "placed" at screen centre
  private onStatus?: (s: ArStatus) => void

  // camera-overlay pose (screen-plane offset + scale + user yaw)
  private baseDistance = 100 // in from camera (~8ft: full body with headroom)
  private offset = new THREE.Vector2(0, 0)
  private userScale = 1
  private userYaw = 0

  // device orientation
  private motionOn = false
  private orientYaw = 0
  private orientPitch = 0
  private orientHandler?: (e: DeviceOrientationEvent) => void

  // XR
  private xrSession: XRSession | null = null
  private hitSource: XRHitTestSource | null = null
  private xrRefSpace: XRReferenceSpace | null = null
  private reticle: THREE.Mesh
  private xrPlaced = false

  // pointer gestures
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchStart = 0
  private twistStart = 0
  private startScale = 1
  private startYaw = 0

  constructor(container: HTMLElement, onStatus?: (s: ArStatus) => void) {
    this.container = container
    this.onStatus = onStatus
    this.gender = 'male'
    this.textures = { front: null, back: null, frontIn: { wIn: 12, hIn: 16 }, backIn: { wIn: 12, hIn: 16 } }

    // Camera video behind the canvas.
    this.video = document.createElement('video')
    this.video.setAttribute('playsinline', '')
    this.video.muted = true
    Object.assign(this.video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      zIndex: '0',
      background: '#0c0f13',
    } as CSSStyleDeclaration)
    container.appendChild(this.video)

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true, // needed for screenshots
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.xr.enabled = true
    Object.assign(this.renderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '1',
      touchAction: 'none',
    } as CSSStyleDeclaration)
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 4000)
    this.camera.position.set(0, 0, 0)

    // Soft studio ambient (image-based) + a shadow-casting key light.
    this.env = makeGradientEnv()
    this.scene.environment = this.env

    this.scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x3a3630, 0.55))
    this.key = new THREE.DirectionalLight(0xffffff, 2.1)
    this.key.position.set(-6, 16, 10)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(1024, 1024)
    this.key.shadow.camera.near = 1
    this.key.shadow.camera.far = 120
    const c = this.key.shadow.camera as THREE.OrthographicCamera
    c.left = -40
    c.right = 40
    c.top = 60
    c.bottom = -40
    this.key.shadow.bias = -0.0008
    this.scene.add(this.key, this.key.target)
    const fill = new THREE.DirectionalLight(0xbcd3ff, 0.5)
    fill.position.set(8, 6, -6)
    this.scene.add(fill)

    // Anchor hierarchy: dolly (world placement) → turn (yaw/scale) → figure.
    this.dolly = new THREE.Group()
    this.turn = new THREE.Group()
    this.dolly.add(this.turn)
    this.scene.add(this.dolly)

    // Contact shadow catcher at the feet.
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.turn.add(this.ground)

    this.mannequin = buildMannequin(this.gender)
    this.turn.add(this.mannequin.group)
    this.turn.add(this.decals)
    this.layoutFigure()

    // XR reticle.
    const ring = new THREE.RingGeometry(2.2, 2.8, 32).rotateX(-Math.PI / 2)
    this.reticle = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({ color: 0x35c7ff, transparent: true, opacity: 0.9 }),
    )
    this.reticle.visible = false
    this.reticle.matrixAutoUpdate = false
    this.scene.add(this.reticle)

    this.bindPointers()
    window.addEventListener('resize', this.onResize)
    this.onResize()
    this.renderer.setAnimationLoop(this.tick)

    if (import.meta.env.DEV) {
      ;(window as unknown as { __arScene?: ArScene }).__arScene = this
    }
  }

  /**
   * DEV/headless probe: force a render and read the framebuffer back (works
   * under swiftshader where OS screenshots don't capture WebGL). Reports the
   * figure height, live decal count, and how much of the frame the figure
   * covers — used by scripts/ar-verify.mjs.
   */
  __probe(): { decals: number; figureHeightIn: number; opaque: number; total: number } {
    this.renderer.render(this.scene, this.camera)
    const gl = this.renderer.domElement
    const c = document.createElement('canvas')
    c.width = gl.width
    c.height = gl.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(gl, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let opaque = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 12) opaque++
    return {
      decals: this.decals.children.length,
      figureHeightIn: this.mannequin.heightIn,
      opaque,
      total: d.length / 4,
    }
  }

  // --- figure layout (place under the camera in overlay mode) --------------

  private layoutFigure(): void {
    const m = this.mannequin
    // Sit the figure's feet on y=0 of the dolly, so the ground shadow lands
    // at the feet and the chest reads roughly at eye height.
    this.turn.position.set(0, 0, 0)
    this.mannequin.group.position.y = -m.minY
    this.decals.position.y = -m.minY
    this.ground.position.y = 0
    this.updateOverlayPose()
  }

  /** Camera-overlay: park the dolly a comfortable distance ahead. */
  private updateOverlayPose(): void {
    if (this.mode === 'xr') return
    const dist = this.baseDistance
    // Centre the full figure vertically (feet-to-head straddles the view axis).
    this.dolly.position.set(this.offset.x, -this.mannequin.heightIn * 0.5 + this.offset.y, -dist)
    this.turn.scale.setScalar(this.userScale)
    this.turn.rotation.y = this.userYaw + this.orientYaw
    this.dolly.rotation.x = this.orientPitch
  }

  // --- content -------------------------------------------------------------

  setGender(g: Gender): void {
    if (g === this.gender) return
    this.gender = g
    this.turn.remove(this.mannequin.group)
    this.mannequin.dispose()
    this.mannequin = buildMannequin(g)
    this.mannequin.shirtMaterial.color.set(this.garmentColor)
    this.turn.add(this.mannequin.group)
    this.layoutFigure()
    this.rebuildDecals()
  }

  setGarmentColor(hex: string): void {
    this.garmentColor = hex
    this.mannequin.shirtMaterial.color.set(hex)
  }

  setTextures(tex: ArTextures): void {
    this.textures = tex
    this.rebuildDecals()
  }

  private rebuildDecals(): void {
    // Dispose old.
    for (const child of [...this.decals.children]) {
      const mesh = child as THREE.Mesh
      mesh.geometry.dispose()
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.map?.dispose()
      mat.dispose()
      this.decals.remove(mesh)
    }
    const build = (side: MannequinSide, canvas: HTMLCanvasElement | null, size: SizeIn) => {
      if (!canvas) return
      const a = this.mannequin.anchors[side]
      const geo = makeCurvedDecal(size.wIn, size.hIn, a.radius)
      const mat = new THREE.MeshStandardMaterial({
        map: canvasTexture(canvas),
        transparent: true,
        alphaTest: 0.02,
        roughness: 0.82,
        metalness: 0,
        envMapIntensity: 1,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        side: THREE.FrontSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      // Mannequin-local Y; the decals group already carries the -minY grounding
      // shift (see layoutFigure), so DON'T re-apply it here.
      const cy = a.topY - GAP_BELOW_COLLAR - size.hIn / 2
      mesh.position.set(0, cy, side === 'front' ? a.surfaceZ + DECAL_LIFT : -(a.surfaceZ + DECAL_LIFT))
      mesh.rotation.y = a.rotationY
      mesh.renderOrder = 3
      this.decals.add(mesh)
    }
    build('front', this.textures.front, this.textures.frontIn)
    build('back', this.textures.back, this.textures.backIn)
  }

  /** Rotate the figure to show a given face toward the camera. */
  showSide(side: MannequinSide): void {
    this.userYaw = side === 'back' ? Math.PI : 0
    this.updateOverlayPose()
  }

  resetPose(): void {
    this.offset.set(0, 0)
    this.userScale = 1
    this.userYaw = 0
    this.updateOverlayPose()
  }

  // --- camera stream -------------------------------------------------------

  async startCamera(): Promise<void> {
    if (this.stream) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    this.video.srcObject = this.stream
    await this.video.play().catch(() => undefined)
  }

  stopCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
  }

  // --- device orientation (parallax) ---------------------------------------

  async enableMotion(): Promise<boolean> {
    if (this.motionOn) return true
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission()
        if (res !== 'granted') return false
      } catch {
        return false
      }
    }
    let base: number | null = null
    this.orientHandler = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return
      // Landscape-agnostic small parallax: gamma (L/R tilt) → yaw, beta → pitch.
      if (base == null) base = e.gamma
      this.orientYaw = THREE.MathUtils.degToRad(THREE.MathUtils.clamp((e.gamma - base) * 0.6, -32, 32))
      this.orientPitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp((e.beta - 75) * 0.12, -10, 10))
      if (this.mode === 'overlay') this.updateOverlayPose()
    }
    window.addEventListener('deviceorientation', this.orientHandler)
    this.motionOn = true
    this.emitStatus()
    return true
  }

  // --- pointer gestures (overlay) ------------------------------------------

  private bindPointers(): void {
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.onPointerUp)
    el.addEventListener('pointerleave', this.onPointerUp)
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.mode === 'xr') return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
      this.twistStart = Math.atan2(b.y - a.y, b.x - a.x)
      this.startScale = this.userScale
      this.startYaw = this.userYaw
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.mode === 'xr' || !this.pointers.has(e.pointerId)) return
    const prev = this.pointers.get(e.pointerId)!
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 1) {
      // Drag = reposition in the view plane. Scale screen px → world inches.
      const perPx = (2 * this.baseDistance * Math.tan((this.camera.fov * Math.PI) / 360)) / this.container.clientHeight
      this.offset.x += (e.clientX - prev.x) * perPx
      this.offset.y -= (e.clientY - prev.y) * perPx
      this.updateOverlayPose()
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      if (this.pinchStart > 0) {
        this.userScale = THREE.MathUtils.clamp((this.startScale * dist) / this.pinchStart, 0.35, 4)
        this.userYaw = this.startYaw + (ang - this.twistStart)
        this.updateOverlayPose()
      }
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchStart = 0
  }

  // --- WebXR (progressive) -------------------------------------------------

  static async supportsXR(): Promise<boolean> {
    try {
      return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')))
    } catch {
      return false
    }
  }

  async enterXR(domOverlay?: HTMLElement): Promise<void> {
    if (!navigator.xr) throw new Error('WebXR unavailable')
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      ...(domOverlay ? { domOverlay: { root: domOverlay } } : {}),
    })
    // Register lifecycle listeners BEFORE any fallible await, so a system-gesture
    // exit always restores overlay state even if session setup rejects below.
    session.addEventListener('select', this.onXRSelect)
    session.addEventListener('end', this.onXREnd)
    this.xrSession = session
    this.mode = 'xr'
    this.xrPlaced = false
    this.placed = false
    this.video.style.visibility = 'hidden' // compositor provides passthrough
    this.userScale = 1
    this.turn.scale.setScalar(1)
    this.turn.rotation.y = this.userYaw
    this.dolly.rotation.x = 0

    try {
      await this.renderer.xr.setSession(session as unknown as XRSession)
      this.xrRefSpace = await session.requestReferenceSpace('local')
      const viewerSpace = await session.requestReferenceSpace('viewer')
      this.hitSource = (await session.requestHitTestSource?.({ space: viewerSpace })) ?? null
    } catch (err) {
      // Setup failed after the session began presenting — end it so onXREnd
      // restores overlay mode + the camera video (never leave a frozen screen).
      this.exitXR()
      throw err
    }
    this.emitStatus()
  }

  private onXRSelect = () => {
    if (!this.reticle.visible) return
    this.dolly.position.setFromMatrixPosition(this.reticle.matrix)
    this.dolly.quaternion.setFromRotationMatrix(this.reticle.matrix)
    this.turn.scale.setScalar(1)
    this.xrPlaced = true
    this.placed = true
    this.reticle.visible = false
    this.emitStatus()
  }

  private onXREnd = () => {
    this.hitSource = null
    this.xrRefSpace = null
    this.xrSession = null
    this.mode = 'overlay'
    this.placed = true
    this.reticle.visible = false
    this.video.style.visibility = 'visible'
    this.layoutFigure()
    this.emitStatus()
  }

  exitXR(): void {
    this.xrSession?.end().catch(() => undefined)
  }

  // --- screenshot ----------------------------------------------------------

  /** Composite the camera frame + rendered figure into a PNG blob. */
  async capture(): Promise<Blob> {
    const out = document.createElement('canvas')
    const w = this.container.clientWidth * Math.min(devicePixelRatio, 2)
    const h = this.container.clientHeight * Math.min(devicePixelRatio, 2)
    out.width = Math.round(w)
    out.height = Math.round(h)
    const ctx = out.getContext('2d')!

    if (this.mode === 'overlay' && this.video.videoWidth) {
      // object-fit: cover the video frame.
      const vw = this.video.videoWidth
      const vh = this.video.videoHeight
      const scale = Math.max(out.width / vw, out.height / vh)
      const dw = vw * scale
      const dh = vh * scale
      ctx.drawImage(this.video, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh)
    } else {
      ctx.fillStyle = '#0c0f13'
      ctx.fillRect(0, 0, out.width, out.height)
    }
    // Force a fresh synchronous render so the GL buffer is current, then blit.
    this.renderer.render(this.scene, this.camera)
    ctx.drawImage(this.renderer.domElement, 0, 0, out.width, out.height)

    return new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), 'image/png'),
    )
  }

  // --- loop + resize -------------------------------------------------------

  private tick = (_t: number, frame?: XRFrame) => {
    if (this.mode === 'xr' && frame && this.hitSource && this.xrRefSpace && !this.xrPlaced) {
      const hits = frame.getHitTestResults(this.hitSource)
      if (hits.length) {
        const pose = hits[0].getPose(this.xrRefSpace)
        if (pose) {
          this.reticle.visible = true
          this.reticle.matrix.fromArray(pose.transform.matrix)
        }
      } else {
        this.reticle.visible = false
      }
    }
    this.renderer.render(this.scene, this.camera)
  }

  private onResize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w < 2 || h < 2) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.mode === 'overlay') this.updateOverlayPose()
  }

  private emitStatus(): void {
    this.onStatus?.({ mode: this.mode, placed: this.placed, motion: this.motionOn })
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    if (this.orientHandler) window.removeEventListener('deviceorientation', this.orientHandler)
    this.xrSession?.end().catch(() => undefined)
    this.stopCamera()
    this.mannequin.dispose()
    this.env.dispose()
    for (const child of this.decals.children) {
      const mesh = child as THREE.Mesh
      mesh.geometry.dispose()
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.map?.dispose()
      mat.dispose()
    }
    this.ground.geometry.dispose()
    ;(this.ground.material as THREE.Material).dispose()
    this.renderer.dispose()
    this.video.remove()
    this.renderer.domElement.remove()
  }
}
