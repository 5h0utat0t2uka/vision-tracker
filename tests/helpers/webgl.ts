export function webglFixture(options: { unavailable?: boolean; shaderFailure?: boolean; linkFailure?: boolean } = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  let lost = false
  const record = (name: string, args: unknown[]) => calls.push({ name, args: args.map(arg => arg instanceof Float32Array || arg instanceof Uint8Array ? arg.slice() : arg) })
  const gl: Record<string, unknown> = {}
  for (const [index, name] of ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ARRAY_BUFFER', 'FLOAT', 'TEXTURE0', 'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'LINEAR', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'RGBA', 'UNSIGNED_BYTE', 'UNPACK_FLIP_Y_WEBGL', 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'COLOR_BUFFER_BIT', 'DYNAMIC_DRAW', 'TRIANGLES'].entries()) gl[name] = index + 100
  for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'useProgram', 'deleteShader', 'bindBuffer', 'enableVertexAttribArray', 'vertexAttribPointer', 'activeTexture', 'bindTexture', 'texParameteri', 'uniform1i', 'texImage2D', 'pixelStorei', 'clearColor', 'viewport', 'clear', 'bufferData', 'bufferSubData', 'drawArrays', 'deleteBuffer', 'deleteTexture', 'deleteProgram']) {
    gl[name] = (...args: unknown[]) => record(name, args)
  }
  for (const name of ['createShader', 'createProgram', 'createBuffer', 'createTexture']) gl[name] = () => ({ kind: name })
  gl.getShaderParameter = () => !options.shaderFailure
  gl.getProgramParameter = () => !options.linkFailure
  gl.getShaderInfoLog = gl.getProgramInfoLog = () => 'test diagnostic'
  gl.getAttribLocation = () => 0
  gl.getUniformLocation = () => ({})
  gl.isContextLost = () => lost
  gl.getExtension = () => ({ loseContext() { lost = true; record('loseContext', []) } })
  const canvas = { width: 0, height: 0, getContext: (kind: string) => kind === 'webgl' && !options.unavailable ? gl : null } as unknown as HTMLCanvasElement
  return { canvas, calls, gl, loseContext() { lost = true } }
}
