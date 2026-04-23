import { createAvlTree } from "../../src/avl-tree/avl-tree"

describe("avl-tree", () => {
  describe("insert", () => {
    it("should return the size of the tree", () => {
      const tree = createAvlTree()
      tree.insert(1, 1)
      tree.insert(2, 2)
      tree.insert(3, 3)
      tree.insert(4, 4)
      tree.insert(5, 5)
      expect(tree.size()).toBe(5)
    })

    it("should ignore insert of duplicate key", () => {
      const tree = createAvlTree()
      tree.insert(1, 1)
      tree.insert(1, 1)
      expect(tree.size()).toBe(1)
    })

    /**
     *         c
     *        / \           _b_
     *       b   z         /   \
     *      / \     ->    a     c
     *     a   y         / \   / \
     *    / \           w   x y   z
     *   w   x
     */
    it("should correctly balance the left left case", () => {
      const tree = createAvlTree()
      tree.insert(3, 3)
      tree.insert(2, 2)
      tree.insert(1, 1)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(2)
    })

    /**
     *       c
     *      / \           _b_
     *     a   z         /   \
     *    / \     ->    a     c
     *   w   b         / \   / \
     *      / \       w   x y   z
     *     x   y
     */
    it("should correctly balance the left right case", () => {
      const tree = createAvlTree()
      tree.insert(3, 3)
      tree.insert(1, 1)
      tree.insert(2, 2)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(2)
    })

    /**
     *     a
     *    / \               _b_
     *   w   b             /   \
     *      / \     ->    a     c
     *     x   c         / \   / \
     *        / \       w   x y   z
     *       y   z
     */
    it("should correctly balance the right right case", () => {
      const tree = createAvlTree()
      tree.insert(1, 1)
      tree.insert(2, 2)
      tree.insert(3, 3)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(2)
    })

    /**
     *     a
     *    / \             _b_
     *   w   c           /   \
     *      / \   ->    a     c
     *     b   z       / \   / \
     *    / \         w   x y   z
     *   x   y
     */
    it("should correctly balance the right left case", () => {
      const tree = createAvlTree()
      tree.insert(1, 1)
      tree.insert(3, 3)
      tree.insert(2, 2)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(2)
    })
  })

  describe("remove", () => {
    it("should not change the size of a tree with no root", () => {
      const tree = createAvlTree()
      tree.remove(1)
      expect(tree.isEmpty()).toBeTruthy()
    })

    it("should delete a single key", () => {
      const tree = createAvlTree()
      tree.insert(1, 1)
      tree.remove(1)
      expect(tree.isEmpty()).toBeTruthy()
    })

    /**
     *       _4_                       _2_
     *      /   \                     /   \
     *     2     6  -> delete(6) ->  1     4
     *    / \                             /
     *   1   3                           3
     */
    it("should correctly balance the left left case", () => {
      const tree = createAvlTree()
      tree.insert(4, 4)
      tree.insert(2, 2)
      tree.insert(6, 6)
      tree.insert(3, 3)
      tree.insert(5, 5)
      tree.insert(1, 1)
      tree.insert(7, 7)
      tree.remove(7)
      tree.remove(5)
      tree.remove(6)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(2)
      expect(tree.root().value).toBe(2)
      expect(tree.root().left).toBeDefined()
      expect(tree.root().left.key).toBe(1)
      expect(tree.root().left.value).toBe(1)
      expect(tree.root().right).toBeDefined()
      expect(tree.root().right.key).toBe(4)
      expect(tree.root().right.value).toBe(4)
      expect(tree.root().right.left).toBeDefined()
      expect(tree.root().right.left.key).toBe(3)
      expect(tree.root().right.left.value).toBe(3)
    })

    /**
     *       _4_                       _6_
     *      /   \                     /   \
     *     2     6  -> delete(2) ->  4     7
     *          / \                   \
     *         5   7                  5
     */
    it("should correctly balance the right right case", () => {
      const tree = createAvlTree()
      tree.insert(4, 4)
      tree.insert(2, 2)
      tree.insert(6, 6)
      tree.insert(3, 3)
      tree.insert(5, 5)
      tree.insert(1, 1)
      tree.insert(7, 7)
      tree.remove(1)
      tree.remove(3)
      tree.remove(2)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(6)
      expect(tree.root().value).toBe(6)
      expect(tree.root().left).toBeDefined()
      expect(tree.root().left.key).toBe(4)
      expect(tree.root().left.value).toBe(4)
      expect(tree.root().left.right).toBeDefined()
      expect(tree.root().left.right.key).toBe(5)
      expect(tree.root().left.right.value).toBe(5)
      expect(tree.root().right).toBeDefined()
      expect(tree.root().right.key).toBe(7)
      expect(tree.root().right.value).toBe(7)
    })

    /**
     *       _6_                       _4_
     *      /   \                     /   \
     *     2     7  -> delete(8) ->  2     6
     *    / \     \                 / \   / \
     *   1   4     8               1   3 5   7
     *      / \
     *     3   5
     */
    it("should correctly balance the left right case", () => {
      const tree = createAvlTree()
      tree.insert(6, 6)
      tree.insert(2, 2)
      tree.insert(7, 7)
      tree.insert(1, 1)
      tree.insert(8, 8)
      tree.insert(4, 4)
      tree.insert(3, 3)
      tree.insert(5, 5)
      tree.remove(8)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(4)
      expect(tree.root().value).toBe(4)
      expect(tree.root().left).toBeDefined()
      expect(tree.root().left.key).toBe(2)
      expect(tree.root().left.value).toBe(2)
      expect(tree.root().left.left).toBeDefined()
      expect(tree.root().left.left.key).toBe(1)
      expect(tree.root().left.left.value).toBe(1)
      expect(tree.root().left.right).toBeDefined()
      expect(tree.root().left.right.key).toBe(3)
      expect(tree.root().left.right.value).toBe(3)
      expect(tree.root().right).toBeDefined()
      expect(tree.root().right.key).toBe(6)
      expect(tree.root().right.value).toBe(6)
      expect(tree.root().right.left).toBeDefined()
      expect(tree.root().right.left.key).toBe(5)
      expect(tree.root().right.left.value).toBe(5)
      expect(tree.root().right.right).toBeDefined()
      expect(tree.root().right.right.key).toBe(7)
      expect(tree.root().right.right.value).toBe(7)
    })

    /**
     *       _3_                       _5_
     *      /   \                     /   \
     *     2     7  -> delete(1) ->  3     7
     *    /     / \                 / \   / \
     *   1     5   8               2   4 6   8
     *        / \
     *       4   6
     */
    it("should correctly balance the right left case", () => {
      const tree = createAvlTree()
      tree.insert(3, 3)
      tree.insert(2, 2)
      tree.insert(7, 7)
      tree.insert(1, 1)
      tree.insert(8, 8)
      tree.insert(5, 5)
      tree.insert(4, 4)
      tree.insert(6, 6)
      tree.remove(1)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(5)
      expect(tree.root().value).toBe(5)
      expect(tree.root().left).toBeDefined()
      expect(tree.root().left.key).toBe(3)
      expect(tree.root().left.value).toBe(3)
      expect(tree.root().left.left).toBeDefined()
      expect(tree.root().left.left.key).toBe(2)
      expect(tree.root().left.left.value).toBe(2)
      expect(tree.root().left.right).toBeDefined()
      expect(tree.root().left.right.key).toBe(4)
      expect(tree.root().left.right.value).toBe(4)
      expect(tree.root().right).toBeDefined()
      expect(tree.root().right.key).toBe(7)
      expect(tree.root().right.value).toBe(7)
      expect(tree.root().right.left).toBeDefined()
      expect(tree.root().right.left.key).toBe(6)
      expect(tree.root().right.left.value).toBe(6)
      expect(tree.root().right.right).toBeDefined()
      expect(tree.root().right.right.key).toBe(8)
      expect(tree.root().right.right.value).toBe(8)
    })

    it("should take the right child if the left does not exist", () => {
      const tree = createAvlTree()
      tree.insert(1, 1)
      tree.insert(2, 2)
      tree.remove(1)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(2)
      expect(tree.root().value).toBe(2)
    })

    it("should take the left child if the right does not exist", () => {
      const tree = createAvlTree()
      tree.insert(2, 2)
      tree.insert(1, 1)
      tree.remove(2)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(1)
      expect(tree.root().value).toBe(1)
    })

    it("should get the right child if the node has 2 leaf children", () => {
      const tree = createAvlTree()
      tree.insert(2, 2)
      tree.insert(1, 1)
      tree.insert(3, 3)
      tree.remove(2)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(3)
      expect(tree.root().value).toBe(3)
    })

    it("should get the in-order successor if the node has both children", () => {
      const tree = createAvlTree()
      tree.insert(2, 2)
      tree.insert(1, 1)
      tree.insert(4, 4)
      tree.insert(3, 3)
      tree.insert(5, 5)
      tree.remove(2)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(3)
      expect(tree.root().value).toBe(3)
    })
  })

  describe("get", () => {
    it("should return the correct values", () => {
      const tree = createAvlTree()
      tree.insert(1, 4)
      tree.insert(2, 5)
      tree.insert(3, 6)
      expect(tree.get(1)).toBe(4)
      expect(tree.get(2)).toBe(5)
      expect(tree.get(3)).toBe(6)
    })

    it("should return null when the value doesn't exist", () => {
      const tree = createAvlTree()
      expect(tree.get(1)).toBeNull()
      expect(tree.get(2)).toBeNull()
      expect(tree.get(3)).toBeNull()
      tree.insert(1, 4)
      tree.insert(2, 5)
      tree.insert(3, 6)
      expect(tree.get(4)).toBeNull()
      expect(tree.get(5)).toBeNull()
      expect(tree.get(6)).toBeNull()
    })
  })

  describe("findByValue", () => {
    it("on empty tree", async () => {
      const tree = createAvlTree<number, number>()
      expect(tree.findByValue(25)).toBeNull()
    })

    it("when values exist", async () => {
      const tree = createAvlTree<number, string>()
      tree.insert(10, "100")
      expect(tree.findByValue("10")).toBeNull()
      expect(tree.findByValue("25")).toBeNull()
      expect(tree.findByValue("100")).toEqual("100")
    })

    it("with custom objects", async () => {
      type TestType = { a: number; b: number }
      const tree = createAvlTree<number, TestType>(
        (x, y) => y - x,
        (x, y) => y.b - x.b
      )
      tree.insert(10, { a: 10, b: 100 })
      tree.insert(20, { a: 20, b: 200 })
      tree.insert(30, { a: 30, b: 300 })
      expect(tree.findByValue({ b: 10 })).toBeNull()
      expect(tree.findByValue({ b: 100 })).toEqual({ a: 10, b: 100 })
      expect(tree.findByValue({ b: 200 })).toEqual({ a: 20, b: 200 })
      expect(tree.findByValue({ b: 250 })).toBeNull()
      expect(tree.findByValue({ b: 300 })).toEqual({ a: 30, b: 300 })
    })
  })

  describe("findEnclosingRange", () => {
    it("finds the correct range for empty tree", async () => {
      const tree = createAvlTree()
      expect(tree.findEnclosingRange(25)).toEqual({ min: undefined, max: undefined })
    })

    it("finds the correct range for single-element tree", async () => {
      const tree = createAvlTree()
      tree.insert(10, 10)
      expect(tree.findEnclosingRange(25)).toEqual({ min: 10, max: undefined })
      expect(tree.findEnclosingRange(5)).toEqual({ min: undefined, max: 10 })
    })

    it("finds the correct range", async () => {
      const tree = createAvlTree()
      tree.insert(10, 10)
      tree.insert(20, 20)
      tree.insert(30, 30)
      expect(tree.findEnclosingRange(5)).toEqual({ min: undefined, max: 10 })
      expect(tree.findEnclosingRange(10)).toEqual({ min: 10, max: 10 })
      expect(tree.findEnclosingRange(15)).toEqual({ min: 10, max: 20 })
      expect(tree.findEnclosingRange(20)).toEqual({ min: 20, max: 20 })
      expect(tree.findEnclosingRange(25)).toEqual({ min: 20, max: 30 })
      expect(tree.findEnclosingRange(30)).toEqual({ min: 30, max: 30 })
      expect(tree.findEnclosingRange(31)).toEqual({ min: 30, max: undefined })
    })
  })

  describe("size", () => {
    it("should return the size of the tree", () => {
      const tree = createAvlTree()
      expect(tree.size()).toBe(0)
      tree.insert(1, 1)
      expect(tree.size()).toBe(1)
      tree.insert(2, 2)
      expect(tree.size()).toBe(2)
      tree.insert(3, 3)
      expect(tree.size()).toBe(3)
      tree.insert(4, 4)
      expect(tree.size()).toBe(4)
      tree.insert(5, 5)
      expect(tree.size()).toBe(5)
      tree.insert(6, 6)
      expect(tree.size()).toBe(6)
      tree.insert(7, 7)
      expect(tree.size()).toBe(7)
      tree.insert(8, 8)
      expect(tree.size()).toBe(8)
      tree.insert(9, 9)
      expect(tree.size()).toBe(9)
      tree.insert(10, 10)
      expect(tree.size()).toBe(10)
    })
  })

  describe("isEmpty", () => {
    it("should return whether the tree is empty", () => {
      const tree = createAvlTree()
      expect(tree.isEmpty()).toBeTruthy()
      tree.insert(1, 1)
      expect(tree.isEmpty()).toBeFalsy()
      tree.remove(1)
      expect(tree.isEmpty()).toBeTruthy()
    })
  })

  describe("contains", () => {
    it("should return false if the tree is empty", () => {
      const tree = createAvlTree()
      expect(tree.contains(1)).toBeFalsy()
    })

    it("should return whether the tree contains a node", () => {
      const tree = createAvlTree()
      expect(tree.contains(1)).toBeFalsy()
      expect(tree.contains(2)).toBeFalsy()
      expect(tree.contains(3)).toBeFalsy()
      tree.insert(3, 30)
      tree.insert(1, 10)
      tree.insert(2, 20)
      expect(tree.contains(1)).toBeTruthy()
      expect(tree.contains(2)).toBeTruthy()
      expect(tree.contains(3)).toBeTruthy()
    })

    it("should return false when the expected parent has no children", () => {
      const tree = createAvlTree()
      tree.insert(2, 1)
      expect(tree.contains(1)).toBeFalsy()
      expect(tree.contains(3)).toBeFalsy()
    })
  })

  describe("Custom compare function", () => {
    it("should function correctly given a non-reverse customCompare", () => {
      const tree = createAvlTree<number, number>(
        (a, b) => b - a,
        (a, b) => b - a
      )
      tree.insert(2, 2)
      tree.insert(1, 1)
      tree.insert(3, 3)
      expect(tree.size()).toBe(3)
      tree.remove(3)
      expect(tree.size()).toBe(2)
      expect(tree.root()).toBeDefined()
      expect(tree.root().key).toBe(2)
      expect(tree.root().left).toBe(null)
      expect(tree.root().right).toBeDefined()
      expect(tree.root().right.key).toBe(1)
    })

    it("should work when the key is a complex object", () => {
      interface IComplexObject {
        innerKey: number
      }
      const tree = createAvlTree<IComplexObject, number>((a, b) => a.innerKey - b.innerKey)
      tree.insert({ innerKey: 1 }, 1)
      expect(tree.contains({ innerKey: 1 })).toBeTruthy()
      expect(tree.contains({ innerKey: 2 })).toBeFalsy()
    })
  })
})
