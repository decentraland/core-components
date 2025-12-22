import { EthAddress } from '@dcl/schemas'
import { IHttpServerComponent } from '@well-known-components/interfaces'

/**
 * Middleware that automatically converts Ethereum addresses to lowercase in URL parameters
 * This middleware detects parameters that match the Ethereum address pattern and normalizes them
 */
export function ethAddressNormalizerMiddleware() {
  return async function (
    ctx: IHttpServerComponent.DefaultContext<any>,
    next: () => Promise<IHttpServerComponent.IResponse>
  ): Promise<IHttpServerComponent.IResponse> {
    if (!ctx.params || typeof ctx.params !== 'object') {
      return await next()
    }

    // Check each parameter to see if it's an Ethereum address
    for (const [key, value] of Object.entries(ctx.params)) {
      // Ensure the value is a string before validation and conversion
      if (typeof value === 'string' && EthAddress.validate(value)) {
        // Convert to lowercase if it's an Ethereum address
        ctx.params[key] = value.toLowerCase()
      }
    }

    // Call the next middleware/handler with the normalized context
    return await next()
  }
}
