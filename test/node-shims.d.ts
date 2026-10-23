// The Node APIs the browser test uses (fixtures and the CI flag). The project's
// types are the Workers runtime's; full Node types would clash with them.
declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean
  export function readFileSync(path: string | URL): Buffer
}

declare const process: { env: Record<string, string | undefined> }

interface ImportMeta {
  readonly url: string
}
