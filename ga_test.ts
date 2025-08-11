import {
  generateOptimisedAssignments,
  type SimplePlayer,
} from "./ga.ts";

import {
  assertEquals,
  assertExists,
  assert,
} from "https://deno.land/std@0.203.0/testing/asserts.ts";

/**
 * These tests exercise the genetic algorithm used to generate lineups.  Rather
 * than spinning up the full HTTP service we call the helper directly with
 * simple player and position inputs.  Each test covers a different use case
 * to validate that the algorithm behaves as expected.  Because the algorithm
 * incorporates random shuffling and evolution, the exact assignment may vary
 * from run to run.  We therefore assert on general properties (such as
 * positions being assigned or left unassigned) rather than exact matches.
 */

Deno.test("balanced assignment assigns each player to a unique position", () => {
  const players: SimplePlayer[] = [
    { id: "p1", name: "Alice", pref: ["1", "2", "3"] },
    { id: "p2", name: "Bob", pref: ["2", "1", "3"] },
    { id: "p3", name: "Carol", pref: ["3", "2", "1"] },
  ];
  const positions = ["1", "2", "3"];
  const assignments = generateOptimisedAssignments(players, positions);
  // All positions should be present as keys
  assertEquals(Object.keys(assignments).sort(), positions);
  // Every position should have a player assigned (no nulls)
  for (const pos of positions) {
    assertExists(assignments[pos]);
  }
  // Each player should appear exactly once
  const assigned = Object.values(assignments);
  assertEquals(new Set(assigned).size, players.length);
});

Deno.test(
  "extra positions remain unassigned when there are more positions than players",
  () => {
    const players: SimplePlayer[] = [
      { id: "p1", name: "Alice", pref: ["A", "B"] },
      { id: "p2", name: "Bob", pref: ["B", "A"] },
    ];
    const positions = ["A", "B", "C", "D"];
    const assignments = generateOptimisedAssignments(players, positions);
    // Expect assignments for all positions
    assertEquals(Object.keys(assignments).sort(), positions);
    // Exactly two positions should be filled and the rest null
    const values = Object.values(assignments);
    const filled = values.filter((v) => v !== null);
    const empty = values.filter((v) => v === null);
    assertEquals(filled.length, players.length);
    assertEquals(empty.length, positions.length - players.length);
  },
);

Deno.test(
  "algorithm handles players without complete preference lists",
  () => {
    const players: SimplePlayer[] = [
      { id: "p1", name: "Alice", pref: ["X"] },
      { id: "p2", name: "Bob", pref: [] },
      { id: "p3", name: "Carol", pref: ["Y", "X"] },
    ];
    const positions = ["X", "Y", "Z"];
    const assignments = generateOptimisedAssignments(players, positions);
    // All positions should be present as keys
    assertEquals(Object.keys(assignments).sort(), positions);
    // At least two players should be assigned, since there are three players
    const values = Object.values(assignments);
    const filled = values.filter((v) => v !== null);
    assert(filled.length >= 2);
  },
);