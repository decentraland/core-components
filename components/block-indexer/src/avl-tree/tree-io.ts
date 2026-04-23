import fs from 'fs'
import events from 'events'
import readline from 'readline'

import { AvlTree } from './types'
import { Node } from './node'

/**
 * @public
 */
export async function loadTree<K, V>(
  tree: AvlTree<K, V>,
  file: string,
  converter: (row: any[]) => { key: K; value: V }
): Promise<void> {
  const rl = readline
    .createInterface({
      input: fs.createReadStream(file)
    })
    .on('line', (line: string) => {
      if (line.trim().length > 0) {
        const row = line.trim().split(',')
        const { key, value } = converter(row)
        tree.insert(key, value)
      }
    })

  await events.once(rl, 'close')
}

/**
 * @public
 */
export async function saveTree<K, V>(
  tree: AvlTree<K, V>,
  file: string,
  converter: (k: K, v: V) => any[]
): Promise<void> {
  if (!tree.root()) return

  const writeStream = fs.createWriteStream(file, {
    autoClose: true
  })

  const queue: Node<K, V>[] = []
  let current: Node<K, V> = tree.root()!
  queue.push(current)

  while (queue.length) {
    current = queue.shift()!
    const row = [converter(current.key, current.value)]

    // write to file (and flush if buffer full)
    const highWaterMark = writeStream.write(row.join(',') + '\n')
    if (!highWaterMark) {
      await new Promise<void>((resolve) => writeStream.once('drain', () => resolve()))
    }

    if (current.left) queue.push(current.left)
    if (current.right) queue.push(current.right)
  }

  writeStream.end()
  await events.once(writeStream, 'close')
}
