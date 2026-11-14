import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterPanoramas } from './panoramaClusters.ts'

test('nearby panoramas form a selectable cluster while distant points stay separate', () => {
  const clusters = clusterPanoramas([
    {item:'a',x:10,y:10}, {item:'b',x:20,y:15}, {item:'c',x:180,y:90},
  ], 24)
  assert.equal(clusters.length, 2)
  assert.deepEqual(clusters[0].items, ['a','b'])
  assert.deepEqual(clusters[1].items, ['c'])
})

test('invalid cluster radius is rejected', () => {
  assert.throws(() => clusterPanoramas([], 0), /positive/)
})
