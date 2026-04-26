import { test } from 'bun:test'

import {
  buildImportFilePickerConfiguration,
  showOpenImportFilePicker,
} from '@/lib/import-file-picker'

test('src/lib/import-file-picker.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const configuration = buildImportFilePickerConfiguration([
    { extension: 'png', mediaType: 'image/png' },
    { extension: '.jpg', mediaType: 'image/jpeg' },
    { extension: 'png', mediaType: 'image/png' },
  ])

  assert(
    configuration.openPickerOptions.types[0]?.accept['image/png']?.includes('.png')
      && configuration.openPickerOptions.types[0]?.accept['image/jpeg']?.includes('.jpg'),
    'Import picker configuration should group extensions under MIME types for the native picker.',
  )
  assert(
    configuration.inputAccept.includes('image/png')
      && configuration.inputAccept.includes('.png')
      && configuration.inputAccept.includes('.jpg'),
    'Import picker configuration should build an input accept string from extensions and MIME types.',
  )

  const pngFile = new File(['png'], 'reference.png', { type: 'image/png' })
  const pickerResult = await showOpenImportFilePicker({
    acceptedFileTypes: [{ extension: 'png', mediaType: 'image/png' }],
    environment: {
      isSecureContext: true,
      async showOpenFilePicker(options) {
        assert(
          options.types[0]?.accept['image/png']?.includes('.png'),
          'Native import picker should receive the aggregated accept map.',
        )
        return [{
          name: 'reference.png',
          async getFile() {
            return pngFile
          },
          async createWritable() {
            throw new Error('Not used in import picker tests.')
          },
        }]
      },
    },
  })
  assert(pickerResult.ok && pickerResult.file === pngFile, 'Native import picker should resolve the selected file handle to a File object.')

  type ChangeHandler = () => void

  let changeHandler: ChangeHandler | null = null
  const fallbackFile = new File(['jpg'], 'reference.jpg', { type: 'image/jpeg' })
  const fallbackResult = await showOpenImportFilePicker({
    acceptedFileTypes: [{ extension: 'jpg', mediaType: 'image/jpeg' }],
    environment: {
      isSecureContext: true,
      document: {
        body: {
          appendChild() {},
        },
        createElement() {
          const input = {
            type: '',
            accept: '',
            multiple: false,
            style: { display: '' },
            files: [fallbackFile],
            addEventListener(event: string, handler: ChangeHandler) {
              if (event === 'change') {
                changeHandler = handler
              }
            },
            removeEventListener() {},
            remove() {},
            click() {
              changeHandler?.()
            },
          }

          return input as unknown as HTMLInputElement
        },
      } as Document,
    },
  })

  assert(fallbackResult.ok && fallbackResult.file === fallbackFile, 'Fallback import picker should resolve the selected input file when the native picker is unavailable.')
})
