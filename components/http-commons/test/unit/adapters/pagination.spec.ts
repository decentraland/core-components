import { URLSearchParams } from 'url'
import { getPaginationParams } from '../../../src/adapters'

describe('when getting the pagination params', () => {
  describe('and the limit is greater than the max limit', () => {
    it('should return the default limit', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: '200' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe('and the limit is set to a negative number', () => {
    it('should return the default limit', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: '-100' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe("and the limit is set to a a value that can't be parsed as a number", () => {
    it('should return the default limit', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: 'notAnInteger' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe('and the limit is set to a valid value', () => {
    it('should return the value as the limit', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: '10' }))).toEqual({
        limit: 10,
        offset: 0
      })
    })
  })

  describe('and the offset is set to a valid value', () => {
    it('should return the value as the offset', () => {
      expect(getPaginationParams(new URLSearchParams({ offset: '20' }))).toEqual({
        limit: 100,
        offset: 20
      })
    })
  })

  describe('and the offset is set to a negative number', () => {
    it('should default the offset to 0', () => {
      expect(getPaginationParams(new URLSearchParams({ offset: '-5' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe("and the offset can't be parsed as a number", () => {
    it('should default the offset to 0', () => {
      expect(getPaginationParams(new URLSearchParams({ offset: 'notAnInteger' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe('and both limit and offset are missing', () => {
    it('should return the defaults', () => {
      expect(getPaginationParams(new URLSearchParams())).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe('and both limit and offset are valid', () => {
    it('should return the provided values', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: '25', offset: '30' }))).toEqual({
        limit: 25,
        offset: 30
      })
    })
  })
})
