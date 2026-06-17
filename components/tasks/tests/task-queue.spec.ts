import { IBaseComponent } from '@well-known-components/interfaces'
import { InvalidRetriesError } from '../src/errors'
import { createTaskQueue, ITaskQueue } from '../src/task-queue'

describe('when scheduling work on the task queue', () => {
  let queue: ITaskQueue & IBaseComponent

  beforeEach(() => {
    queue = createTaskQueue({ concurrency: 10 })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the job succeeds on the first attempt', () => {
    let job: jest.Mock

    beforeEach(() => {
      job = jest.fn().mockResolvedValue(42)
    })

    it('should resolve with the job result', async () => {
      await expect(queue.scheduleWithRetries(job, 3)).resolves.toBe(42)
    })

    it('should run the job only once', async () => {
      await queue.scheduleWithRetries(job, 3)
      expect(job).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the job fails before eventually succeeding', () => {
    let job: jest.Mock

    beforeEach(() => {
      job = jest.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok')
    })

    it('should retry and resolve with the eventual result', async () => {
      await expect(queue.scheduleWithRetries(job, 3)).resolves.toBe('ok')
    })

    it('should run the job until it succeeds', async () => {
      await queue.scheduleWithRetries(job, 3)
      expect(job).toHaveBeenCalledTimes(2)
    })
  })

  describe('and the job always fails', () => {
    let job: jest.Mock

    beforeEach(() => {
      job = jest.fn().mockRejectedValue(new Error('permanent'))
    })

    it('should reject after exhausting the retries', async () => {
      await expect(queue.scheduleWithRetries(job, 2)).rejects.toThrow('permanent')
    })
  })

  describe('and it is called with no retries', () => {
    it('should throw an InvalidRetriesError', () => {
      expect(() => queue.scheduleWithRetries(() => Promise.resolve(1), 0)).toThrow(InvalidRetriesError)
    })
  })
})
