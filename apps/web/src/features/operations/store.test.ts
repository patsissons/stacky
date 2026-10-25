import { afterEach, describe, expect, it } from 'vitest'
import { operationStore } from './store'

afterEach(() => operationStore.close())

describe('operationStore', () => {
  it('opens a single operation in place of the previous ones', () => {
    operationStore.openAll(['a', 'b'])
    operationStore.open('c')
    expect(operationStore.get()).toMatchObject({ openIds: ['c'], openId: 'c' })
  })

  it('opens several operations with the first one selected', () => {
    operationStore.openAll(['a', 'b', 'c'])
    expect(operationStore.get()).toMatchObject({ openIds: ['a', 'b', 'c'], openId: 'a' })
  })

  it('leaves the drawer alone when there is nothing to open', () => {
    operationStore.open('a')
    operationStore.openAll([])
    expect(operationStore.get()).toMatchObject({ openIds: ['a'], openId: 'a' })
  })

  it('selects another open operation without changing the list', () => {
    operationStore.openAll(['a', 'b'])
    operationStore.select('b')
    expect(operationStore.get()).toMatchObject({ openIds: ['a', 'b'], openId: 'b' })
  })

  it('closes every open operation', () => {
    operationStore.openAll(['a', 'b'])
    operationStore.close()
    expect(operationStore.get()).toMatchObject({ openIds: [], openId: undefined })
  })
})
