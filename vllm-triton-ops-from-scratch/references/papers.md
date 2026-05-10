# References

## Papers

1. **Triton: An Intermediate Language and Compiler for Tiled Neural Network Computations**
   - Philippe Tillet et al., 2019
   - Triton 编程模型的原始论文

2. **GLU Variants Improve Transformer**
   - Noam Shazeer, 2020
   - SwiGLU/GeGLU 等门控激活函数的来源
   - https://arxiv.org/abs/2002.05202

3. **Root Mean Square Layer Normalization**
   - Biao Zhang, Rico Sennrich, 2019
   - RMSNorm 的原始论文
   - https://arxiv.org/abs/1910.07467

4. **LLaMA: Open and Efficient Foundation Language Models**
   - Hugo Touvron et al., 2023
   - Llama 模型架构（使用 SwiGLU + RMSNorm）
   - https://arxiv.org/abs/2302.13971

5. **FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness**
   - Tri Dao et al., 2022
   - 算子融合在注意力机制中的应用
   - https://arxiv.org/abs/2205.14135

## vLLM Source Code

- Repository: https://github.com/vllm-project/vllm
- Key files analyzed:
  - `vllm/model_executor/custom_op.py` — CustomOp base class
  - `vllm/model_executor/layers/activation.py` — Activation functions with Triton
  - `vllm/model_executor/layers/layernorm.py` — RMSNorm implementations
  - `vllm/model_executor/models/llama.py` — Llama model
  - `vllm/triton_utils/` — Triton import utilities
  - `vllm/utils/torch_utils.py` — direct_register_custom_op
