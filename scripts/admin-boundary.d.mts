/**
 * Types for scripts/admin-boundary.mjs.
 *
 * The module itself is plain .mjs because two of its three readers are node
 * scripts with no TypeScript pipeline (see its header). The other two are
 * type-checked, so it needs this: without it `tsc --noEmit` reports the whole
 * module as `any`, and an `any` in the middle of a security boundary is exactly
 * where a typo stops being an error.
 */

export declare const ADMIN_ONLY: readonly string[]
export declare const MUST_REACH: readonly string[]
export declare const ADMIN_ASSET_DIR: string

export declare function isAdminOnly(relPath: string): boolean
export declare function specifiersOf(src: string): string[]

/** Repository-relative path of every reached module, to the file that pulled it in. */
export declare function closureFrom(entry: string, repoRoot: string): Map<string, string>

/** Absolute paths of every module only the admin entry reaches. */
export declare function adminOnlyModules(repoRoot: string): Set<string>
