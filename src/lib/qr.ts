/**
 * QR code → PNG data URL. Lazy-imports the `qrcode` library so it never lands
 * in the initial studio chunk (only pulled when the AR/share modal opens).
 */
export async function makeQrDataUrl(text: string): Promise<string> {
  const QR = (await import('qrcode')).default
  return QR.toDataURL(text, {
    // A 4-module quiet zone (the spec minimum) + a large raster keep the QR
    // scannable off a screen. This only ever encodes a SHORT /v/{id} URL now
    // (QR version ~2–3), not a giant design hash, so modules stay coarse.
    margin: 4,
    width: 512,
    errorCorrectionLevel: 'M',
    color: { dark: '#0c0f13', light: '#ffffff' },
  })
}
