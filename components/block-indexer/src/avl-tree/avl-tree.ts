import { Node } from './node'
import { AvlTree, CompareFunction, PartialCompareFunction, Range } from './types'

/**
 * Represents how balanced a node's left and right children are.
 */
const enum BalanceState {
  /** Right child's height is 2+ greater than left child's height */
  UNBALANCED_RIGHT,
  /** Right child's height is 1 greater than left child's height */
  SLIGHTLY_UNBALANCED_RIGHT,
  /** Left and right children have the same height */
  BALANCED,
  /** Left child's height is 1 greater than right child's height */
  SLIGHTLY_UNBALANCED_LEFT,
  /** Left child's height is 2+ greater than right child's height */
  UNBALANCED_LEFT
}

export const createAvlTree = <K, V>(
  compare?: CompareFunction<K>,
  compareByValue?: PartialCompareFunction<V>
): AvlTree<K, V> => {
  /**
   * Gets the size of the tree.
   */
  let _size: number = 0

  let _root: Node<K, V> | null = null

  /**
   * Compares two keys with each other.
   * @param a The first key to compare.
   * @param b The second key to compare.
   * @return -1, 0 or 1 if a < b, a == b or a > b respectively.
   */
  const _defaultCompare = (a: K, b: K): number => {
    if (a > b) {
      return 1
    }
    if (a < b) {
      return -1
    }
    return 0
  }

  /**
   * Compares two keys with each other.
   * @param a The first key to compare.
   * @param b The second key to compare.
   * @return -1, 0 or 1 if a < b, a == b or a > b respectively.
   */
  const _defaultCompareByValue = (a: Partial<V>, b: Partial<V>): number => {
    if (a > b) {
      return 1
    }
    if (a < b) {
      return -1
    }
    return 0
  }

  const _compare: CompareFunction<K> = compare ? compare : _defaultCompare
  const _compareByValue: PartialCompareFunction<V> = compareByValue ? compareByValue : _defaultCompareByValue

  /**
   * Inserts a new node with a specific key into the tree.
   * @param key The key being inserted.
   * @param value The value being inserted.
   */
  function insert(key: K, value: V): void {
    _root = _insert(key, value, _root)
    _size++
  }

  /**
   * Inserts a new node with a specific key into the tree.
   * @param key The key being inserted.
   * @param value The value to store under the key
   * @param root The root of the tree to insert in.
   * @return The new tree root.
   */
  function _insert(key: K, value: V, root: Node<K, V> | null): Node<K, V> {
    if (root === null) {
      return new Node(key, value)
    }

    const keyComparison = _compare(key, root.key)
    const valueComparison = _compareByValue(value, root.value)
    if (Math.sign(valueComparison) !== Math.sign(keyComparison)) {
      throw Error(
        `Key comparison (${keyComparison} and value comparison (${valueComparison}) must match results. Key: ${key}, value: ${JSON.stringify(
          value
        )} against node's key: ${root.key} and value: ${JSON.stringify(root.value)}`
      )
    }
    if (keyComparison < 0) {
      root.left = _insert(key, value, root.left)
    } else if (keyComparison > 0) {
      root.right = _insert(key, value, root.right)
    } else {
      // It's a duplicate so insertion failed, decrement size to make up for it
      _size--
      return root
    }

    // Update height and rebalance tree
    root.height = Math.max(root.leftHeight, root.rightHeight) + 1
    const balanceState = _getBalanceState(root)

    if (balanceState === BalanceState.UNBALANCED_LEFT) {
      if (_compare(key, (<Node<K, V>>root.left).key) < 0) {
        // left-left case
        root = root.rotateRight()
      } else {
        // left-right case
        root.left = (<Node<K, V>>root.left).rotateLeft()
        return root.rotateRight()
      }
    }

    if (balanceState === BalanceState.UNBALANCED_RIGHT) {
      if (_compare(key, (<Node<K, V>>root.right).key) > 0) {
        // right-right case
        root = root.rotateLeft()
      } else {
        // right-left case
        root.right = (<Node<K, V>>root.right).rotateRight()
        return root.rotateLeft()
      }
    }

    return root
  }

  /**
   * Removes a node with a specific key from the tree.
   * @param key The key being removed.
   */
  function remove(key: K): void {
    _root = _remove(key, _root)
    _size--
  }

  /**
   * Removes a node with a specific key from the tree.
   * @param key The key being removed.
   * @param root The root of the tree to remove from.
   * @return The new tree root.
   */
  function _remove(key: K, root: Node<K, V> | null): Node<K, V> | null {
    // Perform regular BST deletion
    if (root === null) {
      _size++
      return root
    }

    if (_compare(key, root.key) < 0) {
      // The key to be removed is in the left subtree
      root.left = _remove(key, root.left)
    } else if (_compare(key, root.key) > 0) {
      // The key to be removed is in the right subtree
      root.right = _remove(key, root.right)
    } else {
      // root is the node to be removed
      if (!root.left && !root.right) {
        root = null
      } else if (!root.left && root.right) {
        root = root.right
      } else if (root.left && !root.right) {
        root = root.left
      } else {
        // Node has 2 children, get the in-order successor
        const inOrderSuccessor = _minValueNode(<Node<K, V>>root.right)
        root.key = inOrderSuccessor.key
        root.value = inOrderSuccessor.value
        root.right = _remove(inOrderSuccessor.key, root.right)
      }
    }

    if (root === null) {
      return root
    }

    // Update height and rebalance tree
    root.height = Math.max(root.leftHeight, root.rightHeight) + 1
    const balanceState = _getBalanceState(root)

    if (balanceState === BalanceState.UNBALANCED_LEFT) {
      // left-left case
      if (
        _getBalanceState(<Node<K, V>>root.left) === BalanceState.BALANCED ||
        _getBalanceState(<Node<K, V>>root.left) === BalanceState.SLIGHTLY_UNBALANCED_LEFT
      ) {
        return root.rotateRight()
      }
      // left-right case
      // _getBalanceState(root.left) === BalanceState.SLIGHTLY_UNBALANCED_RIGHT
      root.left = (<Node<K, V>>root.left).rotateLeft()
      return root.rotateRight()
    }

    if (balanceState === BalanceState.UNBALANCED_RIGHT) {
      // right-right case
      if (
        _getBalanceState(<Node<K, V>>root.right) === BalanceState.BALANCED ||
        _getBalanceState(<Node<K, V>>root.right) === BalanceState.SLIGHTLY_UNBALANCED_RIGHT
      ) {
        return root.rotateLeft()
      }
      // Right left case
      // _getBalanceState(root.right) === BalanceState.SLIGHTLY_UNBALANCED_LEFT
      root.right = (<Node<K, V>>root.right).rotateRight()
      return root.rotateLeft()
    }

    return root
  }

  /**
   * Gets the value of a node within the tree with a specific key.
   * @param key The key being searched for.
   * @return The value of the node (which may be undefined), or null if it
   * doesn't exist.
   */
  function get(key: K): V | undefined | null {
    if (_root === null) {
      return null
    }

    const result = _get(key, _root)
    if (result === null) {
      return null
    }

    return result.value
  }

  /**
   * Gets the value of a node within the tree with a specific key.
   * @param key The key being searched for.
   * @param root The root of the tree to search in.
   * @return The value of the node or null if it doesn't exist.
   */
  function _get(key: K, root: Node<K, V>): Node<K, V> | null {
    const result = _compare(key, root.key)
    if (result === 0) {
      return root
    }

    if (result < 0) {
      if (!root.left) {
        return null
      }
      return _get(key, root.left)
    }

    if (!root.right) {
      return null
    }
    return _get(key, root.right)
  }

  function findByValue(value: Partial<V>): V | null {
    if (_root === null) {
      return null
    }

    const result = _findByValue(value, _root)
    if (!result) {
      return null
    }

    return result.value
  }

  function _findByValue(value: Partial<V>, root: Node<K, V>): Node<K, V> | null {
    const result = _compareByValue(value, root.value)
    if (result === 0) {
      return root
    }

    if (result < 0) {
      if (!root.left) {
        return null
      }
      return _findByValue(value, root.left)
    }

    if (!root.right) {
      return null
    }
    return _findByValue(value, root.right)
  }

  function findEnclosingRange(key: K): Range<K> {
    if (_root === null) {
      return { min: undefined, max: undefined }
    }

    return _findEnclosingRange(key, _root, undefined, undefined)
  }

  function _findEnclosingRange(key: K, root: Node<K, V> | null, minTs: K | undefined, maxTs: K | undefined): Range<K> {
    if (root === null) {
      return { min: minTs, max: maxTs }
    }
    const result = _compare(key, root.key)
    if (result === 0) {
      return { min: root.key, max: root.key }
    } else if (result < 0) {
      return _findEnclosingRange(key, root.left, minTs, root.key)
    } else {
      return _findEnclosingRange(key, root.right, root.key, maxTs)
    }
  }

  /**
   * Gets whether a node with a specific key is within the tree.
   * @param key The key being searched for.
   * @return Whether a node with the key exists.
   */
  function contains(key: K): boolean {
    if (_root === null) {
      return false
    }

    return !!_get(key, _root)
  }

  /**
   * Gets the minimum value node, rooted in a particular node.
   * @param root The node to search.
   * @return The node with the minimum key in the tree.
   */
  function _minValueNode(root: Node<K, V>): Node<K, V> {
    let current = root
    while (current.left) {
      current = current.left
    }
    return current
  }
  /**
   * Gets the balance state of a node, indicating whether the left or right
   * subtrees are unbalanced.
   * @param node The node to get the difference from.
   * @return The BalanceState of the node.
   */
  function _getBalanceState(node: Node<K, V>): BalanceState {
    const heightDifference = node.leftHeight - node.rightHeight
    switch (heightDifference) {
      case -2:
        return BalanceState.UNBALANCED_RIGHT
      case -1:
        return BalanceState.SLIGHTLY_UNBALANCED_RIGHT
      case 1:
        return BalanceState.SLIGHTLY_UNBALANCED_LEFT
      case 2:
        return BalanceState.UNBALANCED_LEFT
      default:
        return BalanceState.BALANCED
    }
  }

  const isEmpty = (): boolean => _root === null

  const size = (): number => _size

  const root = (): Node<K, V> | null => _root

  return {
    root,
    size,
    isEmpty,
    insert,
    remove,
    get,
    findByValue,
    findEnclosingRange,
    contains
  }
}
