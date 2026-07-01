# ADR 0002: External logistics V1

Status: accepted — 2026-07-01

Rails are bidirectional unless an edge is explicitly directional; crossings do
not connect without a rail node. Stable Dijkstra uses integer length, station
position, then ID. Travel is represented by an exact arrival event rather than
segment signalling in V1.

Requesters define an integer target, minimum batch, maximum batch, and priority.
Priority descends first, followed by request creation time and station ID.
Providers and vehicles reserve stock atomically. A full destination keeps cargo
on the vehicle and sleeps until buffer space is released. Vehicles do not use
fuel and abstract depots are included; signalling, deadlocks, and fuel remain
future extensions.
