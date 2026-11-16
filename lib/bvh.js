import { internalSurfaceArea, rebuildTree } from './build.js';
import { assertId, compareIds, idKey } from './ids.js';
import {
  boxesEqual,
  copyBox,
  isValidBox,
  rayAabb,
  surfaceArea,
  unionBox,
} from './math.js';
import { BvhNode } from './node.js';

const DEFAULTS = {
  rebuildBudget: 32,
  rebuildQualityThreshold: 1.5,
  maxRebuildsPerFrame: 1,
};

export class DynamicBvh {
  constructor(options = {}) {
    this.rebuildBudget = options.rebuildBudget ?? DEFAULTS.rebuildBudget;
    this.rebuildQualityThreshold =
      options.rebuildQualityThreshold ?? DEFAULTS.rebuildQualityThreshold;
    this.maxRebuildsPerFrame = options.maxRebuildsPerFrame ?? DEFAULTS.maxRebuildsPerFrame;
    if (this.rebuildBudget < 1 || !Number.isFinite(this.rebuildBudget)) {
      throw new RangeError('rebuildBudget 必须是 >= 1 的有限数值');
    }
    if (this.maxRebuildsPerFrame < 0 || !Number.isFinite(this.maxRebuildsPerFrame)) {
      throw new RangeError('maxRebuildsPerFrame 必须是 >= 0 的有限数值');
    }

    this.root = null;
    this.leaves = new Map();
    this.internalSa = 0;
    this.baselineInternalSa = 0;
    this.dirtySinceRebuild = 0;
    this.stats = {
      inserts: 0,
      deletes: 0,
      updates: 0,
      refits: 0,
      rebuilds: 0,
      rebuildLeaves: 0,
      framesWithRebuild: 0,
      rayTests: 0,
      rayHits: 0,
    };
  }

  get size() {
    return this.leaves.size;
  }

  has(id) {
    return this.leaves.has(idKey(id));
  }

  getBox(id) {
    const leaf = this.leaves.get(idKey(id));
    return leaf ? copyBox(leaf.bounds) : undefined;
  }

  insert(id, box) {
    assertId(id);
    if (!isValidBox(box)) throw new TypeError(`对象 ${String(id)} 的 AABB 不合法`);
    const key = idKey(id);
    if (this.leaves.has(key)) {
      throw new Error(`重复 ID：${String(id)} 已存在，请先删除或使用 setBox`);
    }

    const leaf = new BvhNode(copyBox(box), id);
    if (this.root === null) {
      this.root = leaf;
    } else {
      const sibling = this.findBestSibling(box);
      const internal = new BvhNode(unionBox(sibling.bounds, box));
      const parent = sibling.parent;
      internal.parent = parent;
      internal.left = sibling;
      internal.right = leaf;
      sibling.parent = internal;
      leaf.parent = internal;
      if (parent === null) {
        this.root = internal;
      } else if (parent.left === sibling) {
        parent.left = internal;
      } else {
        parent.right = internal;
      }
      this.internalSa += internal.sa;
      this.refitUp(parent);
    }

    this.leaves.set(key, leaf);
    this.stats.inserts++;
    this.bumpChange();
    return this;
  }

  delete(id) {
    assertId(id);
    const key = idKey(id);
    const leaf = this.leaves.get(key);
    if (leaf === undefined) return false;

    const parent = leaf.parent;
    if (parent === null) {
      this.root = null;
    } else {
      const grand = parent.parent;
      const sibling = parent.left === leaf ? parent.right : parent.left;
      this.internalSa -= parent.sa;
      if (grand === null) {
        this.root = sibling;
        sibling.parent = null;
      } else {
        sibling.parent = grand;
        if (grand.left === parent) grand.left = sibling;
        else grand.right = sibling;
        this.refitUp(grand);
      }
    }

    this.leaves.delete(key);
    this.stats.deletes++;
    this.bumpChange();
    return true;
  }

  setBox(id, box) {
    assertId(id);
    if (!isValidBox(box)) throw new TypeError(`对象 ${String(id)} 的 AABB 不合法`);
    const leaf = this.leaves.get(idKey(id));
    if (leaf === undefined) throw new Error(`对象 ${String(id)} 不存在`);

    leaf.setBox(box);
    if (leaf.parent !== null) this.refitUp(leaf.parent);
    this.stats.updates++;
    this.bumpChange();
    return this;
  }

  /** 自底向上重新收紧所有内部节点包围盒（局部 refit 的全量版本）。 */
  refit() {
    if (this.root === null) return 0;
    const order = [];
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop();
      order.push(node);
      if (!node.isLeaf) stack.push(node.left, node.right);
    }
    let changed = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      const node = order[i];
      if (node.isLeaf) continue;
      if (this.refreshBounds(node)) changed++;
    }
    return changed;
  }

  /**
   * 帧结束结算：变化量超过预算，或内部节点总表面面积相对基线劣化超过阈值时，
   * 在每帧次数上限内执行全量重建。返回本帧实际重建次数。
   */
  endFrame() {
    let frameRebuilds = 0;
    const tryRebuild = () => {
      if (frameRebuilds >= this.maxRebuildsPerFrame) return false;
      this.rebuild();
      frameRebuilds++;
      this.stats.framesWithRebuild++;
      return true;
    };

    if (this.dirtySinceRebuild >= this.rebuildBudget) {
      tryRebuild();
    } else if (
      Number.isFinite(this.rebuildQualityThreshold) &&
      this.baselineInternalSa > 0 &&
      this.internalSa > this.baselineInternalSa * this.rebuildQualityThreshold
    ) {
      tryRebuild();
    }
    if (frameRebuilds > 0) this.dirtySinceRebuild = 0;
    return frameRebuilds;
  }

  /** 强制全量重建并重置质量基线。 */
  rebuild() {
    const newRoot = rebuildTree([...this.leaves.values()]);
    this.root = newRoot;
    this.internalSa = internalSurfaceArea(newRoot);
    this.baselineInternalSa = this.internalSa;
    this.dirtySinceRebuild = 0;
    this.stats.rebuilds++;
    this.stats.rebuildLeaves += this.leaves.size;
    return this;
  }

  raycastAll(origin, direction) {
    this.assertRay(origin, direction);
    const hits = [];
    if (this.root === null) return hits;
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop();
      this.stats.rayTests++;
      const t = rayAabb(origin, direction, node.bounds);
      if (t === null) continue;
      if (node.isLeaf) {
        this.stats.rayHits++;
        hits.push({ id: node.id, t });
      } else {
        stack.push(node.right, node.left);
      }
    }
    hits.sort((a, b) => (a.t !== b.t ? a.t - b.t : compareIds(a.id, b.id)));
    return hits;
  }

  raycastFirst(origin, direction) {
    this.assertRay(origin, direction);
    if (this.root === null) return null;
    let best = null;
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop();
      this.stats.rayTests++;
      const t = rayAabb(origin, direction, node.bounds);
      if (t === null) continue;
      if (best !== null && t > best.t) continue;
      if (node.isLeaf) {
        this.stats.rayHits++;
        if (best === null || t < best.t || (t === best.t && compareIds(node.id, best.id) < 0)) {
          best = { id: node.id, t };
        }
      } else {
        stack.push(node.right, node.left);
      }
    }
    return best;
  }

  toJSON() {
    if (this.root === null) return null;
    const serialize = (node) =>
      node.isLeaf
        ? { leaf: true, id: node.id, bounds: copyBox(node.bounds) }
        : {
            bounds: copyBox(node.bounds),
            left: serialize(node.left),
            right: serialize(node.right),
          };
    return serialize(this.root);
  }

  /** 校验父/子指针、包围盒、ID 索引和表面面积记账，任何悬挂或无效叶节点直接抛错。 */
  checkInvariants() {
    if (this.root === null) {
      if (this.leaves.size !== 0) throw new Error('空树根节点仍残留叶节点索引');
      if (this.internalSa !== 0) throw new Error('空树内部表面面积记账非 0');
      return { leaves: 0, internals: 0, maxDepth: 0 };
    }

    let leafCount = 0;
    let internals = 0;
    let maxDepth = 0;
    let computedSa = 0;
    const reachable = new Set();
    const stack = [{ node: this.root, depth: 0 }];

    while (stack.length > 0) {
      const { node, depth } = stack.pop();
      if (reachable.has(node)) throw new Error('树中出现重复节点（结构成环）');
      reachable.add(node);
      if (depth > maxDepth) maxDepth = depth;
      if (!isValidBox(node.bounds)) throw new Error('存在退化或非法包围盒节点');

      if (node.isLeaf) {
        leafCount++;
        if (this.leaves.get(idKey(node.id)) !== node) {
          throw new Error(`叶节点 ${String(node.id)} 与 ID 索引不一致`);
        }
        continue;
      }

      internals++;
      computedSa += node.sa;
      if (node.left === null || node.right === null) {
        throw new Error('内部节点缺少子节点');
      }
      if (node.left.parent !== node || node.right.parent !== node) {
        throw new Error('子节点 parent 指针悬挂');
      }
      const merged = unionBox(node.left.bounds, node.right.bounds);
      if (!boxesEqual(merged, node.bounds)) {
        throw new Error('内部节点包围盒与子节点并集不一致');
      }
      stack.push({ node: node.right, depth: depth + 1 }, { node: node.left, depth: depth + 1 });
    }

    if (leafCount !== this.leaves.size) {
      throw new Error(`可达叶节点 ${leafCount} 与索引数量 ${this.leaves.size} 不一致`);
    }
    for (const [key, leaf] of this.leaves) {
      if (!reachable.has(leaf)) throw new Error(`ID ${key} 对应不可达的悬挂叶节点`);
    }
    const saError = computedSa === 0 ? 0 : Math.abs(computedSa - this.internalSa) / computedSa;
    if (saError > 1e-12) {
      throw new Error(`内部表面面积记账错误：${this.internalSa} != ${computedSa}`);
    }
    return { leaves: leafCount, internals, maxDepth };
  }

  bumpChange() {
    this.dirtySinceRebuild++;
  }

  refreshBounds(node) {
    const merged = unionBox(node.left.bounds, node.right.bounds);
    if (boxesEqual(merged, node.bounds)) return false;
    this.internalSa -= node.sa;
    node.bounds = merged;
    this.internalSa += node.sa;
    this.stats.refits++;
    return true;
  }

  refitUp(start) {
    let node = start;
    while (node !== null) {
      this.refreshBounds(node);
      node = node.parent;
    }
  }

  findBestSibling(box) {
    const leafSa = surfaceArea(box);
    let best = null;
    let bestCost = Infinity;
    const stack = [{ node: this.root, inherited: 0 }];

    while (stack.length > 0) {
      const { node, inherited } = stack.pop();
      const combinedSa = surfaceArea(unionBox(node.bounds, box));
      const directCost = inherited + combinedSa;
      if (
        directCost < bestCost ||
        (directCost === bestCost && best !== null && node.sequence < best.sequence)
      ) {
        bestCost = directCost;
        best = node;
      }
      if (node.isLeaf) continue;
      if (combinedSa === 0 || inherited + leafSa < bestCost) {
        stack.push(
          { node: node.right, inherited: directCost },
          { node: node.left, inherited: directCost },
        );
      }
    }
    return best;
  }

  assertRay(origin, direction) {
    for (const v of [origin, direction]) {
      if (v === null || typeof v !== 'object') {
        throw new TypeError('射线 origin/direction 必须是带 x/y/z 的对象');
      }
    }
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isFinite(origin[axis]) || !Number.isFinite(direction[axis])) {
        throw new TypeError(`射线 ${axis} 分量必须是有限数值`);
      }
    }
  }
}
