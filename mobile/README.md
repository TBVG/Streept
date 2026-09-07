# Streept Native Navigation Foundation

This directory defines the contract for the eventual iOS/Android native shell. The web client remains the reference UX while the navigation core is kept transport/UI independent.

## Architecture

`Native shell -> Streept Navigation Core -> routing/map-matching adapters -> scene/traffic adapters`

The first native implementation should host the same route/maneuver/session concepts used by the web app, then add background location, offline region packages, CarPlay, and Android Auto without duplicating navigation logic.

## Current scope

- Stable navigation session identifiers
- Route/maneuver JSON contract
- Offline trip package contract
- Provider interfaces are configuration-driven

This is intentionally a foundation, not a claim that iOS/Android builds are already production-ready.
