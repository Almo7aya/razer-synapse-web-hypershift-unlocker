# Razer Synapse Web Hypershift Unlocker

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Chrome Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-green.svg)

A Chrome extension that discovers your **Razer Synapse Web products** and sets
their `disableHypershiftMapping` flags to `false` where those flags exist.

Open the toolbar popup to see each detected product's name, sidebar icon, and
on/off switch. Products are discovered from Synapse's iframes automatically;
there are no IDs to enter or presets to maintain. Keyboard, mouse, and other
product pages are all included, even when their iframe is hidden.

Products start enabled. Changing a toggle saves the choice and opens an overlay
with **Reload now** and **Later**. Reload to apply the change, or choose **Later**
to keep editing and apply your choices on the next page reload. Turning a product
off leaves that product's app unchanged after reloading. Choices are remembered
locally across visits. Products without `disableHypershiftMapping` flags simply need no changes
and are not treated as errors.

This project is for **Synapse Web only**. It does not modify the desktop Synapse
app or keyboard firmware. It is an independent project, not affiliated with
or endorsed by Razer.

## Load the local extension

1. [Download the source ZIP](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/archive/refs/heads/main.zip)
   and extract it, or clone this repository.
2. Open `chrome://extensions` in Chrome 120 or newer.
3. Enable **Developer mode**, click **Load unpacked**, and select this project's
   `extension` folder. The generated files are included; Node.js is not required.
4. Reload [Synapse Web](https://synapse.razer.com/dashboard) and open your product.
5. Click the extension's toolbar icon to see detected products and their toggles.

Clicking the toolbar icon outside Synapse Web opens
`https://synapse.razer.com/dashboard` in a new tab.

If replacing an earlier local version, click **Reload** on its extension card,
then reload Synapse Web. Disable any earlier experimental mapping userscript
to avoid running two versions of the patch.

Toggle changes apply after reloading Synapse Web. Turning a product off does not
remove it from Synapse or disconnect the device. To turn the whole extension
off, disable it in Chrome and reload Synapse Web.
The extension is not listed in the Chrome Web Store yet.

## How it works

The service worker registers the bundled patch at `document_start` in the
page's `MAIN` world, for all matching product frames. Saved off choices become
URL exclusions in that registration, so disabled products are skipped before
their app starts. The registration persists across browser sessions. See
[Chrome's scripting documentation](https://developer.chrome.com/docs/extensions/reference/api/scripting).

While the popup is open, it inspects the current Synapse tab's product frames
and refreshes the list. Names come from the product page's `.device-name` or
title. Icons come dynamically from the matching sidebar link's computed CSS
background image, including SVG data URLs and same-site SVG assets. The popup
displays them at 24 × 24 pixels; no product SVGs or icon catalog are bundled.
If a sidebar icon is unavailable, a generic icon is shown. Product IDs are used
internally to match frames and remember preferences; they are not displayed or
entered in the popup. Multiple frames of the same product share one toggle.

The patch reads the product ID from the frame's own URL. It wraps Webpack's
`groupList` export getters and changes `disableHypershiftMapping` data properties
before consumers read them. It also processes layouts not currently selected
after module initialization. The JavaScript bundle's name and hash are unused.

The patch operates on compatible layout exports. Product pages without matching
flags stay unchanged. Other mapping restrictions and firmware behavior are
unaffected.

The inspected Huntsman V3 Pro Mini bundle, `main.5a67711b.js`, contains 32 flags
across eight layouts. Its layout factories were checked in isolation. The saved
Viper V4 Pro main bundle has no such flags, which is a normal no-op. These source
observations do not establish mapping compatibility for every product or firmware.

## Check the result

In DevTools, select the relevant `/products/<id>/` frame in the console and run:

```js
window.__razerHypershiftPatch
```

The result reports the detected `productId`, `state`, `hookedLayouts`,
`matchedFlags`, `changedFlags`, and `failedFlags`. Each frame has its own result.
`active` means compatible flags were processed; it does not prove the device
accepts a mapping. `no-flags-found` is informational, with no warning or popup
error. Console diagnostics include the internal product ID.

Changes affect live objects. DevTools will still show the original values in
the downloaded bundle.

## Development

Use Node.js 22 or newer. No npm dependencies or installation step are required.

```sh
npm test
npm run build
npm run check
npm run package
```

`src/runtime.mjs` is the patch source; `src/products.mjs` discovers the products
and their graphics; `src/preferences.mjs` controls persisted toggles and startup
exclusions. The popup and background worker live in `extension/`.

`build` regenerates `extension/content.js`, shared modules, icons, and the bundled
license. `check` verifies generated files. `package`
builds the extension and creates a ZIP in `artifacts/`. In environments that
prohibit child processes, run `node --test --test-isolation=none` (Node 22.8+).

The **Validate extension** GitHub Actions workflow runs only when manually
started from the Actions tab. It runs unit tests, checks generated files, and
uploads an extension ZIP. It does not perform browser or hardware validation.

The extension uses `storage` for local toggle preferences and `scripting` for
startup registration and reading the current Synapse page's product information.
Host access is restricted to `https://synapse.razer.com/*`. There is no telemetry,
remote executable code, or external backend. See [PRIVACY.md](PRIVACY.md).

The local `saved_page/` reference capture and `artifacts/` directory are ignored
by Git and are not included in extension packages. Do not commit saved webpages,
browser profiles, or device/account data.

## Manual validation

- Confirm that the popup lists both the Huntsman V3 Pro Mini and Viper V4 Pro
  with their names and sidebar icons, including the hidden product iframe.
- Turn one product off, close and reopen the popup, and check that its choice
  is remembered. After changing a toggle, check that **Later** dismisses the
  overlay without reloading and **Reload now** reloads Synapse to apply it.
- Confirm that the disabled product no longer receives the patch while the
  other remains enabled. Turn it back on and reload again.
- Switch products in Synapse and check that the popup discovers new frames.
- Products with no matching flags should load normally with no warning.
- Click the extension from another site and confirm it opens the Synapse
  dashboard in a new tab.
- Check actual mapping behavior on the device separately from the popup.

## Contributing and support

Bug reports, product compatibility reports, and pull requests are welcome.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the project structure and contribution
workflow, or [open an issue](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/issues/new/choose).
Please describe what you tested and avoid including account details, saved
Synapse pages, or device serial numbers.

MIT licensed. See [LICENSE](LICENSE).
