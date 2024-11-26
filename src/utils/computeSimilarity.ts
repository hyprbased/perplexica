import dot from 'compute-dot';
import cosineSimilarity from 'compute-cosine-similarity';
import { getSimilarityMeasure } from '../config';

// Interface for similarity metrics
interface SimilarityMetrics {
  value: number;
  quality: number;
  confidence: number;
  method: string;
}

// Interface for vector statistics
interface VectorStats {
  mean: number;
  variance: number;
  norm: number;
}

/**
 * Computes enhanced similarity metrics between two vectors
 */
const computeSimilarity = (x: number[], y: number[]): SimilarityMetrics => {
  if (!isValidVector(x) || !isValidVector(y)) {
    throw new Error('Invalid vector input');
  }

  const similarityMeasure = getSimilarityMeasure();
  let similarityValue: number;
  
  // Normalize vectors for better comparison
  const normalizedX = normalizeVector(x);
  const normalizedY = normalizeVector(y);

  // Compute similarity based on selected measure
  switch (similarityMeasure) {
    case 'cosine':
      similarityValue = cosineSimilarity(normalizedX, normalizedY);
      break;
    case 'dot':
      similarityValue = dot(normalizedX, normalizedY);
      break;
    case 'euclidean':
      similarityValue = computeEuclideanSimilarity(normalizedX, normalizedY);
      break;
    case 'manhattan':
      similarityValue = computeManhattanSimilarity(normalizedX, normalizedY);
      break;
    case 'jaccard':
      similarityValue = computeJaccardSimilarity(normalizedX, normalizedY);
      break;
    default:
      throw new Error(`Unsupported similarity measure: ${similarityMeasure}`);
  }

  // Compute quality metrics
  const xStats = computeVectorStats(x);
  const yStats = computeVectorStats(y);
  const quality = computeQualityScore(xStats, yStats);
  const confidence = computeConfidenceScore(similarityValue, quality);

  return {
    value: similarityValue,
    quality,
    confidence,
    method: similarityMeasure
  };
};

/**
 * Validates input vector
 */
const isValidVector = (vector: number[]): boolean => {
  return vector && 
         Array.isArray(vector) && 
         vector.length > 0 && 
         vector.every(n => typeof n === 'number' && !isNaN(n));
};

/**
 * Normalizes a vector
 */
const normalizeVector = (vector: number[]): number[] => {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return magnitude === 0 ? vector : vector.map(val => val / magnitude);
};

/**
 * Computes vector statistics
 */
const computeVectorStats = (vector: number[]): VectorStats => {
  const mean = vector.reduce((sum, val) => sum + val, 0) / vector.length;
  const variance = vector.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / vector.length;
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

  return { mean, variance, norm };
};

/**
 * Computes Euclidean similarity
 */
const computeEuclideanSimilarity = (x: number[], y: number[]): number => {
  const distance = Math.sqrt(
    x.reduce((sum, val, i) => sum + Math.pow(val - y[i], 2), 0)
  );
  return 1 / (1 + distance); // Convert distance to similarity
};

/**
 * Computes Manhattan similarity
 */
const computeManhattanSimilarity = (x: number[], y: number[]): number => {
  const distance = x.reduce((sum, val, i) => sum + Math.abs(val - y[i]), 0);
  return 1 / (1 + distance); // Convert distance to similarity
};

/**
 * Computes Jaccard similarity
 */
const computeJaccardSimilarity = (x: number[], y: number[]): number => {
  const intersection = x.reduce((sum, val, i) => sum + Math.min(val, y[i]), 0);
  const union = x.reduce((sum, val, i) => sum + Math.max(val, y[i]), 0);
  return union === 0 ? 0 : intersection / union;
};

/**
 * Computes quality score based on vector statistics
 */
const computeQualityScore = (xStats: VectorStats, yStats: VectorStats): number => {
  const meanDiff = Math.abs(xStats.mean - yStats.mean);
  const varianceDiff = Math.abs(xStats.variance - yStats.variance);
  const normDiff = Math.abs(xStats.norm - yStats.norm);

  // Weighted combination of different quality factors
  return 1 - (
    0.4 * (meanDiff / Math.max(xStats.mean, yStats.mean)) +
    0.3 * (varianceDiff / Math.max(xStats.variance, yStats.variance)) +
    0.3 * (normDiff / Math.max(xStats.norm, yStats.norm))
  );
};

/**
 * Computes confidence score
 */
const computeConfidenceScore = (similarity: number, quality: number): number => {
  // Combine similarity and quality metrics for confidence
  return (similarity * 0.7 + quality * 0.3);
};

export default computeSimilarity;
export type { SimilarityMetrics, VectorStats };
