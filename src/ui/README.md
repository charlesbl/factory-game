# UI

React rendering and interaction adapters. Logical geometry and game rules remain
in the editor, compiler, and simulation modules.

Graph connections use the same straight-segment gesture as world rails: press a
free port or endpoint, drag along the dominant grid axis, and release to place.
An aligned compatible port completes the connection; other releases leave a free
endpoint for the next segment. Escape or releasing outside the canvas cancels
the gesture. Machine collisions use the visible footprint without an extra
clearance margin, including the origin and destination machines.

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

The selected factory's world inspector lists its published versions. Upgrading
to a version or replacing with a draft starts ghost placement using the target
contract. Move and rotate the ghost next to the existing station, then click
or press Enter to review and confirm. The preview ignores the old factory's
occupied cells while checking other buildings, terrain and the station link.
The old factory remains intact until a valid replacement is confirmed; Escape
or Cancel placement exits without changing it. Replacement routes its contents
to salvage and rebuilds at the chosen position and orientation. Versions
matching the placed contract are marked as the current design and cannot
trigger a redundant rebuild.
