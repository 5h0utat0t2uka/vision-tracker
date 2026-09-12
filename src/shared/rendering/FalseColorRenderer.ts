import type { Track } from '../tracking/types.ts'
import { FALSE_COLOR_BRIGHTNESS_WEIGHTS, FALSE_COLOR_PALETTE } from './falseColor.ts'

type Viewport = {
  analysisWidth: number
  analysisHeight: number
  cssWidth: number
  cssHeight: number
  renderWidth: number
  renderHeight: number
  offsetX: number
  offsetY: number
}

const VERTEX_SHADER = `
attribute vec2 position;
attribute vec2 texCoord;
varying vec2 uv;
void main() { uv = texCoord; gl_Position = vec4(position, 0.0, 1.0); }
`
const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D videoTexture;
uniform sampler2D paletteTexture;
varying vec2 uv;
void main() {
  vec4 pixel = texture2D(videoTexture, uv);
  float brightness = dot(pixel.rgb, vec3(${FALSE_COLOR_BRIGHTNESS_WEIGHTS.join(', ')}));
  vec3 color = texture2D(paletteTexture, vec2((brightness * 255.0 + 0.5) / 256.0, 0.5)).rgb;
  gl_FragColor = vec4(color * pixel.a, pixel.a);
}
`

// Private offscreen WebGL canvas. The existing 2D display canvas receives its
// finished pixels without CSS/SVG filtering or CPU pixel readback.
export class FalseColorRenderer {
  private readonly gl: WebGLRenderingContext
  private readonly canvas: HTMLCanvasElement
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private videoTexture: WebGLTexture | null = null
  private paletteTexture: WebGLTexture | null = null
  private vertices = new Float32Array(0)
  private disposed = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
    })
    if (!gl) throw new Error('False color requires WebGL. Select another Region effect and restart the camera.')
    this.gl = gl
    try {
      this.initialize()
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  private initialize(): void {
    const gl = this.gl
    const shaders: WebGLShader[] = []
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Failed to allocate a False color shader.')
        shaders.push(shader)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`False color shader compilation failed: ${gl.getShaderInfoLog(shader)}`)
      }
      this.program = gl.createProgram()
      if (!this.program) throw new Error('Failed to allocate the False color program.')
      for (const shader of shaders) gl.attachShader(this.program, shader)
      gl.linkProgram(this.program)
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(`False color program linking failed: ${gl.getProgramInfoLog(this.program)}`)
      gl.useProgram(this.program)
    } finally {
      for (const shader of shaders) gl.deleteShader(shader)
    }
    this.buffer = gl.createBuffer()
    this.videoTexture = gl.createTexture()
    this.paletteTexture = gl.createTexture()
    if (!this.buffer || !this.videoTexture || !this.paletteTexture) throw new Error('Failed to allocate False color GPU resources.')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    for (const [name, offset] of [['position', 0], ['texCoord', 8]] as const) {
      const location = gl.getAttribLocation(this.program!, name)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset)
    }
    for (const [unit, texture, name] of [[0, this.videoTexture, 'videoTexture'], [1, this.paletteTexture, 'paletteTexture']] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.uniform1i(gl.getUniformLocation(this.program!, name), unit)
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, FALSE_COLOR_PALETTE)
    gl.activeTexture(gl.TEXTURE0)
    // Geometry UVs use the video's top-left origin, so uploads are not flipped.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.clearColor(0, 0, 0, 0)
  }

  render(video: HTMLVideoElement, tracks: readonly Track[], viewport: Viewport, width: number, height: number): HTMLCanvasElement {
    const gl = this.gl
    if (this.disposed || gl.isContextLost()) throw new Error('False color WebGL context was lost. Restart the camera or select another Region effect.')
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (this.vertices.length < tracks.length * 24) {
      this.vertices = new Float32Array(Math.max(24, tracks.length * 24 * 2))
      gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW)
    }
    let count = 0
    const { analysisWidth, analysisHeight, cssWidth, cssHeight, renderWidth, renderHeight, offsetX, offsetY } = viewport
    for (const track of tracks) {
      if (track.state !== 'confirmed') continue
      const box = track.bbox
      const u0 = Math.max(0, box.x) / analysisWidth
      const v0 = Math.max(0, box.y) / analysisHeight
      const u1 = Math.min(analysisWidth, box.x + box.width) / analysisWidth
      const v1 = Math.min(analysisHeight, box.y + box.height) / analysisHeight
      if (!(u1 > u0 && v1 > v0)) continue
      const x0 = 2 * (u0 * renderWidth + offsetX) / cssWidth - 1
      const x1 = 2 * (u1 * renderWidth + offsetX) / cssWidth - 1
      const y0 = 1 - 2 * (v0 * renderHeight + offsetY) / cssHeight
      const y1 = 1 - 2 * (v1 * renderHeight + offsetY) / cssHeight
      this.vertices.set([x0, y0, u0, v0, x0, y1, u0, v1, x1, y0, u1, v0, x1, y0, u1, v0, x0, y1, u0, v1, x1, y1, u1, v1], count)
      count += 24
    }
    if (count > 0) {
      // One video upload and one draw call for all current confirmed regions.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices.subarray(0, count))
      gl.drawArrays(gl.TRIANGLES, 0, count / 4)
    }
    return this.canvas
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    gl.deleteBuffer(this.buffer)
    gl.deleteTexture(this.videoTexture)
    gl.deleteTexture(this.paletteTexture)
    gl.deleteProgram(this.program)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
