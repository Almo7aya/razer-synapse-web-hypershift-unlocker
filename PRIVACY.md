# Privacy

Razer Synapse Web Hypershift Unlocker saves product enable/disable choices in
Chrome's local extension storage. It uses the product identifiers from Synapse
iframe URLs to remember those choices. These preferences are not synced or sent
to the developer.

When you click the toolbar icon, the extension checks the active tab's Synapse
Web URL locally. In the popup, it reads product iframe URLs,
display names, and sidebar icons from that tab to show your products. This
display information is not persisted. Icons are read from the sidebar's
computed CSS and displayed as images. SVG data URLs are displayed locally;
SVG asset URLs may load images directly from synapse.razer.com.

Clicking the toolbar icon outside Synapse Web opens the Synapse dashboard in a
new tab. No content is read from unrelated websites.

The extension does not access the browser's browsing-history database. It does
not collect or transmit account credentials, keyboard input, device serial
numbers, or Synapse profiles. It has no analytics, advertising, remote executable
code, or external backend. Synapse URLs and product page content are processed
locally for product discovery and mapping changes; they are not sent to the developer.

Permissions:

- **storage:** remember product toggles locally.
- **scripting:** register the bundled patch at page startup and read product
  display information when the popup is open.
- **synapse.razer.com access:** discover products and apply the patch within
  Synapse Web. The extension does not run on unrelated sites.

The patch modifies live `disableHypershiftMapping` flags in compatible layout
objects. It does not modify device firmware or the desktop Synapse app. The
website continues to handle its own account, profile, and device operations
under Razer's policies.

Removing the extension removes its saved preferences. Reload any open Synapse
Web tabs to clear a patch already applied there.
