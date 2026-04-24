import { createCachingEthereumProvider, EthereumProvider } from "../src"

type MockEthereumProvider = {
  getBlock: jest.Mock
  getBlockNumber: jest.Mock
}

describe("when using the caching ethereum provider", () => {
  let eth: MockEthereumProvider
  let cachingEth: EthereumProvider

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe("and calling getBlockNumber multiple times", () => {
    beforeEach(() => {
      eth = {
        getBlock: jest.fn(),
        getBlockNumber: jest.fn().mockResolvedValue(9),
      }
      cachingEth = createCachingEthereumProvider(eth)
    })

    it("should delegate to the underlying provider on every call without caching", async () => {
      await cachingEth.getBlockNumber()
      await cachingEth.getBlockNumber()
      await cachingEth.getBlockNumber()
      await cachingEth.getBlockNumber()
      expect(eth.getBlockNumber).toHaveBeenCalledTimes(4)
    })
  })

  describe("and calling getBlock", () => {
    describe("and the same block is requested multiple times", () => {
      beforeEach(() => {
        eth = {
          getBlock: jest
            .fn()
            .mockImplementation((block: number) => Promise.resolve({ timestamp: 10 * block })),
          getBlockNumber: jest.fn(),
        }
        cachingEth = createCachingEthereumProvider(eth)
      })

      it("should serve subsequent requests from the cache without re-querying the provider", async () => {
        const first = await cachingEth.getBlock(1)
        const second = await cachingEth.getBlock(1)
        const third = await cachingEth.getBlock(1)

        expect(first).toEqual({ timestamp: 10 })
        expect(second).toEqual({ timestamp: 10 })
        expect(third).toEqual({ timestamp: 10 })
        expect(eth.getBlock).toHaveBeenCalledTimes(1)
      })
    })

    describe("and different blocks are requested", () => {
      beforeEach(() => {
        eth = {
          getBlock: jest
            .fn()
            .mockImplementation((block: number) => Promise.resolve({ timestamp: 10 * block })),
          getBlockNumber: jest.fn(),
        }
        cachingEth = createCachingEthereumProvider(eth)
      })

      it("should cache each block independently and query the provider once per unique block", async () => {
        expect(await cachingEth.getBlock(1)).toEqual({ timestamp: 10 })
        expect(await cachingEth.getBlock(2)).toEqual({ timestamp: 20 })
        expect(await cachingEth.getBlock(3)).toEqual({ timestamp: 30 })
        expect(await cachingEth.getBlock(1)).toEqual({ timestamp: 10 })
        expect(await cachingEth.getBlock(2)).toEqual({ timestamp: 20 })
        expect(await cachingEth.getBlock(3)).toEqual({ timestamp: 30 })

        expect(eth.getBlock).toHaveBeenCalledTimes(3)
      })
    })

    describe("and the underlying provider returns a falsy block", () => {
      beforeEach(() => {
        eth = {
          getBlock: jest.fn().mockResolvedValue(null),
          getBlockNumber: jest.fn(),
        }
        cachingEth = createCachingEthereumProvider(eth)
      })

      it("should reject with a 'Block could not be retrieved' error", async () => {
        await expect(cachingEth.getBlock(42)).rejects.toThrow("Block 42 could not be retrieved.")
      })
    })

    describe("and the underlying provider returns a block whose timestamp is 0", () => {
      beforeEach(() => {
        eth = {
          getBlock: jest.fn().mockResolvedValue({ timestamp: 0 }),
          getBlockNumber: jest.fn(),
        }
        cachingEth = createCachingEthereumProvider(eth)
      })

      it("should resolve to that block instead of treating the 0 timestamp as missing", async () => {
        await expect(cachingEth.getBlock(42)).resolves.toEqual({ timestamp: 0 })
      })
    })

    describe("and the underlying provider rejects", () => {
      let underlyingError: Error

      beforeEach(() => {
        underlyingError = new Error("RPC unavailable")
        eth = {
          getBlock: jest.fn().mockRejectedValue(underlyingError),
          getBlockNumber: jest.fn(),
        }
        cachingEth = createCachingEthereumProvider(eth)
      })

      it("should propagate the underlying provider error to the caller", async () => {
        await expect(cachingEth.getBlock(7)).rejects.toThrow("RPC unavailable")
      })
    })
  })
})
