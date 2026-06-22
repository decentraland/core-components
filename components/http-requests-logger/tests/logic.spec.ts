import { IHttpServerComponent } from '@dcl/core-commons'
import { shouldSkip } from '../src/logic'

let context: IHttpServerComponent.DefaultContext<object>

beforeEach(() => {
  context = {
    request: {
      url: 'http://localhost/health/live'
    } as any,
    url: new URL('http://localhost/health/live')
  }
})

describe('when checking if a request should be skipped according to a string', () => {
  let stringToMatch: string

  describe('and the url matches the provided string', () => {
    beforeEach(() => {
      stringToMatch = context.url.pathname
    })

    it('should return true', () => {
      expect(shouldSkip(context, stringToMatch)).toBe(true)
    })
  })

  describe("and the url doesn't match the provided string", () => {
    beforeEach(() => {
      stringToMatch = '/v1/endpoint'
    })

    it('should return false', () => {
      expect(shouldSkip(context, stringToMatch)).toBe(false)
    })
  })
})

describe('when checking if a request should be skipped according to a an array of strings', () => {
  let stringsToMatch: string[]

  describe('and the url matches one of the provided string', () => {
    beforeEach(() => {
      stringsToMatch = [context.url.pathname, '/v1/endpoint']
    })

    it('should return true', () => {
      expect(shouldSkip(context, stringsToMatch)).toBe(true)
    })
  })

  describe("and the url doesn't match any the provided string", () => {
    beforeEach(() => {
      stringsToMatch = ['/v1/endpoint']
    })

    it('should return false', () => {
      expect(shouldSkip(context, stringsToMatch)).toBe(false)
    })
  })
})

describe('when checking if a request should be skipped according to a regex', () => {
  let regexToMatch: RegExp

  describe('and the url matches the provided regex', () => {
    beforeEach(() => {
      regexToMatch = /^\/health/
    })

    it('should return true', () => {
      expect(shouldSkip(context, regexToMatch)).toBe(true)
    })
  })

  describe("and the url doesn't match the provided regex", () => {
    beforeEach(() => {
      regexToMatch = /^\/another/
    })

    it('should return false', () => {
      expect(shouldSkip(context, regexToMatch)).toBe(false)
    })
  })

  describe('and the provided regex has the global flag', () => {
    beforeEach(() => {
      regexToMatch = /^\/health/g
    })

    it('should match consistently across repeated calls', () => {
      expect(shouldSkip(context, regexToMatch)).toBe(true)
      expect(shouldSkip(context, regexToMatch)).toBe(true)
      expect(shouldSkip(context, regexToMatch)).toBe(true)
    })
  })
})

describe('when checking if a request should be skipped according to a skip function', () => {
  let checkingFunction: (req: IHttpServerComponent.DefaultContext<object>['request']) => boolean

  describe('and the called function returns true', () => {
    beforeEach(() => {
      checkingFunction = req => req.url === 'http://localhost/health/live'
    })

    it('should return true', () => {
      expect(shouldSkip(context, checkingFunction)).toBe(true)
    })
  })

  describe("and the url doesn't match the provided regex", () => {
    beforeEach(() => {
      checkingFunction = req => req.url === 'http://localhost/v1/another'
    })

    it('should return false', () => {
      expect(shouldSkip(context, checkingFunction)).toBe(false)
    })
  })
})
