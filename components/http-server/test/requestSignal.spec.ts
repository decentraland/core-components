import { describeE2E } from './test-e2e-harness'
import { TestComponents } from './test-helpers'

describeE2E('request disconnect signal', ({ components }: { components: TestComponents }) => {
  describe('when the client disconnects while a handler is running', () => {
    let clientController: AbortController
    let handlerStarted: Promise<void>
    let resolveHandlerStarted: () => void
    let serverAbortReason!: Promise<unknown>

    beforeEach(() => {
      clientController = new AbortController()
      handlerStarted = new Promise<void>((resolve) => {
        resolveHandlerStarted = resolve
      })
      components.server.resetMiddlewares()
      components.server.use(async (context) => {
        resolveHandlerStarted()
        serverAbortReason = new Promise((resolve) => {
          context.request.signal.addEventListener('abort', () => resolve(context.request.signal.reason), { once: true })
        })
        await serverAbortReason
        throw context.request.signal.reason
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should abort the handler request signal', async () => {
      const clientRequest = components.fetch.fetch('/', { signal: clientController.signal }).catch((error) => error)
      await handlerStarted
      clientController.abort()

      const [clientError, reason] = await Promise.all([clientRequest, serverAbortReason])
      expect({
        clientRequestAborted:
          typeof clientError === 'object' && clientError !== null && 'name' in clientError
            ? (clientError as Error).name
            : clientError,
        serverReason:
          typeof reason === 'object' && reason !== null && 'name' in reason && 'message' in reason
            ? { message: (reason as Error).message, name: (reason as Error).name }
            : reason
      }).toEqual({
        clientRequestAborted: 'AbortError',
        serverReason: { message: 'Client disconnected.', name: 'AbortError' }
      })
    })
  })
})
