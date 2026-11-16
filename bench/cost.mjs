import { DynamicBvh } from '../lib/index.js';
import { makeBox, makeRay, mulberry32, pointBox } from '../test/_helpers.js';

function timed(fn) {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function buildScene(count, seed) {
  const rng = mulberry32(seed);
  const refitTree = new DynamicBvh({ rebuildBudget: Number.MAX_SAFE_INTEGER, rebuildQualityThreshold: Infinity });
  const rebuildTree = new DynamicBvh();
  for (let i = 0; i < count; i++) {
    const box = makeBox(rng() * 100 - 50, rng() * 100 - 50, rng() * 100 - 50, 0.8);
    refitTree.insert(i, box);
    rebuildTree.insert(i, box);
  }
  refitTree.rebuild();
  rebuildTree.rebuild();
  return { rng, refitTree, rebuildTree };
}

function runUpdateBenchmark(count, frames, movedPerFrame, seed) {
  const { rng, refitTree, rebuildTree } = buildScene(count, seed);
  const refitStats0 = { ...refitTree.stats };
  const rebuildStats0 = { ...rebuildTree.stats };

  const refitMs = timed(() => {
    for (let frame = 0; frame < frames; frame++) {
      for (let k = 0; k < movedPerFrame; k++) {
        const id = (frame * movedPerFrame + k) % count;
        refitTree.setBox(id, makeBox(rng() * 120 - 60, rng() * 120 - 60, rng() * 120 - 60, 0.8));
      }
      refitTree.endFrame();
    }
  });

  const rng2 = mulberry32(seed + 1);
  const rebuildMs = timed(() => {
    for (let frame = 0; frame < frames; frame++) {
      for (let k = 0; k < movedPerFrame; k++) {
        const id = (frame * movedPerFrame + k) % count;
        rebuildTree.setBox(id, makeBox(rng2() * 120 - 60, rng2() * 120 - 60, rng2() * 120 - 60, 0.8));
      }
      rebuildTree.rebuild();
    }
  });

  return {
    count,
    frames,
    movedPerFrame,
    refitMs: refitMs.toFixed(2),
    rebuildMs: rebuildMs.toFixed(2),
    refitNodeChanges: refitTree.stats.refits - refitStats0.refits,
    rebuildCalls: rebuildTree.stats.rebuilds - rebuildStats0.rebuilds,
    rebuildLeavesProcessed: rebuildTree.stats.rebuildLeaves - rebuildStats0.rebuildLeaves,
  };
}

function runRayBenchmark(count, seed) {
  const { rng, refitTree, rebuildTree } = buildScene(count, seed);
  const rays = Array.from({ length: 2000 }, () => makeRay(rng));

  const refitMs = timed(() => {
    for (const { origin, direction } of rays) refitTree.raycastFirst(origin, direction);
  });
  const rebuildMs = timed(() => {
    for (const { origin, direction } of rays) rebuildTree.raycastFirst(origin, direction);
  });

  return {
    count,
    refitRayMs: refitMs.toFixed(2),
    rebuildRayMs: rebuildMs.toFixed(2),
    refitRayTests: refitTree.stats.rayTests,
    rebuildRayTests: rebuildTree.stats.rayTests,
  };
}

function colocatedBenchmark() {
  const count = 1000;
  const tree = new DynamicBvh({ rebuildBudget: Number.MAX_SAFE_INTEGER, rebuildQualityThreshold: Infinity });
  for (let i = 0; i < count; i++) tree.insert(i, pointBox(5, 5, 5));
  tree.rebuild();
  const info = tree.checkInvariants();
  return { count, depth: info.maxDepth, leaves: info.leaves, internals: info.internals };
}

const rows = [
  runUpdateBenchmark(500, 30, 8, 1),
  runUpdateBenchmark(2000, 30, 8, 2),
  runRayBenchmark(2000, 3),
];

console.log('--- 更新成本（30 帧，每帧移动 8 个对象）---');
for (const row of rows.slice(0, 2)) console.table(row);
console.log('--- 2000 条射线查询成本 ---');
console.table(rows[2]);
console.log('--- 1000 个同位置退化盒（refit 树深度/节点）---');
console.table(colocatedBenchmark());
