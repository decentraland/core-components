import { AsyncLocalStorage } from 'node:async_hooks'
import { ITracerComponent, TraceContext, Trace, TraceState } from '@well-known-components/interfaces'
import { buildTraceString, buildTraceContext, generateTraceId } from './logic'
import { INVALID_SPAN_ID } from './constants'
import { NotInSpanError } from './errors'

export function createTracerComponent(): ITracerComponent {
  const asyncLocalStorage = new AsyncLocalStorage<TraceContext>()

  /**
   * Create a new tracing span over a specified function.
   * @param name - The name of the tracing span.
   * @param tracedFunction - The function to be traced.
   * @param traceContext - The initial trace context to initialize the new context with. Usually used to set the information about the trace parent.
   * @returns The result of the execution of the tracedFunction.
   */
  function span<T>(name: string, tracedFunction: () => T, traceContext?: Omit<TraceContext, 'id' | 'name'>): T {
    const parentTraceContext = asyncLocalStorage.getStore()
    let newContext: TraceContext
    if (traceContext) {
      newContext = buildTraceContext({
        name,
        parentId: traceContext.parentId,
        traceId: traceContext.traceId,
        version: Number(traceContext.version),
        traceFlags: Number(traceContext.traceFlags),
        traceState: traceContext.traceState,
        data: traceContext.data
      })
    } else if (parentTraceContext) {
      newContext = buildTraceContext({
        name,
        parentId: parentTraceContext.traceId,
        traceId: parentTraceContext.traceId,
        version: parentTraceContext.version,
        traceFlags: parentTraceContext.traceFlags,
        traceState: parentTraceContext.traceState
      })
    } else {
      // Set up default values
      newContext = buildTraceContext({
        name,
        parentId: INVALID_SPAN_ID,
        traceId: generateTraceId(),
        version: 0,
        traceFlags: 0
      })
    }
    return asyncLocalStorage.run(newContext, tracedFunction)
  }

  /**
   * Gets if the execution context is inside of a trace span or not.
   * @returns true if it is inside of a trace span, false otherwise.
   */
  function isInsideOfTraceSpan(): boolean {
    const currentContext = asyncLocalStorage.getStore()
    return (
      currentContext !== undefined &&
      currentContext.parentId !== undefined &&
      currentContext.traceId !== undefined &&
      currentContext.traceFlags !== undefined &&
      currentContext.version !== undefined
    )
  }

  /**
   * Gets the current span id.
   * @returns The current span id if the function is executed inside of a trace span.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function getSpanId(): string {
    const currentContext = asyncLocalStorage.getStore()
    if (!currentContext) {
      throw new NotInSpanError()
    }

    return currentContext?.id
  }

  /**
   * Gets the information of the current trace.
   * @returns The current trace if the function is executed inside of a trace span.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function getTrace(): Trace {
    const currentContext = asyncLocalStorage.getStore()
    if (!currentContext) {
      throw new NotInSpanError()
    }

    return {
      traceId: currentContext.traceId,
      version: currentContext.version,
      parentId: currentContext.parentId,
      traceFlags: currentContext.traceFlags
    }
  }

  /**
   * Gets the string representation of the information of the current trace.
   * The value is crafted using the traceparent header format.
   * @returns The string representation of the current trace.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function getTraceString(): string {
    const traceParent = getTrace()
    return buildTraceString(traceParent)
  }

  /**
   * Gets the information of the trace to be propagated where the parent id is the current trace span id.
   * @returns The trace child of the current trace.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function getTraceChild(): Trace {
    const currentContext = asyncLocalStorage.getStore()
    if (!currentContext) {
      throw new NotInSpanError()
    }

    return {
      traceId: currentContext.traceId,
      version: currentContext.version,
      parentId: currentContext.id,
      traceFlags: currentContext.traceFlags
    }
  }

  /**
   * Gets the string representation of the trace to be propagated where the parent id is the current trace span id.
   * The value is crafted using the traceparent header format.
   * @returns The string representation of the trace child of the current trace.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function getTraceChildString(): string {
    const traceChild = getTraceChild()
    return buildTraceString(traceChild)
  }

  /**
   * Gets the properties of the trace state.
   * @returns The current trace state.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function getTraceState(): Readonly<TraceState | null> {
    const currentContext = asyncLocalStorage.getStore()
    if (!currentContext) {
      throw new NotInSpanError()
    }

    return Object.freeze(currentContext?.traceState ?? null)
  }

  /**
   * Gets the string representation of the the properties of the trace state.
   * The value is crafted using the tracestate header format.
   * @returns The current trace state or null if there's no trace state.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function getTraceStateString(): string | undefined {
    const traceState = getTraceState()
    return traceState && Object.keys(traceState).length > 0
      ? Object.entries(traceState).reduce((acc, curr, index, arr) => `${acc}=${curr}${index !== arr.length - 1 ? ',' : ''}`, '')
      : undefined
  }

  /**
   * Gets the current trace context data.
   * @returns The current trace context data.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function getContextData<T>(): Readonly<T | null> {
    const currentContext = asyncLocalStorage.getStore()
    if (!currentContext) {
      throw new NotInSpanError()
    }

    return Object.freeze(currentContext?.data ?? null)
  }

  /**
   * Sets the trace context data if executed inside a trace span.
   * @param key - The key of the property to be set.
   * @param value - The value of the property to be set.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function setContextData<T = any>(data: T): void {
    const currentContext = asyncLocalStorage.getStore()
    if (!currentContext) {
      throw new NotInSpanError()
    }

    currentContext.data = data
  }

  /**
   * Sets a property of the trace state if executed inside a trace span.
   * @param key - The key of the property to be set.
   * @param value - The value of the property to be set.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function setTraceStateProperty(key: string, value: string): void {
    const currentContext = asyncLocalStorage.getStore()
    if (!currentContext) {
      throw new NotInSpanError()
    }

    if (!currentContext.traceState) {
      currentContext.traceState = {}
    }
    currentContext.traceState[key] = value
  }

  /**
   * Deletes a property of the trace state if executed inside a trace span.
   * @param key - The key of the property to be deleted.
   * @throws NotInSpanError if executed outside of a scope.
   */
  function deleteTraceStateProperty(key: string): void {
    const currentContext = asyncLocalStorage.getStore()
    if (!currentContext) {
      throw new NotInSpanError()
    }

    if (currentContext.traceState) {
      delete currentContext.traceState[key]
    }
  }

  return {
    span,
    isInsideOfTraceSpan,
    getSpanId,
    getTrace,
    getTraceString,
    getTraceChild,
    getTraceChildString,
    getContextData,
    setContextData,
    getTraceState,
    getTraceStateString,
    setTraceStateProperty,
    deleteTraceStateProperty
  }
}
