import { cp, mkdir, rm } from 'node:fs/promises'

const sourceDirectory = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url)
const targetDirectory = new URL('../public/mediapipe/wasm/', import.meta.url)

await rm(targetDirectory, { recursive: true, force: true })
await mkdir(targetDirectory, { recursive: true })
await cp(sourceDirectory, targetDirectory, { recursive: true })
