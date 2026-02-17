---
name: thompson-sampling-bayesian-bandits
description: Use this skill when implementing exploration-exploitation algorithms, A/B testing optimization, multi-armed bandits, Thompson Sampling, contextual bandits, Bayesian optimization, or adaptive experimentation. Keywords: bandit, Thompson, Bayesian, UCB, regret, Beta distribution, posterior sampling.
---

# Thompson Sampling & Bayesian Bandits

Multi-Armed Bandit問題に対するベイズ的アプローチの包括的ガイド。探索-活用トレードオフを最適化するためのThompson Samplingを中心に、理論的基礎から実装パターンまでをカバー。

## 理論的基礎

### Multi-Armed Bandit問題

K個のアーム（選択肢）があり、各アームiは未知の報酬分布 ν_i を持つ。時刻 t で選択したアーム A_t から報酬 R_t ~ ν_{A_t} を観測。目標は**累積リグレット**の最小化：

```
Regret(T) = T·μ* - E[Σ_{t=1}^{T} R_t]
```

ここで μ* = max_i μ_i は最適アームの期待報酬。

### ベイズ的アプローチの本質

**事前分布 (Prior)**: 各アームの報酬パラメータ θ_i に対する事前信念 P(θ_i)
**事後分布 (Posterior)**: 観測データ D_t 後の更新された信念 P(θ_i | D_t)
**ベイズ更新**: P(θ | D) ∝ P(D | θ) · P(θ)

### 共役事前分布 (Conjugate Priors)

計算効率のために、尤度関数と同じ分布族に属する事前分布を使用：

| 報酬タイプ | 尤度 | 共役事前分布 | 事後分布 |
|-----------|------|-------------|---------|
| Bernoulli (0/1) | Bernoulli(θ) | Beta(α, β) | Beta(α + 成功, β + 失敗) |
| Gaussian (既知分散) | N(μ, σ²) | N(μ₀, σ₀²) | N(μ_post, σ_post²) |
| Gaussian (未知分散) | N(μ, σ²) | Normal-Inverse-Gamma | NIG(μ_n, λ_n, α_n, β_n) |
| Poisson | Poisson(λ) | Gamma(α, β) | Gamma(α + Σx, β + n) |

## Thompson Sampling アルゴリズム

### 核心的アイデア

**後方確率マッチング (Posterior Probability Matching)**:
各時刻 t で、アーム i が最適である事後確率に比例して選択。

### アルゴリズム

```
Thompson Sampling (Bernoulli Bandit)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
入力: K個のアーム
初期化: 各アーム i に α_i = 1, β_i = 1 (一様事前分布)

FOR t = 1, 2, ..., T:
    1. 各アーム i について:
       θ̂_i ~ Beta(α_i, β_i) をサンプリング
    
    2. アーム選択:
       A_t = argmax_i θ̂_i
    
    3. 報酬観測:
       r_t ~ Bernoulli(θ_{A_t})
    
    4. 事後更新:
       IF r_t = 1: α_{A_t} ← α_{A_t} + 1
       ELSE:       β_{A_t} ← β_{A_t} + 1
```

### 理論的保証 (Regret Bounds)

**問題依存境界 (Agrawal & Goyal, 2013)**:
```
E[Regret(T)] ≤ (1+ε) · Σ_{i: Δ_i > 0} (ln T / Δ_i) + O(K/ε²)
```
ここで Δ_i = μ* - μ_i はサブオプティマリティギャップ。

**問題非依存境界**:
```
E[Regret(T)] = O(√(KT ln T))
```

**漸近最適性**: Lai-Robbins下界に一致（Kaufmann et al., 2012）

## アルゴリズム比較

### Thompson Sampling vs UCB vs ε-greedy

| 特性 | Thompson Sampling | UCB | ε-greedy |
|-----|-------------------|-----|----------|
| **理論的保証** | 漸近最適、Bayesian regret最適 | Frequentist regret最適 | O(K ln T / ε) |
| **事前知識** | 事前分布で組み込み可能 | なし | なし |
| **計算量** | サンプリング必要 | 決定的、軽量 | 最軽量 |
| **実証性能** | 優秀 | 優秀 | 劣る |
| **非定常環境** | 適応可能（事前調整） | 変種必要 (SW-UCB) | 適応可能 |
| **バッチ更新** | 自然に対応 | 追加考慮必要 | 対応可能 |

### UCBアルゴリズム

```
UCB1:
A_t = argmax_i [ μ̂_i + c·√(ln t / N_i(t)) ]
```
- μ̂_i: アーム i の経験的平均
- N_i(t): アーム i の試行回数
- c: 探索パラメータ（通常 √2）

### 2024年の実験結果 (Performance Comparison Study)

Bernoulli報酬での比較：
- UCB: TS・ε-TSの**3倍の累積リグレット**
- Thompson Sampling: 最小リグレット、最速収束
- ε-greedy TS: TSと同等だが計算時間が長い

## 実装パターン

### パターン1: Bernoulli Bandit (A/Bテスト最適化)

```typescript
interface BernoulliBandit {
  arms: number;
  alpha: number[];  // 成功カウント + 1
  beta: number[];   // 失敗カウント + 1
}

function thompsonSamplingBernoulli(bandit: BernoulliBandit): number {
  const samples = bandit.alpha.map((a, i) => 
    betaSample(a, bandit.beta[i])
  );
  return argmax(samples);
}

function updateBernoulli(bandit: BernoulliBandit, arm: number, reward: 0 | 1): void {
  if (reward === 1) {
    bandit.alpha[arm]++;
  } else {
    bandit.beta[arm]++;
  }
}

// Beta分布からのサンプリング（NumPy相当）
function betaSample(alpha: number, beta: number): number {
  // Gamma分布を使用した変換サンプリング
  const x = gammaSample(alpha, 1);
  const y = gammaSample(beta, 1);
  return x / (x + y);
}
```

### パターン2: Gaussian Bandit (連続報酬)

未知分散の場合、Normal-Inverse-Gamma事前分布を使用：

```typescript
interface GaussianArm {
  mu: number;      // 位置パラメータ
  lambda: number;  // 精度パラメータ
  alpha: number;   // 形状パラメータ
  beta: number;    // レートパラメータ
  n: number;       // 観測数
  sum: number;     // 報酬合計
  sumSq: number;   // 報酬二乗合計
}

function updateGaussianNIG(arm: GaussianArm, reward: number): void {
  const n_new = arm.n + 1;
  const sum_new = arm.sum + reward;
  const sumSq_new = arm.sumSq + reward * reward;
  
  // NIG事後更新
  const mu_n = (arm.lambda * arm.mu + sum_new) / (arm.lambda + n_new);
  const lambda_n = arm.lambda + n_new;
  const alpha_n = arm.alpha + n_new / 2;
  const beta_n = arm.beta + 0.5 * (sumSq_new - sum_new**2/n_new) 
                 + (arm.lambda * n_new * (sum_new/n_new - arm.mu)**2) / (2 * lambda_n);
  
  Object.assign(arm, { 
    mu: mu_n, lambda: lambda_n, alpha: alpha_n, beta: beta_n,
    n: n_new, sum: sum_new, sumSq: sumSq_new 
  });
}

function sampleGaussianNIG(arm: GaussianArm): number {
  // 1. σ² ~ Inverse-Gamma(α, β)
  const sigma2 = 1 / gammaSample(arm.alpha, 1/arm.beta);
  // 2. μ | σ² ~ N(mu, σ²/λ)
  return normalSample(arm.mu, Math.sqrt(sigma2 / arm.lambda));
}
```

### パターン3: Contextual Bandit (パーソナライゼーション)

Linear Thompson Sampling（LinTS）:

```typescript
interface LinearContextualBandit {
  d: number;           // 特徴次元
  arms: number;
  // 各アームのパラメータ
  B: number[][][];     // d×d 精度行列
  f: number[][];       // d×1 特徴ベクトル累積
  mu: number[][];      // d×1 事後平均
}

function linTSSelect(
  bandit: LinearContextualBandit, 
  contexts: number[][]  // K個のコンテキストベクトル
): number {
  const samples = bandit.mu.map((mu, i) => {
    // 事後からサンプリング: θ ~ N(μ, B⁻¹)
    const Binv = matrixInverse(bandit.B[i]);
    const theta = multivariateNormalSample(mu, Binv);
    // 期待報酬 = θᵀx
    return dotProduct(theta, contexts[i]);
  });
  return argmax(samples);
}

function updateLinTS(
  bandit: LinearContextualBandit,
  arm: number,
  context: number[],
  reward: number
): void {
  // B_a ← B_a + x·xᵀ
  bandit.B[arm] = matrixAdd(bandit.B[arm], outerProduct(context, context));
  // f_a ← f_a + r·x
  bandit.f[arm] = vectorAdd(bandit.f[arm], vectorScale(context, reward));
  // μ_a = B_a⁻¹·f_a
  bandit.mu[arm] = matrixVectorMultiply(matrixInverse(bandit.B[arm]), bandit.f[arm]);
}
```

## 応用事例

### 1. A/Bテスト最適化

**従来のA/Bテスト**: 固定50/50分割 → 探索期間中の機会損失
**バンディットアプローチ**: リアルタイムでトラフィック再配分

```
使い分け:
- A/Bテスト: 大きな変更の統計的検証、長期的意思決定
- バンディット: 継続的最適化、短期的パフォーマンス重視
```

### 2. 推薦システム

- **コールドスタート問題**: 新規ユーザー/アイテムへの探索
- **Contextual Bandit**: ユーザー特徴 × コンテンツ特徴で報酬予測
- **Explore-Exploit**: 既知の良いコンテンツ vs 新規コンテンツ発見

### 3. 臨床試験 (Adaptive Trial Design)

Thompson Samplingは臨床試験設計で以下の利点：
- **倫理的**: 効果の低い治療への割り当てを減らす
- **効率的**: 従来設計より50%以上多くの患者を効果的に治療
- **Phase I/II**: 用量決定で最先端手法を上回る

### 4. 広告最適化

- クリック率（CTR）最適化
- 入札戦略最適化
- クリエイティブ選択

## 高度なトピック

### 遅延報酬 (Delayed Feedback)

現実世界では報酬が即座に観測できないことが多い。

**対処法**:
1. **バッチ更新**: 一定期間ごとにまとめて更新
2. **事後重み付け**: 遅延を考慮した事後分布調整
3. **Exp3-Delay**: 敵対的設定での遅延対応（Regret: O(√(TK + D))）

### 非定常環境 (Non-Stationary Rewards)

報酬分布が時間とともに変化する場合：

**対処法**:
1. **Sliding Window TS**: 直近W回の観測のみ使用
2. **Discounted TS**: 古い観測を指数減衰
3. **Change Detection**: 変化点検出 + リセット

```typescript
// Sliding Window Thompson Sampling
function swTS(windowSize: number): void {
  // 直近windowSize回の観測のみで事後更新
  const recentRewards = rewards.slice(-windowSize);
  alpha = 1 + recentRewards.filter(r => r === 1).length;
  beta = 1 + recentRewards.filter(r => r === 0).length;
}
```

### バッチ更新 (Batched Thompson Sampling)

**理論的結果** (2023):
- バッチサイズが準指数的に増加する場合、漸近性能は即時フィードバックと同等
- 最適バッチ数: Θ(log T)
- Instance-dependent batch complexity: O(log log T)

## 落とし穴と注意点

### 1. Prior Sensitivity（事前分布感度）

**問題**: 事前分布の選択がパフォーマンスに大きく影響

**理論的結果**:
- 良い事前分布: Regret = O(√((1-p)T))
- 悪い事前分布: Regret = O(√(T/p))
  （p: 真のモデルへの事前確率質量）

**対策**:
- 非情報事前分布から開始（Beta(1,1)、一様分布）
- ドメイン知識がある場合のみ informative prior を使用
- 事前分布ミスマッチの影響は total variation distance に比例

### 2. 数値安定性

```typescript
// 危険: α, β が大きくなると数値的に不安定
const sample = betaSample(100000, 100000);

// 対策: 対数空間での計算、または定期的なリセット
function stableBetaSample(alpha: number, beta: number): number {
  if (alpha > 1000 || beta > 1000) {
    // 正規近似を使用
    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta)**2 * (alpha + beta + 1));
    return Math.max(0, Math.min(1, normalSample(mean, Math.sqrt(variance))));
  }
  return betaSample(alpha, beta);
}
```

### 3. コールドスタート

**問題**: 初期段階でサンプルが少なく、高分散

**対策**:
- **Optimistic Initialization**: 高い初期値で探索促進
- **Exploration Bonus**: 初期に追加の探索ボーナス
- **Warm Start**: 過去データからの初期化

### 4. アーム数が多い場合

**問題**: K >> 1000 でサンプリングコストが問題に

**対策**:
- **Top-K サンプリング**: 有望なアームのみサンプリング
- **Contextual Bandit**: アームを特徴ベクトルで表現、一般化
- **階層ベイズ**: アーム間で情報共有

## 実装ライブラリ

### Python

```bash
# 推奨ライブラリ
pip install bayesianbandits  # 本番対応、scikit-learn互換
pip install vowpalwabbit     # 大規模Contextual Bandit
```

**bayesianbandits の使用例**:
```python
from bayesianbandits import ThompsonSampling, Arm
import numpy as np

# Bernoulli Bandit
arms = [Arm(np.random.default_rng(i)) for i in range(3)]
policy = ThompsonSampling()

for t in range(1000):
    arm_idx = policy.select(arms)
    reward = np.random.binomial(1, [0.3, 0.5, 0.7][arm_idx])
    arms[arm_idx].update(reward)
```

### JavaScript/TypeScript

```bash
npm install multi-armed-bandit  # 軽量実装
```

## 検証チェックリスト

Thompson Sampling実装時の確認事項：

- [ ] 共役事前分布が報酬分布に適合している
- [ ] 事前分布パラメータが適切（非情報 or ドメイン知識に基づく）
- [ ] 数値安定性を考慮（大きなα, βへの対処）
- [ ] バッチ更新の場合、バッチサイズが適切
- [ ] 非定常性がある場合、Sliding Window等で対応
- [ ] Regret のモニタリングと可視化
- [ ] オフライン評価（過去データでのシミュレーション）
- [ ] コールドスタート対策

## トラブルシューティング

### Issue: 探索が不十分

**症状**: 特定のアームに固執、新しいアームを試さない

**原因**: 事前分布が強すぎる、または初期サンプルで偏り

**対策**:
```typescript
// 探索ボーナスを追加
const explorationBonus = Math.sqrt(2 * Math.log(t) / N[arm]);
const adjustedSample = sample + explorationBonus;
```

### Issue: 収束が遅い

**症状**: 多くの試行後も最適アームに収束しない

**原因**: アーム間の差が小さい（小さいΔ）、またはノイズが大きい

**対策**:
- サンプルサイズを増やす
- コンテキスト情報を追加（Contextual Bandit化）
- より informative な事前分布を使用

### Issue: 計算コストが高い

**症状**: 大量のアームでサンプリングが遅い

**対策**:
```typescript
// Lazy評価: 必要なアームのみサンプリング
function lazyThompsonSampling(candidates: number[]): number {
  let bestArm = candidates[0];
  let bestSample = sampleArm(bestArm);
  
  for (const arm of candidates.slice(1)) {
    // 早期枝刈り: 現在のbestを超える可能性が低いアームはスキップ
    if (upperBound(arm) > bestSample) {
      const sample = sampleArm(arm);
      if (sample > bestSample) {
        bestSample = sample;
        bestArm = arm;
      }
    }
  }
  return bestArm;
}
```

## 参考文献

### 必読論文

1. **Russo et al. (2018)** "A Tutorial on Thompson Sampling" - Foundations and Trends in Machine Learning
2. **Agrawal & Goyal (2012)** "Analysis of Thompson Sampling for the Multi-armed Bandit Problem" - COLT
3. **Agrawal & Goyal (2013)** "Thompson Sampling for Contextual Bandits with Linear Payoffs" - ICML
4. **Kaufmann et al. (2012)** "Thompson Sampling: An Asymptotically Optimal Finite-Time Analysis"

### 実装リソース

- [bayesianbandits ドキュメント](https://bayesianbandits.readthedocs.io/)
- [Stanford TS Tutorial GitHub](https://github.com/iosband/ts_tutorial)

## Supporting Files

- See `./references/mathematical_foundations.md` for detailed mathematical derivations
- See `./references/algorithm_comparison.md` for comprehensive algorithm benchmarks

---
**Version:** 1.0.0
**Last Updated:** 2026-02-01
**Author:** Data Science Team
