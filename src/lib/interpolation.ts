// Pure interpolation helpers — no UI, no side effects (easy to unit-test).

/** Linear interpolation: estimate Y at targetX between points (x1,y1) and (x2,y2). */
export function linearInterpolate(
  x1: number, y1: number, x2: number, y2: number, targetX: number
): number {
  return y1 + ((targetX - x1) / (x2 - x1)) * (y2 - y1)
}

export interface BilinearInput {
  x1: number; x2: number; targetX: number
  y1: number; y2: number; targetY: number
  q11: number // value at X1,Y1
  q21: number // value at X2,Y1
  q12: number // value at X1,Y2
  q22: number // value at X2,Y2
}

export interface BilinearResult {
  r1: number // interpolated along X at Y1
  r2: number // interpolated along X at Y2
  result: number // interpolated along Y between r1 and r2
}

/** Bilinear interpolation across two variables (X and Y) over a 2x2 grid of values. */
export function bilinearInterpolate(input: BilinearInput): BilinearResult {
  const { x1, x2, targetX, y1, y2, targetY, q11, q21, q12, q22 } = input
  const tx = (targetX - x1) / (x2 - x1)
  const r1 = q11 + tx * (q21 - q11)
  const r2 = q12 + tx * (q22 - q12)
  const result = r1 + ((targetY - y1) / (y2 - y1)) * (r2 - r1)
  return { r1, r2, result }
}

/**
 * Format a number to a fixed number of decimals without scientific notation.
 * Returns '—' for non-finite values.
 */
export function formatNumber(value: number, decimals: number): string {
  if (!isFinite(value)) return '—'
  const d = Math.min(6, Math.max(0, decimals))
  return value.toFixed(d)
}
