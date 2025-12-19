# Ice Maze Generation Algorithm - Technical Deep Dive

**Author**: Generated from source analysis  
**Date**: 2025-12-10  
**Source**: `generator-rust/src/generators/ice.rs`

---

## **Core Concept**

The algorithm generates ice sliding puzzles through **stochastic parallel generation** with **progressive trap injection** and **multi-stage validation**. It runs thousands of attempts in parallel, each attempt building a maze by layering 20+ psychological trap patterns, then filters for exact specifications.

**Key Innovation**: Rather than solving constraints upfront, the algorithm generates thousands of candidates and filters for exact difficulty/psychology requirements.

---

## **Table of Contents**

1. [Phase 1: Setup & Configuration](#phase-1-setup--configuration)
2. [Phase 2: Parallel Generation Loop](#phase-2-parallel-generation-loop)
3. [Phase 3: Validation Pipeline](#phase-3-validation-pipeline)
4. [Phase 4: Selection & Iteration](#phase-4-selection--iteration)
5. [Why This Works](#why-this-works)

---

## **PHASE 1: Setup & Configuration**

### **1.1 Map Size Selection**

Currently configured:
```rust
const SIZE_OPTIONS: [(usize, usize); 1] = [(15, 15)];
```

Expandable to support multiple sizes with weighted random selection.

### **1.2 Compute Scaled Parameters**

All difficulty thresholds scale based on map size using reference 35×35:

```rust
scale = min_dimension / 35.0
```

**Example for 15×15**:
- Scale = 15/35 = 0.43
- `required_optimal_moves` = 10 moves (target solution length)
- `prefilter_thresholds`:
  - `min_counter_intuitive` ≥ 3 (moves away from goal on optimal path)
  - `min_attractive_decoys` ≥ 4 (wrong paths that look right)
  - `min_commitment_gates` ≥ 2 (early choices that matter later)
  - `min_false_progress` ≥ 4 (paths that get closer but dead-end)

**These are hard minimum requirements.** Any maze not meeting ALL gets rejected.

### **1.3 Weighting Constants**

```rust
const WEIGHT_COUNTER_INTUITIVE: f64 = 70.0;
const WEIGHT_ATTRACTIVE_DECOYS: f64 = 80.0;
const WEIGHT_COMMITMENT_GATES: f64 = 70.0;
const WEIGHT_FALSE_PROGRESS: f64 = 100.0;
const WEIGHT_MOVE_BONUS: f64 = 0.5;
const TARGET_PSYCHOLOGY_SCORE: f64 = 800.0;
```

These weights determine what makes a "good" puzzle in the scoring phase.

---

## **PHASE 2: Parallel Generation Loop**

Runs in batches of 1000 attempts (configurable via `TRADITIONAL_ATTEMPTS`). Each attempt is **fully independent** and deterministic from seed.

### **2.1 Seed Initialization**

Each attempt gets unique seed: `"{base_seed}-trad-{attempt_index}"`

**Example**: `"2025-12-10-trad-473"`

Uses **Alea PRNG** (JavaScript seedrandom port) for cross-platform determinism between Rust and TypeScript implementations.

---

### **STEP 1: Create Base Maze**

**Function**: `create_base_maze(width, height, rng)`

**Algorithm**: Recursive backtracking with **step-1 carving**

```
1. Initialize: All tiles = Wall
2. Pick random inner start position (x, y) where 1 ≤ x < width-1, 1 ≤ y < height-1
3. Carve from start:
   a. Mark current as Ice
   b. Shuffle 4 directions: [Up, Down, Left, Right]
   c. For each direction:
      - Move 1 step in direction
      - If unvisited inner cell → recurse
```

**Key Detail**: "Step-1" means each carving move is exactly 1 cell, not 2. This creates **single-thick walls** between passages (not double-thick), resulting in more open, connected mazes.

**Code Reference**:
```rust
fn carve(
    tiles: &mut Vec<Vec<TileType>>,
    visited: &mut HashSet<Position>,
    x: i32,
    y: i32,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
) {
    let pos = Position { x, y };
    visited.insert(pos);
    tiles[y as usize][x as usize] = TileType::Ice;

    let dirs = [(0, -1), (0, 1), (-1, 0), (1, 0)];
    let shuffled = rng.shuffle(&dirs);

    for (dx, dy) in shuffled {
        let nx = x + dx;
        let ny = y + dy;
        let npos = Position { x: nx, y: ny };
        if is_inner(nx, ny, width, height) && !visited.contains(&npos) {
            carve(tiles, visited, nx, ny, width, height, rng);
        }
    }
}
```

**Output**: Fully connected ice maze with perimeter walls intact.

---

### **STEP 2: Structural Foundation Layers**

#### **2.2.1 Widen Passages**

**Function**: `widen_passages(tiles, width, height, rng, intensity)`

- **Purpose**: Break up narrow corridors
- **Method**: 
  - Pick random wall tiles
  - If wall has ≥2 adjacent ice tiles → convert to ice
- **Intensity**: 20% of map area
- **Result**: Reduces maze "tightness", creates more open areas

**Example**:
```
Before:         After:
#####           #####
#...#           #...#
##.##    →      #...#  (middle wall removed)
#...#           #...#
#####           #####
```

#### **2.2.2 Add Extra Connections**

**Function**: `add_extra_connections(tiles, start, goal, width, height, rng, count)`

- **Count**: 35-60 base (scales to 15-26 for 15×15)
- **Method**: 
  - Find random wall tiles adjacent to ice
  - Convert wall → ice if it doesn't trivialize the maze
  - Validates solvability after each change
- **Result**: Creates shortcuts, loops, alternate routes

**Key Validation**:
```rust
// Only keep if maze still solvable
if !is_solvable(tiles, start, goal, width, height) {
    // Revert change
}
```

#### **2.2.3 Add Winding Corridors**

**Function**: `add_winding_corridors(tiles, start, goal, width, height, rng)`

- **Purpose**: Create non-straight paths
- **Method**: Carves curving ice paths between random points
- **Result**: Reduces visual predictability of maze structure

#### **2.2.4 Add Island Obstacles**

**Function**: `add_island_obstacles(tiles, start, goal, width, height, rng, count)`

- **Count**: 10-18 base (scales to 4-8 for 15×15)
- **Method**: 
  - Place small wall clusters (radius 2-4) in open ice areas
  - Must not break solvability
- **Result**: Forces navigation around obstacles

**Example**:
```
........    ........
........    ...##...  ← Island obstacle
........    ..###...
........    ...##...
```

---

### **STEP 3: Start/Goal Placement**

**Critical Section** - Most attempts fail here.

```rust
// Partition map into regions
let left_threshold = width / 3;
let right_threshold = 2 * width / 3;
let top_threshold = height / 3;
let bottom_threshold = 2 * height / 3;

// Collect ice tiles by region
let left_tiles = ice_tiles.filter(|p| p.x < left_threshold);
let right_tiles = ice_tiles.filter(|p| p.x > right_threshold);
let top_left_tiles = ice_tiles.filter(|p| p.x < left_threshold && p.y < top_threshold);
let bottom_right_tiles = ice_tiles.filter(|p| p.x > right_threshold && p.y > bottom_threshold);

// Placement strategy (60% chance for diagonal)
if !top_left_tiles.is_empty() && !bottom_right_tiles.is_empty() && rng.random() < 0.6 {
    start = rng.random_choice(&top_left_tiles);
    goal = rng.random_choice(&bottom_right_tiles);
} else if !left_tiles.is_empty() && !right_tiles.is_empty() {
    start = rng.random_choice(&left_tiles);
    goal = rng.random_choice(&right_tiles);
} else {
    return None;  // Reject attempt
}
```

**Why This Matters**: Ensures diagonal distance between start/goal, making room for interesting paths.

**Rejection Reasons**:
- Insufficient ice tiles in required regions
- Start/goal too close together
- No valid diagonal placement possible

---

### **STEP 4: Psychological Trap Injection (15+ Layers)**

**This is the genius.** Each function adds traps that look appealing but are wrong, WITHOUT breaking the maze. Every change is validated.

#### **4.1 Engineer Counter-Intuitive Path**

**Function**: `engineer_counter_intuitive_path(tiles, start, goal, width, height, rng)`

**Goal**: Make optimal path move AWAY from goal

**Algorithm**:
```
1. Calculate intuitive directions (toward goal)
2. Find positions near goal in intuitive directions
3. Block ice tiles in those "intuitive" zones near goal
4. Forces optimal path to detour in "wrong" direction first
5. Validation: Only keeps blocks if maze still solvable
```

**Example**:
```
S.......     S.......
........     ........
...→→→..     ...###..  ← Blocks intuitive path
........     ...###..     Forces detour around
........     ........
......X.     ......X.
```

**Psychological Effect**: "Going towards goal feels wrong, so I must be doing it wrong"

---

#### **4.2 Almost-There Traps**

**Function**: `create_almost_there_traps(tiles, start, goal, width, height, rng, count)`

**Count**: 5-10 base (scales to 2-4 for 15×15)

**Algorithm**:
```
1. Identify positions VERY close to goal (2-5 tiles away)
2. Create small ice pockets (radius 2) near goal
3. Block direct path from pocket to goal with walls
4. Result: Dead-end areas near goal that LOOK like they should work
```

**Diagram**:
```
........     ........
.....##.     .....##.
.....#X.     .....#X.  ← Goal
.....##.     .....##.
...OOO..     ...OOO..  ← Almost-there trap
...OOO..     ..####.     (O = reachable, blocked from X)
........     ........
```

**Psychological Effect**: "I'm so close! Why can't I reach it?"

---

#### **4.3 Decoy Open Areas**

**Function**: `create_decoy_open_areas(tiles, start, goal, width, height, rng, count)`

**Count**: 6-12 base (scales to 3-5 for 15×15)

**Algorithm**:
```
1. Pick position along intuitive path from start toward goal
2. Create large ice clearing (4-7 tile radius)
3. Block continuation past clearing with walls
4. Clearing is reachable but leads nowhere
5. Validation: Must maintain solvability
```

**Example**:
```
S.......
...##...
..####..  ← Blocked exit
.######.  ← Large open area (attractive!)
..####..
...##...
......X.
```

**Psychological Effect**: "This big open area must be important!"

---

#### **4.4 Hidden Choke Points**

**Function**: `create_hidden_choke_points(tiles, start, goal, width, height, rng, count)`

**Count**: 5-10 base (scales to 2-4 for 15×15)

**Algorithm**:
```
1. Pick position OUTSIDE direct path zone
2. Create long wall barrier (8-14 tiles)
3. Leave 1 gap at random position (not obvious)
4. Validation: Check for stuck states (no one-way traps)
```

**Diagram**:
```
........
########  ← Long barrier
.......#
....#..#  ← Hidden gap
....####
........
```

**Psychological Effect**: "Which of these 10 gaps is the right one?"

---

#### **4.5 Momentum Traps**

**Function**: `create_momentum_traps(tiles, start, goal, width, height, rng, count)`

**Count**: 8-16 base (scales to 3-7 for 15×15)

**Algorithm**:
```
1. Find positions on optimal path
2. Create long ice runways (8-15 tiles) near those positions
3. Runways go in random directions
4. If you enter runway, you slide far away
5. Validation: Must not break solvability
```

**Diagram**:
```
S.......
..*→→→→→→→→→→  ← Momentum trap runway
...↓....        (* = near optimal path position)
...↓....
...X....
```

**Ice Physics**: Once you step on first `→`, you slide ALL the way to the end.

**Psychological Effect**: "Whoops, I'm now 10 tiles away from where I wanted to be"

---

#### **4.6 Anti-Gradient Zones**

**Function**: `create_anti_gradient_zones(tiles, start, goal, width, height, rng, count)`

**Count**: 5-10 base (scales to 2-4 for 15×15)

**Algorithm**:
```
1. Pick zone along start→goal line (20-80% of distance)
2. In that zone:
   a. Block intuitive directions (toward goal): Ice → Wall (40% chance)
   b. Open counter-intuitive (away from goal): Wall → Ice (30% chance)
3. Validation: Must remain solvable
```

**Visual Metaphor**: Reverses the natural "gravity" toward the goal.

**Psychological Effect**: Fighting against intuition in specific zones.

---

#### **4.7 Parallel Path Illusion**

**Function**: `create_parallel_path_illusion(tiles, start, goal, width, height, rng, count)`

**Count**: 6-12 base (scales to 3-5 for 15×15)

**Algorithm**:
```
1. Calculate optimal path length
2. Search for walls with ≥2 ice neighbors
3. Convert wall → ice (creating alternate path)
4. CRITICAL CHECK: New path must be ≥ optimal length (not shorter)
5. If conversion creates shortcut → revert
```

**Example**:
```
Before:        After:
S...#....X     S...#....X
....#....      ....→....  ← Parallel path looks good
....#....      ....→....     but is actually longer
....#....      ....#....
```

**Psychological Effect**: "This parallel route looks equally good!" (but it's longer)

---

#### **4.8 Ledge Misdirection**

**Function**: `create_ledge_misdirection(tiles, start, goal, width, height, rng, count)`

**Count**: 10-18 base (scales to 4-8 for 15×15)

**Ledge Mechanics**: One-way tiles. Can only enter from specific direction.

```rust
enum TileType {
    LedgeUp,    // Can only enter from bottom (moving up)
    LedgeDown,  // Can only enter from top (moving down)
    LedgeLeft,  // Can only enter from right (moving left)
    LedgeRight, // Can only enter from left (moving right)
}
```

**Algorithm**:
```
1. Place ledges in intuitive directions from start
2. Ledge points toward goal
3. Validation: Check that optimal path length doesn't decrease
4. If ledge makes puzzle easier → revert
```

**Example**:
```
S.......
..↓.....  ← LedgeDown (can only enter from above)
........     Once you pass, can't go back up
......X.
```

**Psychological Effect**: "I can go this way but not back... is this right?"

---

#### **4.9 Goal Proximity Dead-Ends**

**Function**: `create_goal_proximity_dead_ends(tiles, start, goal, width, height, rng, count)`

**Count**: 6-12 base (scales to 3-5 for 15×15)

**Algorithm**:
```
1. Create ice pockets (radius 2) at distance 2-5 from goal
2. Block path from pocket toward goal with walls
3. Pocket is accessible from elsewhere
4. Result: Areas near goal you can reach but can't progress from
```

**Diagram**:
```
........
.....##.
....OOO.  ← Dead-end pocket
....O#X.  ← Wall blocks access to X
....OOO.  ← Reachable but wrong
........
```

**Psychological Effect**: "I'm right next to the goal, why is this wrong?"

---

#### **4.10 Commitment Traps**

**Function**: `create_commitment_traps(tiles, start, goal, width, height, rng, count)`

**Count**: 6-12 base (scales to 3-5 for 15×15)

**Algorithm**:
```
1. Find bottlenecks on map (positions with few exits)
2. Make them one-way using ledges
3. Or create situations where wrong choice is hard to backtrack from
4. Choice made early affects outcome late
```

**Example**:
```
S.......
.←←.....  ← Can go left but not return
.|......
.|......  ← Must commit to this path
.|......
.↓......
..X.....
```

**Psychological Effect**: "I chose wrong 30 seconds ago and only now realize it"

---

#### **4.11 Precision Gates**

**Function**: `add_precision_gates(tiles, start, goal, width, height, rng, count)`

**Count**: 8-16 base (scales to 3-7 for 15×15)

**Algorithm**:
```
1. Create narrow passages (1-tile wide)
2. Must enter from exact angle to pass through
3. Wrong angle → slide past into wall/dead-end
```

**Diagram**:
```
#######
.......  ← Must hit this exact tile
###.###  ← 1-tile gate
.......
#######
```

**Psychological Effect**: "I know where to go, but hitting it is hard"

---

#### **4.12 Funnel Patterns**

**Function**: `add_funnel_patterns(tiles, start, goal, width, height, rng, count)`

**Count**: 6-12 base (scales to 3-5 for 15×15)

**Algorithm**:
```
1. Create converging wall patterns
2. Multiple paths lead to same point
3. Only one of those paths continues forward
4. Others dead-end after convergence
```

**Diagram**:
```
...\./.....
....↓......  ← Funnel convergence
....+......  ← Only right path continues
....#.↓....
......X....
```

**Psychological Effect**: "All these paths merge here, so any should work!" (wrong)

---

#### **4.13 Trap Alcoves**

**Function**: `add_trap_alcoves(tiles, start, goal, width, height, rng, count)`

**Count**: 10-18 base (scales to 4-8 for 15×15)

**Algorithm**:
```
1. Create small ice "rooms" off to the side of main paths
2. Look like valid exploration areas
3. Are actually dead-ends
4. Hard to exit once entered (due to ice physics)
```

**Example**:
```
........
...###..
...#OO..  ← Alcove (looks explorable)
...#OO..
........
```

**Psychological Effect**: "Let me explore this room... oh no, trapped"

---

#### **4.14 Deceptive Paths**

**Function**: `add_deceptive_paths(tiles, start, goal, width, height, rng, count)`

**Count**: 25-45 base (scales to 11-19 for 15×15) - **MOST AGGRESSIVE**

**Algorithm**:
```
1. Generic trap injection at high volume
2. Add ice paths that LOOK optimal
3. Actually lengthen solution or dead-end
4. High volume creates "fog of war"
```

**Psychological Effect**: Overwhelming number of plausible-looking options obscures the correct path.

---

#### **4.15 Dead-End Magnets**

**Function**: `add_dead_end_magnets(tiles, start, goal, width, height, rng, count)`

**Count**: 6-12 base (scales to 3-5 for 15×15)

**Algorithm**:
```
1. Identify existing dead-ends in maze
2. Make them MORE attractive:
   - Wider openings
   - Better visibility
   - More ice leading to them
   - More obvious entry points
```

**Example**:
```
Before:        After:
....#....      ........
....#....      ....→...  ← Wide inviting entrance
....#OOO       ...→→OOO  ← Dead-end magnified
....####       ....####
```

**Psychological Effect**: "This wide-open path must be right!"

---

#### **4.16 Stop Blocks**

**Function**: `add_stop_blocks(tiles, start, goal, width, height, rng, count)`

**Count**: 35-60 base (scales to 15-26 for 15×15) - **VERY HIGH VOLUME**

**Algorithm**:
```
1. Convert ice → wall strategically throughout map
2. Place walls to interrupt long slides
3. Forces more precise movement instead of long runways
4. Validation: Must not break solvability
```

**Effect**: Increases puzzle "friction", forces more decisions per unit distance.

---

#### **4.17 Floor Stops**

**Function**: `add_floor_stops(tiles, start, goal, width, height, rng, count)`

**Count**: 2-4 base (scales to 1-2 for 15×15)

**Algorithm**:
```
1. Place TileType::Ground (not ice)
2. Ground stops sliding (acts like wall but passable)
3. Strategic placement near key junctions
```

**Example**:
```
....→→→F....  ← F = Floor, stops sliding
............     Different from ice (would continue sliding)
```

**Psychological Effect**: "Wait, I stopped here instead of sliding?"

---

### **STEP 5: Final Tileset Assembly**

#### **5.1 Convert Floors to Ice**

**Function**: `convert_floors_to_ice(tiles, start, goal, width, height, rng, rate)`

- **Rate**: 82%
- Any remaining `TileType::Ground` tiles → `TileType::Ice` (with 82% probability)
- Creates ice-dominant puzzle with few stopping points

#### **5.2 Add Ledges (Final Pass)**

**Function**: `add_ledges(tiles, start, goal, width, height, rng, count)`

- **Count**: 20-35 base (scales to 9-15 for 15×15)
- Places directional ledges throughout map
- Final layer of one-way complexity

#### **5.3 Set Start/Goal Tiles**

```rust
tiles[start.y as usize][start.x as usize] = TileType::Start;
tiles[goal.y as usize][goal.x as usize] = TileType::Goal;
```

**Maze generation complete.** Now begins validation.

---

## **PHASE 3: Validation Pipeline**

Each attempt must pass **ALL 5 checks** in sequence. Fail any → attempt rejected immediately.

### **Validation 1: Optimal Path Exists**

**Function**: `find_optimal_path(tiles, start, goal, width, height) -> Option<Vec<Position>>`

**Algorithm**: Breadth-First Search (BFS) with ice-slide physics

```rust
fn find_optimal_path(...) -> Option<Vec<Position>> {
    let mut queue: Vec<Position> = vec![start];
    let mut visited = HashSet::new();
    let mut parent: HashMap<Position, Option<Position>> = HashMap::new();
    
    visited.insert(start);
    parent.insert(start, None);
    
    while let Some(current) = queue.pop_front() {
        if current == goal {
            // Reconstruct path from parent pointers
            let mut path = Vec::new();
            let mut pos = Some(current);
            while let Some(p) = pos {
                path.push(p);
                pos = parent.get(&p).and_then(|o| *o);
            }
            path.reverse();
            return Some(path);
        }
        
        for dir in [Up, Down, Left, Right] {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid && !visited.contains(&result.pos) {
                visited.insert(result.pos);
                parent.insert(result.pos, Some(current));
                queue.push(result.pos);
            }
        }
    }
    
    None  // No path found
}
```

**Ice Slide Physics** (`simulate_move`):

```rust
fn simulate_move(tiles, start, dir, width, height) -> MoveResult {
    let (dx, dy) = get_delta(dir);
    let mut x = start.x + dx;
    let mut y = start.y + dy;
    
    // Check first tile
    if !is_valid(x, y, width, height) {
        return MoveResult { pos: start, valid: false };
    }
    
    let target_tile = tiles[y][x];
    if target_tile == Wall {
        return MoveResult { pos: start, valid: false };
    }
    
    // Check ledge entry rules
    if is_ledge(target_tile) {
        if !can_enter_ledge(target_tile, dir) {
            return MoveResult { pos: start, valid: false };
        }
    }
    
    // If on ice, keep sliding
    if target_tile == Ice {
        while steps < 100 {
            let next_x = x + dx;
            let next_y = y + dy;
            
            if !is_valid(next_x, next_y, width, height) break;
            
            let next_tile = tiles[next_y][next_x];
            if next_tile == Wall break;
            
            if is_ledge(next_tile) {
                if !can_enter_ledge(next_tile, dir) break;
                x = next_x;
                y = next_y;
                break;
            }
            
            x = next_x;
            y = next_y;
            
            if next_tile != Ice break;  // Stop on non-ice
        }
    }
    
    MoveResult { pos: Position { x, y }, valid: true }
}
```

**Why BFS Finds Optimal**: BFS explores positions by distance (move count), so first path found is shortest.

**Reject if**: `optimal_path.is_none()`

---

### **Validation 2: No Stuck States**

**Function**: `has_no_stuck_states(tiles, start, goal, width, height) -> bool`

**Algorithm**: Two-phase graph analysis

```rust
fn has_no_stuck_states(...) -> bool {
    // Phase A: Forward reachability from start
    let reachable = get_reachable(tiles, start, width, height);
    
    // Phase B: Backward reachability to goal
    let can_reach_goal = get_can_reach_goal(tiles, goal, width, height);
    
    // Phase C: Validation
    for position in reachable {
        if !can_reach_goal.contains(&position) {
            return false;  // Found stuck state!
        }
    }
    
    true  // No stuck states
}
```

**Forward Reachability** (`get_reachable`):
```rust
fn get_reachable(tiles, start, width, height) -> HashSet<Position> {
    let mut reachable = HashSet::new();
    let mut queue = vec![start];
    reachable.insert(start);
    
    while let Some(current) = queue.pop_front() {
        for dir in [Up, Down, Left, Right] {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid && !reachable.contains(&result.pos) {
                reachable.insert(result.pos);
                queue.push(result.pos);
            }
        }
    }
    
    reachable
}
```

**Backward Reachability** (`get_can_reach_goal`):
```rust
fn get_can_reach_goal(tiles, goal, width, height) -> HashSet<Position> {
    // Build reverse graph: position P -> all positions that can reach P
    let mut reverse_graph = HashMap::new();
    
    for y in 0..height {
        for x in 0..width {
            if tiles[y][x] == Wall continue;
            
            let pos = Position { x, y };
            for dir in [Up, Down, Left, Right] {
                let result = simulate_move(tiles, &pos, dir, width, height);
                if result.valid && result.pos != pos {
                    // If moving from pos lands at result.pos,
                    // then pos can reach result.pos
                    reverse_graph.entry(result.pos)
                        .or_insert(Vec::new())
                        .push(pos);
                }
            }
        }
    }
    
    // BFS backward from goal
    let mut can_reach_goal = HashSet::new();
    let mut queue = vec![goal];
    can_reach_goal.insert(goal);
    
    while let Some(current) = queue.pop_front() {
        if let Some(sources) = reverse_graph.get(&current) {
            for source in sources {
                if !can_reach_goal.contains(source) {
                    can_reach_goal.insert(*source);
                    queue.push(*source);
                }
            }
        }
    }
    
    can_reach_goal
}
```

**Stuck State Example**:
```
S = Start, X = Goal, → = LedgeRight (one-way right)

##########
#S..→....#  ← Can reach here from S
#........#  ← But stuck! One-way prevents backtrack
#.......X#
##########
```

**Why This Matters**: Prevents frustrating situations where you can reach a place but get stuck forever with no path to goal.

**Reject if**: Any reachable position can't reach goal.

---

### **Validation 3: Exact Move Count**

```rust
let optimal_path = find_optimal_path(tiles, start, goal, width, height)?;
let optimal_moves = (optimal_path.len() - 1) as i32;

if optimal_moves != required_optimal_moves {
    return None;  // REJECT
}
```

**For 15×15**: Must be exactly **10 moves**.

**Why This Matters**: 
- Difficulty tuning: Too short = too easy, too long = too hard
- Consistency: All daily puzzles same difficulty
- Pacing: Target ~2-3 minutes solve time

**Path length**: Number of positions in path minus 1 (moves = positions - 1)

**Reject if**: `optimal_moves ≠ required_optimal_moves`

---

### **Validation 4: Psychology Metrics**

**Function**: `calculate_psychology_score(tiles, start, goal, width, height) -> PsychMetrics`

Analyzes the optimal path and maze structure to quantify trap effectiveness:

```rust
struct PsychMetrics {
    counter_intuitive_moves: i32,
    attractive_decoys: i32,
    commitment_gates: i32,
    false_progress_paths: i32,
    psychology_score: f64,
}
```

#### **Metric 1: Counter-Intuitive Moves**

**Function**: `count_counter_intuitive_moves(goal, optimal_path) -> i32`

```rust
fn count_counter_intuitive_moves(goal: &Position, path: &Vec<Position>) -> i32 {
    let mut count = 0;
    
    for i in 1..path.len() {
        let prev_dist = manhattan_dist(&path[i-1], goal);
        let curr_dist = manhattan_dist(&path[i], goal);
        
        // Moving AWAY from goal on optimal path
        if curr_dist > prev_dist {
            count += 1;
        }
    }
    
    count
}
```

**Measures**: Number of optimal moves that increase distance to goal.

**Example**:
```
S.......X    Optimal path: S→→↓↓←←↑→→X
                           ^^   ^^   (4 counter-intuitive moves)
```

---

#### **Metric 2: Attractive Decoys**

**Function**: `count_attractive_decoys(tiles, goal, width, height, optimal_path) -> i32`

**Algorithm**:
```rust
fn count_attractive_decoys(...) -> i32 {
    let optimal_length = optimal_path.len() - 1;
    let optimal_positions: HashSet<_> = optimal_path.iter().collect();
    
    let mut count = 0;
    
    // Test all non-optimal positions
    for y in 0..height {
        for x in 0..width {
            let pos = Position { x, y };
            
            // Skip optimal path positions
            if optimal_positions.contains(&pos) continue;
            if tiles[y][x] == Wall continue;
            
            // Check if position has path to goal
            if let Some(path_length) = find_path(tiles, &pos, goal, width, height) {
                // Decoy if: longer than optimal AND close to optimal path
                if path_length > optimal_length {
                    let near_optimal = optimal_path.iter().any(|p| {
                        manhattan_dist(&pos, p) <= 2
                    });
                    
                    if near_optimal {
                        count += 1;
                    }
                }
            }
        }
    }
    
    count
}
```

**Measures**: Wrong positions that:
1. Have a path to goal (not dead-ends)
2. Path is longer than optimal
3. Position is close to optimal path (within 2 tiles)

**Psychological Effect**: "This position looks right because it's near the correct path!"

---

#### **Metric 3: Commitment Gates**

**Function**: `count_commitment_gates(tiles, goal, width, height, optimal_path, distance_to_goal) -> i32`

**Algorithm**:
```rust
fn count_commitment_gates(...) -> i32 {
    let mut count = 0;
    
    for i in 0..optimal_path.len()-1 {
        let pos = optimal_path[i];
        let optimal_next = optimal_path[i+1];
        
        // Find all available moves from this position
        let mut moves = Vec::new();
        for dir in [Up, Down, Left, Right] {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if result.valid {
                moves.push((result.pos, dir));
            }
        }
        
        // If only 1-2 moves available, not a gate
        if moves.len() <= 2 continue;
        
        // Check if wrong moves lead to significantly worse positions
        let mut wrong_moves_bad = 0;
        
        for (next_pos, dir) in moves {
            if next_pos == optimal_next continue;  // Skip optimal move
            
            // Simulate N moves ahead from wrong choice
            let steps_ahead = 3;
            let future_dist = min_distance_after_n_moves(
                tiles, &next_pos, goal, steps_ahead, distance_to_goal
            );
            
            let optimal_future_dist = distance_to_goal[&optimal_path[i + steps_ahead.min(optimal_path.len()-1)]];
            
            // If all wrong choices lead further from goal
            if future_dist > optimal_future_dist + 3 {
                wrong_moves_bad += 1;
            }
        }
        
        // Commitment gate if most wrong moves have delayed bad consequences
        if wrong_moves_bad >= moves.len() - 2 {
            count += 1;
        }
    }
    
    count
}
```

**Measures**: Positions on optimal path where:
1. Multiple directions available (choice point)
2. Wrong choices don't immediately fail
3. Wrong choices have **delayed** bad consequences (3+ moves later)

**Psychological Effect**: "I chose wrong here but won't know until later"

---

#### **Metric 4: False Progress Paths**

**Function**: `count_false_progress_paths(tiles, start, goal, width, height, optimal_moves, distance_to_goal) -> i32`

**Algorithm**:
```rust
fn count_false_progress_paths(...) -> i32 {
    let start_dist = distance_to_goal[start];
    let mut count = 0;
    
    for y in 0..height {
        for x in 0..width {
            if tiles[y][x] == Wall continue;
            
            let pos = Position { x, y };
            let dist = distance_to_goal[&pos];
            
            // Position gets closer to goal than start
            if dist < start_dist {
                // But either has no path to goal or longer path
                match find_path(tiles, &pos, goal, width, height) {
                    None => count += 1,  // Dead-end despite being closer
                    Some(path_len) if path_len > optimal_moves => count += 1,
                    _ => {}
                }
            }
        }
    }
    
    count
}
```

**Distance to Goal Computation** (`compute_distance_to_goal`):
```rust
fn compute_distance_to_goal(tiles, goal, width, height) -> HashMap<Position, i32> {
    // BFS backward from goal with ice physics
    let mut distances = HashMap::new();
    let mut queue = vec![(goal, 0)];
    distances.insert(goal, 0);
    
    while let Some((pos, dist)) = queue.pop_front() {
        for dir in [Up, Down, Left, Right] {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if result.valid && !distances.contains_key(&result.pos) {
                distances.insert(result.pos, dist + 1);
                queue.push((result.pos, dist + 1));
            }
        }
    }
    
    distances
}
```

**Measures**: Positions that:
1. Are closer to goal than start (by move count)
2. But either:
   - Lead to dead-end (no path to goal), OR
   - Have longer path to goal than optimal

**Psychological Effect**: "I'm getting closer, this must be progress!" (but it's a trap)

---

#### **Psychology Score Calculation**

```rust
fn calculate_psychology_score(...) -> PsychMetrics {
    let optimal_path = find_optimal_path(tiles, start, goal, width, height)?;
    let optimal_moves = optimal_path.len() - 1;
    let distance_to_goal = compute_distance_to_goal(tiles, goal, width, height);
    
    let counter_intuitive_moves = count_counter_intuitive_moves(goal, &optimal_path);
    let attractive_decoys = count_attractive_decoys(tiles, goal, width, height, &optimal_path);
    let commitment_gates = count_commitment_gates(
        tiles, goal, width, height, &optimal_path, &distance_to_goal
    );
    let false_progress_paths = count_false_progress_paths(
        tiles, start, goal, width, height, optimal_moves, &distance_to_goal
    );
    
    let psychology_score = 
        (counter_intuitive_moves as f64 * WEIGHT_COUNTER_INTUITIVE) +
        (attractive_decoys as f64 * WEIGHT_ATTRACTIVE_DECOYS) +
        (commitment_gates as f64 * WEIGHT_COMMITMENT_GATES) +
        (false_progress_paths as f64 * WEIGHT_FALSE_PROGRESS) +
        (optimal_moves as f64 * WEIGHT_MOVE_BONUS) +
        trap_bonus(false_progress_paths, attractive_decoys);
    
    PsychMetrics {
        counter_intuitive_moves,
        attractive_decoys,
        commitment_gates,
        false_progress_paths,
        psychology_score,
    }
}
```

**Weights**:
```rust
const WEIGHT_COUNTER_INTUITIVE: f64 = 70.0;
const WEIGHT_ATTRACTIVE_DECOYS: f64 = 80.0;
const WEIGHT_COMMITMENT_GATES: f64 = 70.0;
const WEIGHT_FALSE_PROGRESS: f64 = 100.0;  // Highest weight
const WEIGHT_MOVE_BONUS: f64 = 0.5;
```

**Trap Bonus**:
```rust
fn trap_bonus(false_progress: i32, decoys: i32) -> f64 {
    let synergy = (false_progress * decoys) as f64;
    (synergy * 0.1).min(50.0)  // Capped at +50
}
```

**Target**: 800.0 for high difficulty

**Example Calculation** (15×15):
```
counter_intuitive_moves = 4  → 4 * 70.0 = 280.0
attractive_decoys = 6        → 6 * 80.0 = 480.0
commitment_gates = 2         → 2 * 70.0 = 140.0
false_progress_paths = 8     → 8 * 100.0 = 800.0
optimal_moves = 10           → 10 * 0.5 = 5.0
trap_bonus(8, 6)             → (48 * 0.1).min(50) = 4.8

Total: 280 + 480 + 140 + 800 + 5 + 4.8 = 1709.8
```

---

### **Validation 5: Prefilter Thresholds**

**Function**: `passes_prefilters(metrics: &PsychMetrics, thresholds: &PrefilterThresholds) -> bool`

```rust
fn passes_prefilters(metrics: &PsychMetrics, thresholds: &PrefilterThresholds) -> bool {
    metrics.counter_intuitive_moves >= thresholds.min_counter_intuitive &&
    metrics.attractive_decoys >= thresholds.min_attractive_decoys &&
    metrics.commitment_gates >= thresholds.min_commitment_gates &&
    metrics.false_progress_paths >= thresholds.min_false_progress
}
```

**For 15×15** (computed in Phase 1):
```rust
PrefilterThresholds {
    min_counter_intuitive: 3,
    min_attractive_decoys: 4,
    min_commitment_gates: 2,
    min_false_progress: 4,
}
```

**ALL must pass** or attempt is rejected.

**Reject if**: Any metric below its threshold.

---

## **PHASE 4: Selection & Iteration**

### **4.1 Within-Batch Selection**

After generating 1000 parallel attempts:

```rust
// Find best puzzle from batch
let best_puzzle = find_best_in_range("traditional", 0..1000, |attempt| {
    // Generate maze (all steps from Phase 2)
    let tiles = /* ... full generation ... */;
    
    // Validate (all checks from Phase 3)
    if !passes_all_validations(&tiles, start, goal) {
        return None;  // Reject
    }
    
    // Score
    let metrics = calculate_psychology_score(&tiles, start, goal, width, height);
    let score = metrics.psychology_score;
    
    Some((puzzle_data, score))
});
```

**Parallel Execution**:
```rust
fn find_best_in_range<F, T>(range: Range<usize>, f: F) -> Option<(T, f64)>
where
    F: Fn(usize) -> Option<(T, f64)> + Sync + Send,
    T: Send,
{
    range.into_par_iter()  // Rayon parallel iterator
        .filter_map(|i| f(i).map(|(puzzle, score)| (puzzle, score, i)))
        .max_by(|a, b| {
            match a.1.partial_cmp(&b.1) {
                Some(Ordering::Equal) => a.2.cmp(&b.2),  // Tiebreaker: lower index
                other => other.unwrap_or(Ordering::Equal),
            }
        })
        .map(|(puzzle, score, _)| (puzzle, score))
}
```

**Deterministic Tiebreaking**: If two puzzles have equal scores, lower attempt index wins. Ensures same result regardless of CPU count or thread scheduling.

---

### **4.2 Between-Batch Iteration**

```rust
let mut batch = 0;
loop {
    let attempt_range = (batch * 1000)..((batch + 1) * 1000);
    
    let best_puzzle = find_best_in_range("traditional", attempt_range, |attempt| {
        // ... generation and validation ...
    });
    
    // Success criteria
    if let Some((puzzle, score)) = best_puzzle.clone() {
        // Ideal: meets target score AND all thresholds
        if score >= TARGET_PSYCHOLOGY_SCORE 
           && puzzle.counter_intuitive_moves >= thresholds.min_counter_intuitive
           && puzzle.attractive_decoys >= thresholds.min_attractive_decoys
           && puzzle.commitment_gates >= thresholds.min_commitment_gates
        {
            log(&format!("Selected puzzle (batch {}, score {:.2})", batch, score));
            return puzzle;  // ✓ Perfect puzzle found
        }
    }
    
    // Fallback: any valid puzzle from batch
    if let Some((puzzle, score)) = best_puzzle {
        log(&format!("Selected best from batch {} (score {:.2})", batch, score));
        return puzzle;  // ✓ Good enough
    }
    
    // No valid puzzles in batch, try next batch
    log(&format!("No puzzle met target in batch {}. Continuing...", batch));
    batch += 1;
}
```

**Batch Strategy**:
1. **First priority**: Puzzle with score ≥ 800 and passing all thresholds
2. **Fallback**: Best scoring puzzle that passed validation (even if below target)
3. **Last resort**: Keep trying batches until something works

**Expected Performance** (15×15):
- Success rate: ~0.1-1% per attempt
- First batch (1000 attempts): ~1-10 valid puzzles expected
- Generation time: 1-5 seconds total

---

## **Why This Works**

### **1. Parallel Scale Overcomes Low Success Rate**

**Problem**: With 20+ trap layers and exact move count requirement, success rate is <1%

**Solution**: Generate 1000+ candidates in parallel, filter for rare valid configurations

**Math**:
- If success rate = 0.5% per attempt
- 1000 attempts → Expected 5 valid puzzles
- Pick best of those 5

### **2. Deterministic Generation**

**Problem**: Same seed must produce same puzzle across platforms (Web, native)

**Solution**:
- Alea PRNG (JavaScript seedrandom port)
- Deterministic attempt ordering with tiebreaker
- No randomness from thread scheduling

**Verification**:
```bash
# Same seed on different machines/browsers produces identical maze
seed="2025-12-10" → puzzle_hash="a3f2b9..."
```

### **3. Physics-Driven Validation**

**Problem**: Hand-crafted constraints are complex and incomplete

**Solution**: 
- Simulate actual game physics (ice sliding)
- BFS pathfinding with physics validates solvability
- Stuck-state detection via graph analysis

**Benefit**: Guarantees playability without hardcoded rules

### **4. Psychologically Optimized**

**Problem**: "Solvable" ≠ "interesting"

**Solution**:
- 15+ trap layers target specific cognitive biases
- Quantify trap effectiveness with 4 metrics
- Filter for puzzles that exploit human intuition

**Traps Target**:
- **Proximity bias**: "Closer = better" (false progress)
- **Momentum heuristic**: "Keep going straight" (momentum traps)
- **Sunk cost**: "I've gone this far" (commitment gates)
- **Visibility bias**: "Big open area = correct" (decoy areas)

### **5. Hard Constraints Ensure Quality**

**Problem**: Variable difficulty makes game feel inconsistent

**Solution**:
- Exact move count (10 moves for 15×15)
- Minimum trap counts (≥3 counter-intuitive, ≥4 decoys, etc.)
- No stuck states (every reachable position can reach goal)

**Result**: Every daily puzzle has consistent difficulty and fairness

---

## **Performance Characteristics**

### **Time Complexity**

**Per Attempt**:
- Base maze generation: `O(W * H)` - Recursive backtracking
- Trap injection: `O(W * H * T)` - T trap layers, each scans/modifies grid
- Pathfinding validation: `O(W * H * D)` - BFS, D = 4 directions
- Psychology metrics: `O(W * H * D)` - Multiple BFS passes
- **Total**: `O(W * H * T * D)` ≈ `O(W * H)` since T, D are constants

**For 15×15**: ~1-5ms per attempt (native), ~10-30ms (WASM)

**Batch of 1000**:
- Native with Rayon: 1-3 seconds (parallel on all cores)
- WASM with wasm-bindgen-rayon: 2-5 seconds (parallel in web workers)

### **Space Complexity**

**Per Attempt**:
- Tile grid: `O(W * H)`
- Visited sets: `O(W * H)`
- Path storage: `O(W + H)` - Optimal path length
- **Total**: `O(W * H)`

**For 15×15**: ~5-10 KB per attempt

**Parallel overhead**: N threads × 10 KB ≈ 80-160 KB for 8-16 threads

### **Success Rate by Map Size**

| Size | Moves | Success Rate | Expected Valid/Batch | Avg Batches |
|------|-------|--------------|----------------------|-------------|
| 10×10 | 6 | ~5% | 50 | 1 |
| 15×15 | 10 | ~0.5% | 5 | 1-2 |
| 20×20 | 15 | ~0.1% | 1 | 2-5 |
| 35×35 | 30 | ~0.01% | 0.1 | 10-20 |

**Scaling Challenge**: Larger maps have exponentially lower success rates due to:
- More trap injection opportunities
- Stricter move count constraints
- Larger solution space to search

---

## **Configuration Reference**

### **Tunable Constants**

```rust
// Generation volume
const TRADITIONAL_ATTEMPTS: usize = 1000;  // Attempts per batch

// Target difficulty
const TARGET_PSYCHOLOGY_SCORE: f64 = 800.0;  // Scoring threshold

// Psychology weights
const WEIGHT_COUNTER_INTUITIVE: f64 = 70.0;
const WEIGHT_ATTRACTIVE_DECOYS: f64 = 80.0;
const WEIGHT_COMMITMENT_GATES: f64 = 70.0;
const WEIGHT_FALSE_PROGRESS: f64 = 100.0;  // Highest impact

// Base prefilter thresholds (for 35×35 reference)
const BASE_PREFILTER_MIN_COUNTER_INTUITIVE: i32 = 10;
const BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS: i32 = 14;
const BASE_PREFILTER_MIN_COMMITMENT_GATES: i32 = 5;
const BASE_PREFILTER_MIN_FALSE_PROGRESS: i32 = 14;
```

### **Map Size Configuration**

```rust
const SIZE_OPTIONS: [(usize, usize); 1] = [
    (15, 15),  // Current configuration
];

// Can expand to:
// const SIZE_OPTIONS: [(usize, usize); 3] = [
//     (15, 15),  // Small
//     (25, 25),  // Medium
//     (35, 35),  // Large
// ];
```

### **Scaling Formulas**

All parameters scale with map size:

```rust
scale = min(width, height) / 35.0;

scaled_value = (base_value * scale).round().max(absolute_min);
scaled_range = (
    (min * scale).round().max(absolute_min),
    (max * scale).round().max(scaled_min + 1)
);
```

---

## **Extending the Algorithm**

### **Adding New Trap Patterns**

1. **Define trap function**:
```rust
fn create_my_trap(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    for _ in 0..count {
        // Identify target location
        // Modify tiles
        // Validate solvability
        // Revert if broken
    }
}
```

2. **Integrate into generation pipeline** (Step 4):
```rust
let (trap_min, trap_max) = scale_range_for_map(6, 12, width, height, 2);
let trap_count = rng.random_int(trap_min, trap_max);
create_my_trap(tiles, start, goal, width, height, rng, trap_count);
```

3. **Optional**: Add corresponding psychology metric if trap has unique effect

### **Adding New Psychology Metrics**

1. **Define counting function**:
```rust
fn count_my_metric(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    optimal_path: &Vec<Position>,
) -> i32 {
    let mut count = 0;
    // Analyze maze structure and optimal path
    // Count occurrences of pattern
    count
}
```

2. **Add to `PsychMetrics` struct**:
```rust
struct PsychMetrics {
    // ... existing fields ...
    my_metric: i32,
}
```

3. **Update scoring calculation**:
```rust
const WEIGHT_MY_METRIC: f64 = 75.0;

psychology_score += (my_metric as f64 * WEIGHT_MY_METRIC);
```

4. **Add prefilter threshold** (optional):
```rust
struct PrefilterThresholds {
    // ... existing fields ...
    min_my_metric: i32,
}
```

---

## **Debugging & Diagnostics**

### **Logging**

The algorithm logs progress:

```rust
log_to_console(&format!(
    "[Rust] Map {}x{}: required_optimal_moves={}",
    width, height, required_optimal_moves
));
log_to_console(&format!(
    "[Rust] Prefilters: counter_intuitive>={}, decoys>={}, gates>={}, false_progress>={}",
    thresholds.min_counter_intuitive,
    thresholds.min_attractive_decoys,
    thresholds.min_commitment_gates,
    thresholds.min_false_progress
));
```

### **Common Failure Modes**

1. **No puzzles in batch**:
   - **Cause**: Thresholds too high for map size
   - **Fix**: Lower prefilter thresholds or increase batch size

2. **Generation timeout**:
   - **Cause**: Too many batches needed
   - **Fix**: Reduce trap counts or relax move count requirement

3. **All puzzles too easy**:
   - **Cause**: Trap injection not aggressive enough
   - **Fix**: Increase trap counts or tighten prefilters

4. **All puzzles too hard**:
   - **Cause**: Required move count too high
   - **Fix**: Reduce required_optimal_moves

### **Metrics to Monitor**

```rust
// Per batch
log(&format!("Batch {}: {} valid puzzles, best score: {:.2}", 
    batch, valid_count, best_score));

// Per puzzle selected
log(&format!("Selected: moves={}, ci={}, decoys={}, gates={}, fp={}, score={:.2}",
    optimal_moves, counter_intuitive, decoys, gates, false_progress, score));
```

---

## **Future Optimizations**

### **1. Adaptive Batch Sizing**

Currently fixed at 1000 attempts. Could adjust based on success rate:

```rust
let mut batch_size = 1000;
if success_rate < 0.1% {
    batch_size = 2000;  // Need more attempts
} else if success_rate > 2% {
    batch_size = 500;   // Fewer attempts needed
}
```

### **2. Early Termination**

Stop generation once "perfect" puzzle found:

```rust
if score >= TARGET_PSYCHOLOGY_SCORE * 1.2 {
    return puzzle;  // Don't bother with rest of batch
}
```

### **3. Incremental Validation**

Validate during generation instead of after:

```rust
// After each trap layer
if !is_solvable(tiles, start, goal, width, height) {
    return None;  // Abort attempt early
}
```

### **4. Caching Distance Maps**

`compute_distance_to_goal` is called multiple times with same inputs:

```rust
// Compute once, reuse across metrics
let distance_to_goal = compute_distance_to_goal(tiles, goal, width, height);
// Pass to all counting functions
```

---

## **References**

- **Algorithm**: `generator-rust/src/generators/ice.rs`
- **Types**: `generator-rust/src/types.rs`
- **Game Physics**: `src/game/GameScene.ts` (TypeScript reference implementation)
- **Parallel Framework**: Rayon (`rayon::prelude::*`)
- **PRNG**: Alea algorithm (seedrandom.js port)

---

**Document Version**: 1.0  
**Last Updated**: 2025-12-10  
**Maintainer**: Mazle Team
