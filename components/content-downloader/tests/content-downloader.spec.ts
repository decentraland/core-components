import { createInMemoryStorage, IContentStorageComponent } from '@dcl/catalyst-storage'
import { hashV1 } from '@dcl/hashing'
import { STOP_COMPONENT } from '@well-known-components/interfaces'
import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import { Readable } from 'stream'
import { createContentDownloaderComponent } from '../src/component'
import { InvalidContentHashError } from '../src/errors'
import { IContentDownloaderComponent } from '../src/types'

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

describe('when downloading content with the content-downloader component', () => {
  let server: http.Server
  let baseUrl: string
  let contentByHash: Map<string, Buffer>
  let requestCount: number
  let storage: IContentStorageComponent
  let targetFolder: string
  let component: IContentDownloaderComponent

  beforeEach(async () => {
    contentByHash = new Map()
    requestCount = 0
    server = http.createServer((req, res) => {
      const match = req.url?.match(/\/contents\/(.+)$/)
      const body = match && contentByHash.get(match[1])
      if (body) {
        requestCount++
        res.writeHead(200)
        res.end(body)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`
    storage = createInMemoryStorage()
    const metrics: any = { observe: jest.fn(), increment: jest.fn(), startTimer: jest.fn(() => ({ end: jest.fn() })) }
    const logs: any = {
      getLogger: () => ({ log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })
    }
    targetFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cd-test-'))
    component = await createContentDownloaderComponent({ logs, storage, metrics })
  })

  afterEach(async () => {
    await component[STOP_COMPONENT]!()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    jest.resetAllMocks()
  })

  describe('and the file is present on a server', () => {
    let hash: string
    let content: Buffer
    let servers: string[]

    beforeEach(async () => {
      content = Buffer.from('hello content downloader')
      hash = await hashV1(content)
      contentByHash.set(hash, content)
      servers = [baseUrl]
    })

    it('should store the downloaded file in storage keyed by its hash', async () => {
      await component.downloadFileWithRetries(hash, targetFolder, servers, 3, 0)

      const stored = await streamToBuffer(await (await storage.retrieve(hash))!.asStream())
      expect(stored).toEqual(content)
    })

    it('should hit the server only once for concurrent downloads of the same hash', async () => {
      await Promise.all([
        component.downloadFileWithRetries(hash, targetFolder, servers, 3, 0),
        component.downloadFileWithRetries(hash, targetFolder, servers, 3, 0)
      ])

      expect(requestCount).toBe(1)
    })
  })

  describe('and the hash is not a valid content address', () => {
    let invalidHash: string

    beforeEach(() => {
      invalidHash = '../../etc/passwd'
    })

    it('should reject with an InvalidContentHashError', async () => {
      await expect(component.downloadFileWithRetries(invalidHash, targetFolder, [baseUrl], 3, 0)).rejects.toThrow(
        InvalidContentHashError
      )
    })
  })

  describe('and the component is stopped', () => {
    it('should resolve its STOP_COMPONENT lifecycle hook', async () => {
      await expect(component[STOP_COMPONENT]!()).resolves.toBeUndefined()
    })
  })
})
