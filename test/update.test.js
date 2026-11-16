import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DynamicBvh } from '../lib/index.js';
import { makeBox, makeRay, mulberry32, randomBox, runScenario } from './_helpers.js';

describe('随机增量更新与全量重建等价', () => {
  test('插入/删除/AABB 修改混合操作下查询逐帧一致', () => {
    const scene = runScenario(
      { assert },
      { seed: 42, options: { rebuildBudget: 24 }, label: 'random-mixed' },
    );
    const { live, objects, random, runFrame, bootstrap } = scene;

    bootstrap(Array.from({ length: 80 }, (_, i) => [i, randomBox(random)]));

    let totalRebuilds = 0;
    for (let frame = 0; frame < 60; frame++) {
      const operations = [];
      const ids = [...objects.keys()];
      const changeCount = 1 + Math.floor(random() * 18);
      for (let k = 0; k < changeCount; k++) {
        const roll = random();
        if (roll < 0.45 && ids.length > 1) {
          const id = ids[Math.floor(random() * ids.length)];
          operations.push({ type: 'update', id, box: randomBox(random, 100, 0.1, 6) });
        } else if (roll < 0.7) {
          const id = 10000 + frame * 50 + k;
          operations.push({ type: 'insert', id, box: randomBox(random) });
        } else if (ids.length > 5) {
          const id = ids[Math.floor(random() * ids.length)];
          operations.push({ type: 'delete', id });
        }
      }
      const rays = Array.from({ length: 10 }, () => makeRay(random));
      totalRebuilds += runFrame(operations, rays);
      if (frame % 5 === 0) {
        live.refit();
        live.checkInvariants();
      }
    }

    assert.ok(live.stats.rebuilds > 0, '预算阈值应至少触发一次重建');
    assert.ok(live.stats.refits > 0, '局部 refit 应被实际执行');
    live.checkInvariants();
    assert.equal(live.size, objects.size);
  });
});

describe('跨节点移动', () => {
  test('对象移动到树的另一端后无悬挂叶节点且查询正确', () => {
    const scene = runScenario(
      { assert },
      {
        seed: 7,
        options: { rebuildBudget: 1000000, rebuildQualityThreshold: Infinity },
        label: 'cross-node',
      },
    );
    const { live, runFrame, random, bootstrap } = scene;

    const initial = [['mover', makeBox(-90, -90, -90, 1)]];
    for (let i = 0; i < 120; i++) initial.push([`anchor-${i}`, randomBox(random)]);
    bootstrap(initial);
    const before = live.size;
    const baselineRebuilds = live.stats.rebuilds;

    for (let frame = 0; frame < 20; frame++) {
      const target = makeBox(
        frame % 2 === 0 ? 90 : -90,
        frame % 2 === 0 ? 90 : -90,
        frame % 3 === 0 ? 90 : -90,
        1,
      );
      const rays = Array.from({ length: 8 }, () => makeRay(random));
      runFrame([{ type: 'update', id: 'mover', box: target }], rays);
    }

    assert.equal(live.size, before);
    assert.equal(live.stats.rebuilds, baselineRebuilds, '预算内只允许 refit');
    live.checkInvariants();

    const moverBox = live.getBox('mover');
    const hit = live.raycastFirst(
      { x: moverBox.minX, y: moverBox.minY, z: moverBox.minZ - 10 },
      { x: 0, y: 0, z: 1 },
    );
    assert.equal(hit.id, 'mover', '移动后的对象必须仍可通过射线定位');
  });
});

describe('重建预算与每帧上限', () => {
  test('变化量达到预算才重建，且每帧不超过上限', () => {
    const bvh = new DynamicBvh({ rebuildBudget: 5, maxRebuildsPerFrame: 1, rebuildQualityThreshold: Infinity });
    for (let i = 0; i < 20; i++) bvh.insert(i, makeBox(i, i, i, 0.5));
    bvh.rebuild();
    const startRebuilds = bvh.stats.rebuilds;

    assert.equal(bvh.endFrame(), 0);
    for (let i = 0; i < 4; i++) bvh.setBox(i, makeBox(i + 100, i, i, 0.5));
    assert.equal(bvh.endFrame(), 0, '未达预算不应重建');
    assert.equal(bvh.stats.rebuilds, startRebuilds);

    bvh.setBox(4, makeBox(104, 4, 4, 0.5));
    assert.equal(bvh.endFrame(), 1, '达到预算应重建一次');
    assert.equal(bvh.stats.rebuilds, startRebuilds + 1);
    bvh.checkInvariants();
  });

  test('maxRebuildsPerFrame 为 0 时彻底关闭自动重建', () => {
    const bvh = new DynamicBvh({ rebuildBudget: 1, maxRebuildsPerFrame: 0 });
    bvh.insert('x', makeBox(0, 0, 0, 1));
    bvh.endFrame();
    assert.equal(bvh.stats.rebuilds, 0);
    bvh.rebuild();
    assert.equal(bvh.stats.rebuilds, 1);
  });
});

describe('质量劣化触发', () => {
  test('包围盒膨胀使内部表面积超阈值时触发重建', () => {
    const bvh = new DynamicBvh({
      rebuildBudget: 1000000,
      rebuildQualityThreshold: 1.5,
      maxRebuildsPerFrame: 1,
    });
    const rng = mulberry32(99);
    for (let i = 0; i < 60; i++) bvh.insert(i, randomBox(rng, 20, 0.3, 0.8));
    bvh.rebuild();
    const baseline = bvh.baselineInternalSa;

    for (let i = 0; i < 60; i++) bvh.setBox(i, randomBox(rng, 80, 3, 8));
    assert.ok(bvh.internalSa > baseline * 1.5, '膨胀后表面积应明显劣化');
    assert.equal(bvh.endFrame(), 1);
    assert.ok(bvh.internalSa <= bvh.baselineInternalSa * 1.0001);
    bvh.checkInvariants();
  });
});

describe('确定性重放', () => {
  test('相同操作序列作用于两个实例得到相同结构与查询', () => {
    const replay = (seed) => {
      const rng = mulberry32(seed);
      const bvh = new DynamicBvh({ rebuildBudget: 10 });
      for (let i = 0; i < 40; i++) bvh.insert(i, randomBox(rng));
      for (let frame = 0; frame < 15; frame++) {
        for (let k = 0; k < 6; k++) {
          const id = Math.floor(rng() * 40);
          bvh.setBox(id, randomBox(rng));
        }
        bvh.endFrame();
      }
      return JSON.stringify(bvh.toJSON());
    };
    assert.equal(replay(2026), replay(2026));
    assert.notEqual(replay(2026), replay(2027));
  });
});
