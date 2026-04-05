# OpenEvolve — 特性列表（认知学习顺序）

## Level 0: 基础层

| # | 特性 | 源文件 | 依赖 | 测试 |
|---|------|--------|------|------|
| F0.1 | `Program` 数据类 | `database.py:L32-65` | 无 | `test_database.py` |
| F0.2 | 基础评估器（exec + 打分） | `evaluator.py:L80+` | 无 | `test_evaluator_timeout.py` |
| F0.3 | 配置加载（YAML） | `config.py` | pyyaml | （内联） |
| F0.4 | 代码工具（解析 EVOLVE 块） | `utils/code_utils.py` | 无 | `test_file_extension.py` |

## Level 1: 核心算法

| # | 特性 | 源文件 | 依赖 | 测试 |
|---|------|--------|------|------|
| F1.1 | MAP-Elites 网格（特征单元） | `database.py:L400-500` | F0.1 | `test_database.py`, `test_island_map_elites.py` |
| F1.2 | 特征提取 + 自适应缩放 | `database.py:L250-350` | F1.1 | `test_database.py` |
| F1.3 | 适应度计算（数值指标平均） | `database.py:L200-250` | F0.1 | `test_database.py` |
| F1.4 | 选择策略（探索/利用/随机） | `database.py:L600+` | F1.1 | `test_database.py` |
| F1.5 | 精英程序档案 | `database.py:L150-200` | F1.3 | `test_database.py` |
| F1.6 | LLM 代码生成（单模型） | `llm/openai.py` | F0.1 | （集成测试） |
| F1.7 | 提示词构建（采样器 + 模板） | `prompt/sampler.py` | F1.5, F1.6 | （内联） |
| F1.8 | 单次迭代（采样→提示→生成→评估→存储） | `iteration.py` | F1.1-F1.7 | （集成测试） |
| F1.9 | 控制器主循环 | `controller.py:L200+` | F1.8 | `test_evolution_pipeline.py` |

## Level 2: 增强层

| # | 特性 | 源文件 | 依赖 | 测试 |
|---|------|--------|------|------|
| F2.1 | 岛屿进化（多种群） | `database.py:L700+` | F1.1 | `test_island_*.py`（8 个文件） |
| F2.2 | 岛间迁移 | `database.py:L800+` | F2.1 | `test_island_migration.py` |
| F2.3 | 级联评估（3 阶段） | `evaluator.py:L150+` | F0.2 | `test_cascade_validation.py` |
| F2.4 | LLM 集成（加权多模型） | `llm/ensemble.py` | F1.6 | （集成测试） |
| F2.5 | 基于 Diff 的进化（SEARCH/REPLACE） | `utils/code_utils.py`, `prompt/sampler.py` | F1.7 | （内联） |
| F2.6 | Artifact 系统（旁路数据） | `database.py`, `evaluator.py` | F0.1 | `test_artifacts.py` |
| F2.7 | 新颖性检查（基于嵌入） | `database.py:L900+` | F1.1 | （有限） |

## Level 3: 高级 / 生产就绪

| # | 特性 | 源文件 | 依赖 | 测试 |
|---|------|--------|------|------|
| F3.1 | 进程并行（ProcessPoolExecutor） | `process_parallel.py` | F1.9 | `test_concurrent_island_access.py` |
| F3.2 | 检查点 / 恢复 | `controller.py:L400+` | F1.9 | `test_checkpoint_resume.py` |
| F3.3 | 早停（收敛检测） | `controller.py` | F1.9 | （内联） |
| F3.4 | 进化追踪（RL 日志） | `evolution_trace.py` | F1.8 | `test_evolution_trace.py` |
| F3.5 | 手动模式（人在回路） | `controller.py` | F1.9 | （有限） |
| F3.6 | 高层 API（`run_evolution`, `evolve_function`） | `api.py` | F3.1, F3.2 | `test_library_api.py` |
| F3.7 | CLI 命令行接口 | `cli.py` | F3.6 | （内联） |
| F3.8 | 可视化（网页版进化树） | `scripts/visualizer.py` | F3.2 | （手动） |

## Notebook → 特性 映射

| 章节 | 覆盖特性 | 完成后应通过的测试 |
|------|---------|-------------------|
| 00 — 为什么要做这个项目 | — | — |
| 01 — 最小可行进化器 | F0.1, F0.2（部分） | 基础 Program 测试 |
| 02 — MAP-Elites | F1.1, F1.2, F1.3 | `test_database.py`（网格测试） |
| 03 — 岛屿进化 | F2.1, F2.2 | `test_island_*.py` |
| 04 — LLM 作为变异算子 | F1.6, F1.7, F2.4 | （集成测试） |
| 05 — 级联评估 | F2.3 | `test_cascade_validation.py` |
| 06 — 基于 Diff 的进化 | F2.5 | （内联） |
| 07 — 进程并行 | F3.1 | `test_concurrent_island_access.py` |
| 08 — 检查点机制 | F3.2 | `test_checkpoint_resume.py` |
| 09 — 完整集成 | F3.3-F3.7 | 全部测试 |
