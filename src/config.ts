/**
 * Build identity, stamped into exported order archives (DTF manifest +
 * LISEZ-MOI). Keep it in step with package.json `version` — when a print shop
 * disputes a file, the first question is which build produced it.
 */
export const APP_VERSION = '0.1.0'

/** Business configuration — edit these before going live. */
export const BUSINESS = {
  name: 'Tshop',
  tagline: 'Custom apparel studio',
  /** Quote requests open the visitor's mail app addressed here. */
  quoteEmail: 'orders@tshop.example',
}
