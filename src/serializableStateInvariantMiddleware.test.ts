import { Reducer } from 'redux'
import { Console } from 'console'
import { Writable } from 'stream'
import { configureStore } from './configureStore'

import {
  createSerializableStateInvariantMiddleware,
  findNonSerializableValue,
  isPlain
} from './serializableStateInvariantMiddleware'

describe('findNonSerializableValue', () => {
  it('Should return false if no matching values are found', () => {
    const obj = {
      a: 42,
      b: {
        b1: 'test'
      },
      c: [99, { d: 123 }]
    }

    const result = findNonSerializableValue(obj)

    expect(result).toBe(false)
  })

  it('Should return a keypath and the value if it finds a non-serializable value', () => {
    function testFunction() {}

    const obj = {
      a: 42,
      b: {
        b1: testFunction
      },
      c: [99, { d: 123 }]
    }

    const result = findNonSerializableValue(obj)

    expect(result).toEqual({ keyPath: 'b.b1', value: testFunction })
  })

  it('Should return the first non-serializable value it finds', () => {
    const map = new Map()
    const symbol = Symbol.for('testSymbol')

    const obj = {
      a: 42,
      b: {
        b1: 1
      },
      c: [99, { d: 123 }, map, symbol, 'test'],
      d: symbol
    }

    const result = findNonSerializableValue(obj)

    expect(result).toEqual({ keyPath: 'c.2', value: map })
  })

  it('Should return a specific value if the root object is non-serializable', () => {
    const value = new Map()
    const result = findNonSerializableValue(value)

    expect(result).toEqual({ keyPath: '<root>', value })
  })

  it('Should accept null as a valid value', () => {
    const obj = {
      a: 42,
      b: {
        b1: 1
      },
      c: null
    }

    const result = findNonSerializableValue(obj)

    expect(result).toEqual(false)
  })
})

describe('serializableStateInvariantMiddleware', () => {
  let log = ''
  const originalConsole = window.console

  beforeEach(() => {
    log = ''

    const writable = new Writable({
      write(chunk, encoding, callback) {
        log += chunk
        callback()
      }
    })

    const mockConsole = new Console({
      stdout: writable,
      stderr: writable
    })

    Object.defineProperty(window, 'console', {
      value: mockConsole
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'console', {
      value: originalConsole
    })
  })

  it('Should log an error when a non-serializable action is dispatched', () => {
    const reducer: Reducer = (state = 0, _action) => state + 1

    const serializableStateInvariantMiddleware = createSerializableStateInvariantMiddleware()

    const store = configureStore({
      reducer,
      middleware: [serializableStateInvariantMiddleware]
    })

    const type = Symbol.for('SOME_CONSTANT')
    const dispatchedAction = { type }

    store.dispatch(dispatchedAction)

    expect(log).toMatchInlineSnapshot(`
      "A non-serializable value was detected in an action, in the path: \`type\`. Value: Symbol(SOME_CONSTANT) 
      Take a look at the logic that dispatched this action:  { type: Symbol(SOME_CONSTANT) } 
      (See https://redux.js.org/faq/actions#why-should-type-be-a-string-or-at-least-serializable-why-should-my-action-types-be-constants)
      "
    `)
  })

  it('Should log an error when a non-serializable value is in state', () => {
    const ACTION_TYPE = 'TEST_ACTION'

    const initialState = {
      a: 0
    }

    const badValue = new Map()

    const reducer: Reducer = (state = initialState, action) => {
      switch (action.type) {
        case ACTION_TYPE: {
          return {
            a: badValue
          }
        }
        default:
          return state
      }
    }

    const serializableStateInvariantMiddleware = createSerializableStateInvariantMiddleware()

    const store = configureStore({
      reducer: {
        testSlice: reducer
      },
      middleware: [serializableStateInvariantMiddleware]
    })

    store.dispatch({ type: ACTION_TYPE })

    expect(log).toMatchInlineSnapshot(`
      "A non-serializable value was detected in the state, in the path: \`testSlice.a\`. Value: Map {} 
      Take a look at the reducer(s) handling this action type: TEST_ACTION.
      (See https://redux.js.org/faq/organizing-state#can-i-put-functions-promises-or-other-non-serializable-items-in-my-store-state)
      "
    `)
  })

  describe('consumer tolerated structures', () => {
    const nonSerializableValue = new Map()

    const nestedSerializableObjectWithBadValue = {
      isSerializable: true,
      entries: (): [string, any][] => [
        ['good-string', 'Good!'],
        ['good-number', 1337],
        ['bad-map-instance', nonSerializableValue]
      ]
    }

    const serializableObject = {
      isSerializable: true,
      entries: (): [string, any][] => [
        ['first', 1],
        ['second', 'B!'],
        ['third', nestedSerializableObjectWithBadValue]
      ]
    }

    it('Should log an error when a non-serializable value is nested in state', () => {
      const ACTION_TYPE = 'TEST_ACTION'

      const initialState = {
        a: 0
      }

      const reducer: Reducer = (state = initialState, action) => {
        switch (action.type) {
          case ACTION_TYPE: {
            return {
              a: serializableObject
            }
          }
          default:
            return state
        }
      }

      // use default options
      const serializableStateInvariantMiddleware = createSerializableStateInvariantMiddleware()

      const store = configureStore({
        reducer: {
          testSlice: reducer
        },
        middleware: [serializableStateInvariantMiddleware]
      })

      store.dispatch({ type: ACTION_TYPE })

      // since default options are used, the `entries` function in `serializableObject` will cause the error
      expect(log).toMatchInlineSnapshot(`
        "A non-serializable value was detected in the state, in the path: \`testSlice.a.entries\`. Value: [Function: entries] 
        Take a look at the reducer(s) handling this action type: TEST_ACTION.
        (See https://redux.js.org/faq/organizing-state#can-i-put-functions-promises-or-other-non-serializable-items-in-my-store-state)
        "
      `)
    })

    it('Should use consumer supplied isSerializable and getEntries options to tolerate certain structures', () => {
      const ACTION_TYPE = 'TEST_ACTION'

      const initialState = {
        a: 0
      }

      const isSerializable = (val: any): boolean =>
        val.isSerializable || isPlain(val)
      const getEntries = (val: any): [string, any][] =>
        val.isSerializable ? val.entries() : Object.entries(val)

      const reducer: Reducer = (state = initialState, action) => {
        switch (action.type) {
          case ACTION_TYPE: {
            return {
              a: serializableObject
            }
          }
          default:
            return state
        }
      }

      const serializableStateInvariantMiddleware = createSerializableStateInvariantMiddleware(
        { isSerializable, getEntries }
      )

      const store = configureStore({
        reducer: {
          testSlice: reducer
        },
        middleware: [serializableStateInvariantMiddleware]
      })

      store.dispatch({ type: ACTION_TYPE })

      // error reported is from a nested class instance, rather than the `entries` function `serializableObject`
      expect(log).toMatchInlineSnapshot(`
        "A non-serializable value was detected in the state, in the path: \`testSlice.a.third.bad-map-instance\`. Value: Map {} 
        Take a look at the reducer(s) handling this action type: TEST_ACTION.
        (See https://redux.js.org/faq/organizing-state#can-i-put-functions-promises-or-other-non-serializable-items-in-my-store-state)
        "
      `)
    })
  })

  it('Should use the supplied isSerializable function to determine serializability', () => {
    const ACTION_TYPE = 'TEST_ACTION'

    const initialState = {
      a: 0
    }

    const badValue = new Map()

    const reducer: Reducer = (state = initialState, action) => {
      switch (action.type) {
        case ACTION_TYPE: {
          return {
            a: badValue
          }
        }
        default:
          return state
      }
    }

    const serializableStateInvariantMiddleware = createSerializableStateInvariantMiddleware(
      {
        isSerializable: () => true
      }
    )

    const store = configureStore({
      reducer: {
        testSlice: reducer
      },
      middleware: [serializableStateInvariantMiddleware]
    })

    store.dispatch({ type: ACTION_TYPE })

    // Supplied 'isSerializable' considers all values serializable, hence
    // no error logging is expected:
    expect(log).toBe('')
  })

  it('should not check serializability for ignored action types', () => {
    let numTimesCalled = 0

    const serializableStateMiddleware = createSerializableStateInvariantMiddleware(
      {
        isSerializable: () => {
          numTimesCalled++
          return true
        },
        ignoredActions: ['IGNORE_ME']
      }
    )

    const store = configureStore({
      reducer: () => ({}),
      middleware: [serializableStateMiddleware]
    })

    expect(numTimesCalled).toBe(0)

    store.dispatch({ type: 'IGNORE_ME' })

    expect(numTimesCalled).toBe(0)

    store.dispatch({ type: 'ANY_OTHER_ACTION' })

    expect(numTimesCalled).toBeGreaterThan(0)
  })
})
