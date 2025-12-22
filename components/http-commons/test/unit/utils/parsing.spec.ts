import { Request } from 'node-fetch'
import { parseJson } from '../../../src/utils'

describe('when parsing a request', () => {
  it('should parse json correctly', async () => {
    const request = new Request('', {
      method: 'POST',
      body: JSON.stringify({ foo: 'bar' })
    })

    await expect(parseJson(request)).resolves.toEqual({ foo: 'bar' })
  })

  it('should parse json correctly', async () => {
    const request = new Request('', {
      method: 'POST',
      body: 'xx { xxx } xx'
    })

    await expect(parseJson(request)).rejects.toThrow('Invalid body')
  })
})
