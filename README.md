# Factory Game

An idle factory game centred on designing and optimising production systems.

The current implementation uses a spatial, typed production graph. Players place
machines and junctions, connect capacity-limited ports, compile the blueprint into
an immutable exact-rate contract, and run that contract against integer world
buffers with bounded work in progress. Compilation runs in a worker; runtime and
offline progress are event driven.

The **World** workspace renders the factory network in 3D with Three.js:
buildings, exterior station/depot hookups, directional rails, moving cargo pods,
construction previews, and a minimap. The world worker owns simulation and
placement validation; opening or editing a factory blueprint preserves its placed
instance until an explicit replacement is confirmed.

Use the mouse wheel to zoom, right-drag to orbit, and the camera toolbar to return
home or switch to a top view. Keyboard placement and touch confirmation are
available for point actions. Dismantling uses a mouse drag box: highlighted
entities and individual rail cells are dismantled on release, and Escape cancels
the selection. The batch is handled as one world command and save. Buildings
still waiting for salvage are marked in red and excluded from later marquee
selections. Their inspector can cancel dismantling: the building returns as a
construction site and requests its recovered materials for rebuilding. A
selected dismantling building can also be destroyed permanently from the world
toolbar; this discards its remaining salvage and related cargo. Touch
dismantling is not supported.
Logistics stations use three modes: Request targets an amount, Passive provider
offers stock only to requests, and Active provider sends surplus to requests
first and then to storage with room. Graphics quality and overlay preferences
are saved locally. The model gallery is available at `/?asset-gallery`.

You can try the deployed game [here](https://factory.crashkiller.ovh/).

## Development

Install the dependencies:

```sh
npm install
```

Start the development server:

```sh
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173). On the services host,
the LAN/VPN development route is
[https://factory-dev.crashkiller.ovh](https://factory-dev.crashkiller.ovh).

Create a production build:

```sh
npm run build
```

Run the complete local verification:

```sh
npm run check
npm run test:e2e
```

The large deterministic path and compact-instance benchmarks are available with
`npm run benchmark`. Their reference results are documented in
[`docs/performance.md`](docs/performance.md).

The detailed factory graph design is available in
[`docs/factory-graph-design.md`](docs/factory-graph-design.md). The staged
implementation roadmap starts in
[`docs/implementation-plan/README.md`](docs/implementation-plan/README.md).
