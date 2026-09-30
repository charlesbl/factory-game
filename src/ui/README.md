# UI

React rendering and interaction adapters. Logical geometry and game rules remain
in the editor, compiler, and simulation modules.

World dismantling uses a mouse marquee: eligible entities whose projected
footprints intersect the drag box and individual rail cells whose projected
segments cross it are highlighted as it moves, then dismantled when the pointer
is released in one world command and save. Escape cancels the active selection.
Buildings waiting for salvage have a red dismantling marker and are excluded
from later marquee selections. Their inspector can cancel dismantling; the
building returns as a construction site that requests its recovered materials
for rebuilding. The world toolbar can permanently destroy a selected
dismantling building, including its remaining salvage and related cargo. Touch
dismantling is not supported.

Station rules have three modes: Request for a target amount, Passive provider
for stock available only to requests, and Active provider for surplus sent to
requests first and then to storage with free capacity.
