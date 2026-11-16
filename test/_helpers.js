import assert from 'node:assert/strict';

import { DynamicBvh } from '../lib/index.js';
import { idKey } from '../lib/ids.js';

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeBox(cx, cy, cz, half) {
  return {
    minX: cx - half,
    minY: cy - half,
    minZ: cz - half,
    maxX: cx + half,
    maxY: cy + half,
    maxZ: cz + half,
  };
}

export function pointBox(cx, cy, cz) {
  return { minX: cx, minY: cy, minZ: cz, maxX: cx, maxY: cy, maxZ: cz };
}

export function randomBox(random, range = 100, halfMin = 0.2, halfMax = 2) {
  const half = halfMin + random() * (halfMax - halfMin);
  return makeBox(
    (random() - 0.5) * 2 * range,
    (random() - 0.5) * 2 * range,
    (random() - 0.5) * 2 * range,
    half,
  );
}

export function makeRay(random, range = 140) {
  const origin = {
    x: (random() - 0.5) * 2 * range,
    y: (random() - 0.5) * 2 * range,
    z: (random() - 0.5) * 2 * range,
  };
  const direction = {
    x: random() * 2 - 1,
    y: random() * 2 - 1,
    z: random() * 2 - 1,
  };
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  direction.x /= length;
  direction.y /= length;
  direction.z /= length;
  return { origin, direction };
}

export function assertSameHits(t, live, reference, rays) {
  for (const { origin, direction } of rays) {
    t.assert.deepStrictEqual(
      live.raycastAll(origin, direction),
      reference.raycastAll(origin, direction),
    );
    t.assert.deepStrictEqual(
      live.raycastFirst(origin, direction),
      reference.raycastFirst(origin, direction),
    );
  }
}

/**
 * live 树按预算做 refit/有限重建；reference 树每帧全量重建。
 * 两树每帧用相同射线集合对比，结果必须完全一致。
 */
export function runScenario(t, { seed, options, label }) {
  const live = new DynamicBvh(options);
  const reference = new DynamicBvh(options);
  const objects = new Map();
  const random = mulberry32(seed);

  function runFrame(operations, rays) {
    live.checkInvariants();
    const byId = new Map();
    for (const op of operations) {
      byId.set(idKey(op.id), op);
    }
    for (const op of byId.values()) {
      if (op.type === 'insert') {
        live.insert(op.id, op.box);
        reference.insert(op.id, op.box);
        objects.set(op.id, op.box);
      } else if (op.type === 'delete') {
        if (!live.has(op.id)) continue;
        live.delete(op.id);
        reference.delete(op.id);
        objects.delete(op.id);
      } else {
        if (!live.has(op.id)) continue;
        live.setBox(op.id, op.box);
        reference.setBox(op.id, op.box);
        objects.set(op.id, op.box);
      }
    }
    const frameRebuilds = live.endFrame();
    reference.rebuild();
    assertSameHits(t, live, reference, rays);
    return frameRebuilds;
  }

  function bootstrap(entries) {
    for (const [id, box] of entries) {
      live.insert(id, box);
      reference.insert(id, box);
      objects.set(id, box);
    }
    live.rebuild();
    reference.rebuild();
    live.dirtySinceRebuild = 0;
  }

  return { live, reference, objects, random, label, runFrame, bootstrap };
}
