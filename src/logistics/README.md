# Logistics

Discrete world rails, stations, delivery jobs, and vehicles. This module only
sees integer world buffers and never imports editable factory graphs or WIP.

Station roles distinguish Requests, Passive providers, and Active providers.
Requests maintain a target quantity; passive stock moves only to requests;
active stock first serves requests and then moves to storage with free capacity.
