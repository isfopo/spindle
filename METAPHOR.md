# Spindle

Spindle is a compositional TypeScript application architecture organized around three concerns: Data, Domain, and Design.

The goal is to provide clear boundaries between persistence, application behavior, and user experience while allowing each layer to remain independently composable.

## The Three Concerns

### Data — Fiber → Thread

Data is the raw material of the application.

It provides the tools for working with persistence without imposing domain meaning:

SQL
Schemas
Queries
Database adapters
Repositories
Seeds

Fiber represents raw data and persistence primitives.
Thread represents those primitives made useful to the application through consistent data-access abstractions.

Data knows where things come from, not what they mean.

### Domain — Yarn

Domain turns threads of data into meaningful application concepts.

It contains:

Domain objects
Services
Business rules
Validation
Errors
Application behavior

Yarn represents threads that have been gathered and strengthened into something useful for constructing an application.

Domain knows what things mean and what can be done with them.

### Design — Fabric

Design turns domain concepts into a user experience.

It provides:

Components
Views
Layouts
Client interactions
Pages

Design can use an atomic composition model:

Atoms → Molecules → Organisms → Templates → Pages

These progressively compose domain concepts into the finished fabric of the application.

Design knows how the application is experienced.

## The Spindle

The three concerns work together as a progression:

Data              Domain              Design

Fiber → Thread →  Yarn  ───────────→  Fabric
 SQL     Repo      Objects              Atoms
 Schema  Query     Services             Molecules
 Adapter          Behavior              Organisms
                                        Templates
                                        Pages


A controller acts as a boundary between the concerns, coordinating the movement of information from Data through Domain and into Design.

Spindle provides the mechanism for turning raw application material into meaningful behavior and, ultimately, user experience.

Guiding Principle

Data provides the material.
Domain gives it meaning.
Design gives it expression.

Spindle favors composition over a monolithic framework, with each concern providing focused primitives that can be combined to build an application.
