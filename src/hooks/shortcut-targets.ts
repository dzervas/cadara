export function isTextEditingTarget(target: EventTarget | null | undefined) {
  if (!target) {
    return false
  }

  const textTarget = target as {
    isContentEditable?: unknown
    tagName?: unknown
  }
  const tagName = typeof textTarget.tagName === 'string'
    ? textTarget.tagName.toLowerCase()
    : ''

  return isInstanceOfDomClass(target, 'HTMLInputElement')
    || isInstanceOfDomClass(target, 'HTMLTextAreaElement')
    || isInstanceOfDomClass(target, 'HTMLSelectElement')
    || isInstanceOfDomClass(target, 'HTMLElement') && textTarget.isContentEditable === true
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || textTarget.isContentEditable === true
}

function isInstanceOfDomClass(target: EventTarget, className: keyof typeof globalThis) {
  const constructor = globalThis[className]
  return typeof constructor === 'function' && target instanceof constructor
}
