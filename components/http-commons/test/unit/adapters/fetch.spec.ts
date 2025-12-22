import fetch from 'node-fetch'
import { IFetchComponent } from '@well-known-components/interfaces'
import { createFetchComponent } from '../../../src'

jest.mock('node-fetch', () => jest.fn())

describe('Fetch', () => {
  let fetcher: IFetchComponent

  beforeEach(async () => {
    fetcher = await createFetchComponent()
  })

  it('should parse json correctly', async () => {
    const mockFetch: jest.Mock = fetch as any
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => Promise.resolve({ foo: 'bar' })
      })
    )

    const response = await fetcher.fetch('http://localhost/something')
    await expect(response.json()).resolves.toEqual({ foo: 'bar' })
  })

  it('should throw error on error response', async () => {
    const mockFetch: jest.Mock = fetch as any
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not found',
        url: 'http://localhost/something'
      })
    )

    await expect(fetcher.fetch('http://localhost/something')).rejects.toThrow(
      'HTTP Error Response: 404 Not found for URL http://localhost/something'
    )
  })
})
