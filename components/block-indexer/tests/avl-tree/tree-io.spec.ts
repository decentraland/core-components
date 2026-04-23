import fs from "fs"
import { unlink } from "node:fs/promises"

import { createAvlTree } from "../../src/avl-tree/avl-tree"
import { loadTree, saveTree } from "../../src/avl-tree/tree-io"

const rowToValuesConverter = (row: any[]): { key: number; value: number } => ({
  key: parseInt(row[0]),
  value: parseInt(row[1]),
})

const valuesToRowConverter = (k: number, v: number): number[] => [k, v]

describe("Tree IO", () => {
  describe("saveTree", () => {
    const file = "file.csv"
    afterEach(async () => {
      await unlink(file)
    })

    it("should serialize the tree", async () => {
      const tree = createAvlTree<number, number>()
      tree.insert(1, 1)
      tree.insert(2, 2)
      tree.insert(3, 3)
      tree.insert(4, 4)
      tree.insert(5, 5)
      tree.insert(6, 6)

      await saveTree(tree, file, valuesToRowConverter)

      expect(fs.existsSync(file)).toBeTruthy()
    })
  })

  describe("loadTree", () => {
    const file = "tests/fixtures/serialized-tree.csv"
    it("should load a serialized tree", async () => {
      const tree = createAvlTree<number, number>()

      await loadTree(tree, file, rowToValuesConverter)

      expect(tree.size()).toBe(6)
      expect(tree.root().key).toBe(4)
      expect(tree.root().left.key).toBe(2)
      expect(tree.root().right.key).toBe(5)
    })
  })
})
