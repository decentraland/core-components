import { BlockInfo, BlockRepository } from "../../src"

export const createMockBlockRepository = (
  currentBlock: number,
  blocks: Record<number, number>
): BlockRepository => {
  const findBlock = (block: number): Promise<BlockInfo | undefined> => {
    if (block > currentBlock) {
      return Promise.reject(new Error("Block after current block"))
    }

    if (block in blocks) {
      return Promise.resolve({
        block,
        timestamp: blocks[block],
      })
    }

    // Blocks in gaps inside the known range resolve to undefined so the
    // caller's "if (blockInfo)" defensive check exercises its fall-through path.
    return Promise.resolve(undefined)
  }

  return {
    currentBlock: () =>
      Promise.resolve({
        block: currentBlock,
        timestamp: blocks[currentBlock],
      }),
    findBlock: findBlock as (block: number) => Promise<BlockInfo>,
  }
}
