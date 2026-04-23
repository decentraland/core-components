import {
  BlockRepository,
  createBlockRepository,
  EthereumProvider,
  metricsDefinitions,
} from "../src"
import { createTestMetricsComponent } from "@well-known-components/metrics"
import { createLogComponent } from "@well-known-components/logger"
import { ILoggerComponent, IMetricsComponent } from "@well-known-components/interfaces"

describe("when using the block repository", () => {
  let logs: ILoggerComponent
  let metrics: IMetricsComponent<keyof typeof metricsDefinitions>
  let ethereumProvider: EthereumProvider
  let blockRepository: BlockRepository

  beforeEach(async () => {
    logs = await createLogComponent({})
    metrics = createTestMetricsComponent(metricsDefinitions)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe("and calling currentBlock", () => {
    describe("and the provider returns a block with a valid timestamp", () => {
      beforeEach(() => {
        ethereumProvider = {
          getBlockNumber: jest.fn().mockResolvedValue(1000),
          getBlock: jest.fn().mockResolvedValue({ timestamp: 1500 }),
        }
        blockRepository = createBlockRepository({ logs, metrics, ethereumProvider })
      })

      it("should resolve to the current block number and its timestamp", async () => {
        await expect(blockRepository.currentBlock()).resolves.toEqual({
          block: 1000,
          timestamp: 1500,
        })
      })
    })

    describe("and the provider's getBlockNumber rejects", () => {
      let rpcError: Error

      beforeEach(() => {
        rpcError = new Error("RPC timeout")
        ethereumProvider = {
          getBlockNumber: jest.fn().mockRejectedValue(rpcError),
          getBlock: jest.fn(),
        }
        blockRepository = createBlockRepository({ logs, metrics, ethereumProvider })
      })

      it("should reject with the underlying RPC error", async () => {
        await expect(blockRepository.currentBlock()).rejects.toThrow("RPC timeout")
      })
    })

    describe("and the provider returns a block with a falsy timestamp", () => {
      beforeEach(() => {
        ethereumProvider = {
          getBlockNumber: jest.fn().mockResolvedValue(500),
          getBlock: jest.fn().mockResolvedValue({ timestamp: 0 }),
        }
        blockRepository = createBlockRepository({ logs, metrics, ethereumProvider })
      })

      it("should reject with a 'Block could not be retrieved' error", async () => {
        await expect(blockRepository.currentBlock()).rejects.toThrow(
          "Block 500 could not be retrieved."
        )
      })
    })
  })

  describe("and calling findBlock", () => {
    describe("and the block exists with a numeric timestamp", () => {
      beforeEach(() => {
        ethereumProvider = {
          getBlockNumber: jest.fn(),
          getBlock: jest.fn().mockResolvedValue({ timestamp: 13268653 }),
        }
        blockRepository = createBlockRepository({ logs, metrics, ethereumProvider })
      })

      it("should resolve to the block number and its timestamp", async () => {
        await expect(blockRepository.findBlock(13268153)).resolves.toEqual({
          block: 13268153,
          timestamp: 13268653,
        })
      })
    })

    describe("and the block exists with a string timestamp", () => {
      beforeEach(() => {
        ethereumProvider = {
          getBlockNumber: jest.fn(),
          getBlock: jest.fn().mockResolvedValue({ timestamp: "1500" }),
        }
        blockRepository = createBlockRepository({ logs, metrics, ethereumProvider })
      })

      it("should coerce the string timestamp to a number in the returned block", async () => {
        await expect(blockRepository.findBlock(100)).resolves.toEqual({
          block: 100,
          timestamp: 1500,
        })
      })
    })

    describe("and the provider's getBlock rejects", () => {
      let rpcError: Error

      beforeEach(() => {
        rpcError = new Error("network error")
        ethereumProvider = {
          getBlockNumber: jest.fn(),
          getBlock: jest.fn().mockRejectedValue(rpcError),
        }
        blockRepository = createBlockRepository({ logs, metrics, ethereumProvider })
      })

      it("should reject with the underlying RPC error", async () => {
        await expect(blockRepository.findBlock(42)).rejects.toThrow("network error")
      })
    })

    describe("and the provider returns a block with a falsy timestamp", () => {
      beforeEach(() => {
        ethereumProvider = {
          getBlockNumber: jest.fn(),
          getBlock: jest.fn().mockResolvedValue({ timestamp: 0 }),
        }
        blockRepository = createBlockRepository({ logs, metrics, ethereumProvider })
      })

      it("should reject with a 'Block could not be retrieved' error", async () => {
        await expect(blockRepository.findBlock(42)).rejects.toThrow(
          "Block 42 could not be retrieved."
        )
      })
    })
  })
})
