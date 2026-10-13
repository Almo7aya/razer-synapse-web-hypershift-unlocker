# Contributing

This project is a Chrome extension for Synapse Web. Contributions should keep
product discovery automatic, work across product categories, and limit site
access to `https://synapse.razer.com/*`.

## Report a problem

Use the issue templates for bugs or product compatibility reports. Include the
extension version, browser version, product name, steps to reproduce, and what
you expected to happen. Distinguish popup behavior, the mapping interface, and
actual device output. A product without `disableHypershiftMapping` flags is a
normal no-op.

Do not upload saved Synapse webpages, browser profiles, account information, or
device serial numbers. The extension does not need credentials or profile data
to diagnose most problems.

## Make a change

1. Fork the repository, clone your fork, and create a branch for your change.
2. Use Node.js 22 or newer; no npm dependencies need installing.
3. Edit the source and regenerate packaged files with `npm run build`.
4. Describe the change and the validation you performed in a pull request.
   State explicitly which browser or device behavior was not tested.

Keep changes focused and update the documentation when behavior changes.
Changes to permissions, storage, or network access should also update
[PRIVACY.md](PRIVACY.md).

## Source layout

- `src/runtime.mjs`: the patch installed in product frames.
- `src/products.mjs`: product and sidebar icon discovery.
- `src/preferences.mjs`: saved toggles and startup exclusions.
- `extension/`: popup, background worker, manifest, and generated installable files.
- `tools/`: dependency-free build, icon, and ZIP generation.
- `test/`: Node.js unit tests; these do not establish browser or device compatibility.

Edit `src/` rather than generated copies under `extension/lib/` or
`extension/content.js`. Commit regenerated extension files so users can load
the repository's `extension` folder without building it.

Available commands:

```sh
npm run build
npm test
npm run check
npm run package
```

The **Validate extension** Actions workflow runs on pull requests and pushes to
`main`. It can also be triggered manually from the Actions tab. Do not commit
`saved_page/`, browser profiles, or build artifacts.

For manual validation, check product detection, sidebar icons, remembered
toggles, both reload-overlay choices, and the dashboard shortcut from another
site. Confirm that disabled products are skipped after reloading and products
without matching flags still work normally. Check device output separately.

Maintainers can start **Publish extension** manually from the Actions tab on
`main`. The default **check** mode validates the package and checks Google
authentication and Chrome Web Store access without changing versions or
publishing. Choose **publish** and a patch, minor, or major version increment
to create the version commit/tag and GitHub release ZIP, then submit the
package to Chrome Web Store. Re-run the same workflow run to resume a
partially completed release without another version bump.

Contributions are licensed under the project's [MIT license](LICENSE).
