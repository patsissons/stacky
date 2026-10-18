/** Release version baked into the image at build time (`STACKY_VERSION` build arg). */
export const VERSION = process.env.STACKY_VERSION ?? 'dev'

/** Changes on every process start; the UI uses it to notice that stacky restarted. */
export const BOOT_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
