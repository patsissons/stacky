import { describe, expect, it } from 'vitest'
import { editorOptions } from './editor-options'

describe('editorOptions', () => {
  it('keeps completion for compose files', () => {
    expect(editorOptions('yaml').quickSuggestions).toEqual({
      other: true,
      comments: false,
      strings: true,
    })
  })

  it('turns word guesses off for .env and other plain files', () => {
    const ini = editorOptions('ini')
    expect(ini.quickSuggestions).toBe(false)
    expect(ini.wordBasedSuggestions).toBe('off')
    expect(ini.suggestOnTriggerCharacters).toBe(false)
  })
})
