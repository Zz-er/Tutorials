# reimpl-tutorial Skill 优化建议

> 在为 CORAL 项目编写「从零到精通」教程的过程中，记录 reimpl-tutorial skill 可以改进的地方。

## 1. JS 模板字面量中的反引号问题

**问题**：Skill 要求使用 Node.js builder 脚本生成 .ipynb（避免 JSON 手写问题），但没有提到当 Python 代码或 Markdown 中包含反引号（`` ` ``）时会破坏 JS 模板字面量。

**现象**：notebook 07 首次构建时 SyntaxError，因为 Python 代码中的 `` `coral eval` `` 格式化文本提前关闭了 JS 的模板字面量。

**建议**：在 skill 的「Notebook Creation Method」部分增加一节：

```markdown
### 处理反引号冲突

当 notebook 内容包含反引号时（Markdown 行内代码、Python f-string 等），
需要特殊处理：

**Markdown 单元格**：使用变量插值
```javascript
const BT = '`';     // 单反引号
const BT3 = '```';  // 三反引号
md(`使用 ${BT}coral eval${BT} 命令`);
```

**Python 代码单元格**：使用 chr(96)
```javascript
code(`bt = chr(96)  # backtick
print(f"Run {bt}coral eval{bt}")`);
```
```

**严重程度**：高 — 几乎每个教程都会遇到代码中包含反引号的情况。

---

## 2. 缺少并行构建的速率限制提醒

**问题**：Skill 说「Create notebooks serially (one at a time), not in parallel」，理由是「API rate-limit errors」。但实际上，构建 notebook 是纯本地操作（Node.js 脚本），不涉及 API 调用。真正需要串行的是 **编写** builder 脚本的过程（因为需要上下文连贯）。

**建议**：更精确地说明串行的原因：
- 编写（Write）需要串行 → 因为后续 notebook 可能引用前面的概念
- 构建（Build, node \_build\_nb.js）可以并行 → 纯本地无依赖
- 验证（Validate, JSON.parse）可以并行

---

## 3. 「保存到 our-implementation/」步骤的时机模糊

**问题**：Skill 说「Updates our-implementation/ — Write the clean module code that all subsequent notebooks will import (incremental mode only)」，但没有说清楚何时执行这个保存。在实际操作中：

- builder 脚本只生成 .ipynb 文件
- our-implementation/ 中的模块是在 **运行 notebook** 时通过代码单元格写入的
- 如果 notebook 从未在 Jupyter 中执行过，our-implementation/ 将是空的

**建议**：明确说明有两种保存策略：
1. **Notebook 运行时保存**：代码单元格包含 `open(...).write(...)` 逻辑
2. **Builder 脚本直接保存**：在 `_build_nb.js` 末尾用 `fs.writeFileSync` 同时写入 .py 文件

推荐策略 2，因为不依赖用户手动执行 notebook。

---

## 4. 中文/多语言支持指引不足

**问题**：Skill 提到「Use 「」 for Chinese quotation marks inside notebook text」，但实际使用中发现：

- 很多中文场景需要使用 `""` 双引号（如引用术语），`「」` 并非万能替代
- JSON.stringify 已经能正确处理中文双引号，不需要额外转义
- 更大的问题是 Python 字符串中的中文引号（需要在 JS 模板中正确转义 `\\"`）

**建议**：
- 删除关于 `「」` 的硬性规则
- 改为：「在 JS 模板字面量中，中文文本和双引号由 JSON.stringify 自动处理。只需注意 Python 代码中的 `\\"` 转义即可。」

---

## 5. 验证模式建议增强

**现状**：Skill 要求每个 notebook 末尾运行 pytest 验证。但对于教程类项目（如 CORAL），原始项目的测试可能依赖复杂环境（Docker、tmux、特定 Python 版本），不适合在 notebook 中直接运行。

**建议**：增加一种「自包含验证」模式：

```markdown
### 自包含验证模式

当原始测试依赖复杂环境时，改为在 notebook 中编写等价的断言测试：

```python
# 验证核心行为
assert grader.grade(code).aggregated > 0
assert len(read_attempts(coral_dir)) == 5
assert best.status == "improved"
print("All assertions passed")
```
```

---

## 6. Mermaid 图在 code() 中使用的错误提示

**现状**：Skill 说「Mermaid diagrams must go in markdown cells, never in code cells」，这很对。但在实际编写时，很容易在 `code()` 调用中不小心写入 mermaid 内容，且没有运行时错误提示。

**建议**：在 builder 脚本模板中增加一个简单的 lint 检查：

```javascript
// 在生成 notebook JSON 之前
cells.forEach((cell, i) => {
  if (cell.cell_type === 'code' && cell.source.join('').includes('```mermaid')) {
    console.warn(`WARNING: Cell ${i} is a code cell but contains mermaid diagram`);
  }
});
```

---

## 7. 缺少「跨 notebook 引用」规范

**问题**：教程中经常需要引用其他章节（如「见第 3 章」或链接到其他 notebook）。Skill 没有提供标准的引用格式。

**建议**：增加跨引用规范：
```markdown
### 跨 Notebook 引用

- 链接到其他 notebook：`[第 3 章](03-grader-system.ipynb)`
- 引用特定节：`见 [第 3 章 §2.1](03-grader-system.ipynb)（GraderInterface 协议）`
- 标准导航页脚：每个 notebook 末尾包含上一章/下一章链接
```

---

## 8. Phase 1 分析深度建议

**现状**：Skill 说「Read every source file. Map all classes, functions, and their relationships.」这在大型项目中不太现实（CORAL 有 54 个 Python 文件、~10000 行代码）。

**建议**：
- 增加「核心 vs 外围」分类指导：先读入口点和核心路径，再按需展开
- 提供一个分析优先级框架：
  1. 入口点（CLI、main）
  2. 核心数据流（输入 → 处理 → 输出）
  3. 辅助模块（按依赖关系展开）
  4. 可选功能（Web UI、Gateway 等）

---

## 9. 「痛点驱动」原则的具体化

**现状**：Skill 说「Show the failure first, then fix it」，但没有给出具体的实现模式。

**建议**：增加一个标准的「痛点 → 解决方案」代码模式：

```python
# === 痛点演示 ===
# 展示没有这个功能时会出什么问题
try:
    result = broken_approach()
    print(f"看起来可以，但是...")
except SomeError as e:
    print(f"失败！{e}")  # 让读者亲眼看到问题

print("---")

# === 解决方案 ===
# 引入本章的功能
result = our_new_approach()
print(f"问题解决: {result}")
```

---

## 10. 构建脚本清理时机

**现状**：Skill 说「After all notebooks are built and validated, delete the _build_nb*.js files.」

**问题**：这些脚本实际上是 notebook 的源码，删除后将无法重新生成或修改 notebook。如果后续需要修改某一章的内容，就只能直接编辑 JSON 格式的 .ipynb 文件（正是 skill 要求避免的事情）。

**建议**：改为「将 _build_nb*.js 移入 scripts/ 目录而非删除」，或提供一个 `build_all.sh` 脚本统一管理：

```bash
#!/bin/bash
for f in notebooks/_build_nb*.js; do
  echo "Building $f..."
  node "$f"
done
echo "All notebooks built."
```

---

## 总结

reimpl-tutorial skill 的整体设计思路非常好（JS builder 避免 JSON 问题、认知顺序排列、痛点驱动教学）。主要改进方向是：

1. **补充实战细节**：反引号冲突、跨引用格式、保存策略等在实际编写中频繁遇到的问题
2. **明确模糊规则**：中文处理、验证模式、清理时机的具体建议
3. **降低大型项目门槛**：Phase 1 分析的优先级框架

这些改进将显著减少教程编写过程中的试错成本。
