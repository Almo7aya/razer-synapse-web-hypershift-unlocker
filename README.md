# Razer Synapse Web Hypershift Unlocker

<p align="center">
  <img src="screenshots/01-hypershift-mapping.jpg" alt="Hypershift Mapping Unlocker showing controls for a Razer keyboard and mouse" width="800">
</p>

[![Install from Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/ndgdpnegngmfmlilocjefojfllclikhc)

[![Validate extension](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/actions/workflows/ci.yml)
[![Publish extension](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/actions/workflows/publish.yml/badge.svg?branch=main)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/actions/workflows/publish.yml)
[![Latest release](https://img.shields.io/github/v/release/Almo7aya/razer-synapse-web-hypershift-unlocker)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[![Chrome 120+](https://img.shields.io/badge/Chrome-120%2B-4285F4?logo=googlechrome&logoColor=white)](extension/manifest.json)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853)](extension/manifest.json)
[![Release downloads](https://img.shields.io/github/downloads/Almo7aya/razer-synapse-web-hypershift-unlocker/total?label=release%20downloads)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/releases)

[![Stars](https://img.shields.io/github/stars/Almo7aya/razer-synapse-web-hypershift-unlocker?style=flat)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/stargazers)
[![Forks](https://img.shields.io/github/forks/Almo7aya/razer-synapse-web-hypershift-unlocker?style=flat)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/forks)
[![Open issues](https://img.shields.io/github/issues/Almo7aya/razer-synapse-web-hypershift-unlocker)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/issues)
[![Open pull requests](https://img.shields.io/github/issues-pr/Almo7aya/razer-synapse-web-hypershift-unlocker)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/pulls)
[![Contributors](https://img.shields.io/github/contributors/Almo7aya/razer-synapse-web-hypershift-unlocker)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/graphs/contributors)
[![Last commit](https://img.shields.io/github/last-commit/Almo7aya/razer-synapse-web-hypershift-unlocker/main)](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/commits/main)

A Chrome extension that unlocks restricted Hypershift mappings in
[Razer Synapse Web](https://synapse.razer.com/dashboard).

- Automatically detects Razer products, including keyboards and mice.
- Shows product names and icons from Synapse's sidebar.
- Remembers an on/off toggle for each product.
- Lets you reload immediately after a change or apply it later.
- Opens the Synapse dashboard when clicked from another website.

Products without matching mapping restrictions are left unchanged. Available
mappings still depend on the product and its firmware.

## Install

1. Download the extension ZIP from [Releases](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/releases)
   and extract it. Until a release is available, [download the source](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/archive/refs/heads/main.zip)
   and use its `extension` folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted extension folder.
4. Reload Synapse Web.

## Use

Open the extension from the toolbar while using Synapse Web. Products are
enabled by default. Change a toggle, then choose **Reload now** or **Later**.
Your choices take effect when Synapse reloads.

## Privacy

Product preferences stay in local browser storage. The extension has no
analytics or external backend, and site access is limited to Synapse Web.
See the [privacy policy](PRIVACY.md).

## Contributing

[Bug reports and product compatibility reports](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/issues/new/choose)
are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development instructions.

For Synapse Web only; does not modify desktop Synapse or device firmware.
Independent project, not affiliated with or endorsed by Razer.

[MIT licensed](LICENSE).
