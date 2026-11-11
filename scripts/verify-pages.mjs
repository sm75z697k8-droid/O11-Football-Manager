/**
 * O11 Phase 0E — live GitHub Pages HTTP smoke test.
 * Proves the deployed HTML references accessible, nonempty JS/CSS bundles.
 * Does not replace real iPhone Safari rendering or runtime browser tests.
 */
import { setTimeout as delay } from 'node:timers/promises'

const site = process.env.SITE_URL
const sha = process.env.GITHUB_SHA || 'local'
const base = '/O11-Football-Manager/'
const maxAttempts = 8

if (!site) throw new Error('SITE_URL is required for live Pages verification')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function getAssets(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => url.startsWith(base + 'assets/'))
}

async function verifyOnce() {
  const pageUrl = new URL(site)
  assert(pageUrl.pathname === base, 'Pages URL must match repository base path')
  pageUrl.searchParams.set('o11_verify', sha)
  const response = await fetch(pageUrl, { cache: 'no-store' })
  assert(response.ok, 'HTML returned HTTP ' + response.status)
  const html = await response.text()
  assert(html.includes('id="root"'), 'Deployed HTML lacks React mount point')
  assert(!html.includes('src="/src/main.tsx"'), 'Uncompiled source is still being published')
  const assets = getAssets(html)
  assert(assets.some((path) => path.endsWith('.js')), 'No deployed JavaScript bundle referenced')
  assert(assets.some((path) => path.endsWith('.css')), 'No deployed CSS bundle referenced')

  for (const path of assets) {
    assert(/^\/O11-Football-Manager\/assets\/[a-zA-Z0-9._-]+\.(?:js|css)$/.test(path), 'Unexpected asset path')
    const assetUrl = new URL(path, pageUrl.origin)
    const assetResponse = await fetch(assetUrl, { cache: 'no-store' })
    assert(assetResponse.ok, path + ' returned HTTP ' + assetResponse.status)
    const type = assetResponse.headers.get('content-type') || ''
    assert(path.endsWith('.js') ? /javascript/i.test(type) : /css/i.test(type), 'Invalid Content-Type for ' + path + ': ' + type)
    const body = await assetResponse.arrayBuffer()
    assert(body.byteLength > 100, 'Published asset is unexpectedly empty: ' + path)
    console.log('[O11 Pages] ' + path + ': HTTP ' + assetResponse.status + ', ' + body.byteLength + ' bytes, ' + type)
  }
  console.log('[O11 Pages] Live compiled HTML + all referenced JS/CSS assets available')
}

let lastError
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await verifyOnce()
    process.exit(0)
  } catch (error) {
    lastError = error
    console.warn('[O11 Pages] Attempt ' + attempt + '/' + maxAttempts + ' failed: ' + String(error))
    if (attempt < maxAttempts) await delay(8000)
  }
}
throw new Error('Live Pages verification failed after retries: ' + String(lastError))
