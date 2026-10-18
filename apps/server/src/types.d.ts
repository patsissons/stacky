declare module 'composerize' {
  const composerize: (
    command: string,
    existing?: string | null,
    version?: string,
    indent?: number,
  ) => string
  export default composerize
}
