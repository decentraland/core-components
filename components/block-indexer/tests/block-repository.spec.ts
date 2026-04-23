import { createBlockRepository, metricsDefinitions } from "../src"
import { EthereumProvider } from "../src"
import { createTestMetricsComponent } from "@well-known-components/metrics"
import { createLogComponent } from "@well-known-components/logger"
import { ILoggerComponent, IMetricsComponent } from "@well-known-components/interfaces"

const createEthereumMock = (currentBlock: number): EthereumProvider => ({
  getBlock(block: number): Promise<{ timestamp: string | number }> {
    return Promise.resolve({ timestamp: block + 500 })
  },
  getBlockNumber(): Promise<number> {
    return Promise.resolve(currentBlock)
  },
})

describe("block-repository", () => {
  let logs: ILoggerComponent
  let metrics: IMetricsComponent<keyof typeof metricsDefinitions>

  beforeEach(async () => {
    logs = await createLogComponent({})
    metrics = createTestMetricsComponent(metricsDefinitions)
  })

  it("currentBlock", async () => {
    const blockRepository = createBlockRepository({
      logs,
      metrics,
      ethereumProvider: createEthereumMock(1000),
    })

    const currentBlock = await blockRepository.currentBlock()

    expect(currentBlock.block).toBe(1000)
    expect(currentBlock.timestamp).toBe(1500)
  })

  it("currentBlock 2", async () => {
    const blockRepository = createBlockRepository({
      logs,
      metrics,
      ethereumProvider: createEthereumMock(13268200),
    })

    const foundBlock = await blockRepository.findBlock(13268153)

    expect(foundBlock.block).toBe(13268153)
    expect(foundBlock.timestamp).toBe(13268653)
  })
})
