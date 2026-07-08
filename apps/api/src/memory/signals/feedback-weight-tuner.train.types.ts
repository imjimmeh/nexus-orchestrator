/**
 * Exported interfaces for the pure logistic-regression trainer
 * (`feedback-weight-tuner.train.ts`). Kept in a dedicated `*.types.ts` file
 * to honour the project's `no-restricted-syntax` rule that bans exported
 * interfaces from non-`.types.ts` modules.
 */

/** One labelled training row: a feature vector plus a binary class label. */
export interface LabelledSample {
  /** Feature vector. Every sample in a batch must share the same length. */
  readonly features: readonly number[];
  /** Binary class label — `1` (positive) or `0` (negative). */
  readonly label: number;
}

/** Tunable gradient-descent hyper-parameters (all optional with defaults). */
export interface TrainLogisticOptions {
  /** Step size for each gradient update. Default `0.1`. */
  readonly learningRate?: number;
  /** Number of full-batch gradient-descent passes. Default `500`. */
  readonly iterations?: number;
  /** L2 regularisation strength (λ). Default `0.01`. */
  readonly l2?: number;
}

/** Result of a training run. */
export interface TrainLogisticResult {
  /** Learned per-feature weights, aligned to `LabelledSample.features`. */
  readonly weights: number[];
  /** Learned bias / intercept term. */
  readonly intercept: number;
  /** Number of gradient-descent iterations actually performed. */
  readonly iterations: number;
  /** Mean cross-entropy loss (plus L2 penalty) after the final iteration. */
  readonly finalLoss: number;
}
