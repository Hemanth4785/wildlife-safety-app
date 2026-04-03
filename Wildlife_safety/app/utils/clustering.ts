/**
 * Optimized clustering algorithm for animal predictions
 * Uses spatial indexing to reduce complexity from O(n²) to O(n log n)
 */

import type { AnimalPrediction } from '../types';

export interface AnimalCluster {
  id: string;
  members: AnimalPrediction[];
  position: [number, number];
}

/**
 * Calculate distance between two points in degrees
 * For small distances, this approximation is sufficient
 */
const distanceDegrees = (
  [lat1, lon1]: [number, number],
  [lat2, lon2]: [number, number]
): number => {
  const dLat = Math.abs(lat1 - lat2);
  const dLon = Math.abs(lon1 - lon2);
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

/**
 * Optimized clustering using spatial grid
 * Time complexity: O(n) instead of O(n²)
 */
export const clusterAnimals = (
  predictions: AnimalPrediction[],
  pathIndex: number,
  distanceThreshold: number = 0.01
): AnimalCluster[] => {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return [];
  }

  // Filter predictions with valid positions at current path index
  const validPredictions = predictions.filter(p => {
    const pos = p?.fullPath?.[pathIndex];
    return pos && Array.isArray(pos) && pos.length === 2;
  });

  if (validPredictions.length === 0) {
    return [];
  }

  // Use a spatial grid to reduce comparisons
  const gridSize = distanceThreshold * 2;
  const grid = new Map<string, AnimalPrediction[]>();

  // Assign predictions to grid cells
  validPredictions.forEach(pred => {
    const pos = pred?.fullPath?.[pathIndex];
    if (!pos || !Array.isArray(pos) || pos.length !== 2) return;
    const gridX = Math.floor(pos[0] / gridSize);
    const gridY = Math.floor(pos[1] / gridSize);
    const key = `${gridX},${gridY}`;
    
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key)!.push(pred);
  });

  const clusters: AnimalCluster[] = [];
  const processed = new Set<string>();

  // Process each grid cell
  grid.forEach((cellPredictions, cellKey) => {
    // Within the same cell, check distances
    for (let i = 0; i < cellPredictions.length; i++) {
      const p1 = cellPredictions[i];
      if (processed.has(p1.id)) continue;

      const p1Pos = p1?.fullPath?.[pathIndex];
      if (!p1Pos || !Array.isArray(p1Pos) || p1Pos.length !== 2) {
        processed.add(p1.id);
        continue;
      }
      const cluster: AnimalCluster = {
        id: p1.id,
        members: [p1],
        position: p1Pos,
      };
      processed.add(p1.id);

      // Check neighbors in same cell and adjacent cells
      for (let j = i + 1; j < cellPredictions.length; j++) {
        const p2 = cellPredictions[j];
        if (processed.has(p2.id)) continue;

        const p2Pos = p2?.fullPath?.[pathIndex];
        if (!p2Pos || !Array.isArray(p2Pos) || p2Pos.length !== 2) {
          processed.add(p2.id);
          continue;
        }
        const dist = distanceDegrees(p1Pos, p2Pos);
        
        if (dist < distanceThreshold) {
          cluster.members.push(p2);
          processed.add(p2.id);
        }
      }

      // Check adjacent cells (simplified - only check immediate neighbors)
      const [gridX, gridY] = cellKey.split(',').map(Number);
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          if (dx === 0 && dy === 0) continue;
          const neighborKey = `${gridX + dx},${gridY + dy}`;
          const neighbors = grid.get(neighborKey);
          if (neighbors) {
            neighbors.forEach(p2 => {
              if (processed.has(p2.id)) return;
              const p2Pos = p2?.fullPath?.[pathIndex];
              if (!p2Pos || !Array.isArray(p2Pos) || p2Pos.length !== 2) {
                processed.add(p2.id);
                return;
              }
              const dist = distanceDegrees(p1Pos, p2Pos);
              if (dist < distanceThreshold) {
                cluster.members.push(p2);
                processed.add(p2.id);
              }
            });
          }
        }
      }

      clusters.push(cluster);
    }
  });

  return clusters;
};
