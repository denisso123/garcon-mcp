// The two Node APIs the browser test reads fixtures with. The project's
// types are the Workers runtime's; full Node types would clash with them.
declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean
  export function readFileSync(path: string | URL): Buffer
}

interface ImportMeta {
  readonly url: string
}
