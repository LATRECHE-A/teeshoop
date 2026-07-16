/**
 * Ambient types for the three.js addons we use (exporters + GLTFLoader). three
 * ships these under examples/jsm as plain `.js` with no bundled `.d.ts` (same
 * gap we patched for RoomEnvironment), so under `strict` they must be declared
 * here. Minimal surface — only what arExport.ts + the viewer use.
 */
declare module 'three/examples/jsm/exporters/GLTFExporter.js' {
  import type { Object3D } from 'three'

  export interface GLTFExporterOptions {
    binary?: boolean
    embedImages?: boolean
    onlyVisible?: boolean
    trs?: boolean
    maxTextureSize?: number
    animations?: unknown[]
  }

  export class GLTFExporter {
    parse(
      input: Object3D | Object3D[],
      onDone: (gltf: ArrayBuffer | Record<string, unknown>) => void,
      onError: (error: unknown) => void,
      options?: GLTFExporterOptions,
    ): void
    parseAsync(
      input: Object3D | Object3D[],
      options?: GLTFExporterOptions,
    ): Promise<ArrayBuffer | Record<string, unknown>>
  }
}

declare module 'three/examples/jsm/exporters/USDZExporter.js' {
  import type { Object3D } from 'three'

  export interface USDZExporterOptions {
    quickLookCompatible?: boolean
    maxTextureSize?: number
    includeAnchoringProperties?: boolean
    ar?: {
      anchoring?: { type: string }
      planeAnchoring?: { alignment: string }
    }
  }

  export class USDZExporter {
    parse(
      scene: Object3D,
      onDone: (result: Uint8Array) => void,
      onError: (error: unknown) => void,
      options?: USDZExporterOptions,
    ): void
    parseAsync(scene: Object3D, options?: USDZExporterOptions): Promise<Uint8Array>
  }
}

declare module 'three/examples/jsm/geometries/DecalGeometry.js' {
  import type { BufferGeometry, Euler, Mesh, Vector3 } from 'three'
  export class DecalGeometry extends BufferGeometry {
    constructor(mesh: Mesh, position: Vector3, orientation: Euler, size: Vector3)
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { Group, LoadingManager } from 'three'

  export interface GLTF {
    scene: Group
    scenes: Group[]
    animations: unknown[]
    cameras: unknown[]
    asset: Record<string, unknown>
  }

  export class GLTFLoader {
    constructor(manager?: LoadingManager)
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: unknown) => void,
    ): void
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<GLTF>
    parse(
      data: ArrayBuffer | string,
      path: string,
      onLoad: (gltf: GLTF) => void,
      onError?: (error: unknown) => void,
    ): void
  }
}
