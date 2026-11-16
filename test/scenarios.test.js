import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DynamicBvh } from '../lib/index.js';
import { makeBox, makeRay, mulberry32, pointBox, runScenario } from './_helpers.js';

const FRAMES = 40;
const RAYS = 24;

describe('场景一：移动角色（少量对象跨节点移动）', () => {
  test('refit 与每帧 rebuild 查询一致，预算内零重建', () => {
    const scene = runScenario(
      { assert },
      { seed: 11, options: { rebuildBudget: 1000000, rebuildQualityThreshold: Infinity }, label: 'characters' },
    );
    const { live, runFrame, random, bootstrap } = scene;

    const characterCount = 12;
    const positions = [];
    const initial = [];
    for (let i = 0; i < characterCount; i++) {
      const box = makeBox((i - 6) * 4, 0, 0, 0.6);
      positions.push({ x: (i - 6) * 4, y: 0, z: 0 });
      initial.push([`char-${i}`, box]);
    }
    for (let i = 0; i < 150; i++) {
      const angle = (i / 150) * Math.PI * 2;
      initial.push([`prop-${i}`, makeBox(Math.cos(angle) * 60, Math.sin(angle) * 60, (i % 5) * 4, 0.8)]);
    }
    bootstrap(initial);
    const baselineRebuilds = live.stats.rebuilds;

    for (let frame = 0; frame < FRAMES; frame++) {
      const operations = [];
      for (let i = 0; i < characterCount; i++) {
        const angle = (frame / FRAMES) * Math.PI * 4 + i;
        const radius = 50 + (i % 3) * 8;
        const pos = positions[i];
        pos.x = Math.cos(angle) * radius;
        pos.y = Math.sin(angle) * radius;
        pos.z = Math.sin(angle * 0.7 + i) * 20;
        operations.push({ type: 'update', id: `char-${i}`, box: makeBox(pos.x, pos.y, pos.z, 0.6) });
      }
      const rays = Array.from({ length: RAYS }, () => makeRay(random));
      runFrame(operations, rays);
    }

    assert.equal(live.stats.rebuilds, baselineRebuilds, '预算与质量阈值内只能 refit，不能自动重建');
    assert.ok(live.stats.refits > 0);
    assert.ok(live.stats.rayTests > 0);
    live.checkInvariants();
  });
});

describe('场景二：树冠摆动（大量叶子小幅周期运动）', () => {
  test('小幅 refit 保持一致；漂移导致超预算时按上限重建', () => {
    const scene = runScenario(
      { assert },
      { seed: 22, options: { rebuildBudget: 60, maxRebuildsPerFrame: 1 }, label: 'canopy' },
    );
    const { live, runFrame, random, bootstrap } = scene;

    const leafCount = 400;
    const base = [];
    const initial = [];
    for (let i = 0; i < leafCount; i++) {
      const bx = (i % 20) * 3 - 30;
      const by = Math.floor(i / 20) * 2;
      const bz = Math.floor(i / 400) * 3;
      base.push({ bx, by, bz });
      initial.push([`leaf-${i}`, makeBox(bx, by, bz, 0.4)]);
    }
    bootstrap(initial);

    let frameRebuildTotal = 0;
    for (let frame = 0; frame < FRAMES; frame++) {
      const operations = [];
      const wind = frame * 0.35;
      for (let i = 0; i < leafCount; i++) {
        const { bx, by, bz } = base[i];
        const swayX = Math.sin(wind + i * 0.31) * (0.5 + frame * 0.04);
        const swayZ = Math.cos(wind * 0.8 + i * 0.17) * 0.4;
        operations.push({
          type: 'update',
          id: `leaf-${i}`,
          box: makeBox(bx + swayX, by, bz + swayZ, 0.4),
        });
      }
      const rays = Array.from({ length: RAYS }, () => makeRay(random, 60));
      const frameRebuilds = runFrame(operations, rays);
      assert.ok(frameRebuilds <= 1, '每帧最多重建一次');
      frameRebuildTotal += frameRebuilds;
    }

    assert.ok(frameRebuildTotal >= 1, '持续摆动累积超预算后应触发重建');
    live.checkInvariants();
  });
});

describe('场景三：大批同位置物件（退化盒 + 批量插入删除）', () => {
  test('重复位置与零厚度盒不产生无效叶节点，两种策略查询一致', () => {
    const scene = runScenario(
      { assert },
      { seed: 33, options: { rebuildBudget: 128, maxRebuildsPerFrame: 2 }, label: 'colocated' },
    );
    const { live, runFrame, random, bootstrap } = scene;

    const batchSize = 300;
    bootstrap(Array.from({ length: batchSize }, (_, i) => [`item-${i}`, pointBox(4, 4, 4)]));

    const rng = mulberry32(123);
    for (let frame = 0; frame < FRAMES; frame++) {
      const operations = [];
      for (let k = 0; k < 24; k++) {
        const id = `item-${Math.floor(rng() * batchSize)}`;
        const roll = rng();
        if (roll < 0.4) {
          operations.push({ type: 'delete', id });
        } else if (roll < 0.7) {
          if (!live.has(id)) operations.push({ type: 'insert', id, box: pointBox(4, 4, 4) });
        } else {
          if (live.has(id)) {
            operations.push({
              type: 'update',
              id,
              box: pointBox(4 + (rng() - 0.5) * 0.001, 4, 4),
            });
          }
        }
      }
      const rays = Array.from({ length: RAYS }, () => makeRay(random));
      runFrame(operations, rays);
    }

    const origin = { x: 0, y: 0, z: 0 };
    const direction = { x: 1, y: 1, z: 1 };
    const length = Math.hypot(1, 1, 1);
    const normalized = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
    const hits = live.raycastAll(origin, normalized);
    assert.ok(hits.length > 0);
    assert.ok(hits.every((h) => Number.isFinite(h.t)));
    live.checkInvariants();
  });
});

describe('成本与确定性对比', () => {
  test('refit 成本随深度增长、rebuild 成本随叶子数增长，且统计可重复', () => {
    const build = (seed) => {
      const rng = mulberry32(seed);
      const refitTree = new DynamicBvh({ rebuildBudget: 1_000_000 });
      const rebuildTree = new DynamicBvh();
      for (let i = 0; i < 200; i++) {
        const box = makeBox(rng() * 80 - 40, rng() * 80 - 40, rng() * 80 - 40, 0.7);
        refitTree.insert(i, box);
        rebuildTree.insert(i, box);
      }
      refitTree.rebuild();
      rebuildTree.rebuild();
      const start = {
        refits: refitTree.stats.refits,
        rebuilds: rebuildTree.stats.rebuilds,
      };

      for (let i = 0; i < 30; i++) {
        const id = i % 200;
        const box = makeBox(rng() * 80 - 40, rng() * 80 - 40, rng() * 80 - 40, 0.7);
        refitTree.setBox(id, box);
        rebuildTree.setBox(id, box);
        rebuildTree.rebuild();
      }
      return {
        refitWork: refitTree.stats.refits - start.refits,
        rebuildCalls: rebuildTree.stats.rebuilds - start.rebuilds,
        rebuildLeaves: rebuildTree.stats.rebuildLeaves,
      };
    };

    const a = build(555);
    const b = build(555);
    assert.deepStrictEqual(a, b, '相同种子下成本统计必须确定');
    assert.equal(a.rebuildCalls, 30);
    assert.ok(a.refitWork > 0);
    assert.ok(a.rebuildLeaves >= 30 * 199, '每次全量重建都要处理全部存活叶子');
  });
});
