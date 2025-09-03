import { IBaseComponent } from '@well-known-components/interfaces'

export interface ICacheStorageComponent extends IBaseComponent {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  remove(key: string): Promise<void>
  keys(pattern?: string): Promise<string[]>
}
