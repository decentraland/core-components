import { LRUCache } from 'lru-cache'
import { ICacheStorageComponent } from '@dcl/core-commons'

export function createInMemoryCacheComponent(): ICacheStorageComponent {
  const cache = new LRUCache<string, any>({
    max: 10000,
    ttl: 1000 * 60 * 60 // 1 hour default TTL
  })

  const component: ICacheStorageComponent = {
    async get<T>(key: string): Promise<T | null> {
      const value = cache.get(key)
      return value !== undefined ? (value as T) : null
    },

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
      const options = ttl ? { ttl: ttl * 1000 } : undefined
      cache.set(key, value, options)
    },

    async remove(key: string): Promise<void> {
      cache.delete(key)
    },

    async keys(pattern?: string): Promise<string[]> {
      const allKeys = Array.from(cache.keys()) as string[]
      if (!pattern) return allKeys
      
      // Simple pattern matching - convert glob-like pattern to regex
      const regexPattern = pattern.replace(/\*/g, '.*')
      const regex = new RegExp(regexPattern)
      return allKeys.filter((key: string) => regex.test(key))
    }
  }

  return component
}
