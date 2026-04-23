import { BlockSearch, createAvlBlockSearch, metricsDefinitions } from "../src"
import { createMockBlockRepository } from "./helpers/mocks"
import { range } from "./utils"
import { realBlocks, testingBlocks } from "./fixtures/blocks"
import { createTestMetricsComponent } from "@well-known-components/metrics"
import { createLogComponent } from "@well-known-components/logger"
import { ILoggerComponent, IMetricsComponent } from "@well-known-components/interfaces"

describe("block-indexer", () => {
  let blockSearch: BlockSearch
  let logs: ILoggerComponent
  let metrics: IMetricsComponent<keyof typeof metricsDefinitions>

  beforeEach(async () => {
    logs = await createLogComponent({})
    metrics = createTestMetricsComponent(metricsDefinitions)
    blockSearch = createAvlBlockSearch({
      logs,
      metrics,
      blockRepository: createMockBlockRepository(10, testingBlocks),
    })
  })

  it.each(range(0, 9))("works for timestamps before start %p", async (ts) => {
    await expect(blockSearch.findBlockForTimestamp(ts)).resolves.toBeUndefined()
  })

  it.each(range(10, 109))("works for timestamp %p", async (ts) => {
    await expect(blockSearch.findBlockForTimestamp(ts)).resolves.toEqual({
      block: Math.floor(ts / 10),
      timestamp: Math.floor(ts / 10) * 10,
    })
  })

  it.each(range(110, 120))("works for timestamps past current tip %p", async (ts) => {
    await expect(blockSearch.findBlockForTimestamp(ts)).resolves.toEqual({
      block: 10,
      timestamp: 100,
    })
  })

  it("works for successive searches", async () => {
    for (let ts = 50; ts < 60; ts++) {
      await expect(blockSearch.findBlockForTimestamp(ts)).resolves.toEqual({
        block: Math.floor(ts / 10),
        timestamp: Math.floor(ts / 10) * 10,
      })
    }
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
  ])("find block for timestamp %p", async (entityTs: number, block: number, blockTs: number) => {
    const realBlockSearch: BlockSearch = createAvlBlockSearch({
      logs,
      metrics,
      blockRepository: createMockBlockRepository(15597127, realBlocks),
    })

    const currentBlock = await realBlockSearch.findBlockForTimestamp(entityTs)
    expect(currentBlock.block).toBe(block)
    expect(currentBlock.timestamp).toBe(blockTs)
  })
})
