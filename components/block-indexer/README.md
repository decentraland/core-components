# @dcl/block-indexer

Find the block that was the tip of the chain at a given timestamp.

## Installation

`npm i @dcl/block-indexer`

## Usage

```ts
import {
  createAvlBlockSearch,
  createBlockRepository,
  createCachingEthereumProvider
} from "@dcl/block-indexer"

const ethereumProvider = createCachingEthereumProvider(
  new Web3("https://rpc.decentraland.org/mainnet?project=block-indexer").eth
)
const blockRepository = createBlockRepository({ logs, metrics, ethereumProvider })
const blockSearch = createAvlBlockSearch({ logs, metrics, blockRepository })

const block = await blockSearch.findBlockForTimestamp(1612524240)
// { block: 11795935, timestamp: 1612524239 }
```
