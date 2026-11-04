# DronaHQ SDK

`dronahq.js` is the original DronaHQ Native Container SDK v7.4.1 supplied
for this application, retained without modification.

It is an application runtime dependency, not an uploaded reference asset.
Keep it with the application source so clean checkouts and builds do not
depend on `attached_assets` or previous build output.

Original SHA-256:
`2db898f5337a72114b721ab2d9717b08de4891e0e6e014181e751778a135996a`

The loader imports it with Vite's `?url` handling and loads it only when needed
by the Drona handoff. It does not replace an SDK already provided by Drona.
