import type {
  LabelledSample,
  TrainLogisticOptions,
  TrainLogisticResult,
} from './feedback-weight-tuner.train.types';

export type {
  LabelledSample,
  TrainLogisticOptions,
  TrainLogisticResult,
} from './feedback-weight-tuner.train.types';

/** Default step size for each gradient-descent update. */
const DEFAULT_LEARNING_RATE = 0.1;

/** Default number of full-batch gradient-descent passes. */
const DEFAULT_ITERATIONS = 500;

/** Default L2 regularisation strength (λ). */
const DEFAULT_L2 = 0.01;

/** Numerical floor to keep `log()` finite inside the cross-entropy term. */
const LOG_EPSILON = 1e-12;

/** Logistic sigmoid: `1 / (1 + exp(-z))`, numerically stable for large |z|. */
function sigmoid(z: number): number {
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const expZ = Math.exp(z);
  return expZ / (1 + expZ);
}

/** Dot product of two equal-length vectors. */
function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Train an L2-regularised binary logistic-regression model via plain
 * full-batch gradient descent. Pure and dependency-free — the gradient
 * descent is implemented here rather than pulling in an ML library so the
 * tuner adds no new npm dependency.
 *
 * Model: `p = σ(wᵀx + b)`, optimised against the mean binary cross-entropy
 * loss plus an L2 penalty `½·λ·‖w‖²` (the bias `b` is left un-penalised, the
 * standard convention). Gradients:
 *
 * ```
 * ∂L/∂wⱼ = mean_i[(pᵢ − yᵢ)·xᵢⱼ] + λ·wⱼ
 * ∂L/∂b  = mean_i[(pᵢ − yᵢ)]
 * ```
 *
 * Weights start at zero (the maximally-uncertain prior). An empty sample set
 * is a valid input — it returns zero-length weights, a zero intercept, and a
 * zero loss so the caller (the weekly tuner) can fail soft.
 *
 * @param samples Labelled training rows; every `features` array must share
 *   the same length.
 * @param options Optional gradient-descent hyper-parameters.
 */
export function trainLogisticRegression(
  samples: readonly LabelledSample[],
  options: TrainLogisticOptions = {},
): TrainLogisticResult {
  const learningRate = options.learningRate ?? DEFAULT_LEARNING_RATE;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const l2 = options.l2 ?? DEFAULT_L2;

  const dimension = samples.length > 0 ? samples[0].features.length : 0;
  const weights = new Array<number>(dimension).fill(0);
  let intercept = 0;

  if (samples.length === 0 || dimension === 0) {
    return { weights, intercept, iterations, finalLoss: 0 };
  }

  const n = samples.length;

  for (let iter = 0; iter < iterations; iter++) {
    // Update weights first (returns the pre-update loss, which we discard —
    // the authoritative post-training loss is recomputed once below), then
    // update the intercept against the freshly-updated weights.
    runGradientStep(samples, weights, intercept, {
      learningRate,
      l2,
      dimension,
      n,
    });
    intercept = updateIntercept(samples, weights, intercept, {
      learningRate,
      n,
    });
  }

  const finalLoss = computeLoss(samples, weights, intercept, l2, n);

  return { weights, intercept, iterations, finalLoss };
}

interface WeightStepParams {
  readonly learningRate: number;
  readonly l2: number;
  readonly dimension: number;
  readonly n: number;
}

/**
 * Apply one gradient-descent update to the (mutable) `weights` vector and
 * return the pre-update mean loss. The intercept is updated separately by
 * {@link updateIntercept} to keep each helper's complexity within bounds.
 */
function runGradientStep(
  samples: readonly LabelledSample[],
  weights: number[],
  intercept: number,
  params: WeightStepParams,
): number {
  const gradWeights = new Array<number>(params.dimension).fill(0);
  let loss = 0;

  for (const sample of samples) {
    const p = sigmoid(dot(weights, sample.features) + intercept);
    const error = p - sample.label;
    for (let j = 0; j < params.dimension; j++) {
      gradWeights[j] += error * sample.features[j];
    }
    loss += -(
      sample.label * Math.log(p + LOG_EPSILON) +
      (1 - sample.label) * Math.log(1 - p + LOG_EPSILON)
    );
  }

  for (let j = 0; j < params.dimension; j++) {
    const grad = gradWeights[j] / params.n + params.l2 * weights[j];
    weights[j] -= params.learningRate * grad;
  }

  return loss / params.n;
}

/** Apply one gradient-descent update to the bias term and return the new value. */
function updateIntercept(
  samples: readonly LabelledSample[],
  weights: readonly number[],
  intercept: number,
  params: { readonly learningRate: number; readonly n: number },
): number {
  let gradIntercept = 0;
  for (const sample of samples) {
    const p = sigmoid(dot(weights, sample.features) + intercept);
    gradIntercept += p - sample.label;
  }
  return intercept - params.learningRate * (gradIntercept / params.n);
}

/** Mean binary cross-entropy loss plus the L2 penalty on the weights. */
function computeLoss(
  samples: readonly LabelledSample[],
  weights: readonly number[],
  intercept: number,
  l2: number,
  n: number,
): number {
  let loss = 0;
  for (const sample of samples) {
    const p = sigmoid(dot(weights, sample.features) + intercept);
    loss += -(
      sample.label * Math.log(p + LOG_EPSILON) +
      (1 - sample.label) * Math.log(1 - p + LOG_EPSILON)
    );
  }
  return loss / n + 0.5 * l2 * dot(weights, weights);
}
