import {
  BlockRepository,
  BlockSearch,
  createAvlBlockSearch,
  metricsDefinitions,
} from "../src"
import { createMockBlockRepository } from "./helpers/mocks"
import { range } from "./utils"
import { realBlocks, testingBlocks } from "./fixtures/blocks"
import { createTestMetricsComponent } from "@well-known-components/metrics"
import { createLogComponent } from "@well-known-components/logger"
import { ILoggerComponent, IMetricsComponent } from "@well-known-components/interfaces"

describe("when searching for a block by timestamp", () => {
  let logs: ILoggerComponent
  let metrics: IMetricsComponent<keyof typeof metricsDefinitions>
  let blockSearch: BlockSearch

  beforeEach(async () => {
    logs = await createLogComponent({})
    metrics = createTestMetricsComponent(metricsDefinitions)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe("and the chain has ten synthetic blocks each ten seconds apart", () => {
    beforeEach(() => {
      blockSearch = createAvlBlockSearch({
        logs,
        metrics,
        blockRepository: createMockBlockRepository(10, testingBlocks),
      })
    })

    describe("and the requested timestamp is before the first block", () => {
      it.each(range(0, 9))("should resolve to undefined for timestamp %p", async (ts) => {
        await expect(blockSearch.findBlockForTimestamp(ts)).resolves.toBeUndefined()
      })
    })

    describe("and the requested timestamp falls within the range of known blocks", () => {
      it.each(range(10, 109))(
        "should resolve to the block that brackets timestamp %p",
        async (ts) => {
          await expect(blockSearch.findBlockForTimestamp(ts)).resolves.toEqual({
            block: Math.floor(ts / 10),
            timestamp: Math.floor(ts / 10) * 10,
          })
        }
      )
    })

    describe("and the requested timestamp is past the current tip of the chain", () => {
      it.each(range(110, 120))(
        "should resolve to the current tip block for timestamp %p",
        async (ts) => {
          await expect(blockSearch.findBlockForTimestamp(ts)).resolves.toEqual({
            block: 10,
            timestamp: 100,
          })
        }
      )
    })

    describe("and consecutive timestamps in the same range are searched in sequence", () => {
      it("should return the matching block for each successive timestamp, reusing cached tree nodes", async () => {
        for (let ts = 50; ts < 60; ts++) {
          await expect(blockSearch.findBlockForTimestamp(ts)).resolves.toEqual({
            block: Math.floor(ts / 10),
            timestamp: Math.floor(ts / 10) * 10,
          })
        }
      })
    })
  })

  describe("and the chain is populated with real mainnet block timestamps", () => {
    beforeEach(() => {
      blockSearch = createAvlBlockSearch({
        logs,
        metrics,
        blockRepository: createMockBlockRepository(15597127, realBlocks),
      })
    })

    it.each([
      [1632225210, 13268972, 1632225209],
      [1612524220, 11795934, 1612524214],
      [1612524240, 11795935, 1612524239],
      [1632225210, 13268972, 1632225209],
      [1623203977, 12597525, 1623203966],
      [1623203978, 12597526, 1623203978],
      [1623203990, 12597526, 1623203978],
      [1623204004, 12597527, 1623204003],
      [1623204021, 12597528, 1623204005],
      [1623204030, 12597529, 1623204022],
    ])(
      "should resolve timestamp %p to block %p with actual timestamp %p",
      async (entityTs: number, block: number, blockTs: number) => {
        await expect(blockSearch.findBlockForTimestamp(entityTs)).resolves.toEqual({
          block,
          timestamp: blockTs,
        })
      }
    )
  })

  describe("and the block repository calls are counted", () => {
    let findBlock: jest.Mock
    let blockRepository: BlockRepository
    let blocks: Record<number, number>

    beforeEach(() => {
      // A 30-block chain where block N has timestamp N*10.
      blocks = {}
      for (let block = 1; block <= 30; block++) {
        blocks[block] = block * 10
      }
      findBlock = jest.fn((block: number) =>
        Promise.resolve(block in blocks ? { block, timestamp: blocks[block] } : undefined)
      )
      blockRepository = {
        currentBlock: jest.fn().mockResolvedValue({ block: 30, timestamp: 300 }),
        findBlock: findBlock as BlockRepository["findBlock"],
      }
    })

    describe("and the same timestamp is looked up twice within the cache capacity", () => {
      beforeEach(() => {
        blockSearch = createAvlBlockSearch({ logs, metrics, blockRepository })
      })

      it("should serve the second lookup from the cache without querying the repository again", async () => {
        await blockSearch.findBlockForTimestamp(50)
        findBlock.mockClear()

        await blockSearch.findBlockForTimestamp(50)

        expect(findBlock).not.toHaveBeenCalled()
      })
    })

    describe("and more distinct blocks are looked up than the configured cache maximum", () => {
      let overflowTimestamps: number[]

      beforeEach(() => {
        overflowTimestamps = [290, 250, 210, 170, 130]
        blockSearch = createAvlBlockSearch({ logs, metrics, blockRepository }, { maxCachedBlocks: 2 })
      })

      it("should evict the oldest cached blocks and refetch them on a later lookup instead of growing without bound", async () => {
        // Prime the cache with an early block (timestamp 50 -> block 5).
        await blockSearch.findBlockForTimestamp(50)
        // Look up several other timestamps to push past the 2-entry cap.
        for (const ts of overflowTimestamps) {
          await blockSearch.findBlockForTimestamp(ts)
        }
        findBlock.mockClear()

        await blockSearch.findBlockForTimestamp(50)

        expect(findBlock).toHaveBeenCalledWith(5)
      })
    })
  })

  describe("and the underlying block repository rejects", () => {
    let failingRepository: BlockRepository
    let rpcError: Error

    beforeEach(() => {
      rpcError = new Error("RPC unavailable")
      failingRepository = {
        currentBlock: jest.fn().mockRejectedValue(rpcError),
        findBlock: jest.fn().mockRejectedValue(rpcError),
      }
      blockSearch = createAvlBlockSearch({
        logs,
        metrics,
        blockRepository: failingRepository,
      })
    })

    it("should propagate the underlying repository error to the caller", async () => {
      await expect(blockSearch.findBlockForTimestamp(1000)).rejects.toThrow("RPC unavailable")
    })
  })
})
