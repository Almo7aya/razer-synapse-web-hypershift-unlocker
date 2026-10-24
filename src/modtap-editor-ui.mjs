// Runs in Chrome's isolated world. Page scripts cannot call this message bridge.
// The editor reads on user actions; highlights have their own bounded read pass.
export function installModTapEditorUI(installHighlights) {
    if (location.origin !== 'https://synapse.razer.com' || !/^\/products\/688(?:\/|$)/.test(location.pathname)
        || document.querySelector('[data-local-modtap-editor]')) return;
    const host = document.createElement('div');
    host.dataset.localModtapEditor = 'true';
    // Synapse's window capture listener checks this class before dismissing a
    // remapping panel. Our overlay is outside its inner .keymap-component, and
    // clicks inside the closed shadow root are retargeted to this host. A bubble
    // listener alone is too late to prevent that native outside-click handler.
    host.classList.add('preventing-closing-mapping');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
        :host { color-scheme: dark; font: 14px/1.5 "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        dialog { position: static; width: 100%; height: 100%; max-width: none; max-height: none; overflow: auto;
            margin: 0; padding: 16px; background: #111; color: #ccc; border: 0; border-radius: 0; }
        header { display: flex; gap: 12px; align-items: center; } h2 { margin: 0; font-size: 21px; flex: 1; }
        .extension-brand { display: grid; gap: 3px; margin-bottom: 12px; padding: 8px 10px;
            background: #272134; border-left: 3px solid #baa1ff; border-radius: 4px; color: #dfd3ff; }
        .extension-tag { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; }
        .extension-brand strong { font-size: 12px; line-height: 17px; font-weight: 600; }
        p { margin: 10px 0; } .muted { color: #b4c3b8; font-size: 13px; } .badge { color: #d8dca7; }
        label.field { display: grid; gap: 6px; margin-top: 16px; font-weight: 600; }
        select { width: 100%; padding: 10px; color: inherit; background: #252e28; border: 1px solid #536858; border-radius: 5px; font: inherit; }
        .toggle { display: flex; gap: 10px; align-items: center; margin-top: 16px; } input { accent-color: #79db9a; width: 18px; height: 18px; }
        .hold { padding: 12px; background: #242d27; border-radius: 5px; margin-top: 16px; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
        button { padding: 9px 13px; font: 600 15px "Segoe UI", sans-serif; border-radius: 5px; cursor: pointer;
            border: 1px solid #607565; color: #e3eee5; background: transparent; }
        button.primary { background: #79db9a; color: #102117; border-color: #79db9a; }
        button:disabled, select:disabled { opacity: .45; cursor: default; }
        button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #a3f5b9; outline-offset: 3px; }
        #status { min-height: 24px; color: #b0e9c1; white-space: pre-line; } #status.error { color: #ffc1b5; }
        [hidden] { display: none !important; }
        :host([data-inline]) { color-scheme: dark; }
        :host([data-inline]) dialog { position: static; width: 100%; max-width: none; height: 100%; max-height: none;
            padding: 16px; margin: 0; border: 0; border-radius: 0; background: #111; color: #ccc; }
        :host([data-inline]) h2 { color: #ccb8ff; font: 16px/20px "Segoe UI", sans-serif; text-transform: uppercase; }
        :host([data-inline]) .muted, :host([data-inline]) .badge { font-size: 12px; }
        :host([data-inline]) select { background: #111; border-color: #5d5d5d; border-radius: 3px; padding: 7px; }
        :host([data-inline]) .hold { background: #222; padding: 10px; }
        :host([data-inline]) input { accent-color: #baa1ff; flex: 0 0 auto; }
        :host([data-inline]) .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        :host([data-inline]) button { border-radius: 3px; padding: 8px 4px; font-size: 14px; }
        :host([data-inline]) #cancel { display: block; order: 0; background: #707070; border-color: #707070; }
        :host([data-inline]) #save { order: 1; background: #baa1ff; border-color: #baa1ff; color: #181021; }
        :host([data-inline]) #restore { order: 2; } :host([data-inline]) #refresh { order: 3; }
        #edit-hold { margin-top: 8px; padding: 6px 8px; width: 100%; }
    </style>
    <dialog aria-labelledby="heading">
        <div class="extension-brand"><span class="extension-tag">EXTENSION</span><strong>Hypershift Mapping Unlocker</strong></div>
        <header><h2 id="heading">Dual-purpose keys</h2></header>
        <p id="profile" class="muted">Loading profile…</p>
        <p id="support" class="badge"></p>
        <label class="toggle"><input id="enabled" type="checkbox"> Enable dual-purpose</label>
        <label class="field">On tap<select id="tap"></select></label>
        <div class="hold">On hold: <strong id="hold">Current normal assignment</strong>
            <p class="muted">Hold uses the key’s normal mapping. Change it in Synapse Web, then return here to set the tap action.</p>
            <button id="edit-hold">Change hold action</button></div>
        <div class="actions"><button id="cancel">Cancel</button><button id="save" class="primary">Save</button><button id="restore">Restore original</button><button id="refresh">Refresh</button></div>
        <p id="status" role="status" aria-live="polite"></p>
        <p class="muted">Changes are saved on the keyboard and remain after disabling or removing the extension. Restore original resets this key’s dual-purpose setting. Caps Lock and Fn are excluded.</p>
    </dialog>`;
    const $ = selector => shadow.querySelector(selector);
    const dialog = $('dialog');
    const highlights = typeof installHighlights === 'function' ? installHighlights() : null;
    let busy = false, view = null, needsRefresh = false, openedFrom, inline = null;
    const status = (text, error = false) => { $('#status').textContent = text; $('#status').classList.toggle('error', error); };
    const request = async value => {
        const result = await chrome.runtime.sendMessage({ type: 'modTapEditor', ...value, requireSelected: true });
        if (!result) throw Error('No response from the extension. Reload the extension and Synapse Web.');
        if (!result.ok) {
            if (result.view) view = result.view;
            throw Error(result.message || result.error || 'Could not verify the change. Turn on Developer mode in the extension to export diagnostics.');
        }
        return result;
    };
    function dirty() {
        return Boolean(view && (Number($('#enabled').checked) !== view.current.enabled
            || ($('#enabled').checked && Number($('#tap').value) !== view.current.keyCode)));
    }
    function controls() {
        for (const id of ['enabled', 'tap', 'cancel', 'refresh']) $(`#${id}`).disabled = busy;
        const tapCode = Number($('#tap').value);
        const validTap = view?.taps.some(tap => tap.code === tapCode);
        $('#save').disabled = busy || needsRefresh || !view || view.pending || !validTap || !dirty();
        $('#restore').disabled = busy || needsRefresh || !view?.hasBackup || (view.restored && !view.pending);
        $('#edit-hold').disabled = busy || needsRefresh || !view || view.pending;
    }
    function fill(select, options, value) {
        select.replaceChildren(...options.map(({ value, label }) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }));
        select.value = String(value);
    }
    function display() {
        if (!view) return;
        $('#profile').textContent = `Profile: ${view.profileName}`;
        const selected = view.keys.find(key => key.inputID === view.inputID);
        const taps = view.taps.map(tap => ({ value: tap.code, label: tap.name }));
        const currentKnown = view.taps.some(tap => tap.code === view.current.keyCode);
        if (!currentKnown && view.current.enabled) taps.unshift({ value: view.current.keyCode, label: 'Current action (unlisted)' });
        const defaultTap = view.taps.find(tap => tap.code === selected?.defaultTapCode)?.code ?? view.taps[0]?.code;
        fill($('#tap'), taps, currentKnown || view.current.enabled ? view.current.keyCode : defaultTap);
        $('#enabled').checked = Boolean(view.current.enabled);
        $('#hold').textContent = view.hold;
        $('#support').textContent = selected?.support === 'Tested' ? 'Tap and hold tested on this key, including after reconnecting.'
            : selected?.support === 'Stock key' ? 'Built-in dual-purpose key. Synapse’s main dual-purpose switch can reset its mapping.'
                : 'Tap and hold have not yet been tested on this key.';
        controls();
    }
    async function task(fn) {
        if (busy) return;
        busy = true; controls();
        try { await fn(); }
        catch (error) { needsRefresh = true; status(error.message, true); }
        finally { busy = false; controls(); }
    }
    async function read(inputID) {
        status('Reading the selected key…');
        const result = await request({ action: 'read', inputID });
        view = result.view; needsRefresh = false; display();
        status(result.message || (view.pending ? 'A previous write is unverified. Restore this key before saving another change.' : 'Current settings read from the keyboard.'));
    }
    function closeInline() {
        if (!inline) return;
        const previous = inline;
        inline = null;
        previous.button.classList.remove('open');
        previous.button.setAttribute('aria-pressed', 'false');
        if (previous.body) { previous.body.inert = previous.bodyInert; previous.body.style.visibility = previous.bodyVisibility; }
        for (const item of previous.selected) if (item.isConnected) item.classList.add('open');
        dialog.close();
        document.body.append(host);
        delete host.dataset.inline; host.style.cssText = '';
    }
    function inlinePanel(button, panel) {
        closeInline();
        if (dialog.open) dialog.close();
        const rail = panel.querySelector('.key-mapping.actions');
        const body = panel.querySelector('.body');
        inline = { panel, button, rail, body, bodyInert: body?.inert, bodyVisibility: body?.style.visibility,
            selected: [...rail.querySelectorAll('.action-wrapper.open')],
            title: panel.querySelector('.keymap-head')?.textContent };
        if (body) { body.inert = true; body.style.visibility = 'hidden'; }
        for (const item of inline.selected) item.classList.remove('open');
        button.classList.add('open'); button.setAttribute('aria-pressed', 'true');
        host.dataset.inline = 'true';
        // Absolutely positioned inside the existing content region. It cannot
        // become another flex column or cover the category rail / close button.
        host.style.cssText = 'position:absolute;left:44px;top:0;bottom:0;width:274px;max-width:calc(100% - 44px);z-index:104;background:#111;overflow:auto';
        panel.append(host);
        $('#save').textContent = 'Save';
        dialog.show();
    }
    async function open(button, panel) {
        if (busy) return;
        inlinePanel(button, panel);
        openedFrom = button;
        view = null; needsRefresh = true;
        $('#tap').replaceChildren();
        $('#enabled').checked = false; $('#support').textContent = '';
        $('#profile').textContent = 'Loading profile…'; $('#hold').textContent = 'Current normal assignment';
        await task(async () => {
            status('Loading the keyboard…');
            const available = await request({ action: 'catalog' });
            const target = available.selectedInputID;
            if (!available.keys.some(key => key.inputID === target)) throw Error('This selected key is excluded or unavailable. Choose another key in Synapse.');
            await read(target);
        });
    }
    for (const id of ['enabled', 'tap']) $(`#${id}`).addEventListener('change', controls);
    $('#refresh').addEventListener('click', event => {
        if (!event.isTrusted) return;
        highlights?.refresh();
        if (view) void task(() => read(view.inputID));
        else if (inline) void open(openedFrom, inline.panel);
    });
    for (const action of ['save', 'restore']) $(`#${action}`).addEventListener('click', event => {
        if (!event.isTrusted || !view || needsRefresh) return;
        void task(async () => {
            status(action === 'save' ? 'Saving and verifying…' : 'Restoring and verifying…');
            let result;
            try { result = await request({ action, inputID: view.inputID, expected: view.expected,
                ...(action === 'save' ? { settings: { enabled: $('#enabled').checked, keyCode: Number($('#tap').value) } } : {}) }); }
            finally { highlights?.refresh(); }
            view = result.view; needsRefresh = false; display(); status(result.message);
        });
    });
    $('#edit-hold').addEventListener('click', event => {
        if (!event.isTrusted || busy || !view || needsRefresh || !inline) return;
        if (dirty()) { status('Save or cancel your tap changes before editing the hold action.', true); return; }
        void task(async () => {
            const current = await request({ action: 'catalog' });
            if (current.selectedInputID !== view.inputID) throw Error('The selected key changed. Reopen Dual-purpose for the new key.');
            if (current.isHypershift) { status('Switch Synapse to Standard mode before editing the hold action.', true); return; }
            const nativeEditor = inline.rail.querySelector('.action-wrapper.KEYBOARD_FUNCTION .head');
            if (!nativeEditor) throw Error('Select Keyboard Function in Synapse to change the normal assignment.');
            closeInline();
            nativeEditor.click(); // Navigation only. The user saves in Synapse.
        });
    });
    $('#cancel').addEventListener('click', event => { if (event.isTrusted && !busy) closeInline(); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => openedFrom?.focus());
    // Keep handled editor events out of the site's bubbling listeners without
    // cancelling checkbox/label activation, select menus or focus defaults.
    for (const type of ['click', 'mousedown', 'pointerdown', 'keydown']) host.addEventListener(type, event => event.stopPropagation());
    // Native category/key/close clicks dismiss our unsaved form. During a write
    // keep the selection stable until its read-back has finished.
    document.addEventListener('click', event => {
        if (!inline || !event.isTrusted || host.contains(event.target) || inline.button.contains(event.target)) return;
        if (busy) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        closeInline();
    }, true);
    function mountCategory(panel) {
        const rail = panel.querySelector('.key-mapping.actions');
        if (!rail || rail.querySelector('[data-local-modtap-entry="panel"]')) return;
        const item = document.createElement('div');
        item.className = 'action-wrapper'; item.dataset.localModtapEntry = 'panel';
        item.setAttribute('role', 'button'); item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', 'Dual-purpose — Hypershift Mapping Unlocker extension'); item.setAttribute('aria-pressed', 'false');
        item.title = 'Dual-purpose — Hypershift Mapping Unlocker extension';
        item.style.cssText = 'box-shadow:inset 3px 0 #baa1ff;background-color:#272134';
        const head = document.createElement('div'); head.className = 'head';
        head.style.color = '#ccb8ff';
        const icon = document.createElement('i'); icon.setAttribute('aria-hidden', 'true'); icon.textContent = '⇄';
        icon.style.cssText = 'position:absolute;left:12px;top:6px;width:20px;height:20px;line-height:20px;font:22px/20px Segoe UI,sans-serif;text-align:center';
        const badge = document.createElement('b'); badge.setAttribute('aria-hidden', 'true'); badge.textContent = 'EXT';
        badge.style.cssText = 'position:absolute;left:8px;top:29px;width:28px;font:700 8px/11px Segoe UI,sans-serif;letter-spacing:.6px;text-align:center;color:#dfd3ff';
        const label = document.createElement('span'); label.textContent = 'Dual-purpose';
        head.append(icon, badge, label); item.append(head);
        const activate = event => {
            if (!event.isTrusted) return;
            if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); void open(item, panel);
        };
        item.addEventListener('click', activate); item.addEventListener('keydown', activate);
        // Put it next to Keyboard Function, inheriting the site's own category
        // sizing, hover expansion and selected styling without adding a column.
        const keyboard = rail.querySelector('.action-wrapper.KEYBOARD_FUNCTION');
        if (keyboard) keyboard.after(item); else rail.append(item);
    }
    let scheduled = false;
    const scan = () => {
        scheduled = false;
        highlights?.syncDOM();
        for (const panel of document.querySelectorAll('.common-key-mapping.key-config.open')) mountCategory(panel);
        if (inline && !busy && (!inline.panel.isConnected || !inline.panel.classList.contains('open')
            || !inline.button.isConnected || inline.panel.querySelector('.keymap-head')?.textContent !== inline.title)) closeInline();
    };
    new MutationObserver(() => { if (!scheduled) { scheduled = true; setTimeout(scan, 100); } })
        .observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    scan();
}
