import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installModTapHighlights } from '../src/modtap-highlights.mjs';

function harness(page = 'customize') {
    const keys = ['KEY_H','KEY_BACKSLASH_mapped','KEY_CAPS_LOCK_mapped','KEY_FN','KEY_WINDOWS'].map(id => ({id,dataset:{}}));
    const timers = new Map(), listeners = {}, calls = [], styles = [];
    let nextTimer = 0, profile = 'Profile A', result = {ok:true,enabledKeys:['KEY_H']};
    const document = { hidden:false, documentElement:{dataset:{localModtapPage:page}}, head:{append:style=>styles.push(style)}, createElement:()=>({}),
        querySelector: () => ({textContent:profile}), querySelectorAll:()=>keys,
        addEventListener(type, listener) { listeners[type] = listener; } };
    const context = vm.createContext({document,setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),
        chrome:{runtime:{async sendMessage(message){calls.push(structuredClone(message));return result;}}}});
    const app = vm.runInContext(`(${installModTapHighlights.toString()})()`,context);
    const flush = async () => { const pending=[...timers.values()];timers.clear();for(const fn of pending)await fn(); };
    const click = (kind='',isTrusted=true) => listeners.click({isTrusted,target:{closest(selector){
        if(selector==='[data-local-modtap-editor]')return kind==='editor';
        return kind==='save';
    }}});
    return {app,keys,timers,calls,styles,document,listeners,flush,click,setResult:value=>{result=value;},profile:value=>{profile=value;}};
}

test('highlights follow keyboard replies, mapped SVG IDs and replacements without changing native key metadata', async () => {
    const h=harness(); h.setResult({ok:true,enabledKeys:['KEY_H','KEY_BACKSLASH','KEY_CAPS_LOCK','KEY_FN','KEY_LEFT_GUI']});
    await h.flush();
    assert.deepEqual(h.keys.map(key=>key.dataset.localModtapEnabled), ['true','true',undefined,undefined,'true']);
    assert.match(h.styles[0].textContent, /#baa1ff/);
    h.keys[0]={id:'KEY_H_mapped',dataset:{},nativeValue:'unchanged'};
    h.app.syncDOM();
    await h.flush();
    assert.equal(h.keys[0].dataset.localModtapEnabled,'true'); assert.equal(h.keys[0].nativeValue,'unchanged');
    h.setResult({ok:true,enabledKeys:[]});h.app.refresh();await h.flush();
    assert.ok(h.keys.every(key=>!key.dataset.localModtapEnabled));
    assert.ok(h.calls.every(call=>call.action==='highlights'), 'The highlighter never requests a write');
});

test('profile changes clear stale colours before replacement reads; failed reads keep them cleared', async () => {
    const h=harness(); h.app.syncDOM();await h.flush();
    assert.equal(h.keys[0].dataset.localModtapEnabled,'true');
    h.profile('Profile B');h.app.syncDOM();
    assert.equal(h.keys[0].dataset.localModtapEnabled,undefined);
    h.setResult({ok:false});await h.flush();
    assert.ok(h.keys.every(key=>!key.dataset.localModtapEnabled));
    assert.equal(h.timers.size,0);
    h.setResult({ok:true,enabledKeys:['KEY_H']});h.app.refresh();await h.flush();
    h.listeners['hypershift-unlocker:modtap-state']();
    assert.equal(h.keys[0].dataset.localModtapEnabled,undefined, 'Profiles with identical displayed names still invalidate colours through the state notification');
    await h.flush();assert.equal(h.calls.at(-1).force,false, 'An external notification cannot force uncached device traffic');
});

test('ordinary clicks reuse the snapshot, save clicks force a read, and editor clicks do not trigger background reads', async () => {
    const h=harness();await h.flush();
    h.click('editor');h.click('',false);assert.equal(h.timers.size,0);
    h.click();h.click();h.click();assert.equal(h.timers.size,1);await h.flush();
    assert.equal(h.calls.at(-1).force,false);
    h.click('save');await h.flush();assert.equal(h.calls.at(-1).force,true);
    h.document.hidden=true;h.app.refresh();await h.flush();const count=h.calls.length;
    h.document.hidden=false;h.listeners.visibilitychange();await h.flush();assert.equal(h.calls.length,count+1);
});

test('startup retries stop after six attempts instead of continuously polling an unavailable keyboard', async () => {
    const h=harness();h.setResult({ok:false,retry:true});
    for(let i=0;i<10;i++)await h.flush();
    assert.equal(h.calls.length,6);assert.equal(h.timers.size,0);
    h.setResult({ok:true,enabledKeys:['KEY_H']});h.click();await h.flush();
    assert.equal(h.keys[0].dataset.localModtapEnabled,'true');
});

test('purple overlays appear only in Customize and return after navigating back', async () => {
    const h=harness('other');await h.flush();
    assert.equal(h.calls.length,0);
    const navigate=page=>{h.document.documentElement.dataset.localModtapPage=page;h.listeners['hypershift-unlocker:modtap-state']();};
    navigate('customize');await h.flush();
    assert.equal(h.keys[0].dataset.localModtapEnabled,'true');
    navigate('other');
    assert.ok(h.keys.every(key=>!key.dataset.localModtapEnabled));
    h.click('save');h.app.refresh();h.app.syncDOM();await h.flush();
    assert.equal(h.calls.length,1, 'Other product pages do not request highlight reads');
    navigate('customize');await h.flush();
    assert.equal(h.keys[0].dataset.localModtapEnabled,'true');
});

test('leaving Customize during an in-flight read cannot repaint another product page', async () => {
    const h=harness();let finish;
    h.setResult(new Promise(resolve=>{finish=resolve;}));
    const pending=h.flush();
    h.document.documentElement.dataset.localModtapPage='other';
    h.listeners['hypershift-unlocker:modtap-state']();
    finish({ok:true,enabledKeys:['KEY_H']});await pending;
    assert.ok(h.keys.every(key=>!key.dataset.localModtapEnabled));
    assert.equal(h.timers.size,0);
});
