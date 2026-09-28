#!/usr/bin/env node
// The reference CI job moved into the plugin (plugin/scripts/devanity-rules-ci.mjs), where the modes
// run it. This path keeps a workflow copied before the move working when its DEVANITY_REF advances.
// deferred: an old-path shim, remove at the next major release once consumers re-copy the template.
import '../plugin/scripts/devanity-rules-ci.mjs';
