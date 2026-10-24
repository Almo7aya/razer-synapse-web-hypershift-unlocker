import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EXPERIMENTS, normalizeExperiments, normalizeDeveloperMode, normalizeExperimentalMode, withExperimentEnabled } from '../src/experiments.mjs';
import { normalizePreferences } from '../src/preferences.mjs';

const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../extension/popup.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');

// Popup logic only: no browser, Synapse page or hardware is opened.
async function harness(developerMode = false, experimentalMode = false, disabledExperiments = ['dualPurpose', 'macros']) {
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.classList = {toggle(){}}; }
        append(...items) { this.children.push(...items); }
        replaceChildren(...items) { this.children = items; }
        addEventListener(type, listener) { this.listeners[type] = listener; }
        setAttribute() {}
        focus() { document.activeElement = this; }
        showModal() { this.open = true; }
        close() { this.open = false; this.listeners.close?.(); }
        querySelectorAll(selector) {
            return this.children.flatMap(child => [...((selector === child.tag || selector === '.' + child.className) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0]; }
        set innerHTML(value) {
            assert.ok(value.includes('product-heading'));
            this.children = ['img', 'input', 'product-name', 'product-state'].map(name => {
                const node = new Element(['img','input'].includes(name) ? name : 'p'); node.className = name; return node;
            });
        }
    }
    const fields = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => ['#' + id, new Element(id)]));
    fields.set('main', new Element('main'));
    const document = {activeElement:null,hidden:false,querySelector:selector=>fields.get(selector),createElement:tag=>new Element(tag)};
    const stored = {disabledProducts:[],disabledExperiments:[...disabledExperiments],developerMode,experimentalMode};
    let fail = false, storageListener;
    const messages = [], executions = [];
    const context = vm.createContext({document, URL, EXPERIMENTS, normalizePreferences, normalizeExperiments, normalizeDeveloperMode, normalizeExperimentalMode,
        discoverProducts(){}, collectDiagnostics(){}, collectModTapProbeInPage(){},
        setInterval(){},window:{close(){}}, chrome:{
            runtime:{async sendMessage(message) {
                messages.push(structuredClone(message));
                if (['setDeveloperMode', 'setExperimentalMode'].includes(message.type)) {
                    if (fail) return {ok:false,error:'Storage unavailable'};
                    stored[message.type === 'setDeveloperMode' ? 'developerMode' : 'experimentalMode']=message.enabled;
                }
                if (message.type === 'setExperiment') {
                    if (fail) return {ok:false,error:'Storage unavailable'};
                    stored.disabledExperiments=withExperimentEnabled(stored.disabledExperiments,message.experiment,message.enabled);
                }
                return {ok:true,...structuredClone(stored)};
            }},
            tabs:{async query(){return [{id:7,url:'https://synapse.razer.com/dashboard'}];}},
            storage:{onChanged:{addListener(listener){storageListener=listener;}}},
            scripting:{async executeScript(options){executions.push(options);return [{result:[
                {productId:'688',name:'Keyboard'}, {productId:'229',name:'Mouse'},
            ]}];}},
        }});
    await vm.runInContext(`(async()=>{${source}\n})()`, context);
    const controls = () => fields.get('#products').querySelectorAll('input').map(item=>item.dataset.control);
    const toggle = async (enabled, mode = 'developer') => {const control=fields.get(`#${mode}-mode`);control.checked=enabled;await control.listeners.change();};
    return {fields,messages,executions,stored,controls,toggle,document,fail:value=>{fail=value;},
        storage:(value, mode = 'developer')=>storageListener({[`${mode}Mode`]:{newValue:value}},'local')};
}

test('popup modes independently reveal diagnostics and experimental options, remember choices and prompt to reload', async () => {
    const h = await harness();
    assert.equal(h.fields.get('#notice').textContent, undefined, 'Popup initialization succeeds');
    assert.deepEqual(h.controls(), ['688','menu','windows','229']);
    assert.equal(h.fields.get('#developer-tools').hidden, true);
    assert.equal(h.fields.has('#read-modtap'), false);
    assert.equal(h.executions.length, 1, 'Opening the popup only discovers products; no old probe is run');
    await h.toggle(true);
    assert.equal(h.stored.developerMode, true);
    assert.deepEqual(h.controls(), ['688','menu','windows','keyboardLogs','229','mouseLogs']);
    assert.equal(h.fields.get('#developer-tools').hidden, false);
    assert.equal(h.fields.get('#reload-dialog').open, true);
    h.fields.get('#reload-dialog').close();
    assert.equal(h.document.activeElement, h.fields.get('#developer-mode'));
    await h.toggle(true, 'experimental');
    assert.equal(h.stored.experimentalMode, true);
    assert.equal(h.stored.developerMode, true);
    assert.deepEqual(h.controls(), ['688','menu','drag','windows','dualPurpose','keyboardLogs','229','macros','mouseLogs']);
    assert.equal(h.fields.get('#reload-dialog').open, true);
    h.fields.get('#reload-dialog').close();
    assert.equal(h.document.activeElement, h.fields.get('#experimental-mode'));
    await h.toggle(false);
    assert.equal(h.fields.get('#developer-tools').hidden, true);
    assert.deepEqual(h.controls(), ['688','menu','drag','windows','dualPurpose','229','macros']);
    const reopened = await harness(h.stored.developerMode, h.stored.experimentalMode);
    assert.equal(reopened.fields.get('#developer-mode').checked, false);
    assert.equal(reopened.fields.get('#experimental-mode').checked, true);
    assert.deepEqual(reopened.controls(), h.controls());
    await reopened.toggle(false, 'experimental');
    assert.deepEqual(reopened.controls(), ['688','menu','windows','229']);
    assert.deepEqual(reopened.stored.disabledExperiments, ['dualPurpose','macros']);
    const developerOnly = await harness(true);
    assert.equal(developerOnly.fields.get('#developer-mode').checked, true);
    assert.ok(developerOnly.controls().includes('keyboardLogs'));
    assert.ok(!developerOnly.controls().includes('drag'));
});

test('failed mode saves restore the previous popup state, and external stored mode changes update its controls', async () => {
    const h = await harness(); h.fail(true);
    for (const mode of ['developer','experimental']) {
        await h.toggle(true, mode);
        assert.equal(h.fields.get(`#${mode}-mode`).checked, false);
        assert.equal(h.fields.get('#developer-tools').hidden, true);
        assert.deepEqual(h.controls(), ['688','menu','windows','229']);
        assert.match(h.fields.get('#notice').textContent, /Storage unavailable/);
        assert.ok(!h.fields.get('#reload-dialog').open);
    }
    h.storage(true);
    assert.equal(h.fields.get('#developer-mode').checked, true);
    assert.ok(h.controls().includes('keyboardLogs'));
    assert.ok(!h.controls().includes('drag'));
    h.storage(true, 'experimental');
    assert.equal(h.fields.get('#experimental-mode').checked, true);
    assert.ok(h.controls().includes('drag'));
    h.storage(false);
    assert.deepEqual(h.controls(), ['688','menu','drag','windows','dualPurpose','229','macros']);
    const count = h.executions.length;
    await h.fields.get('#export-diagnostics').listeners.click();
    assert.equal(h.executions.length, count, 'Experimental mode alone cannot enable diagnostic exports');
    h.storage(false, 'experimental');
    assert.deepEqual(h.controls(), ['688','menu','windows','229']);
});

test('Dual-purpose keys is a remembered keyboard toggle with a reload prompt', async () => {
    const feature = h => h.fields.get('#products').querySelectorAll('input').find(input => input.dataset.control === 'dualPurpose');
    const change = async (h, enabled) => { const checkbox=feature(h); checkbox.checked=enabled; await checkbox.listeners.change(); };
    assert.equal(feature(await harness()), undefined, 'Hidden outside Experimental mode');
    const h = await harness(false, true);
    assert.equal(feature(h).checked, false, 'Requires an explicit opt-in even in Experimental mode');
    assert.equal(feature(h).disabled, false, 'Developer mode is not required');
    await change(h, true);
    assert.equal(feature(h).checked, true);
    h.fields.get('#reload-dialog').close();
    await change(h, false);
    assert.equal(feature(h).checked, false);
    assert.equal(h.fields.get('#reload-dialog').open, true);
    assert.ok(h.stored.disabledExperiments.includes('dualPurpose'));
    const reopened = await harness(false, true, h.stored.disabledExperiments);
    assert.equal(feature(reopened).checked, false);
    await change(reopened, true);
    assert.equal(feature(reopened).checked, true);
    reopened.fields.get('#reload-dialog').close();
    reopened.fail(true);
    await change(reopened, false);
    assert.equal(feature(reopened).checked, true, 'Failed saves restore the previous choice');
    assert.equal(reopened.executions.length, 1, 'Changing the option performs no page or hardware operations before reload');
});
