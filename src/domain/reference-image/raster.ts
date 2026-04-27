export const supportedReferenceImageFileTypes = [
  { extension: 'png', mediaType: 'image/png' },
  { extension: 'jpg', mediaType: 'image/jpeg' },
  { extension: 'jpeg', mediaType: 'image/jpeg' },
  { extension: 'webp', mediaType: 'image/webp' },
  { extension: 'bmp', mediaType: 'image/bmp' },
] as const

export function inferReferenceImageMediaType(name: string) {
  const extension = getFileExtension(name)
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    default:
      return null
  }
}

export function encodeBytesToBase64(bytes: Uint8Array) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }
  return btoa(binary)
}

export function readRasterImageDimensions(bytes: Uint8Array) {
  const png = readPngDimensions(bytes)
  if (png) {
    return png
  }

  const jpeg = readJpegDimensions(bytes)
  if (jpeg) {
    return jpeg
  }

  const webp = readWebpDimensions(bytes)
  if (webp) {
    return webp
  }

  const bmp = readBmpDimensions(bytes)
  if (bmp) {
    return bmp
  }

  const tiff = readTiffDimensions(bytes)
  if (tiff) {
    return tiff
  }

  throw new Error('Could not decode image dimensions from the imported bytes.')
}

function getFileExtension(name: string) {
  const match = /\.([^.]+)$/.exec(name.trim())
  return match?.[1]?.toLowerCase() ?? null
}

function readPngDimensions(bytes: Uint8Array) {
  if (
    bytes.byteLength < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
  ) {
    return null
  }

  return {
    width: readUint32(bytes, 16, false),
    height: readUint32(bytes, 20, false),
  }
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = bytes[offset + 1]
    if (marker === undefined) {
      break
    }
    offset += 2

    while (bytes[offset] === 0xff) {
      offset += 1
    }

    if (marker === 0xd9 || marker === 0xda) {
      break
    }

    const segmentLength = readUint16(bytes, offset, false)
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      break
    }

    if (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        width: readUint16(bytes, offset + 5, false),
        height: readUint16(bytes, offset + 3, false),
      }
    }

    offset += segmentLength
  }

  return null
}

function readWebpDimensions(bytes: Uint8Array) {
  if (
    bytes.byteLength < 16
    || readAscii(bytes, 0, 4) !== 'RIFF'
    || readAscii(bytes, 8, 4) !== 'WEBP'
  ) {
    return null
  }

  const chunkType = readAscii(bytes, 12, 4)
  if (chunkType === 'VP8X' && bytes.byteLength >= 30) {
    return {
      width: 1 + readUint24(bytes, 24, true),
      height: 1 + readUint24(bytes, 27, true),
    }
  }

  if (chunkType === 'VP8L' && bytes.byteLength >= 25) {
    const bits = readUint32(bytes, 21, true)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  if (chunkType === 'VP8 ' && bytes.byteLength >= 30) {
    return {
      width: readUint16(bytes, 26, true) & 0x3fff,
      height: readUint16(bytes, 28, true) & 0x3fff,
    }
  }

  return null
}

function readBmpDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return null
  }

  return {
    width: Math.abs(readInt32(bytes, 18, true)),
    height: Math.abs(readInt32(bytes, 22, true)),
  }
}

function readTiffDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 8) {
    return null
  }

  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d
  if (!littleEndian && !bigEndian) {
    return null
  }

  const little = littleEndian
  const magic = readUint16(bytes, 2, little)
  if (magic !== 42) {
    return null
  }

  const ifdOffset = readUint32(bytes, 4, little)
  if (ifdOffset + 2 > bytes.byteLength) {
    return null
  }

  const entryCount = readUint16(bytes, ifdOffset, little)
  let width: number | null = null
  let height: number | null = null

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (entryOffset + 12 > bytes.byteLength) {
      break
    }

    const tag = readUint16(bytes, entryOffset, little)
    const type = readUint16(bytes, entryOffset + 2, little)
    const count = readUint32(bytes, entryOffset + 4, little)
    const valueOffset = entryOffset + 8
    const value = readTiffValue(bytes, valueOffset, type, count, little)

    if (tag === 256 && typeof value === 'number') {
      width = value
    }
    if (tag === 257 && typeof value === 'number') {
      height = value
    }
  }

  return width !== null && height !== null ? { width, height } : null
}

function readTiffValue(
  bytes: Uint8Array,
  valueOffset: number,
  type: number,
  count: number,
  littleEndian: boolean,
) {
  if (count !== 1) {
    return null
  }

  if (type === 3) {
    return readUint16(bytes, valueOffset, littleEndian)
  }

  if (type === 4) {
    return readUint32(bytes, valueOffset, littleEndian)
  }

  return null
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, littleEndian)
}

function readUint24(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  if (littleEndian) {
    return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  }

  return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, littleEndian)
}

function readInt32(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, littleEndian)
}
