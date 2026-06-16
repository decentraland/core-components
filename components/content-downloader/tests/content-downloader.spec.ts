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

describe('createContentDownloaderComponent', () => {
  let server: http.Server
  let baseUrl: string
  let contentByHash: Map<string, Buffer>
  let storage: IContentStorageComponent
  let metrics: any
  let logs: any
  let targetFolder: string
  let component: IContentDownloaderComponent

  beforeAll((done) => {
    contentByHash = new Map()
    server = http.createServer((req, res) => {
      const match = req.url?.match(/\/contents\/(.+)$/)
      const body = match && contentByHash.get(match[1])
      if (body) {
        res.writeHead(200)
        res.end(body)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as any).port}`
      done()
    })
  })

  afterAll((done) => {
    server.close(done)
  })

  beforeEach(async () => {
    storage = createInMemoryStorage()
    metrics = {
      observe: jest.fn(),
      increment: jest.fn(),
      startTimer: jest.fn(() => ({ end: jest.fn() }))
    }
    logs = { getLogger: () => ({ log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }
    targetFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cd-test-'))
    component = await createContentDownloaderComponent({ logs, storage, metrics })
  })

  afterEach(async () => {
    await component[STOP_COMPONENT]!()
    jest.resetAllMocks()
  })

  describe('when downloading a valid content file present on a server', () => {
    let hash: string
    let content: Buffer

    beforeEach(async () => {
      content = Buffer.from('hello content downloader')
      hash = await hashV1(content)
      contentByHash.set(hash, content)
    })

    it('should download it and store it in storage by hash', async () => {
      await component.downloadFileWithRetries(hash, targetFolder, [baseUrl], 3, 0)

      expect(await storage.exist(hash)).toBe(true)
      const stored = await streamToBuffer(await (await storage.retrieve(hash))!.asStream())
      expect(stored).toEqual(content)
    })

    it('should de-duplicate concurrent downloads of the same hash', async () => {
      const [a, b] = await Promise.all([
        component.downloadFileWithRetries(hash, targetFolder, [baseUrl], 3, 0),
        component.downloadFileWithRetries(hash, targetFolder, [baseUrl], 3, 0)
      ])
      expect(a).toEqual(b)
      expect(await storage.exist(hash)).toBe(true)
    })
  })

  describe('when the hash is not a valid content address', () => {
    it('should reject with InvalidContentHashError before touching storage', async () => {
      const existSpy = jest.spyOn(storage, 'exist')
      await expect(component.downloadFileWithRetries('../../etc/passwd', targetFolder, [baseUrl], 3, 0)).rejects.toThrow(
        InvalidContentHashError
      )
      expect(existSpy).not.toHaveBeenCalled()
    })
  })

  describe('when the component is stopped', () => {
    it('should resolve STOP_COMPONENT', async () => {
      await expect(component[STOP_COMPONENT]!()).resolves.toBeUndefined()
    })
  })
})
