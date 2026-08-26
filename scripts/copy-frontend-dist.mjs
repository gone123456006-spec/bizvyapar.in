import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'frontend', 'dist')
const target = resolve(root, 'dist')

if (!existsSync(source)) {
  console.error(`[copy-frontend-dist] Missing build output: ${source}`)
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`[copy-frontend-dist] Copied ${source} → ${target}`)
