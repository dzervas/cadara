import { EditorContext } from '@/hooks/editor-context'
import { createRequiredContextHook } from '@/hooks/create-required-context-hook'

export const useEditorState = createRequiredContextHook(EditorContext, 'useEditorState', 'EditorProvider')
