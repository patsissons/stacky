// Renders the docs site's Open Graph card from the logo and the containers screenshot.
//
//   pnpm site:og-image
//
// Re-run it after `pnpm site:screenshots`; the image lands in apps/site/public/og.png.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const site = path.resolve(import.meta.dirname, '../../site')
const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`

const logo = dataUrl(path.join(site, 'src/assets/logo.svg'), 'image/svg+xml')
const screenshot = dataUrl(path.join(site, 'src/assets/screenshots/containers.png'), 'image/png')
const font = dataUrl(
  path.resolve(
    import.meta.dirname,
    '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  ),
  'font/woff2',
)

const html = `<!doctype html>
<style>
  @font-face { font-family: Inter; src: url(${font}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden; position: relative;
    font-family: Inter, sans-serif; color: #e0e7ff;
    background:
      radial-gradient(circle at 15% 20%, rgb(99 102 241 / 0.35), transparent 45%),
      radial-gradient(circle at 90% 100%, rgb(79 70 229 / 0.3), transparent 50%),
      #0b0b17;
  }
  .text { position: absolute; left: 72px; top: 72px; width: 470px; }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 44px; font-weight: 700; color: #fff; }
  .brand img { width: 64px; height: 64px; }
  h1 { margin-top: 56px; font-size: 50px; line-height: 1.1; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
  p { margin-top: 24px; font-size: 24px; line-height: 1.4; color: #c7d2fe; }
  .url { position: absolute; left: 72px; bottom: 64px; font-size: 22px; font-weight: 600; color: #a5b4fc; }
  .shot {
    position: absolute; left: 600px; top: 96px; width: 820px;
    border: 1px solid rgb(199 210 254 / 0.25); border-radius: 14px;
    box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.7);
  }
</style>
<div class="text">
  <div class="brand"><img src="${logo}" alt="">stacky</div>
  <h1>Compose-first Docker stack manager</h1>
  <p>A fast, modern web UI for your home lab. Your compose files stay the source of truth.</p>
</div>
<div class="url">stacky.lgtm.page</div>
<img class="shot" src="${screenshot}" alt="">`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html)
await page.evaluate('document.fonts.ready')
await page.screenshot({ path: path.join(site, 'public/og.png') })
await browser.close()
console.log('saved og.png')
