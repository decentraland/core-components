import fs from "fs"
import { unlink } from "node:fs/promises"

import { createAvlTree } from "../../src/avl-tree/avl-tree"
import { loadTree, saveTree } from "../../src/avl-tree/tree-io"
import { AvlTree } from "../../src/avl-tree/types"

const rowToValuesConverter = (row: string[]): { key: number; value: number } => ({
  key: parseInt(row[0]),
  value: parseInt(row[1]),
})

const valuesToRowConverter = (k: number, v: number): number[] => [k, v]

describe("when serializing and deserializing an AVL tree to disk", () => {
  describe("and saving a populated tree", () => {
    const file = "saved-tree.csv"
    let tree: AvlTree<number, number>

    beforeEach(() => {
      tree = createAvlTree<number, number>()
      tree.insert(1, 1)
      tree.insert(2, 2)
      tree.insert(3, 3)
      tree.insert(4, 4)
      tree.insert(5, 5)
      tree.insert(6, 6)
    })

    afterEach(async () => {
      if (fs.existsSync(file)) {
        await unlink(file)
      }
    })

    it("should create the target file with the serialized contents", async () => {
      await saveTree(tree, file, valuesToRowConverter)
      expect(fs.existsSync(file)).toBe(true)
    })
  })

  describe("and saving an empty tree", () => {
    const file = "empty-tree.csv"
    let tree: AvlTree<number, number>

    beforeEach(() => {
      tree = createAvlTree<number, number>()
    })

    afterEach(async () => {
      if (fs.existsSync(file)) {
        await unlink(file)
      }
    })

    it("should not create a file", async () => {
      await saveTree(tree, file, valuesToRowConverter)
      expect(fs.existsSync(file)).toBe(false)
    })
  })

  describe("and saving a tree whose writes exceed the write-stream high-water mark", () => {
    const file = "big-tree.csv"
    let tree: AvlTree<number, number>

    beforeEach(() => {
      tree = createAvlTree<number, number>()
      // Insert enough entries whose serialized line is large enough to
      // exceed the default write-stream high-water mark and exercise the
      // drain-wait path in saveTree.
      for (let i = 1; i <= 1000; i++) {
        tree.insert(i, i)
      }
    })

    afterEach(async () => {
      if (fs.existsSync(file)) {
        await unlink(file)
      }
    })

    it("should flush on backpressure and persist every entry", async () => {
      const padding = "x".repeat(64)
      await saveTree(tree, file, (k, v) => [k, v, padding])
      const lines = fs.readFileSync(file, "utf8").trim().split("\n")
      expect(lines).toHaveLength(1000)
    })
  })

  describe("and loading a serialized tree from disk", () => {
    const file = "tests/fixtures/serialized-tree.csv"
    let tree: AvlTree<number, number>

    beforeEach(async () => {
      tree = createAvlTree<number, number>()
      await loadTree(tree, file, rowToValuesConverter)
    })

    it("should populate the tree with every entry from the file", () => {
      expect(tree.size()).toBe(6)
    })

    it("should have the expected root key after balancing", () => {
      const root = tree.root()
      expect(root).not.toBeNull()
      expect(root!.key).toBe(4)
    })

    it("should have the expected left child of the root", () => {
      const root = tree.root()
      expect(root!.left).not.toBeNull()
      expect(root!.left!.key).toBe(2)
    })

    it("should have the expected right child of the root", () => {
      const root = tree.root()
      expect(root!.right).not.toBeNull()
      expect(root!.right!.key).toBe(5)
    })
  })
})
