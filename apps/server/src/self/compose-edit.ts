import { isMap, isScalar, parseDocument } from 'yaml'
import { composeTags } from '../stacks/compose-file'

/**
 * Changes one service's `image:` with a targeted edit of the YAML document:
 * comments, ordering, anchors and formatting elsewhere are untouched.
 */
export function setServiceImage(text: string, service: string, image: string): string {
  const doc = parseDocument(text, { customTags: composeTags })
  if (doc.errors.length) throw new Error(`cannot edit compose file: ${doc.errors[0]!.message}`)
  const node = doc.getIn(['services', service], true)
  if (!isMap(node)) throw new Error(`service "${service}" not found in compose file`)
  const current = node.get('image', true)
  if (isScalar(current)) current.value = image
  else node.set('image', image)
  return doc.toString({ lineWidth: 0 })
}
