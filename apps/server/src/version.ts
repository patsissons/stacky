/** Release version baked into the image at build time (`STACKY_VERSION` build arg). */
export const VERSION = process.env.STACKY_VERSION ?? 'dev'
