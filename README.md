# bvh-dynamic-updater

Node.js 动态 BVH（层次包围盒）光线求交更新库，面向树冠摆动、角色移动、可破坏道具等
每帧变化的游戏场景。对象以稳定 ID 管理，支持插入、删除、AABB 修改和局部 refit；
变化超过预算或树质量劣化时，在每帧次数上限内执行全量重建。

## 设计

- **稳定 ID 索引**：`Map<idKey, 叶节点>`，数字 ID 与字符串 ID 命名空间隔离（`1` 与 `'1'` 共存），
  重复 ID 直接抛错，绝不静默覆盖。
- **增量维护**：插入用 SAH 启发式寻找最佳兄弟节点并新建内部节点；删除摘除叶节点并回收父节点；
  `setBox` 只替换叶包围盒，再沿 `parent` 链向上 refit，不触碰无关子树。
- **确定性全量重建**：选质心跨度最大轴、稳定排序（质心值 + ID 决胜）后中位切分。
  相同叶子集合在任何进程、任何调用次数下生成结构完全相同的树。
- **查询一致性**：射线遍历只依赖叶节点 AABB，命中结果按 `(t, ID)` 全序排序；
  refit 树与全量重建树对任意射线返回逐元素相同的结果。
- **边界安全**：空树查询返回空结果；点/线/面等零厚度退化 AABB 用 slab 闭合区间正确命中；
  `checkInvariants()` 校验父子指针、包围盒并集、ID 索引和表面面积记账，跨节点移动后
  不存在不可达的悬挂叶节点。

## API

```js
import { DynamicBvh } from './lib/index.js';

const bvh = new DynamicBvh({
  rebuildBudget: 32,              // 距上次重建的累计变更数阈值
  rebuildQualityThreshold: 1.5,   // 内部节点总表面积相对基线的劣化倍数；Infinity 关闭
  maxRebuildsPerFrame: 1,         // endFrame() 每帧最多重建次数；0 关闭自动重建
});

bvh.insert(id, box);               // box: {minX,minY,minZ,maxX,maxY,maxZ}
bvh.delete(id);                    // 不存在返回 false
bvh.setBox(id, box);               // 修改 AABB 并向上 refit
bvh.has(id);
bvh.getBox(id);
bvh.refit();                       // 全树自底向上收紧（局部 refit 的全量版本）
bvh.rebuild();                     // 强制全量重建并重置质量基线
const frameRebuilds = bvh.endFrame();  // 每帧调用，按预算/质量决定是否重建

bvh.raycastAll(origin, direction);     // [{id, t}, ...]，按 t、ID 排序
bvh.raycastFirst(origin, direction);   // {id, t} 或 null
bvh.checkInvariants();                 // 结构自检，返回 {leaves, internals, maxDepth}
bvh.toJSON();                          // 确定性树结构快照
bvh.stats;                             // 插入/删除/refit/重建/射线测试等计数器
```

## refit 与 rebuild 的切换条件

`endFrame()` 按以下顺序判定，且一帧最多重建 `maxRebuildsPerFrame` 次：

1. **预算触发**：`dirtySinceRebuild >= rebuildBudget`。每次插入/删除/`setBox` 累计一次变更，
   重建后清零；未重建时跨帧保留，因此小改动持续累积最终也会触发。
2. **质量触发**：`internalSa > baselineInternalSa * rebuildQualityThreshold`。
   refit 只能放大包围盒，对象长距离移动后内部节点表面积膨胀、射线被大量空盒测试拖累；
   重建后基线刷新为紧凑树的表面积。
3. 两条都不满足则只做 refit（零结构变更，成本仅为受影响祖先链的包围盒重算）。

实测（`node bench/cost.mjs`，本机数值，随机器浮动）：

| 场景（30 帧，每帧移动 8 个对象） | refit | 每帧 rebuild |
| --- | --- | --- |
| 500 对象，更新耗时 | ~1.5–2.5 ms | ~50–115 ms |
| 2000 对象，更新耗时 | ~0.7–1.4 ms | ~260–390 ms |
| 2000 对象，2000 条射线 | ~16–18 ms（包围盒膨胀后偏慢） | ~8–12 ms（树紧凑） |

结论：**局部、小幅、少量移动时 refit 的更新成本比 rebuild 低两个数量级，应保持 refit；
当单帧变更面大（预算用尽）或包围盒膨胀导致射线成本反超时，用有限次 rebuild 收回查询性能。**
这正是镜头靠近复杂场景时避免整棵重建造成帧时间尖峰的策略。

## 测试

```bash
node --test
```

覆盖内容（18 个测试）：

- 空树、清空回空树、重复 ID、非法/退化 AABB、非法 ID 不留脏状态；
- 点/线/面退化盒射线命中，200 个同位置退化盒 refit 与 rebuild 查询一致；
- 随机插入/删除/修改混合操作下，refit 树与每帧全量重建参照树逐帧查询逐元素相等；
- 对象在树两端反复跨节点移动后无悬挂叶节点；
- 预算阈值、每帧重建上限、关闭自动重建、表面积劣化质量触发；
- 相同操作序列的确定性重放，以及全量重建的结构确定性；
- 三个指定场景：移动角色（纯 refit）、树冠摆动（超预算按上限重建）、
  大批同位置物件批量增删改；
- 成本计数器的可重复性：refit 工作量随树深增长，rebuild 每次处理全部存活叶子。
