import { Node } from './node'

/**
 * @public
 */
export type CompareFunction<K> = (a: K, b: K) => number

/**
 * @public
 */
export type PartialCompareFunction<V> = (a: Partial<V>, b: Partial<V>) => number

/**
 * @public
 */
export type Range<T> = { min: T | undefined; max: T | undefined }

/**
 * An AVL tree-like data structure with a key and value.
 * It builds on AVL-tree but adds a couple more search functions.
 * @public
 */
export type AvlTree<K, V> = {
  /**
   * Gets whether the tree is empty.
   */
  root(): Node<K, V> | null

  /**
   * Gets the size of the tree.
   */
  size(): number

  /**
   * Gets whether the tree is empty.
   */
  isEmpty(): boolean

  /**
   * Inserts a new node with a specific key into the tree.
   * @param key - The key being inserted.
   * @param value - The value being inserted.
   */
  insert(key: K, value: V): void

  /**
   * Deletes a node with a specific key from the tree.
   * @param key - The key being deleted.
   */
  remove(key: K): void

  /**
   * Gets the value of a node within the tree with a specific key.
   * @param key - The key being searched for.
   * @returns The value of the node (which may be undefined), or null if it
   * doesn't exist.
   */
  get(key: K): V | undefined | null

  findByValue(value: Partial<V>): V | undefined | null

  findEnclosingRange(key: K): Range<K>

  /**
   * Gets whether a node with a specific key is within the tree.
   * @param key - The key being searched for.
   * @returns Whether a node with the key exists.
   */
  contains(key: K): boolean
}
