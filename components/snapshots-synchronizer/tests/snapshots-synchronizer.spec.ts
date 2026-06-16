import { createInMemoryStorage, IContentStorageComponent } from '@dcl/catalyst-storage'
import { AuthLinkType } from '@dcl/schemas'
import { STOP_COMPONENT } from '@well-known-components/interfaces'
import { Readable } from 'stream'
import { createSnapshotsSynchronizerComponent } from '../src/component'
import { ISnapshotsSynchronizerComponent, SnapshotsSynchronizerComponents, SynchronizerOptions } from '../src/types'

function snapshotLine(entityId: string, entityTimestamp: number): string {
  return JSON.stringify({
    entityType: 'profile',
    entityId,
    entityTimestamp,
    authChain: [{ type: AuthLinkType.SIGNER, payload: '0x3b21028719a4aca7ebee35b0157a6f1b0cf0d0c5', signature: '' }],
    pointers: ['0x1']
  })
}

describe('when synchronizing with the snapshots-synchronizer component', () => {
  let storage: IContentStorageComponent
  let options: SynchronizerOptions
  let component: ISnapshotsSynchronizerComponent

  beforeEach(async () => {
    storage = createInMemoryStorage()
    options = {
      tmpDownloadFolder: '/tmp/snapshots-sync-test',
      requestMaxRetries: 3,
      requestRetryWaitTime: 0,
      pointerChangesWaitTime: 0,
      fromTimestamp: 0,
      bootstrapReconnection: { reconnectTime: 1000, reconnectRetryTimeExponent: 1.5, maxReconnectionTime: 3_600_000 },
      syncingReconnection: { reconnectTime: 1000, reconnectRetryTimeExponent: 1.2, maxReconnectionTime: 3_600_000 }
    }
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
    const components: SnapshotsSynchronizerComponents = {
      logs,
      metrics,
      fetcher: { fetch: jest.fn() } as any,
      storage,
      contentDownloader,
      deployer: { scheduleEntityDeployment: jest.fn(), onIdle: jest.fn(), prepareForDeploymentsIn: jest.fn() } as any,
      snapshotStorage: { has: jest.fn().mockResolvedValue(false) } as any,
      processedSnapshotStorage: {
        filterProcessedSnapshotsFrom: jest.fn().mockResolvedValue(new Set()),
        markSnapshotAsProcessed: jest.fn()
      } as any
    }
    component = await createSnapshotsSynchronizerComponent(components, options)
  })

  afterEach(async () => {
    await component[STOP_COMPONENT]!()
    jest.resetAllMocks()
  })

  describe('and streaming the deployments of a snapshot already present in storage', () => {
    let snapshotHash: string
    let entityIds: string[]
    let servers: Set<string>

    beforeEach(async () => {
      snapshotHash = 'bafkreitestsnapshot'
      entityIds = [
        'ba000000000000000000000000000000000000000000000000000000001',
        'ba000000000000000000000000000000000000000000000000000000002'
      ]
      servers = new Set(['http://server.example.com'])
      const file = entityIds.map((id, index) => snapshotLine(id, index + 1)).join('\n') + '\n'
      await storage.storeStream(snapshotHash, Readable.from([Buffer.from(file)]))
    })

    it('should yield each deployment annotated with the snapshot hash and the servers it was found in', async () => {
      const yielded: Array<{ entityId: string; snapshotHash?: string; servers: string[] }> = []
      for await (const deployment of component.streamFromSnapshot(options, snapshotHash, servers)) {
        yielded.push({ entityId: deployment.entityId, snapshotHash: deployment.snapshotHash, servers: deployment.servers })
      }

      expect(yielded).toEqual([
        { entityId: entityIds[0], snapshotHash, servers: ['http://server.example.com'] },
        { entityId: entityIds[1], snapshotHash, servers: ['http://server.example.com'] }
      ])
    })
  })

  describe('and the component is stopped', () => {
    it('should resolve its STOP_COMPONENT lifecycle hook', async () => {
      await expect(component[STOP_COMPONENT]!()).resolves.toBeUndefined()
    })
  })
})
