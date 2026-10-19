import { DiffEditor, Editor, type OnMount } from '@monaco-editor/react'
import { useTheme } from 'next-themes'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ValidationIssue } from '@stacky/shared'
import { monaco } from './monaco'

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
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
 * Monaco picks the line ending for new lines from the browser's platform, so on Windows an
 * empty .env would be saved with CRLF. Files that already use CRLF keep it; everything else
 * is written with LF, which is what docker compose and shells expect.
 */
function forceUnixLineEndings(model: monaco.editor.ITextModel | null) {
  if (!model || model.getValue().includes('\r\n')) return
  model.setEOL(monaco.editor.EndOfLineSequence.LF)
}

export interface CodeEditorProps {
  /** Model path; compose files match the schema by name, e.g. `stack/compose.yaml`. */
  path: string
  language: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  issues?: ValidationIssue[]
  onSave?: () => void
  onDeploy?: () => void
}

/** Monaco editor with stacky's theme, server validation markers and save/deploy shortcuts. */
export default function CodeEditor({
  path,
  language,
  value,
  onChange,
  readOnly,
  issues,
  onSave,
  onDeploy,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const handlers = useRef({ onSave, onDeploy })
  useLayoutEffect(() => {
    handlers.current = { onSave, onDeploy }
  })

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      handlers.current.onSave?.(),
    )
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD, () =>
      handlers.current.onDeploy?.(),
    )
    forceUnixLineEndings(editor.getModel())
    editor.onDidChangeModel(() => forceUnixLineEndings(editor.getModel()))
  }

  // Server-side (docker compose config) issues become editor markers.
  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (!model) return
    const markers = (issues ?? [])
      .filter((i) => i.source === 'compose' || i.source === 'yaml')
      .map((i) => {
        const line = Math.min(Math.max(i.line ?? 1, 1), model.getLineCount())
        return {
          severity:
            i.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: i.message,
          startLineNumber: line,
          startColumn: i.column ?? model.getLineFirstNonWhitespaceColumn(line) ?? 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
        }
      })
    monaco.editor.setModelMarkers(model, 'stacky', markers)
  }, [issues, value])

  return (
    <Editor
      path={path}
      language={language}
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={onMount}
      theme={resolvedTheme === 'light' ? 'stacky-light' : 'stacky-dark'}
      options={{ ...OPTIONS, readOnly }}
      loading={<div className="text-muted-foreground p-4 text-sm">Loading editor…</div>}
    />
  )
}

export function CodeDiff({
  original,
  modified,
  language,
}: {
  original: string
  modified: string
  language: string
}) {
  const { resolvedTheme } = useTheme()
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme={resolvedTheme === 'light' ? 'stacky-light' : 'stacky-dark'}
      options={{
        ...OPTIONS,
        readOnly: true,
        renderSideBySide: typeof window !== 'undefined' && window.innerWidth > 900,
        originalEditable: false,
      }}
      // let the widget dispose its own models; avoids "TextModel got disposed" on unmount
      keepCurrentOriginalModel
      keepCurrentModifiedModel
    />
  )
}
