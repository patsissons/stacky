import type { editor } from 'monaco-editor'

export const OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontFamily: '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 13,
  lineHeight: 20,
  tabSize: 2,
  insertSpaces: true,
  scrollBeyondLastLine: false,
  renderWhitespace: 'boundary',
  automaticLayout: true,
  wordWrap: 'off',
  padding: { top: 10, bottom: 10 },
  quickSuggestions: { other: true, comments: false, strings: true },
  stickyScroll: { enabled: true },
  fixedOverflowWidgets: true,
}

/**
 * Compose files get schema completion; `.env` and other plain files only have Monaco's
 * word-based guesses, which pop up while a value is typed and turn the next Enter into
 * "accept suggestion" instead of a new line.
 */
const PLAIN_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: 'off',
}

export function editorOptions(language: string) {
  return language === 'yaml' ? OPTIONS : { ...OPTIONS, ...PLAIN_OPTIONS }
}
