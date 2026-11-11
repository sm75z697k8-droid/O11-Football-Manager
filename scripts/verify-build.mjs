/**
 * O11 Phase 0E — production artifact smoke check.
 * Runs on GitHub Actions with Node; no browser/runtime simulation claims.
 */
import { readFileSync, statSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = resolve(root, 'dist')
const base = '/O11-Football-Manager/'
const html = readFileSync(join(dist, 'index.html'), 'utf8')

function check(condition, message) {
  if (!condition) throw new Error('Build smoke test: ' + message)
}

export function assetPaths(markup) {
  return [...markup.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => url.startsWith(base + 'assets/'))
}

check(html.includes('id="root"'), 'Compiled HTML must contain React mount point')
check(!html.includes('src="/src/main.tsx"'), 'HTML still references uncompiled Vite source')
const paths = assetPaths(html)
check(paths.some((path) => path.endsWith('.js')), 'Missing compiled JavaScript asset reference')
check(paths.some((path) => path.endsWith('.css')), 'Missing compiled CSS asset reference')

for (const assetPath of paths) {
  const relative = assetPath.slice(base.length)
  check(/^assets\/[a-zA-Z0-9._-]+\.(?:js|css)$/.test(relative), 'Unsafe or malformed asset path: ' + assetPath)
  const absolute = resolve(dist, relative)
  check(absolute.startsWith(dist + sep), 'Asset path escaped output directory')
  check(statSync(absolute).isFile(), 'Asset is not a file: ' + relative)
  const bytes = statSync(absolute).size
  check(bytes > 100, 'Asset is unexpectedly empty: ' + relative)
  console.log('[O11 build] ' + assetPath + ': ' + bytes + ' bytes')
}
console.log('[O11 build] Compiled HTML and JS/CSS assets verified')
