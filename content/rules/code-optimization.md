---
name: code-optimization
description: Keep every file, class and function to one responsibility in any language, and audit a codebase for SRP, coupling and structure. Read before writing, moving or reviewing code.
---

# Code Optimization

This rule is about **responsibility, coupling, flow and structure**, not about any language.
It applies the same way to JavaScript, Python, Go, Java, C#, Rust, shell, SQL or anything
else, so it holds in every repository.

It has two parts:

1. **The standing rules.** You obey them on every change that writes, moves or reviews code.
   They stop a codebase from decaying, so the audit is rarely needed.
2. **The audit.** A full analysis that produces a refactor plan. It runs only when the user
   asks for one, or when the standing rules find a hotspot the current change should not fix on
   its own.

The standing rules are the point. A codebase that obeys them while it is written never needs
a rescue.

## Part 1: The standing rules

### 1. One reason to change

Every file, class, module and function has **one responsibility**, which you can say in one
sentence without "and". If the sentence needs "and", there are two responsibilities, and they
belong in two places.

Change an existing unit only for the reason it already has. If the change brings a new
reason, it goes in a new unit, which the old one calls.

| Unit | Holds one… | Smell that it holds two |
|---|---|---|
| Function | step: compute, decide, or perform an effect | It parses **and** validates **and** writes; it takes a flag that switches what it does |
| Class / module | concept, with the data and behaviour of that concept | Its methods split into groups that never touch each other's state |
| File | module, named for what it holds | The name is `utils`, `helpers`, `common`, `misc`, `manager`, or the file has two unrelated export groups |
| Directory | feature or layer | Files in it change for unrelated reasons, in unrelated commits |

### 2. Keep effects at the edge

Separate **deciding** from **doing**. Pure logic (parse, validate, compute, transform) takes
values and returns values. Effects (network, disk, database, clock, environment, process,
logging) live in thin units at the edge that call the logic.

A unit that does both cannot be tested without its effect, and that is the root of most
tangled code.

### 3. Dependencies point one way

Code at a higher level (entry points, transports, user interface) depends on code at a lower
level (features, then domain logic, then shared primitives). Never the reverse, and never in
a cycle.

- A lower level never imports a higher one. If it needs something from above, the higher
  level passes it in as an argument or an interface.
- Two units that import each other are one unit split badly, or need a third that both use.
- Read configuration and environment once, at the entry point, and pass values down. A
  unit deep in the tree that reads the environment itself is a hidden dependency.

### 4. One home for each fact

Every constant, rule, format and piece of logic is written **once**. When the same shape
appears a second time, decide whether it is the same fact. If it is, it gets one home and
both callers use it. If it only looks the same, leave the two copies alone, because merging
two facts that change for different reasons creates coupling.

### 5. A clear flow

A reader can follow a request from its entry point to its effect by reading top to bottom.

- Return early on failure, rather than nesting the success path.
- Avoid global mutable state, singletons that hold request data, and action at a distance
  through events when a direct call would do.
- Never swallow an error to keep going. Handle it where the caller can act on it, or let it
  propagate.

### 6. Size is a signal, not a rule

Length does not prove a violation, but it is where violations hide. Look again when:

- A function is over about 40 lines, or nests more than three levels.
- A file is over about 300 lines, or exports unrelated things.
- A function takes more than four parameters, or a boolean that switches its behaviour.

Each is a prompt to check rule 1, not a limit to split mechanically. A long function with
one responsibility is fine. A short one with two is not.

### 7. Structure follows responsibility

Place a new file where its responsibility lives, beside the code that changes with it.
Group by feature first and by layer inside a feature, unless the repository already uses
another layout consistently. Follow the existing layout rather than starting a second one.
No dumping-ground directory: if a file fits nowhere, the missing place is the finding.

### 8. Leave the code you touch no worse

You fix what your change touches. You do **not** refactor code your change does not need.
A small fix inside the unit you are already changing, such as extracting a function or
removing a duplicate, belongs in the change. A larger problem you notice somewhere else is a
**hotspot**: report it to the user in a sentence, and leave it for an audit or its own
change. A refactor nobody asked for, mixed into a feature, makes both harder to review.

Never mix a refactor and a behaviour change in one commit. The refactor goes first and
changes no behaviour, so the tests prove it.

## Part 2: The audit

Run it when the user asks to optimize, refactor, untangle or restructure a codebase, or when
the hotspots reported under rule 8 add up to a structural problem. Because the standing rules
keep code clean as it is written, the audit is a rare, deliberate event, not a routine one.

**The audit writes no code.** It produces a plan. The user approves the plan before any file
changes, and the work then proceeds one approved step at a time.

### 1. Map what is there

- List the entry points (binaries, servers, handlers, jobs, exported APIs) and follow each to
  its effects.
- Draw the module dependency graph. Mark cycles, edges that point up a level, and modules
  with very high fan-in or fan-out.
- Note the test coverage. A refactor with no test to prove it changes nothing is a rewrite.
  If coverage is missing, the first step of the plan adds characterization tests.

### 2. Find the problems

Check every unit against the standing rules, and record each finding with its evidence:
file, unit, which rule it breaks, and what that costs.

| Area | Look for |
|---|---|
| SRP | God files and god classes; functions that mix parse, decide and effect; flag arguments |
| Spaghetti | Import cycles; upward dependencies; global mutable state; deep nesting; hidden reads of environment or configuration; errors swallowed or caught too broadly |
| Structure | Dumping-ground directories; files far from the code that changes with them; two layouts used at once; dead code |
| Optimization | Duplicated logic; repeated work inside loops (I/O, parsing, allocation); queries issued one per item; unbounded growth such as caches or buffers with no limit; synchronous blocking on a hot path; premature abstraction with one implementation |

Report performance only with evidence: a measurement, or an algorithmic cost you can state.
A guess is not a bottleneck.

### 3. Order the work

Sort the findings into steps. Each step is one responsibility, and small enough to be one
pull request that changes no behaviour.

1. **Safety net:** the tests that lock current behaviour, where they are missing.
2. **Leaves first:** extract pure logic and shared primitives that nothing else depends on.
   They carry the least risk and unblock everything above them.
3. **Break cycles and upward edges,** by passing dependencies in or by introducing the third
   unit that both sides use.
4. **Split the god units,** one responsibility at a time, keeping the old public interface
   as a thin forwarder until its callers move.
5. **Move files** to the target structure. A move is a step of its own, so the diff of a
   move contains no edits.
6. **Optimize,** last, against a measurement taken before and after.

For each step, give: the files it touches, what moves where, the risk, and how the tests
prove that behaviour is unchanged.

### 4. Write the plan

The output has these sections, in this order:

1. **Summary.** The three to five problems that cost the most, each in one sentence.
2. **Current structure.** A directory tree and the dependency graph, with the problems
   marked.
3. **Target structure.** The proposed tree, with each directory's single responsibility
   written beside it.
4. **Steps.** The ordered list from section 3, each one shippable on its own.
5. **Examples.** For the two or three most important steps, a short before-and-after
   snippet in the repository's own language.
6. **Not changing.** What you looked at and chose to leave, and why. An audit that changes
   everything has not prioritized.

Draw diagrams as plain text: a tree, or arrows between module names. They must survive being
pasted into a commit, a terminal or an issue.

### Example: a target structure

The shape is the same in any language. Only the file extension changes.

```
src/
  entry/          one entry point per transport: wiring only, no logic
    cli
    http
  features/
    orders/
      handler     turns a request into a call, and the result into a response
      service     the orders logic: decide, no effects
      store       orders persistence: effects only
  domain/         types and pure rules shared by features
  platform/       config loading, logging, clients for outside services
```

The dependencies run `entry → features → domain`, and `features → platform`. Nothing below
imports anything above it.

### Example: splitting one function

Before, one function holds three responsibilities:

```
function placeOrder(request):
    data = parseJson(request.body)
    if data.quantity <= 0: return error(400)
    total = data.price * data.quantity * (1 + TAX)
    database.insert("orders", data, total)
    email.send(data.customer, "Order placed")
    return ok(total)
```

After, each unit has one, and only the edge performs effects:

```
function parseOrder(body) -> Order                 # parse
function validate(order) -> Problem or nothing     # decide
function totalOf(order) -> Money                   # compute, pure

function placeOrder(order, store, notifier):       # orchestrate the effects
    problem = validate(order)
    if problem: return problem
    total = totalOf(order)
    store.save(order, total)
    notifier.orderPlaced(order.customer)
    return total
```

The logic can be tested without a database or a mail server, and the store and notifier
can change without touching it.
