import { createCachingEthereumProvider, EthereumProvider } from "../src"

const createEthereumMock = (): EthereumProvider => ({
  getBlock: jest.fn().mockImplementation((block) => ({ timestamp: 10 * block })),
  getBlockNumber: jest.fn().mockReturnValue(9),
})

describe("caching-ethereum-provider", () => {
  it("getBlockNumber is never cached", async () => {
    const eth = createEthereumMock()
    const cachingEth = createCachingEthereumProvider(eth)

    expect(await cachingEth.getBlockNumber()).toBe(9)
    expect(await cachingEth.getBlockNumber()).toBe(9)
    expect(await cachingEth.getBlockNumber()).toBe(9)
    expect(await cachingEth.getBlockNumber()).toBe(9)

    expect(eth.getBlockNumber).toHaveBeenCalledTimes(4)
  })

  it("getBlock is cached for each block", async () => {
    const eth = createEthereumMock()
    const cachingEth = createCachingEthereumProvider(eth)

    expect(await cachingEth.getBlock(1)).toEqual({ timestamp: 10 })
    expect(await cachingEth.getBlock(1)).toEqual({ timestamp: 10 })
    expect(await cachingEth.getBlock(1)).toEqual({ timestamp: 10 })
    expect(await cachingEth.getBlock(1)).toEqual({ timestamp: 10 })
    expect(eth.getBlock).toHaveBeenCalledTimes(1)

    expect(await cachingEth.getBlock(2)).toEqual({ timestamp: 20 })
    expect(await cachingEth.getBlock(2)).toEqual({ timestamp: 20 })
    expect(eth.getBlock).toHaveBeenCalledTimes(2)

    expect(await cachingEth.getBlock(1)).toEqual({ timestamp: 10 })
    expect(await cachingEth.getBlock(2)).toEqual({ timestamp: 20 })
    expect(eth.getBlock).toHaveBeenCalledTimes(2)

    expect(await cachingEth.getBlock(3)).toEqual({ timestamp: 30 })
    expect(eth.getBlock).toHaveBeenCalledTimes(3)
  })
})
