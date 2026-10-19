// Monaco is bundled and self-hosted (no CDN), so the editor works on offline home labs.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { configureMonacoYaml } from 'monaco-yaml'
import YamlWorker from './yaml.worker.js?worker'
import { composeSchema, SERVICE_FILE_SUFFIX, serviceSchema } from './schema'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    return label === 'yaml' ? new YamlWorker() : new EditorWorker()
  },
}

loader.config({ monaco })

configureMonacoYaml(monaco, {
  enableSchemaRequest: false,
  validate: true,
  completion: true,
  hover: true,
  schemas: [
    {
      uri: 'https://stacky.lgtm.page/schema/compose-spec.json',
      fileMatch: [
        '**/compose.yaml',
        '**/compose.yml',
        '**/docker-compose.yaml',
        '**/docker-compose.yml',
      ],
      schema: composeSchema as never,
    },
    {
      uri: 'https://stacky.lgtm.page/schema/compose-service.json',
      fileMatch: [`**/*${SERVICE_FILE_SUFFIX}`],
      schema: serviceSchema as never,
    },
  ],
})

monaco.editor.defineTheme('stacky-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#14161f', 'editorGutter.background': '#14161f' },
})
monaco.editor.defineTheme('stacky-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#ffffff' },
})

export { monaco }
