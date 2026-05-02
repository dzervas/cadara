import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { getMeasurementWitnessStyleConfig } from '@/components/cad/measurement-witness-style'

test('src/components/cad/measurement-witness-style.spec.ts', () => {  const style = getMeasurementWitnessStyleConfig()

  expectTrue(style.core.color === 0xffde59, 'Measurement witness core lines should use the bright yellow accent.')
  expectTrue(style.halo.lineWidth > style.core.lineWidth, 'Measurement witness halo should render wider than the core line.')
  expectTrue(style.halo.opacity < style.core.opacity, 'Measurement witness halo should stay softer than the core line.')
  expectTrue(style.marker.scale > 1, 'Measurement witness markers should be emphasized over default point markers.')
})
