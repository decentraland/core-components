import { IFetchComponent } from '@well-known-components/interfaces'
import * as nodeFetch from 'node-fetch'

class HTTPResponseError extends Error {
  constructor(public response: nodeFetch.Response) {
    super(`HTTP Error Response: ${response.status} ${response.statusText} for URL ${response.url}`)
  }
}

const checkStatus = (response: nodeFetch.Response) => {
  if (response.ok) {
    // response.status >= 200 && response.status < 300
    return response
  }

  throw new HTTPResponseError(response)
}

export async function createFetchComponent() {
  const fetch: IFetchComponent = {
    async fetch(url: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit): Promise<nodeFetch.Response> {
      return nodeFetch.default(url, init).then((response: nodeFetch.Response) => checkStatus(response))
    }
  }

  return fetch
}
