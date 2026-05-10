# Tutorial Summary

## Notebooks

| # | File | Description |
|---|------|-------------|
| 00 | `00-why-this-project.ipynb` | 项目动机：为什么 LLM 推理需要自定义算子，vLLM 的算子架构全景，Triton 的定位，三个实战场景预览 |
| 01 | `01-triton-kernel-basics.ipynb` | Triton 编程模型基础：program_id/BLOCK_SIZE/mask，向量加法，SiLU kernel，2D Grid，vLLM 的 Triton 兼容性处理 |
| 02 | `02-custom-op-registration.ipynb` | CustomOp 注册系统：基类设计，@register 装饰器，forward_native/forward_cuda 双路径，平台自动分发，SiluAndMul 实现 |
| 03 | `03-fused-operators.ipynb` | 融合算子：Memory-bound 分析与算术强度，Fused SiLU+Mul，Fused Add+RMSNorm，@triton.autotune 自动调优 |
| 04 | `04-replace-model-ops.ipynb` | 模型级替换：Llama 算子调用链分析，OOT 注册机制，Triton 替换 SiluAndMul/RMSNorm，端到端 Llama 集成 |
| 05 | `05-full-integration.ipynb` | 完整集成：端到端开发流程（ClampedGeGLU），性能 Benchmark，最佳实践，常见陷阱，全教程知识图谱 |
| 06 | `06-vllm-matmul-landscape.ipynb` | 矩阵乘法全景：GQA/MLA/GDN/MoE/MLP 的 GEMM 算子，Triton vs cuBLAS vs FlashAttention 的选择逻辑 |
| 07 | `07-fused-moe-triton-gemm.ipynb` | Fused MoE Triton GEMM：Token 路由、Expert 选择、从 Naive 到 vLLM 级的 5 个版本递进实现 |
| 08 | `08-triton-attention-gemm.ipynb` | 注意力 GEMM：Prefill FlashAttention、Decode Flash-Decoding、GQA Grouped Kernel、MLA BLOCK_DPE |
| 09 | `09-performance-comparison.ipynb` | 性能对比：Triton Ultimate vs cuBLAS vs vLLM MoE，差距根因分析，选型决策树 |
| 10 | `10-tp-communication-gemm.ipynb` | TP通信与GEMM协同：ColumnParallel/RowParallel原理，Llama TP2全流程模拟，MoE TP vs EP，通信-计算重叠 |
| 11 | `11-custom-triton-gemm-on-qwen.ipynb` | 实战：在 Qwen3.5 上部署自定义 Triton GEMM，三条替换路径（CustomOp/PluggableLayer/GEMM分发），选择性替换，插件化部署 |
| 12 | `12-cuda-graph-and-gemm.ipynb` | CUDA Graph 机制全解：CPU launch 开销、capture/replay 原理、vLLM 5 种模式、capture sizes 与 padding、对 GEMM M/N/K 的影响、torch.compile 交互、自定义 Triton GEMM 注意事项 |
