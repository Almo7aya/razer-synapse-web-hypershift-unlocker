// In-page colours reflect verified keyboard reads, never local undo backups.
// Self-contained so it can be included in the isolated-world content script.
export function installModTapHighlights() {
    const style = document.createElement('style');
    // These SVG hit areas sit above the native legends. Tint only the fill;
    // keep the border opaque so the labels remain visible underneath.
    const selector = 'html[data-local-modtap-page="customize"] .keyboard-svg .svg-key[data-local-modtap-enabled="true"]';
    style.textContent = selector + '{fill:#9a70dc40!important;stroke:#baa1ff!important;stroke-width:1.6px!important}'
        + selector + ':hover{stroke:#e0d4ff!important;stroke-width:2.5px!important}';
    document.head.append(style);
    let enabled = new Set(), timer, reading = false, again = false, forceNext = false, retries = 0;
    let profileText = '';
    const eligible = key => /^KEY_[A-Z0-9_]+$/.test(key) && !/CAPS|^KEY_FN$|^KEY_FUNCTION$/.test(key);
    const isCustomize = () => document.documentElement?.dataset.localModtapPage === 'customize';
    function paint() {
        const active = isCustomize();
        for (const element of document.querySelectorAll('.keyboard-svg .svg-key[id]')) {
            let key = element.id.replace(/_mapped$/, '');
            if (key === 'KEY_WINDOWS') key = 'KEY_LEFT_GUI';
            if (active && eligible(key) && enabled.has(key)) {
                if (element.dataset.localModtapEnabled !== 'true') element.dataset.localModtapEnabled = 'true';
            } else if (element.dataset.localModtapEnabled) delete element.dataset.localModtapEnabled;
        }
    }
    function schedule(force = false, delay = 400) {
        forceNext ||= force;
        if (!isCustomize()) {
            if (timer) clearTimeout(timer);
            timer = null; again = false; return;
        }
        if (reading) { again = true; return; }
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, delay);
    }
    async function refresh() {
        timer = null;
        if (reading || document.hidden || !isCustomize()) return;
        reading = true;
        const force = forceNext; forceNext = false;
        try {
            const result = await chrome.runtime.sendMessage({ type: 'modTapEditor', action: 'highlights', force });
            enabled = new Set(result?.ok && Array.isArray(result.enabledKeys) ? result.enabledKeys.filter(eligible) : []);
            paint();
            // Bounded startup/busy retries; there is no continuous HID polling.
            if (result?.retry && retries++ < 5) again = true;
            else retries = 0;
        } catch { enabled.clear(); paint(); }
        finally {
            reading = false;
            if (again) { again = false; schedule(forceNext, 1500); }
        }
    }
    function syncDOM() {
        paint();
        const next = document.querySelector('.profile-bar')?.textContent || '';
        if (next !== profileText) {
            profileText = next; enabled.clear(); paint(); retries = 0; schedule();
        }
    }
    document.addEventListener('click', event => {
        if (!event.isTrusted || event.target.closest?.('[data-local-modtap-editor]')) return;
        retries = 0;
        schedule(Boolean(event.target.closest?.('.map-save, [class*="ModTap_wrapper__"]')));
    }, true);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { retries = 0; schedule(true); }
    });
    document.addEventListener('hypershift-unlocker:modtap-state', () => {
        enabled.clear(); paint(); retries = 0; schedule();
    });
    schedule(false, 0);
    return { syncDOM, refresh: () => { retries = 0; schedule(true); } };
}
