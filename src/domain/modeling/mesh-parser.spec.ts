import { test } from 'bun:test'
import { zipSync } from 'fflate'

import {
  parse3mfTriangles,
  parseStlTriangles,
} from '@/domain/modeling/mesh-parser'

test('src/domain/modeling/mesh-parser.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function asciiStl() {
    return new TextEncoder().encode(`solid one
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid one
`)
  }

  function binaryStl(triangleCount: number) {
    const bytes = new Uint8Array(84 + triangleCount * 50)
    const view = new DataView(bytes.buffer)
    view.setUint32(80, triangleCount, true)
    for (let index = 0; index < triangleCount; index += 1) {
      const offset = 84 + index * 50
      const x = index % 64
      const points = [
        [x, 0, 0],
        [x + 1, 0, 0],
        [x, 1, 0],
      ]
      for (const [pointIndex, point] of points.entries()) {
        const pointOffset = offset + 12 + pointIndex * 12
        view.setFloat32(pointOffset, point[0]!, true)
        view.setFloat32(pointOffset + 4, point[1]!, true)
        view.setFloat32(pointOffset + 8, point[2]!, true)
      }
    }
    return bytes
  }

  function triangleOnly3mf() {
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Ignored metadata</metadata>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0" />
          <vertex x="1" y="0" z="0" />
          <vertex x="0" y="1" z="0" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" />
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`
    return zipSync({ '3D/3dmodel.model': new TextEncoder().encode(model) })
  }

  function transformed3mf() {
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices><vertex x="0" y="0" z="0" /><vertex x="1" y="0" z="0" /><vertex x="0" y="1" z="0" /></vertices>
        <triangles><triangle v1="0" v2="1" v3="2" /></triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0" /></build>
</model>`
    return zipSync({ '3D/3dmodel.model': new TextEncoder().encode(model) })
  }

  function singleQuoted3mf() {
    const model = `<?xml version='1.0' encoding='UTF-8'?>
<model unit='millimeter' xmlns='http://schemas.microsoft.com/3dmanufacturing/core/2015/02'>
  <resources>
    <object id='1' type='model'>
      <mesh>
        <vertices>
          <vertex x='0' y='0' z='0' />
          <vertex x='1' y='0' z='0' />
          <vertex x='0' y='1' z='0' />
        </vertices>
        <triangles>
          <triangle v1='0' v2='1' v3='2' />
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid='1' />
  </build>
</model>`
    return zipSync({ '3D/3dmodel.model': new TextEncoder().encode(model) })
  }

  assert(parseStlTriangles(asciiStl()).length === 1, 'ASCII STL parser should extract triangle facets.')
  assert(parseStlTriangles(binaryStl(4096)).length === 4096, 'Binary STL parser should handle medium-size payloads.')
  assert(parse3mfTriangles(triangleOnly3mf()).length === 1, '3MF parser should extract triangle-only geometry.')
  assert(parse3mfTriangles(singleQuoted3mf()).length === 1, '3MF parser should accept XML single-quoted attributes.')

  let rejected = false
  try {
    parse3mfTriangles(transformed3mf())
  } catch {
    rejected = true
  }
  assert(rejected, '3MF parser should reject unsupported transforms required for geometry interpretation.')
})
