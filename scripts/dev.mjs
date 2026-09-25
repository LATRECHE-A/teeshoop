#!/usr/bin/env node
/**
 * One-command dev: the Worker API + the studio, together.
 *
 *   npm run dev        → wrangler dev on :8787  +  vite on :5173
 *
 * `vite` alone serves static assets only: the Falk&Ross catalogue and the AR
 * share flow live on the Worker, so without wrangler the studio's /api/* proxy
 * answers ECONNREFUSED and the catalogue reports itself unreachable. That is
 * exactly how the supplier integration "broke" once: the README said to run two
 * terminals, and nobody does. This script makes the documented setup the
 * default one.
 *
 * If :8787 is already taken (a wrangler you started yourself), the spawned one
 * exits and the studio simply proxies to yours. That is reported, not fatal.
 * TSHOP_NO_WORKER=1 skips the Worker on purpose (pure-frontend work).
 */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { NODE, VITE, WRANGLER } from './bin.mjs'

const CYAN = '\x1b[36m'
const MAGENTA = '\x1b[35m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const children = new Set()
let shuttingDown = false

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  // Give them a beat to exit cleanly before we do.
  setTimeout(() => process.exit(code), 300).unref()
}

function start(tag, color, cmd, args, { fatal }) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  const prefix = `${color}[${tag}]${RESET} `
  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.trim()) out.write(prefix + line + '\n')
      }
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    children.delete(child)
    if (shuttingDown) return
    if (fatal) {
      process.stdout.write(`${prefix}exited (${code ?? 'signal'}), stopping.\n`)
      shutdown(code ?? 0)
    } else {
      process.stdout.write(
        `${prefix}${DIM}exited (${code ?? 'signal'}). If a wrangler dev of yours already owns :8787, ` +
          `the studio will use that one; otherwise the catalogue will report the backend as down ` +
          `until you restart. (TSHOP_NO_WORKER=1 hides this on purpose.)${RESET}\n`,
      )
    }
  })
  return child
}

if (!process.env.TSHOP_NO_WORKER) {
  start('api', MAGENTA, NODE, [WRANGLER, 'dev', '--port', '8787', '--ip', '127.0.0.1'], {
    fatal: false,
  })
} else {
  process.stdout.write(`${MAGENTA}[api]${RESET} skipped (TSHOP_NO_WORKER=1)\n`)
}
// Forward any extra args to vite (e.g. `npm run dev -- --port 5174`).
start('web', CYAN, NODE, [VITE, ...process.argv.slice(2)], { fatal: true })

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
