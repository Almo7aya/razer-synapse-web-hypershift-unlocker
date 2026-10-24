# Privacy

Hypershift Mapping Unlocker unlocks restricted mappings in Razer Synapse Web
and offers optional experimental mapping tools and developer diagnostics.
It has no analytics, advertising, remote executable code, or external backend.
The extension does not automatically send your information to the developer
or other third parties.

## Product discovery and preferences

When you click the toolbar icon, the extension checks the active tab's Synapse
Web URL locally. In the popup, it reads product iframe URLs,
display names, and sidebar icons from that tab to show your products. This
display information is not persisted. Icons are read from the sidebar's
computed CSS and displayed as images. SVG data URLs are displayed locally;
SVG asset URLs may load images directly from synapse.razer.com.

Clicking the toolbar icon outside Synapse Web opens the Synapse dashboard in a
new tab. No content is read from unrelated websites.

Product identifiers, enabled features, and Developer and Experimental mode
choices are saved in the extension's local browser storage. They are not synced
to your Chrome account. The extension does not access the browser's history
database or record typing outside Synapse Web.

## Optional Dual-purpose keys editor

Dual-purpose keys is experimental and requires opt-in. On supported keyboards,
the editor reads the selected onboard profile, keyboard layout, key assignments,
and device replies through Synapse Web's existing device connection. It also
reads dual-purpose settings to highlight configured keys on the Customize page.

Before editing a key, the extension reads the keyboard's serial number and the
profile identifier to calculate SHA-256 hashes. The raw serial is used within
the Synapse page and is not stored in extension backups. The hashes are
persistent identifiers, not a guarantee of anonymity. They prevent a backup
from being applied to a different keyboard or profile.

The extension stores original key settings, normal and Hypershift mapping
records, hashed device and profile identifiers, the onboard profile slot,
layout, timestamps, and verification results locally. Some saved results also
include the profile display name and available key assignments. These records
support verification, recovery, and Restore original. Backups from earlier
local builds are retained for recovery.

Save and Restore original write the selected key's dual-purpose configuration
to onboard memory. These settings can remain after reconnecting the keyboard,
turning the feature off, or uninstalling the extension. This does not replace
the keyboard firmware or modify desktop Synapse.

## Optional diagnostics and exports

Developer mode and Console diagnostics enable bounded, in-memory recording of
Synapse Web console messages, errors, and device reports. Recording is off by
default. Logs may contain profile names, mapping settings, device information,
and other page data that Synapse includes in its console output. Known sensitive
fields, including credentials and serial numbers, are redacted where recognized;
redaction cannot guarantee removal of every sensitive value or encoded packet.

Export diagnostics downloads a JSON file to your computer when you request it.
The file includes available logs, product information, extension preferences,
mapping verification reports, and locally saved recovery records. Nothing is
automatically uploaded. Review the file before sharing it; sending it to someone
or attaching it to a public issue is your choice.

## Retention and controls

Preferences and backups remain in local extension storage until that storage
is cleared or the extension is removed. Disable Console diagnostics or
Developer mode and reload Synapse Web to stop recording and clear that page's
in-memory logs. Downloaded JSON files remain until you delete them yourself.

Disabling a product or experimental feature takes effect after reloading
Synapse Web and does not erase recovery backups or restore keyboard settings.
Use Restore original for edited keys before uninstalling if you want their
original dual-purpose configuration back. Uninstalling deletes the extension's
backups; reloading the page clears its injected tools, but neither operation
undoes mappings already saved on the keyboard.

## Permissions and data use

- **storage:** save preferences and mapping recovery records locally.
- **scripting:** discover products, register bundled page tools, read and apply
  supported mappings on request, and collect requested diagnostic exports.
- **synapse.razer.com access:** provide these features within Synapse Web.
  The extension does not run on unrelated sites.

Data is used only to provide the mapping, recovery, and diagnostic features
described here. It is not sold, used for advertising, or transferred to a
developer-operated service. The extension's use of information complies with
the Chrome Web Store User Data Policy, including its Limited Use requirements.

Synapse Web itself continues to handle account and device services under
Razer's policies. Privacy questions can be raised through the repository's
[issue tracker](https://github.com/Almo7aya/razer-synapse-web-hypershift-unlocker/issues);
do not include private diagnostics or identifying information in a public issue.
