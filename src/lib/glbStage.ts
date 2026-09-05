/**
 * Un modèle GLB dans un canevas : les lumières, le ton et la caméra du projet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 *
 * Il vivait dans `src/viewer/main.ts`, la page que le code QR ouvre. Le
 * personnalisateur de la fiche produit a besoin exactement de la même chose :
 * montrer, dans la page, le modèle que `buildArModel` vient de construire. Le
 * recopier aurait produit une SECONDE façon d'éclairer le vêtement, et deux
 * éclairages sont deux couleurs sur le même tissu, ce que `CLAUDE.md`
 * section 1 interdit et que ce projet a déjà payé une fois (la « dérive de 2 % »
 * de la séance 10, qui était deux instruments et pas un défaut de rendu).
 *
 * Il ne prend AUCUNE décision d'interface : pas de DOM, pas de texte, pas de
 * bouton. Il reçoit un canevas et une URL, et rend de quoi arrêter la boucle.
 * Les deux appelants gardent leur propre page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE TON EST NEUTRE, ET CE N'EST PAS UN DÉTAIL
 *
 * `NeutralToneMapping` à l'exposition de référence, comme le canevas du studio
 * et le plateau du panier. C'est la dernière image qu'un client voit avant
 * d'acheter : elle ne doit pas être la seule surface qui rejuge sa couleur.
 * ACES à 1,05 relevait les noirs et désaturait chaque teinte forte.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Soft equirectangular studio gradient for gentle ambient + reflections. */
function gradientEnv(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0.0, '#eef3fb')
  g.addColorStop(0.5, '#aeb9c8')
  g.addColorStop(1.0, '#42484f')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function initPreview(
  canvas: HTMLCanvasElement,
  glbUrl: string,
  onReady: () => void,
  onFail: () => void,
): { arreter(): void } {
  const aLiberer: { dispose(): void }[] = []
  let vivant = true
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  // Neutral (KHR_PBR_neutral) at reference exposure, the same as the studio
  // canvas and the basket board. This viewer is the AR poster/fallback, i.e. the
  // last thing a customer sees before they buy: it must not be the one surface
  // that re-grades their colour (ACES at 1.05 lifted blacks and desaturated
  // every strong hue).
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0

  const scene = new THREE.Scene()
  const env = gradientEnv()
  aLiberer.push(env)
  scene.environment = env
  scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x3a3630, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 2.0)
  key.position.set(-6, 12, 10)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xbcd3ff, 0.5)
  fill.position.set(8, 5, -6)
  scene.add(fill)

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 4000)
  const pivot = new THREE.Group()
  scene.add(pivot)

  const resize = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w < 2 || h < 2) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  /*
   * L'ÉCOUTEUR EST SUR `window` ET IL EST RETIRÉ, ce qui n'est pas une
   * contradiction avec la cinquième raison de `Shortcode.php` : celle-là parle
   * des écouteurs CLAVIER, qui volent les frappes d'une page qu'ils ne
   * possèdent pas. Un `resize` ne vole rien, et il n'y a pas d'autre façon
   * d'apprendre qu'une fenêtre a changé de taille. Ce qui compte est qu'il
   * parte avec la scène, sinon deux ouvertures de la vue 3D laissent deux
   * écouteurs sur un canevas détruit.
   */

  // Drag to rotate; idle auto-spin.
  let auto = true
  let dragging = false
  let lastX = 0
  let vel = 0.004
  const surAppui = (e: PointerEvent) => {
    dragging = true
    auto = false
    lastX = e.clientX
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const surGlissement = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    lastX = e.clientX
    vel = dx * 0.01
    pivot.rotation.y += vel
  }
  const stop = () => {
    dragging = false
  }
  canvas.addEventListener('pointerdown', surAppui)
  canvas.addEventListener('pointermove', surGlissement)
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)

  new GLTFLoader().loadAsync(glbUrl).then(
    (gltf) => {
      if (!vivant) return
      const model = gltf.scene
      /*
       * CE QUE LE CHARGEUR ALLOUE EST À NOUS, et personne d'autre ne le
       * libérera : three.js ne suit pas ce qu'un GLTF a créé. Séance 10 :
       * trois textures GPU fuyaient par clic sur le sélecteur de scène, et le
       * recensement « atteignable contre alloué » l'a trouvé en secondes.
       */
      model.traverse((n) => {
        const m = n as THREE.Mesh
        if (m.geometry) aLiberer.push(m.geometry)
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
          aLiberer.push(mat)
          for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
            if (v instanceof THREE.Texture) aLiberer.push(v)
          }
        }
      })
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      model.position.sub(center) // centre at the origin so it spins in place
      pivot.add(model)
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 30
      camera.position.set(0, size.y * 0.04, radius / Math.tan((camera.fov * Math.PI) / 360) * 1.15)
      camera.lookAt(0, 0, 0)
      resize()
      renderer.setAnimationLoop(() => {
        if (auto) pivot.rotation.y += 0.006
        else if (!dragging) {
          pivot.rotation.y += vel
          vel *= 0.94
        }
        renderer.render(scene, camera)
      })
      onReady()
    },
    () => {
      if (vivant) onFail()
    },
  )

  return {
    arreter() {
      if (!vivant) return
      vivant = false
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', surAppui)
      canvas.removeEventListener('pointermove', surGlissement)
      canvas.removeEventListener('pointerup', stop)
      canvas.removeEventListener('pointercancel', stop)
      for (const d of aLiberer) d.dispose()
      aLiberer.length = 0
      renderer.dispose()
      // Le contexte lui-même, que `dispose()` ne rend pas toujours : un
      // navigateur n'en garde qu'une poignée et jette la plus ancienne, qui est
      // celle qu'on regarde.
      renderer.forceContextLoss?.()
    },
  }
}

/**
 * Monte un GLB dans ce canevas, et rend de quoi tout arrêter.
 *
 * `arreter()` coupe la boucle d'animation, retire les écouteurs et libère le
 * contexte WebGL. Un contexte laissé derrière est ce qui a coûté trois textures
 * GPU par clic à la séance 10 : un navigateur n'en garde qu'une poignée, et
 * quand il en manque il jette la plus ancienne, c'est-à-dire celle qu'on
 * regarde.
 */
export function monterGlb(
  canvas: HTMLCanvasElement,
  glbUrl: string,
  onReady: () => void,
  onFail: () => void,
): { arreter(): void } {
  return initPreview(canvas, glbUrl, onReady, onFail)
}
