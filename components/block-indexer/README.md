# Block Indexer

[![Coverage Status](https://coveralls.io/repos/github/decentraland/block-indexer/badge.svg?branch=main)](https://coveralls.io/github/decentraland/block-indexer?branch=main)

A component to find the block in the blockchain that was the tip of the blockchain at a given timestamp.

## Installation 

`npm i @dcl/block-indexer`

## Usage

```ts
import { createBlockSearch } from "./block-search"
import { createBlockRepository } from "./block-repository"
import { createCachingEthereumProvider } from "./caching-ethereum-provider"

it("should find the block for given timestamp", async function () {
  const ethereumProvider = createCachingEthereumProvider(
    new Web3("https://rpc.decentraland.org/mainnet?project=block-indexer").eth
  )
  const blockSearch = createBlockSearch(createBlockRepository(ethereumProvider))
  expect(await blockSearch.findBlockForTimestamp(1612524240)).toEqual({ block: 11795935, timestamp: 1612524239 })
}, 30_000)
```
