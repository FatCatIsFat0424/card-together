// Head-to-head SPSA for bot evaluation weights: each iteration perturbs every weight by a random sign, plays the
// two perturbed vectors against each other, and moves the weights towards the winner.

export interface TuneParam {
  readonly name: string;
  readonly value: number;
  /** Size of one perturbation unit; also the scale of a step */
  readonly step: number;
  readonly min: number;
  readonly max: number;
  /** Keep the weight fixed */
  readonly fixed?: boolean;
}

export interface SpsaOptions {
  readonly iterations: number;
  /** Plays `plus` against `minus` and returns plus's mean score in [-1, 1] */
  readonly play: (plus: readonly number[], minus: readonly number[], iteration: number) => Promise<number>;
  readonly random: () => number;
  /** Learning rate in perturbation units per unit of score; default 24 */
  readonly rate?: number;
  readonly onIteration?: (iteration: number, theta: readonly number[], score: number) => void;
}

const ALPHA = 0.602;
const GAMMA = 0.101;

/** Returns the tuned values in the order of `params`. */
export async function spsa(params: readonly TuneParam[], options: SpsaOptions): Promise<number[]> {
  const theta = params.map((param) => param.value);
  const rate = options.rate ?? 24;
  const stability = options.iterations * 0.1;
  for (let iteration = 0; iteration < options.iterations; iteration++) {
    const gain = rate / (iteration + 1 + stability) ** ALPHA;
    const size = 1 / (iteration + 1) ** GAMMA;
    const signs = params.map((param) => (param.fixed ? 0 : options.random() < 0.5 ? -1 : 1));
    const shifted = (sign: number): number[] => theta.map((value, index) => {
      const param = params[index];
      return Math.min(param.max, Math.max(param.min, value + sign * signs[index] * size * param.step));
    });
    const score = await options.play(shifted(1), shifted(-1), iteration);
    theta.forEach((value, index) => {
      const param = params[index];
      if (param.fixed) return;
      // The two games differ by 2 * size perturbation units along this axis.
      const move = (gain * score * signs[index]) / (2 * size);
      theta[index] = Math.min(param.max, Math.max(param.min, value + move * param.step));
    });
    options.onIteration?.(iteration, theta, score);
  }
  return theta;
}
