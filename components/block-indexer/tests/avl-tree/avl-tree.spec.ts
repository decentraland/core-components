import { createAvlTree } from "../../src/avl-tree/avl-tree"
import { AvlTree } from "../../src/avl-tree/types"

describe("when using an AVL tree", () => {
  describe("and inserting nodes", () => {
    let tree: AvlTree<number, number>

    beforeEach(() => {
      tree = createAvlTree<number, number>()
    })

    describe("and inserting multiple unique keys", () => {
      beforeEach(() => {
        tree.insert(1, 1)
        tree.insert(2, 2)
        tree.insert(3, 3)
        tree.insert(4, 4)
        tree.insert(5, 5)
      })

      it("should report a size equal to the number of inserted keys", () => {
        expect(tree.size()).toBe(5)
      })
    })

    describe("and inserting a duplicate key", () => {
      beforeEach(() => {
        tree.insert(1, 1)
        tree.insert(1, 1)
      })

      it("should ignore the duplicate and keep the size at one", () => {
        expect(tree.size()).toBe(1)
      })
    })

    describe("and inserting keys that trigger a left-left rebalance", () => {
      beforeEach(() => {
        tree.insert(3, 3)
        tree.insert(2, 2)
        tree.insert(1, 1)
      })

      it("should rotate so the middle key becomes the root", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(2)
      })
    })

    describe("and inserting keys that trigger a left-right rebalance", () => {
      beforeEach(() => {
        tree.insert(3, 3)
        tree.insert(1, 1)
        tree.insert(2, 2)
      })

      it("should rotate so the middle key becomes the root", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(2)
      })
    })

    describe("and inserting keys that trigger a right-right rebalance", () => {
      beforeEach(() => {
        tree.insert(1, 1)
        tree.insert(2, 2)
        tree.insert(3, 3)
      })

      it("should rotate so the middle key becomes the root", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(2)
      })
    })

    describe("and inserting keys that trigger a right-left rebalance", () => {
      beforeEach(() => {
        tree.insert(1, 1)
        tree.insert(3, 3)
        tree.insert(2, 2)
      })

      it("should rotate so the middle key becomes the root", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(2)
      })
    })

    describe("and inserting a value whose custom comparator disagrees with the key comparator", () => {
      let inconsistentTree: AvlTree<number, { k: number }>

      beforeEach(() => {
        inconsistentTree = createAvlTree<number, { k: number }>(
          (a, b) => a - b,
          (a, b) => a.k! - b.k!
        )
        inconsistentTree.insert(1, { k: 1 })
      })

      it("should throw because key and value comparisons disagree", () => {
        expect(() => inconsistentTree.insert(2, { k: 0 })).toThrow(
          /Key comparison .* and value comparison .* must match/
        )
      })
    })
  })

  describe("and removing nodes", () => {
    let tree: AvlTree<number, number>

    beforeEach(() => {
      tree = createAvlTree<number, number>()
    })

    describe("and the tree is empty", () => {
      beforeEach(() => {
        tree.remove(1)
      })

      it("should remain empty", () => {
        expect(tree.isEmpty()).toBe(true)
      })
    })

    describe("and the tree has a single key and that key is removed", () => {
      beforeEach(() => {
        tree.insert(1, 1)
        tree.remove(1)
      })

      it("should leave the tree empty", () => {
        expect(tree.isEmpty()).toBe(true)
      })
    })

    describe("and a removal triggers a left-left rebalance", () => {
      beforeEach(() => {
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
      })

      it("should rebalance with the expected keys at each position of the subtree", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(2)
        expect(root!.value).toBe(2)
        expect(root!.left!.key).toBe(1)
        expect(root!.left!.value).toBe(1)
        expect(root!.right!.key).toBe(4)
        expect(root!.right!.value).toBe(4)
        expect(root!.right!.left!.key).toBe(3)
        expect(root!.right!.left!.value).toBe(3)
      })
    })

    describe("and a removal triggers a right-right rebalance", () => {
      beforeEach(() => {
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
      })

      it("should rebalance with the expected keys at each position of the subtree", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(6)
        expect(root!.value).toBe(6)
        expect(root!.left!.key).toBe(4)
        expect(root!.left!.value).toBe(4)
        expect(root!.left!.right!.key).toBe(5)
        expect(root!.left!.right!.value).toBe(5)
        expect(root!.right!.key).toBe(7)
        expect(root!.right!.value).toBe(7)
      })
    })

    describe("and a removal triggers a left-right rebalance", () => {
      beforeEach(() => {
        tree.insert(6, 6)
        tree.insert(2, 2)
        tree.insert(7, 7)
        tree.insert(1, 1)
        tree.insert(8, 8)
        tree.insert(4, 4)
        tree.insert(3, 3)
        tree.insert(5, 5)
        tree.remove(8)
      })

      it("should rebalance with the expected keys at each position of the subtree", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(4)
        expect(root!.value).toBe(4)
        expect(root!.left!.key).toBe(2)
        expect(root!.left!.value).toBe(2)
        expect(root!.left!.left!.key).toBe(1)
        expect(root!.left!.left!.value).toBe(1)
        expect(root!.left!.right!.key).toBe(3)
        expect(root!.left!.right!.value).toBe(3)
        expect(root!.right!.key).toBe(6)
        expect(root!.right!.value).toBe(6)
        expect(root!.right!.left!.key).toBe(5)
        expect(root!.right!.left!.value).toBe(5)
        expect(root!.right!.right!.key).toBe(7)
        expect(root!.right!.right!.value).toBe(7)
      })
    })

    describe("and a removal triggers a right-left rebalance", () => {
      beforeEach(() => {
        tree.insert(3, 3)
        tree.insert(2, 2)
        tree.insert(7, 7)
        tree.insert(1, 1)
        tree.insert(8, 8)
        tree.insert(5, 5)
        tree.insert(4, 4)
        tree.insert(6, 6)
        tree.remove(1)
      })

      it("should rebalance with the expected keys at each position of the subtree", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(5)
        expect(root!.value).toBe(5)
        expect(root!.left!.key).toBe(3)
        expect(root!.left!.value).toBe(3)
        expect(root!.left!.left!.key).toBe(2)
        expect(root!.left!.left!.value).toBe(2)
        expect(root!.left!.right!.key).toBe(4)
        expect(root!.left!.right!.value).toBe(4)
        expect(root!.right!.key).toBe(7)
        expect(root!.right!.value).toBe(7)
        expect(root!.right!.left!.key).toBe(6)
        expect(root!.right!.left!.value).toBe(6)
        expect(root!.right!.right!.key).toBe(8)
        expect(root!.right!.right!.value).toBe(8)
      })
    })

    describe("and removing a node that has only a right child", () => {
      beforeEach(() => {
        tree.insert(1, 1)
        tree.insert(2, 2)
        tree.remove(1)
      })

      it("should promote the right child as the new root", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(2)
        expect(root!.value).toBe(2)
      })
    })

    describe("and removing a node that has only a left child", () => {
      beforeEach(() => {
        tree.insert(2, 2)
        tree.insert(1, 1)
        tree.remove(2)
      })

      it("should promote the left child as the new root", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(1)
        expect(root!.value).toBe(1)
      })
    })

    describe("and removing a node that has two leaf children", () => {
      beforeEach(() => {
        tree.insert(2, 2)
        tree.insert(1, 1)
        tree.insert(3, 3)
        tree.remove(2)
      })

      it("should promote the right child in place of the removed node", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(3)
        expect(root!.value).toBe(3)
      })
    })

    describe("and removing a node that has two non-leaf children", () => {
      beforeEach(() => {
        tree.insert(2, 2)
        tree.insert(1, 1)
        tree.insert(4, 4)
        tree.insert(3, 3)
        tree.insert(5, 5)
        tree.remove(2)
      })

      it("should replace the removed node with its in-order successor", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(3)
        expect(root!.value).toBe(3)
      })
    })
  })

  describe("and getting a value by key", () => {
    let tree: AvlTree<number, number>

    describe("and the keys exist in the tree", () => {
      beforeEach(() => {
        tree = createAvlTree<number, number>()
        tree.insert(1, 4)
        tree.insert(2, 5)
        tree.insert(3, 6)
      })

      it("should return the value for a key that resolves via the left subtree", () => {
        expect(tree.get(1)).toBe(4)
      })

      it("should return the value for a key that resolves at the root", () => {
        expect(tree.get(2)).toBe(5)
      })

      it("should return the value for a key that resolves via the right subtree", () => {
        expect(tree.get(3)).toBe(6)
      })
    })

    describe("and the tree is empty", () => {
      beforeEach(() => {
        tree = createAvlTree<number, number>()
      })

      it("should return null for any key lookup", () => {
        expect(tree.get(1)).toBeNull()
      })
    })

    describe("and the key is absent from a populated tree", () => {
      beforeEach(() => {
        tree = createAvlTree<number, number>()
        tree.insert(1, 4)
        tree.insert(2, 5)
        tree.insert(3, 6)
      })

      it("should return null for a key immediately above the maximum", () => {
        expect(tree.get(4)).toBeNull()
      })

      it("should return null for a key further above the maximum", () => {
        expect(tree.get(5)).toBeNull()
      })

      it("should return null for a far-out-of-range key", () => {
        expect(tree.get(6)).toBeNull()
      })
    })
  })

  describe("and finding a node by value", () => {
    describe("and the tree is empty", () => {
      let tree: AvlTree<number, number>

      beforeEach(() => {
        tree = createAvlTree<number, number>()
      })

      it("should return null", () => {
        expect(tree.findByValue(25)).toBeNull()
      })
    })

    describe("and searching by a primitive value", () => {
      let tree: AvlTree<number, string>

      beforeEach(() => {
        tree = createAvlTree<number, string>()
        tree.insert(10, "100")
      })

      it("should return the stored value when it matches an existing entry", () => {
        expect(tree.findByValue("100")).toBe("100")
      })

      it("should return null when the value is lower than any stored entry", () => {
        expect(tree.findByValue("10")).toBeNull()
      })

      it("should return null when the value is higher than any stored entry", () => {
        expect(tree.findByValue("25")).toBeNull()
      })
    })

    describe("and searching by a custom object with a key-and-value comparator", () => {
      type TestValue = { a: number; b: number }
      let tree: AvlTree<number, TestValue>

      beforeEach(() => {
        tree = createAvlTree<number, TestValue>(
          (x, y) => y - x,
          (x, y) => y.b! - x.b!
        )
        tree.insert(10, { a: 10, b: 100 })
        tree.insert(20, { a: 20, b: 200 })
        tree.insert(30, { a: 30, b: 300 })
      })

      it("should return the matching object for the left subtree partial value", () => {
        expect(tree.findByValue({ b: 100 })).toEqual({ a: 10, b: 100 })
      })

      it("should return the matching object for a partial value at the root", () => {
        expect(tree.findByValue({ b: 200 })).toEqual({ a: 20, b: 200 })
      })

      it("should return the matching object for the right subtree partial value", () => {
        expect(tree.findByValue({ b: 300 })).toEqual({ a: 30, b: 300 })
      })

      it("should return null for a partial value below the stored range", () => {
        expect(tree.findByValue({ b: 10 })).toBeNull()
      })

      it("should return null for a partial value that falls in a gap between stored values", () => {
        expect(tree.findByValue({ b: 250 })).toBeNull()
      })
    })
  })

  describe("and finding the range enclosing a key", () => {
    describe("and the tree is empty", () => {
      let tree: AvlTree<number, number>

      beforeEach(() => {
        tree = createAvlTree<number, number>()
      })

      it("should return an undefined min and max", () => {
        expect(tree.findEnclosingRange(25)).toEqual({ min: undefined, max: undefined })
      })
    })

    describe("and the tree has a single element", () => {
      let tree: AvlTree<number, number>

      beforeEach(() => {
        tree = createAvlTree<number, number>()
        tree.insert(10, 10)
      })

      it("should return the element as min and an undefined max for a key above it", () => {
        expect(tree.findEnclosingRange(25)).toEqual({ min: 10, max: undefined })
      })

      it("should return an undefined min and the element as max for a key below it", () => {
        expect(tree.findEnclosingRange(5)).toEqual({ min: undefined, max: 10 })
      })
    })

    describe("and the tree has multiple elements", () => {
      let tree: AvlTree<number, number>

      beforeEach(() => {
        tree = createAvlTree<number, number>()
        tree.insert(10, 10)
        tree.insert(20, 20)
        tree.insert(30, 30)
      })

      it("should return an undefined min and the lowest key for a key below the range", () => {
        expect(tree.findEnclosingRange(5)).toEqual({ min: undefined, max: 10 })
      })

      it("should return the key itself when it matches the lowest stored key", () => {
        expect(tree.findEnclosingRange(10)).toEqual({ min: 10, max: 10 })
      })

      it("should return the adjacent keys for a key between the lowest and middle entries", () => {
        expect(tree.findEnclosingRange(15)).toEqual({ min: 10, max: 20 })
      })

      it("should return the key itself when it matches the middle stored key", () => {
        expect(tree.findEnclosingRange(20)).toEqual({ min: 20, max: 20 })
      })

      it("should return the adjacent keys for a key between the middle and highest entries", () => {
        expect(tree.findEnclosingRange(25)).toEqual({ min: 20, max: 30 })
      })

      it("should return the key itself when it matches the highest stored key", () => {
        expect(tree.findEnclosingRange(30)).toEqual({ min: 30, max: 30 })
      })

      it("should return the highest key as min and an undefined max for a key above the range", () => {
        expect(tree.findEnclosingRange(31)).toEqual({ min: 30, max: undefined })
      })
    })
  })

  describe("and observing the size", () => {
    let tree: AvlTree<number, number>

    beforeEach(() => {
      tree = createAvlTree<number, number>()
    })

    describe("and the tree has no entries", () => {
      it("should report a size of zero", () => {
        expect(tree.size()).toBe(0)
      })
    })

    describe("and entries are inserted one at a time", () => {
      it("should increment the size by one after each unique insert", () => {
        for (let i = 1; i <= 10; i++) {
          tree.insert(i, i)
          expect(tree.size()).toBe(i)
        }
      })
    })
  })

  describe("and checking emptiness", () => {
    let tree: AvlTree<number, number>

    beforeEach(() => {
      tree = createAvlTree<number, number>()
    })

    describe("and nothing has been inserted", () => {
      it("should report the tree as empty", () => {
        expect(tree.isEmpty()).toBe(true)
      })
    })

    describe("and a key has been inserted", () => {
      beforeEach(() => {
        tree.insert(1, 1)
      })

      it("should report the tree as not empty", () => {
        expect(tree.isEmpty()).toBe(false)
      })
    })

    describe("and an inserted key has been removed", () => {
      beforeEach(() => {
        tree.insert(1, 1)
        tree.remove(1)
      })

      it("should report the tree as empty again", () => {
        expect(tree.isEmpty()).toBe(true)
      })
    })
  })

  describe("and checking whether a key is contained", () => {
    let tree: AvlTree<number, number>

    beforeEach(() => {
      tree = createAvlTree<number, number>()
    })

    describe("and the tree is empty", () => {
      it("should return false", () => {
        expect(tree.contains(1)).toBe(false)
      })
    })

    describe("and the tree contains the target key", () => {
      beforeEach(() => {
        tree.insert(3, 30)
        tree.insert(1, 10)
        tree.insert(2, 20)
      })

      it("should return true for a key in the left subtree", () => {
        expect(tree.contains(1)).toBe(true)
      })

      it("should return true for a key at the root", () => {
        expect(tree.contains(2)).toBe(true)
      })

      it("should return true for a key in the right subtree", () => {
        expect(tree.contains(3)).toBe(true)
      })
    })

    describe("and the expected parent for a missing key has no children", () => {
      beforeEach(() => {
        tree.insert(2, 1)
      })

      it("should return false for a key that would be the left child", () => {
        expect(tree.contains(1)).toBe(false)
      })

      it("should return false for a key that would be the right child", () => {
        expect(tree.contains(3)).toBe(false)
      })
    })
  })

  describe("and the tree is configured with custom compare functions", () => {
    describe("and using a reversed numeric comparator", () => {
      let tree: AvlTree<number, number>

      beforeEach(() => {
        tree = createAvlTree<number, number>(
          (a, b) => b - a,
          (a, b) => b - a
        )
        tree.insert(2, 2)
        tree.insert(1, 1)
        tree.insert(3, 3)
        tree.remove(3)
      })

      it("should report the correct size after removal", () => {
        expect(tree.size()).toBe(2)
      })

      it("should arrange keys according to the reversed comparator", () => {
        const root = tree.root()
        expect(root).not.toBeNull()
        expect(root!.key).toBe(2)
        expect(root!.left).toBeNull()
        expect(root!.right).not.toBeNull()
        expect(root!.right!.key).toBe(1)
      })
    })

    describe("and the key is a complex object with a key-only comparator", () => {
      interface IComplexObject {
        innerKey: number
      }
      let tree: AvlTree<IComplexObject, number>

      beforeEach(() => {
        tree = createAvlTree<IComplexObject, number>((a, b) => a.innerKey - b.innerKey)
        tree.insert({ innerKey: 1 }, 1)
      })

      it("should report a previously inserted complex key as contained", () => {
        expect(tree.contains({ innerKey: 1 })).toBe(true)
      })

      it("should report an unknown complex key as not contained", () => {
        expect(tree.contains({ innerKey: 2 })).toBe(false)
      })
    })
  })
})
