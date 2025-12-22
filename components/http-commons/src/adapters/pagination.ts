import { PaginatedParameters } from '@dcl/schemas'

const MAX_LIMIT = 100

export function getPaginationParams(params: URLSearchParams): Required<PaginatedParameters> {
  const limit = params.get('limit')
  const offset = params.get('offset')
  const parsedLimit = parseInt(limit as string, 10)
  const parsedOffset = parseInt(offset as string, 10)

  const paginationLimit =
    limit && !isNaN(parsedLimit) && parsedLimit <= MAX_LIMIT && parsedLimit > 0 ? parsedLimit : MAX_LIMIT
  const paginationOffset = !isNaN(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0

  return {
    limit: paginationLimit,
    offset: paginationOffset
  }
}
