import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installModTapEditorUI } from '../src/modtap-editor-ui.mjs';

// Small event/DOM double for message routing; no browser or device is opened.
function harness({ enabled = 1, keyCode = 80, isHypershift = false } = {}) {
    const fields = new Map(), calls = [];
    let shadow, editorHost, selectedInputID = 'KEY_A', fail = false, scan, documentClick;
    class Element {
        constructor(tag) {
            this.tag = tag; this.dataset = {}; this.style = {}; this.children = []; this.listeners = {}; this.value = ''; this.attributes = {}; this.inert = false;
            this.classes = new Set(); this.classList = { toggle: (key, on) => on ? this.classes.add(key) : this.classes.delete(key),
                add: key => this.classes.add(key), remove: key => this.classes.delete(key), contains: key => this.classes.has(key) };
        }
        set className(value) { this.classes = new Set(value.split(' ')); }
        get isConnected() { return true; }
        setAttribute(key, value) { this.attributes[key] = value; }
        contains(target) { return this === target || this.children.some(child => child.contains(target)); }
        append(...children) {
            for (const child of children) {
                if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
                child.parentElement = this; this.children.push(child);
            }
        }
        after(child) { const parent = this.parentElement; child.parentElement = parent; parent.children.splice(parent.children.indexOf(this)+1,0,child); }
        replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ''; }
        addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
        emit(type, isTrusted = true, supplied) {
            const event = supplied || { type, target:this, isTrusted, propagationStopped:false, defaultPrevented:false,
                stopPropagation() { this.propagationStopped = true; }, preventDefault() { this.defaultPrevented = true; } };
            for (const callback of this.listeners[type] || []) callback(event);
            return event;
        }
        querySelector(selector) {
            const entry = /data-local-modtap-entry="([^"]+)"/.exec(selector)?.[1];
            if (entry) return this.children.find(child => child.dataset.localModtapEntry === entry);
            return fields.get(selector) || null;
        }
        querySelectorAll(selector) { assert.equal(selector, '.action-wrapper.open'); return this.children.filter(child => child.classList.contains('action-wrapper') && child.classList.contains('open')); }
        attachShadow() { editorHost = this; shadow = new Element('shadow'); return shadow; }
        set innerHTML(value) {
            fields.set('dialog', new Element('dialog'));
            for (const [,id] of value.matchAll(/\bid="([^"]+)"/g)) fields.set(`#${id}`, new Element(id));
        }
        showModal() { throw Error('Standalone popup must not open'); }
        click() { this.clickCount = (this.clickCount || 0) + 1; this.emit('click', false); }
        show() { this.open = true; }
        close() { this.open = false; this.emit('close'); }
        focus() {}
    }
    const widget = new Element('widget'), panel = new Element('panel'), body = new Element('body');
    const rail = new Element('rail'), nativeBody = new Element('native-body'), keyboard = new Element('keyboard'), heading = new Element('heading');
    keyboard.className = 'action-wrapper KEYBOARD_FUNCTION open'; panel.classList.add('open');
    heading.textContent = 'A'; rail.append(keyboard); panel.append(rail, nativeBody, heading);
    fields.set('.keymap-head', heading); fields.set('.key-mapping.actions', rail);
    fields.set('.action-wrapper.KEYBOARD_FUNCTION', keyboard); fields.set('.body', nativeBody);
    const keyboardHead = new Element('native-keyboard-head'); keyboard.append(keyboardHead);
    fields.set('.action-wrapper.KEYBOARD_FUNCTION .head', keyboardHead);
    const document = {
        body, createElement: tag => new Element(tag), addEventListener(type, listener, capture) { assert.equal(type, 'click'); assert.equal(capture, true); documentClick = listener; },
        querySelector(selector) {
            if (selector === '[data-local-modtap-editor]') return body.children.find(child => child.dataset.localModtapEditor);
            if (selector.includes('ModTap_wrapper__')) return { closest: selector => selector === '.widget' ? widget : null };
            return null;
        },
        querySelectorAll(selector) { assert.equal(selector, '.common-key-mapping.key-config.open'); return [panel]; },
    };
    const keys = [{inputID:'KEY_BACKSLASH',name:'Backslash',support:'Tested',defaultTapCode:49},
        {inputID:'KEY_A',name:'A',support:'Experimental',defaultTapCode:4},{inputID:'KEY_H',name:'H',support:'Experimental',defaultTapCode:11}];
    const taps = [{code:4,name:'A'},{code:11,name:'H'},{code:41,name:'Escape'},{code:49,name:'Backslash'},{code:80,name:'Left Arrow'}];
    const makeView = inputID => ({inputID,keys,taps,hold:inputID==='KEY_A'?'A':'Backslash',profileName:'Gaming',
        current:{keyId:inputID==='KEY_A'?31:29,enabled,keyCode,holdTime:250},expected:{scope:inputID,current:{}},hasBackup:true,restored:false,pending:false});
    const context = vm.createContext({ document, location: {origin:'https://synapse.razer.com',pathname:'/products/688/'},
        MutationObserver: class { constructor(fn) { scan = fn; } observe() {} }, setTimeout: fn => fn(),
        chrome: { runtime: { async sendMessage(request) {
            calls.push(structuredClone(request));
            if (fail) return {ok:false,error:'Keyboard changed. Click Refresh.'};
            if (request.action === 'catalog') return {ok:true,keys,taps,selectedInputID,isHypershift};
            const view = makeView(request.inputID);
            if (request.action === 'save') Object.assign(view.current, {keyCode:request.settings.keyCode,enabled:Number(request.settings.enabled)});
            return {ok:true,view,message:'Verified'};
        } } },
    });
    vm.runInContext(`(${installModTapEditorUI.toString()})()`, context);
    function nativeWindowCapture(event) {
        // Synapse's audited windowClick handler runs before document/host
        // listeners. The overlay is not inside its inner keymap-component.
        const target = event.target;
        if (!rail.contains(target) && !nativeBody.contains(target)
            && ![target, target.parentElement].some(node => node?.classList.contains('preventing-closing-mapping'))) {
            panel.classList.remove('open');
        }
    }
    function clickCheckbox(throughLabel = false) {
        const events = [];
        // Outside a closed shadow root both the label and its forwarded input
        // click expose the host as target, not the inner form control.
        for (let index = 0; index < (throughLabel ? 2 : 1); index++) {
            const event = {type:'click',target:editorHost,isTrusted:true,defaultPrevented:false,propagationStopped:false,
                preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
            nativeWindowCapture(event);
            documentClick(event);
            editorHost.emit('click', true, event);
            events.push(event);
        }
        if (!events.at(-1).defaultPrevented) {
            const checkbox = fields.get('#enabled'); checkbox.checked = !checkbox.checked; checkbox.emit('change');
        }
        scan();
        return events;
    }
    return { calls, widget, panel, rail, nativeBody, keyboard, keyboardHead, heading, editorHost, clickCheckbox, category: () => rail.children.find(child => child.dataset.localModtapEntry === 'panel'),
        clickOutside: () => documentClick({isTrusted:true,target:body}), scan: () => scan(), $: id => shadow.querySelector(id),
        selected: value => { selectedInputID = value; }, fail: value => { fail = value; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('only the native category mounts, ignores synthetic clicks and uses actual selection', async () => {
    const app = harness();
    assert.equal(app.widget.children.length, 0, 'The old feature-card button is removed');
    assert.equal(app.category().title, 'Dual-purpose — Hypershift Mapping Unlocker extension');
    assert.equal(app.category().parentElement, app.rail, 'Category lives in the native rail, never in the panel flex row');
    app.scan(); app.scan();
    assert.equal(app.widget.children.length, 0); assert.equal(app.rail.children.length, 2);
    assert.deepEqual(app.calls, []);
    app.category().emit('click', false); await settle();
    assert.equal(app.calls.length, 0);
    app.category().emit('click'); await settle();
    assert.deepEqual(app.calls.map(call => [call.action,call.inputID]), [['catalog',undefined],['read','KEY_A']]);
    assert.equal(app.$('#key'), null); assert.equal(app.$('#hold').textContent, 'A');
    assert.equal(app.nativeBody.inert, true); assert.equal(app.keyboard.classList.contains('open'), false);
    assert.equal(app.$('#save').textContent, 'Save');
    const overlay = app.panel.children.find(child => child.dataset.localModtapEditor);
    assert.match(overlay.style.cssText, /position:absolute/); assert.match(overlay.style.cssText, /left:44px/);
    app.$('#cancel').emit('click');
    assert.equal(app.nativeBody.inert, false); assert.equal(app.keyboard.classList.contains('open'), true);
    assert.equal(app.panel.children.length, 3);
    app.selected('KEY_BACKSLASH'); app.category().emit('click'); await settle();
    assert.equal(app.calls.at(-1).inputID, 'KEY_BACKSLASH');
    assert.match(app.$('#support').textContent, /tested on this key/);
});

test('checkbox and label clicks survive native capture dismissal while retaining checkbox defaults', async () => {
    const app = harness(); app.category().emit('click'); await settle();
    assert.equal(app.$('#enabled').checked, true);
    for (const throughLabel of [false, true]) {
        const events = app.clickCheckbox(throughLabel);
        assert.ok(events.every(event => !event.defaultPrevented && event.propagationStopped), 'Editor bubbling is isolated without cancelling label/checkbox activation');
        assert.equal(app.$('dialog').open, true);
        assert.equal(app.panel.classList.contains('open'), true);
        assert.equal(app.$('#enabled').checked, throughLabel);
        assert.equal(app.$('#save').disabled, throughLabel, 'Toggle changes affect Save eligibility');
        assert.equal(app.calls.length, 2, 'A toggle alone must not write or probe the keyboard');
    }
    // Negative control reproduces the old failure despite the bubble listener:
    // window capture has already closed the native panel by that point.
    app.editorHost.classList.remove('preventing-closing-mapping');
    app.clickCheckbox();
    assert.equal(app.panel.classList.contains('open'), false);
    assert.equal(app.$('dialog').open, false);
});

test('editing fields sends nothing until Save, which carries the displayed key and snapshot', async () => {
    const app = harness(); app.category().emit('click'); await settle();
    app.$('#tap').value = '41'; app.$('#tap').emit('change');
    assert.equal(app.calls.length, 2); assert.equal(app.$('#save').disabled, false);
    app.$('#save').emit('click', false); await settle();
    assert.equal(app.calls.length, 2);
    app.$('#save').emit('click'); await settle();
    assert.deepEqual(app.calls.at(-1), {type:'modTapEditor',action:'save',inputID:'KEY_A',expected:{scope:'KEY_A',current:{}},settings:{enabled:true,keyCode:41},requireSelected:true});
    app.$('#restore').emit('click'); await settle();
    assert.equal(app.calls.at(-1).action, 'restore'); assert.equal(app.calls.at(-1).inputID, 'KEY_A');
});

test('reopening on Caps Lock clears a previous selection and cannot save it accidentally', async () => {
    const app = harness(); app.category().emit('click'); await settle();
    app.$('#cancel').emit('click'); app.selected('KEY_CAPS_LOCK');
    app.category().emit('click'); await settle();
    assert.match(app.$('#status').textContent, /excluded or unavailable/);
    assert.equal(app.$('#save').disabled, true); assert.equal(app.$('#restore').disabled, true);
    const count = app.calls.length;
    app.$('#save').emit('click'); await settle();
    assert.equal(app.calls.length, count);
});

test('new H mappings default to H on tap and the hold shortcut only navigates the native editor', async () => {
    const app = harness({enabled:0,keyCode:0}); app.selected('KEY_H'); app.category().emit('click'); await settle();
    assert.equal(app.$('#tap').value, '11');
    assert.equal(app.$('#save').disabled, true, 'Choosing a default while disabled does not create an unsaved edit');
    app.$('#edit-hold').emit('click'); await settle();
    assert.equal(app.keyboardHead.clickCount, 1);
    assert.equal(app.$('dialog').open, false);
    assert.ok(!app.calls.some(call => ['save','restore'].includes(call.action)));
});

test('hold navigation preserves unsaved tap edits and refuses Hypershift mode or a changed selection', async () => {
    const dirty = harness(); dirty.category().emit('click'); await settle();
    dirty.$('#tap').value = '41'; dirty.$('#tap').emit('change'); dirty.$('#edit-hold').emit('click'); await settle();
    assert.equal(dirty.keyboardHead.clickCount, undefined); assert.equal(dirty.calls.length, 2);
    assert.match(dirty.$('#status').textContent, /Save or cancel/); assert.equal(dirty.$('dialog').open, true);
    for (const mode of ['hypershift','changed']) {
        const app = harness({isHypershift:mode==='hypershift'}); app.category().emit('click'); await settle();
        if(mode==='changed')app.selected('KEY_H');
        app.$('#edit-hold').emit('click'); await settle();
        assert.equal(app.keyboardHead.clickCount, undefined); assert.equal(app.$('dialog').open, true);
        assert.match(app.$('#status').textContent, /Standard mode|selected key changed/);
    }
});

test('request errors require a successful Refresh before another write', async () => {
    const app = harness(); app.category().emit('click'); await settle();
    app.$('#tap').value = '41'; app.$('#tap').emit('change'); app.fail(true);
    app.$('#save').emit('click'); await settle();
    assert.equal(app.$('#save').disabled, true); assert.equal(app.$('#restore').disabled, true);
    assert.match(app.$('#status').textContent, /Keyboard changed/);
    app.fail(false); app.$('#refresh').emit('click'); await settle();
    assert.equal(app.calls.at(-1).action, 'read'); assert.equal(app.$('#restore').disabled, false);
});

test('leaving the native category or selecting another key discards only the unsaved form', async () => {
    const app = harness(); app.category().emit('click'); await settle();
    app.$('#tap').value = '41'; app.$('#tap').emit('change');
    app.clickOutside();
    assert.equal(app.$('dialog').open, false); assert.equal(app.nativeBody.inert, false);
    assert.equal(app.calls.length, 2, 'Dismissal must not save or probe again');
    app.category().emit('click'); await settle();
    app.heading.textContent = 'B'; app.scan();
    assert.equal(app.$('dialog').open, false);
    assert.equal(app.nativeBody.inert, false);
    assert.ok(!app.calls.some(call => call.action === 'save'));
});
