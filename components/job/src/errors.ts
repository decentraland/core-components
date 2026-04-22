import { isErrorWithMessage } from '@dcl/core-commons'

export class WrongOnTimeError extends Error {
  constructor(onTime: number) {
    super(`onTime must be at least 500ms, got ${onTime}ms`)
    this.name = 'WrongOnTimeError'
  }
}

export class InvalidStartupDelayError extends Error {
  constructor(startupDelay: number) {
    super(`startupDelay must be non-negative, got ${startupDelay}ms`)
    this.name = 'InvalidStartupDelayError'
  }
}

export class InvalidCronExpressionError extends Error {
  constructor(expression: string, cause: unknown) {
    const causeMessage = isErrorWithMessage(cause) ? cause.message : String(cause)
    super(`Invalid cron expression "${expression}": ${causeMessage}`, { cause })
    this.name = 'InvalidCronExpressionError'
  }
}
