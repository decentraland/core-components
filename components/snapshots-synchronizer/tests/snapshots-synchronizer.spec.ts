import { createInMemoryStorage, IContentStorageComponent } from '@dcl/catalyst-storage'
import { AuthLinkType } from '@dcl/schemas'
import { STOP_COMPONENT } from '@well-known-components/interfaces'
import { Readable } from 'stream'
import { createSnapshotsSynchronizerComponent } from '../src/component'
import { ISnapshotsSynchronizerComponent, SnapshotsSynchronizerComponents, SynchronizerOptions } from '../src/types'

const authChain = [{ type: AuthLinkType.SIGNER, payload: '0x3b21028719a4aca7ebee35b0157a6f1b0cf0d0c5', signature: '' }]

function deployment(entityId: string, entityTimestamp: number) {
  return { entityType: 'profile', entityId, entityTimestamp, authChain, pointers: ['0x1'] }
}

const baseOptions: SynchronizerOptions = {
  tmpDownloadFolder: '/tmp/snapshots-sync-test',
  requestMaxRetries: 3,
  requestRetryWaitTime: 0,
  pointerChangesWaitTime: 0,
  fromTimestamp: 0,
  bootstrapReconnection: { reconnectTime: 1000, reconnectRetryTimeExponent: 1.5, maxReconnectionTime: 3_600_000 },
  syncingReconnection: { reconnectTime: 1000, reconnectRetryTimeExponent: 1.2, maxReconnectionTime: 3_600_000 }
}

describe('createSnapshotsSynchronizerComponent', () => {
  let storage: IContentStorageComponent
  let components: SnapshotsSynchronizerComponents
  let component: ISnapshotsSynchronizerComponent

  beforeEach(async () => {
    storage = createInMemoryStorage()
    const metrics: any = { observe: jest.fn(), increment: jest.fn(), startTimer: jest.fn(() => ({ end: jest.fn() })) }
    const logs: any = {
      getLogger: () => ({ log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })
    }
    const contentDownloader: any = {
      [STOP_COMPONENT]: jest.fn(),
      // snapshot file is pre-seeded in storage by the test, so this is a no-op
      downloadFileWithRetries: jest.fn().mockResolvedValue(undefined),
      downloadEntityAndContentFiles: jest.fn().mockResolvedValue({})
    }
    components = {
      logs,
      metrics,
      fetcher: { fetch: jest.fn() } as any,
      storage,
      contentDownloader,
      deployer: { scheduleEntityDeployment: jest.fn(), onIdle: jest.fn(), prepareForDeploymentsIn: jest.fn() },
      snapshotStorage: { has: jest.fn().mockResolvedValue(false) },
      processedSnapshotStorage: {
        filterProcessedSnapshotsFrom: jest.fn().mockResolvedValue(new Set()),
        markSnapshotAsProcessed: jest.fn()
      }
    }
    component = await createSnapshotsSynchronizerComponent(components, baseOptions)
  })

  afterEach(async () => {
    await component[STOP_COMPONENT]!()
    jest.resetAllMocks()
  })

  describe('when streaming the deployments of a snapshot already present in storage', () => {
    const snapshotHash = 'bafkreitestsnapshot'
    const id1 = 'ba000000000000000000000000000000000000000000000000000000001'
    const id2 = 'ba000000000000000000000000000000000000000000000000000000002'

    beforeEach(async () => {
      const file = [JSON.stringify(deployment(id1, 1)), JSON.stringify(deployment(id2, 2))].join('\n')
      await storage.storeStream(snapshotHash, Readable.from([Buffer.from(file + '\n')]))
    })

    it('should yield each deployment annotated with the snapshot hash and servers', async () => {
      const yielded: any[] = []
      for await (const d of component.streamFromSnapshot(baseOptions, snapshotHash, new Set(['http://server.example.com']))) {
        yielded.push(d)
      }

      expect(yielded).toHaveLength(2)
      expect(yielded[0]).toMatchObject({ entityId: id1, snapshotHash, servers: ['http://server.example.com'] })
      expect(yielded[1]).toMatchObject({ entityId: id2, snapshotHash })
    })
  })

  describe('when the component is stopped', () => {
    it('should resolve STOP_COMPONENT', async () => {
      await expect(component[STOP_COMPONENT]!()).resolves.toBeUndefined()
    })
  })
})
