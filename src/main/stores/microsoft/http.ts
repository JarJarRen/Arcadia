/**
 * The slice of `fetch` the Microsoft modules use.
 *
 * Narrower than `fetch` on purpose, and the same trick `steam/webApi.ts`
 * already plays: a test supplies four fields rather than a whole Response.
 * Unlike Steam's, this one needs POST with headers and a body, so the init
 * object is part of the shape.
 */
export type HttpFn = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  }
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export const defaultHttp: HttpFn = (url, init) =>
  globalThis.fetch(url, init as RequestInit) as unknown as ReturnType<HttpFn>
