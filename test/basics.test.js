import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DynamicBvh, internalSurfaceArea, rayAabb } from '../lib/index.js';

describe('空树与基础操作', () => {
  test('空树查询返回空结果且无异常', () => {
    const bvh = new DynamicBvh();
    const ray = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
    assert.deepStrictEqual(bvh.raycastAll(ray.origin, ray.direction), []);
    assert.equal(bvh.raycastFirst(ray.origin, ray.direction), null);
    assert.equal(bvh.delete('missing'), false);
    assert.equal(bvh.size, 0);
    assert.equal(bvh.endFrame(), 0);
    bvh.checkInvariants();
  });

  test('插入后清空可回到真正的空树', () => {
    const bvh = new DynamicBvh();
    const box = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    bvh.insert('a', box).insert('b', box).insert('c', box);
    assert.equal(bvh.size, 3);
    for (const id of ['a', 'b', 'c']) assert.equal(bvh.delete(id), true);
    assert.equal(bvh.root, null);
    assert.equal(bvh.size, 0);
    bvh.checkInvariants();
    assert.equal(
      bvh.raycastFirst({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }),
      null,
    );
  });

  test('重复 ID、非法 AABB、非法 ID 全部拒绝且不留脏状态', () => {
    const bvh = new DynamicBvh();
    const box = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    bvh.insert(7, box);
    assert.throws(() => bvh.insert(7, box), /重复 ID/);
    assert.throws(
      () => bvh.insert(8, { minX: 1, minY: 0, minZ: 0, maxX: 0, maxY: 1, maxZ: 1 }),
      /AABB 不合法/,
    );
    assert.throws(() => bvh.insert(NaN, box), /ID/);
    assert.throws(() => bvh.insert({}, box), /ID/);
    assert.throws(() => bvh.setBox(99, box), /不存在/);
    assert.throws(() => bvh.insert(10, null), /AABB/);
    assert.equal(bvh.size, 1);
    bvh.checkInvariants();
  });
});

describe('退化包围盒', () => {
  test('点/线/平面 AABB 可被射线命中', () => {
    const bvh = new DynamicBvh();
    const point = { minX: 5, minY: 0, minZ: 0, maxX: 5, maxY: 0, maxZ: 0 };
    const plane = { minX: 2, minY: -10, minZ: -10, maxX: 2, maxY: 10, maxZ: 10 };
    bvh.insert('point', point).insert('plane', plane);

    const origin = { x: 0, y: 0, z: 0 };
    const dir = { x: 1, y: 0, z: 0 };
    const hits = bvh.raycastAll(origin, dir);
    assert.deepStrictEqual(hits, [
      { id: 'plane', t: 2 },
      { id: 'point', t: 5 },
    ]);
    assert.deepStrictEqual(bvh.raycastFirst(origin, dir), { id: 'plane', t: 2 });
    bvh.checkInvariants();
  });

  test('大量同位置退化盒 refit/rebuild 结果一致', () => {
    const bvh = new DynamicBvh({ rebuildBudget: 1000 });
    const point = { minX: 3, minY: 3, minZ: 3, maxX: 3, maxY: 3, maxZ: 3 };
    for (let i = 0; i < 200; i++) bvh.insert(`p${i}`, point);
    bvh.checkInvariants();
    const origin = { x: 0, y: 0, z: 0 };
    const dir = { x: 1, y: 1, z: 1 };
    const refitHits = bvh.raycastAll(origin, dir);
    bvh.rebuild();
    const rebuildHits = bvh.raycastAll(origin, dir);
    assert.deepStrictEqual(rebuildHits, refitHits);
    assert.equal(rebuildHits.length, 200);
    const rebuiltOnce = JSON.stringify(bvh.toJSON());
    bvh.rebuild();
    assert.equal(JSON.stringify(bvh.toJSON()), rebuiltOnce);
    bvh.checkInvariants();
  });
});

describe('射线求交数学', () => {
  test('slab 测试处理反向、零分量和内部出发', () => {
    const box = { minX: -1, minY: -1, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 };
    assert.equal(rayAabb({ x: 2, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, box), 1);
    assert.equal(rayAabb({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, box), 0);
    assert.equal(rayAabb({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, box), 4);
    assert.equal(rayAabb({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, box), null);
    assert.equal(rayAabb({ x: -5, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, box), null);
  });
});

describe('重建确定性', () => {
  test('相同叶子集合多次重建产生完全相同的树', () => {
    const bvh = new DynamicBvh();
    const make = (i) => ({
      minX: i * 1.5,
      minY: (i % 4) * 2,
      minZ: -i,
      maxX: i * 1.5 + 1,
      maxY: (i % 4) * 2 + 1,
      maxZ: -i + 1,
    });
    for (let i = 0; i < 64; i++) bvh.insert(i, make(i));
    bvh.rebuild();
    const first = JSON.stringify(bvh.toJSON());
    for (let i = 0; i < 5; i++) {
      bvh.insert(1000 + i, make(100 + i));
      bvh.delete(1000 + i);
      bvh.rebuild();
      assert.equal(JSON.stringify(bvh.toJSON()), first);
    }
    bvh.checkInvariants();
    assert.equal(internalSurfaceArea(bvh.root), bvh.internalSa);
  });
});
