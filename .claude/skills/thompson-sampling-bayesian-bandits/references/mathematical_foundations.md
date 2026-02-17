# Mathematical Foundations of Thompson Sampling

数学的厳密性を重視したThompson Samplingの理論的基礎。

## 1. ベイズ推論の基礎

### ベイズの定理

パラメータ θ とデータ D に対して：

```
P(θ | D) = P(D | θ) · P(θ) / P(D)
         = P(D | θ) · P(θ) / ∫ P(D | θ') P(θ') dθ'
```

- **P(θ)**: 事前分布 (Prior)
- **P(D | θ)**: 尤度関数 (Likelihood)
- **P(θ | D)**: 事後分布 (Posterior)
- **P(D)**: 周辺尤度 (Evidence) - 正規化定数

### 共役事前分布

尤度関数 P(x | θ) に対し、事前分布 P(θ) が事後分布と同じ分布族に属するとき、**共役事前分布**と呼ぶ。

**利点**: 事後分布が閉形式で計算可能、MCMC不要

## 2. Beta-Bernoulli モデル

### Beta分布

確率密度関数：
```
Beta(θ; α, β) = θ^(α-1) · (1-θ)^(β-1) / B(α, β)
```

ここで B(α, β) = Γ(α)Γ(β) / Γ(α+β) はベータ関数。

**モーメント**:
- 期待値: E[θ] = α / (α + β)
- 分散: Var[θ] = αβ / [(α+β)²(α+β+1)]
- 最頻値 (α, β > 1): (α-1) / (α+β-2)

### Bernoulli尤度との共役性

n回の試行で s 回成功、f = n - s 回失敗を観測：

```
P(s, f | θ) = θ^s · (1-θ)^f
```

事前分布 Beta(α, β) からの事後分布：

```
P(θ | s, f) ∝ θ^s · (1-θ)^f · θ^(α-1) · (1-θ)^(β-1)
            = θ^(α+s-1) · (1-θ)^(β+f-1)
            ~ Beta(α + s, β + f)
```

**更新則**: α_new = α + s,  β_new = β + f

## 3. Normal-Inverse-Gamma モデル

### 設定

観測 X_1, ..., X_n ~ N(μ, σ²) で μ と σ² の両方が未知。

### 事前分布

Normal-Inverse-Gamma(μ₀, λ, α, β):

```
P(μ, σ²) = P(μ | σ²) · P(σ²)
         = N(μ; μ₀, σ²/λ) · IG(σ²; α, β)
```

ここで IG(σ²; α, β) = β^α / Γ(α) · (σ²)^(-α-1) · exp(-β/σ²)

### 事後更新

n個の観測後の事後パラメータ：

```
μ_n = (λ·μ₀ + n·x̄) / (λ + n)
λ_n = λ + n
α_n = α + n/2
β_n = β + (1/2)·Σ(x_i - x̄)² + (λ·n·(x̄ - μ₀)²) / (2·(λ + n))
```

ここで x̄ = (1/n)·Σx_i は標本平均。

### μの周辺事後分布

σ²を周辺化すると、μはスチューデントt分布に従う：

```
μ | D ~ t_{2α_n}(μ_n, β_n / (α_n · λ_n))
```

## 4. Regret理論

### 定義

**累積リグレット**:
```
R(T) = Σ_{t=1}^{T} (μ* - μ_{A_t})
```

**期待リグレット**:
```
E[R(T)] = Σ_{t=1}^{T} E[μ* - μ_{A_t}]
```

### Lai-Robbins下界 (1985)

任意の一様良いポリシーに対して：

```
lim inf_{T→∞} E[R(T)] / ln T ≥ Σ_{i: μ_i < μ*} Δ_i / KL(ν_i || ν*)
```

ここで：
- Δ_i = μ* - μ_i（サブオプティマリティギャップ）
- KL(ν_i || ν*)：アーム i と最適アームの分布間のKLダイバージェンス

### Thompson Samplingのリグレット境界

**定理 (Agrawal & Goyal, 2012)**:

Bernoulli報酬に対するThompson Samplingの期待リグレット：

```
E[R(T)] ≤ (1 + ε) · Σ_{i: Δ_i > 0} (ln T / Δ_i) + O(K/ε²)
```

**定理 (Kaufmann et al., 2012)**:

Thompson Samplingは漸近的に最適：

```
lim_{T→∞} E[R(T)] / ln T = Σ_{i: Δ_i > 0} Δ_i / KL(μ_i || μ*)
```

## 5. 探索-活用トレードオフの数学的定式化

### 最適停止問題との関係

Gittins Index:

```
G_i(t) = sup_{τ > t} E[Σ_{s=t}^{τ-1} γ^{s-t} R_s | F_t] / E[Σ_{s=t}^{τ-1} γ^{s-t} | F_t]
```

割引因子 γ → 1 の極限でMAB問題に対応。

### Information-Theoretic視点

**情報利得 (Information Gain)**:

```
IG(A_t) = H(θ | D_t) - E[H(θ | D_t, A_t, R_t)]
```

Thompson Samplingは暗黙的に情報利得と即時報酬のバランスを取る。

## 6. Contextual Banditの理論

### Linear Banditモデル

報酬: E[R_t | A_t = a, x_t] = θ*ᵀ x_{t,a}

ここで x_{t,a} ∈ ℝ^d はコンテキスト-アクション特徴ベクトル。

### LinUCBのリグレット境界

```
R(T) = Õ(d√T)
```

### Linear Thompson Samplingのリグレット境界 (Agrawal & Goyal, 2013)

```
R(T) = Õ(d^{3/2} √T)
```

## 7. 事後確率マッチングの正当化

### Thompson Samplingの解釈

時刻 t での選択確率：

```
P(A_t = a | D_{t-1}) = P(a = argmax_{a'} θ_{a'} | D_{t-1})
                     = ∫ I[a = argmax_{a'} θ_{a'}] · P(θ | D_{t-1}) dθ
```

### Bayesian Regretとの関係

**Bayesian Regret**:

```
BR(T) = E_θ*[E[R(T) | θ*]]
```

Thompson Samplingは Bayesian Regret を最小化する観点で最適。

## 8. 数値計算上の注意

### Beta分布のサンプリング

大きなα, βに対する安定なサンプリング：

**方法1: Gamma比による変換**
```
X ~ Gamma(α, 1), Y ~ Gamma(β, 1)
θ = X / (X + Y) ~ Beta(α, β)
```

**方法2: 正規近似 (α, β >> 1)**
```
θ ~ N(α/(α+β), αβ/[(α+β)²(α+β+1)])
θ = clip(θ, 0, 1)
```

### 対数空間での計算

オーバーフロー回避：
```
log P(θ | D) = (α-1)·log(θ) + (β-1)·log(1-θ) - log B(α, β)
```

## 参考文献

1. Lai, T. L., & Robbins, H. (1985). Asymptotically efficient adaptive allocation rules.
2. Russo, D., Van Roy, B., Kazerouni, A., Osband, I., & Wen, Z. (2018). A Tutorial on Thompson Sampling.
3. Agrawal, S., & Goyal, N. (2012). Analysis of Thompson Sampling for the Multi-armed Bandit Problem.
4. Kaufmann, E., Korda, N., & Munos, R. (2012). Thompson Sampling: An Asymptotically Optimal Finite-Time Analysis.
5. Chapelle, O., & Li, L. (2011). An Empirical Evaluation of Thompson Sampling.
