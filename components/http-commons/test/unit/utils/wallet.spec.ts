import { generateRandomWalletAddress, generateRandomWalletAddresses } from '../../../src/utils'

const addressRegex = /^0x[0-9a-fA-F]{40}$/

describe('when generating a random wallet address', () => {
  it('should generate a valid address', () => {
    const address = generateRandomWalletAddress()
    expect(address).toMatch(addressRegex)
  })
})

describe('when generating multiple random wallet addresses', () => {
  it('should generate the correct number of valid addresses', () => {
    const addresses = generateRandomWalletAddresses(10)
    expect(addresses.length).toBe(10)
    addresses.forEach((address) => {
      expect(address).toMatch(addressRegex)
    })
  })
})
