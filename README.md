# Factory Game

An idle factory game centred on designing and optimising production systems.

The current implementation uses a spatial, typed production graph. Players place
machines and junctions, connect capacity-limited ports, compile the blueprint into
an immutable exact-rate contract, and run that contract against integer world
buffers with bounded work in progress. Compilation runs in a worker; runtime and
offline progress are event driven.

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

Then open [http://localhost:5173](http://localhost:5173).

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
