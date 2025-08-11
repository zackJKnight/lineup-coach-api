/*
 * Genetic algorithm utilities for lineup generation.
 *
 * This module implements a simplified genetic algorithm inspired by the
 * lineup optimisation code from the LineupCoach Angular client.  The
 * original implementation operates on multiple periods and uses
 * Lodash for shuffling and a variety of helper functions to measure
 * fairness.  Here we adapt those ideas into plain TypeScript to run
 * inside the Deno runtime.  Given a set of players and positions the
 * algorithm attempts to find an arrangement that maximises a simple
 * fairness metric: the average preference score divided by the
 * distribution of scores.  A higher ratio indicates that players are
 * generally playing positions they prefer and that the difference in
 * scores across players is small (i.e. the lineup is fair).
 *
 * The algorithm works as follows:
 *   1. Represent each candidate lineup as a sequence of `genes` where
 *      each gene is an array of players assigned to positions for
 *      every period.  In this simplified implementation we only
 *      consider a single period, so `genes` is a 2D array with one
 *      element.
 *   2. Generate an initial population of random lineups by
 *      shuffling the player list for each period.
 *   3. Compute a fitness score for each candidate using
 *      `getGameScoreRatio`.  Higher scores are better.
 *   4. Select parents probabilistically based on their fitness and
 *      perform crossover to produce children.  Occasionally mutate
 *      children by reshuffling their genes.
 *   5. Repeat generation and evaluation to evolve towards better
 *      lineups.  After a fixed number of generations, return the
 *      best candidate.
 *
 * While this implementation captures the essence of the genetic
 * algorithm, it deliberately keeps the population size and number of
 * generations small to ensure the API responds in a timely manner on
 * Deno Deploy.  Feel free to tweak `POP_MAX`, `MUTATION_RATE` and
 * `GENERATIONS` if you need higher quality lineups and can tolerate
 * additional compute time.
 */

// Type definitions for clarity
export interface SimplePlayer {
  /** A human‑readable name. */
  name: string;
  /** Ordered list of preferred position names. */
  pref: string[];
  /** Original player ID so we can reference back when building the final lineup. */
  id: string;
}

// Create a blank game with the specified number of periods and positions.
function createGame(periodCount: number, positions: string[]): SimplePlayer[][] {
  const game: SimplePlayer[][] = [];
  for (let i = 0; i < periodCount; i++) {
    const period: SimplePlayer[] = [];
    for (let j = 0; j < positions.length; j++) {
      period.push();
    }
    game.push(period);
  }
  return game;
}

// Shuffle an array in place using the Fisher–Yates algorithm.  We
// implement our own shuffle rather than relying on Lodash to avoid
// pulling in an entire dependency.  The input array is not mutated; a
// new shuffled array is returned.
function shuffle<T>(array: T[]): T[] {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generate an initial game by shuffling players for each period.  If
// positions is undefined or empty an empty game is returned.
function generateGamePlacementFromShuffle(
  periodCount: number,
  players: SimplePlayer[],
  positions: string[],
): SimplePlayer[][] {
  if (!positions || positions.length === 0) {
    return [];
  }
  const game = createGame(periodCount, positions);
  for (let i = 0; i < periodCount; i++) {
    if (game[i].every((spot) => spot === undefined)) {
      const evaluationPeriod = shuffle(players);
      game[i] = evaluationPeriod;
    }
  }
  return game;
}

// Sum preference scores for each player.  Each player's score is
// computed by iterating over the game and adding (positions.length -
// index) for each time the player is assigned to position `j`, where
// `index` is the player's ranking of that position (0 if most
// preferred).  Players with no preference for a position receive a
// score of 0 for that assignment.  A higher sum indicates that the
// player is generally playing positions they prefer.
function sumPlayerScores(
  game: SimplePlayer[][],
  players: SimplePlayer[],
  positions: string[],
  periodCount: number,
): number[] {
  const playerScores: number[] = [];
  if (!players || !positions) return playerScores;
  for (const player of players) {
    let playerScore = 0;
    for (let i = 0; i < periodCount; i++) {
      for (let j = 0; j < positions.length; j++) {
        const assigned = game[i][j];
        if (assigned && assigned.name === player.name) {
          const rankIndex = player.pref.indexOf(positions[j]);
          // If the player has ranked this position, higher preference yields
          // a higher score.  Unranked positions contribute zero.
          if (rankIndex >= 0) {
            playerScore += positions.length - rankIndex;
          }
        }
      }
    }
    playerScores.push(playerScore);
  }
  return playerScores;
}

// Average of an array of numbers.  Returns 0 for an empty array.
function getAveragePlayerScore(playerScores: number[]): number {
  if (playerScores.length === 0) return 0;
  return playerScores.reduce((a, b) => a + b, 0) / playerScores.length;
}

// Compute a distribution measure for the scores.  This function sorts
// the scores in descending order and sums the differences between
// adjacent scores.  A smaller sum implies that scores are more
// tightly clustered (fair).  If there is only one score the
// distribution is defined as 0.
function getGameScoreDistribution(playerScores: number[]): number {
  const sorted = playerScores.slice().sort((a, b) => b - a);
  const diffs: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    diffs.push(sorted[i] - sorted[i + 1]);
  }
  if (diffs.length === 0) return 0;
  return diffs.reduce((a, b) => a + b, 0);
}

// Compute the ratio of the average player score to the distribution of
// scores plus one.  A higher ratio means players on average have
// higher scores and the distribution is lower (fairer).  The +1
// prevents division by zero.
function getGameScoreRatio(
  game: SimplePlayer[][],
  players: SimplePlayer[],
  positions: string[],
  periodCount: number,
): number {
  const playerScores = sumPlayerScores(game, players, positions, periodCount);
  const avg = getAveragePlayerScore(playerScores);
  const distrib = getGameScoreDistribution(playerScores);
  return avg / (distrib + 1);
}

// DNA represents a candidate solution (lineup) in the population.
// Each DNA instance has a set of `genes` (2D array of players) and a
// `fitness` value.  The `players` and `positions` arrays are shared
// references used during mutation and fitness calculation.
class DNA {
  genes: SimplePlayer[][];
  fitness: number;
  players: SimplePlayer[];
  positions: string[];
  periodCount: number;

  constructor(periodCount: number, players: SimplePlayer[], positions: string[]) {
    this.players = players;
    this.positions = positions;
    this.periodCount = periodCount;
    this.genes = generateGamePlacementFromShuffle(periodCount, players, positions);
    this.fitness = 0;
  }

  // Calculate fitness using the ratio function.  The `target` is not
  // actually used in this simplified algorithm but is accepted for
  // API compatibility.
  calcFitness(target: SimplePlayer[][]): void {
    this.fitness = getGameScoreRatio(this.genes, this.players, this.positions, this.periodCount);
  }

  // Produce a child by mixing genes from this DNA and a partner.  A
  // midpoint is chosen at random and genes on one side come from the
  // current individual while the rest come from the partner.  Note
  // that genes is a 2D array but we treat the first dimension (periods)
  // as the sequence and copy rows accordingly.
  crossover(partner: DNA): DNA {
    const child = new DNA(this.periodCount, this.players, this.positions);
    const midpoint = Math.floor(Math.random() * this.genes.length);
    for (let i = 0; i < this.genes.length; i++) {
      if (i > midpoint) child.genes[i] = this.genes[i];
      else child.genes[i] = partner.genes[i];
    }
    return child;
  }

  // Mutate the genes with a given probability.  If mutation occurs at
  // index i, the gene (player array for that period) is shuffled.
  mutate(mutationRate: number): void {
    for (let i = 0; i < this.genes.length; i++) {
      if (Math.random() < mutationRate) {
        this.genes[i] = shuffle(this.players);
      }
    }
  }
}

// Population holds a pool of candidate solutions and drives the
// evolution process.  It manages selection, crossover, mutation and
// evaluation of individuals.
class Population {
  population: DNA[];
  mutationRate: number;
  generations: number;
  finished: boolean;
  target: SimplePlayer[][];
  best: DNA | null;
  perfectScore: number;

  constructor(
    target: SimplePlayer[][],
    mutationRate: number,
    popMax: number,
    players: SimplePlayer[],
    positions: string[],
  ) {
    this.target = target;
    this.mutationRate = mutationRate;
    this.generations = 0;
    this.finished = false;
    this.perfectScore = 8; // arbitrary threshold; not used in fairness algorithm
    this.population = [];
    for (let i = 0; i < popMax; i++) {
      this.population[i] = new DNA(target.length, players, positions);
    }
    this.best = null;
    this.calcFitness();
  }

  calcFitness(): void {
    for (const individual of this.population) {
      individual.calcFitness(this.target);
    }
  }

  // Create a new generation via selection, crossover and mutation.
  generate(): void {
    let maxFitness = 0;
    for (const individual of this.population) {
      if (individual.fitness > maxFitness) {
        maxFitness = individual.fitness;
      }
    }
    const newPopulation: DNA[] = [];
    for (let i = 0; i < this.population.length; i++) {
      const partnerA = this.acceptReject(maxFitness);
      const partnerB = this.acceptReject(maxFitness);
      if (partnerA && partnerB) {
        let child = partnerA.crossover(partnerB);
        child.mutate(this.mutationRate);
        newPopulation[i] = child;
      } else {
        // fallback: if selection fails, clone existing individual
        newPopulation[i] = this.population[i];
      }
    }
    if (newPopulation.length > 0) {
      this.population = newPopulation;
      this.generations++;
      this.calcFitness();
    }
  }

  // Probabilistically pick an individual based on fitness.  Uses
  // rejection sampling: pick a random individual and accept with
  // probability proportional to its fitness relative to maxFitness.
  acceptReject(maxFitness: number): DNA | null {
    let attempt = 0;
    while (true) {
      const index = Math.floor(Math.random() * this.population.length);
      const partner = this.population[index];
      const r = Math.random() * maxFitness;
      if (r < partner.fitness) {
        return partner;
      }
      attempt++;
      if (attempt > 10000) return null;
    }
  }

  evaluate(): void {
    let worldRecord = 0;
    let index = 0;
    for (let i = 0; i < this.population.length; i++) {
      if (this.population[i].fitness > worldRecord) {
        index = i;
        worldRecord = this.population[i].fitness;
      }
    }
    this.best = this.population[index];
    if (worldRecord >= this.perfectScore) {
      this.finished = true;
    }
  }
}

/**
 * Generate an optimised lineup using a genetic algorithm.  Given a list
 * of simple players and position names, this function evolves a
 * population of candidate lineups over a small number of generations
 * and returns the assignments from the best candidate.  Each
 * candidate lineup represents a single period (one set of position
 * assignments).  The resulting assignments map position names to
 * player IDs.  Any positions without a corresponding player are
 * assigned `null`.
 *
 * @param players Array of simple player objects with `name`, `pref` and
 *        `id` properties.
 * @param positions Array of position names.
 * @param periodCount Number of periods (defaults to 1).  Only the
 *        first period's assignments are used in the result.
 */
export function generateOptimisedAssignments(
  players: SimplePlayer[],
  positions: string[],
  periodCount = 1,
): Record<string, string | null> {
  // When there are no players or positions we cannot generate a
  // lineup.  Return an empty mapping.
  if (players.length === 0 || positions.length === 0) {
    const empty: Record<string, string | null> = {};
    for (const pos of positions) empty[pos] = null;
    return empty;
  }
  // Build a target placeholder for the population constructor.  In the
  // original code this was the desired arrangement, but here we use
  // a blank game of the appropriate dimensions.
  const target: SimplePlayer[][] = createGame(periodCount, positions);
  // Genetic algorithm parameters.  These values strike a balance
  // between quality and performance.  Increase POP_MAX or
  // GENERATIONS to potentially improve results at the cost of
  // execution time.
  const POP_MAX = 30;
  const MUTATION_RATE = 0.1;
  const GENERATIONS = 10;
  const population = new Population(target, MUTATION_RATE, POP_MAX, players, positions);
  for (let i = 0; i < GENERATIONS; i++) {
    population.generate();
    population.evaluate();
    if (population.finished) break;
  }
  // After evolution, pick the best individual.  Guard against
  // undefined by using a fallback to the first population member.
  const best = population.best ?? population.population[0];
  const genes = best.genes;
  const assignments: Record<string, string | null> = {};
  // Use only the first period's genes.  Each entry in genes[0] is a
  // player assigned to the corresponding position index.
  const period = genes[0];
  for (let i = 0; i < positions.length; i++) {
    const player = period[i];
    assignments[positions[i]] = player ? player.id : null;
  }
  return assignments;
}