import { describe, expect, it } from 'vitest';
import { trainLogisticRegression } from './feedback-weight-tuner.train';
import type { LabelledSample } from './feedback-weight-tuner.train.types';

/**
 * A tiny 1-D linearly-separable dataset: negatives clustered near 0, positives
 * clustered near 1. A correctly-implemented logistic regression must learn a
 * positive weight + a threshold that separates the two classes.
 */
const SEPARABLE_1D: LabelledSample[] = [
  { features: [0.0], label: 0 },
  { features: [0.1], label: 0 },
  { features: [0.2], label: 0 },
  { features: [0.8], label: 1 },
  { features: [0.9], label: 1 },
  { features: [1.0], label: 1 },
];

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function predict(
  features: readonly number[],
  weights: readonly number[],
  intercept: number,
): number {
  let z = intercept;
  for (let i = 0; i < features.length; i++) {
    z += weights[i] * features[i];
  }
  return sigmoid(z);
}

function trainingAccuracy(
  samples: LabelledSample[],
  weights: readonly number[],
  intercept: number,
): number {
  let correct = 0;
  for (const s of samples) {
    const p = predict(s.features, weights, intercept);
    const predictedLabel = p >= 0.5 ? 1 : 0;
    if (predictedLabel === s.label) {
      correct++;
    }
  }
  return correct / samples.length;
}

describe('trainLogisticRegression', () => {
  it('separates a tiny linearly-separable 1-D dataset (100% training accuracy)', () => {
    const result = trainLogisticRegression(SEPARABLE_1D, { iterations: 2000 });

    const accuracy = trainingAccuracy(
      SEPARABLE_1D,
      result.weights,
      result.intercept,
    );
    expect(accuracy).toBe(1);
  });

  it('improves training accuracy over the zero-weight baseline', () => {
    const baselineAccuracy = trainingAccuracy(SEPARABLE_1D, [0], 0);
    const result = trainLogisticRegression(SEPARABLE_1D, { iterations: 2000 });
    const tunedAccuracy = trainingAccuracy(
      SEPARABLE_1D,
      result.weights,
      result.intercept,
    );

    expect(tunedAccuracy).toBeGreaterThan(baselineAccuracy);
  });

  it('learns a positive weight when the positive class has the larger feature', () => {
    const result = trainLogisticRegression(SEPARABLE_1D, { iterations: 2000 });
    expect(result.weights[0]).toBeGreaterThan(0);
  });

  it('drives the mean loss down across iterations (loss is finite and small)', () => {
    const result = trainLogisticRegression(SEPARABLE_1D, { iterations: 2000 });
    expect(Number.isFinite(result.finalLoss)).toBe(true);
    expect(result.finalLoss).toBeLessThan(0.5);
  });

  it('handles an empty dataset without throwing (zero weights, zero loss)', () => {
    const result = trainLogisticRegression([], { iterations: 10 });
    expect(result.weights).toEqual([]);
    expect(result.intercept).toBe(0);
    expect(result.finalLoss).toBe(0);
  });

  it('reports the number of iterations performed', () => {
    const result = trainLogisticRegression(SEPARABLE_1D, { iterations: 123 });
    expect(result.iterations).toBe(123);
  });

  it('separates a 2-D dataset where only the second feature is informative', () => {
    const samples: LabelledSample[] = [
      { features: [0.5, 0.0], label: 0 },
      { features: [0.2, 0.1], label: 0 },
      { features: [0.9, 0.2], label: 0 },
      { features: [0.1, 0.9], label: 1 },
      { features: [0.7, 0.8], label: 1 },
      { features: [0.4, 1.0], label: 1 },
    ];
    const result = trainLogisticRegression(samples, { iterations: 3000 });
    expect(trainingAccuracy(samples, result.weights, result.intercept)).toBe(1);
    // The informative axis (index 1) should carry more positive weight.
    expect(result.weights[1]).toBeGreaterThan(result.weights[0]);
  });
});
