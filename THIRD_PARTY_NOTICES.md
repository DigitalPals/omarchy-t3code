# Third-party notices

The bridge bundles selected source modules from T3 Code through the pinned
`upstream/t3code` Git submodule. The vector path in `plugin/qml/T3Mark.qml` is
also derived from that revision.

T3 Code is Copyright (c) 2026 T3 Tools Inc. and licensed under the MIT License.
The full notice is available at `upstream/t3code/LICENSE` and is included in
packaged artifacts as `licenses/T3-CODE-LICENSE`.

The standalone artifact embeds Node.js and bundled JavaScript dependencies.
Packaging discovers those dependencies from the generated source map and
ships their exact notices under `licenses/`, with versions and filenames in
`licenses/BUNDLED-LICENSES.json`. Node's complete runtime notice (including
its bundled third-party notices) is shipped as `licenses/NODEJS-LICENSE`.
