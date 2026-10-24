// Self-contained, locally authored hooks. No fetched code is evaluated or rewritten.
// Based on the 2026-10-16 product bundles; unfamiliar shapes are left alone.
export function installExperimentalPatch(createModTapProbe) {
    'use strict';
    const match = /^\/products\/(688|229)(?:\/|$)/.exec(location.pathname);
    if (location.origin !== 'https://synapse.razer.com' || !match || window.__razerExperiments) return;
    const product = match[1];
    const options = { ...window.__razerExperimentalOptions };
    const relevant = product === '688' ? ['menu', 'drag', 'windows'] : ['macros'];
    const readProbe = product === '688' && options.dualPurpose && typeof createModTapProbe === 'function' ? createModTapProbe() : null;
    if (!relevant.some(key => options[key]) && !readProbe) return;
    const status = window.__razerExperiments = {
        product, options, state: 'waiting', hooks: {}, blockedSaves: 0, errors: [],
    };
    const define = Object.defineProperty;
    const descriptor = Object.getOwnPropertyDescriptor;
    const apply = Reflect.apply;
    const sourceOf = value => Function.prototype.toString.call(value);
    const wrappers = new WeakMap();
    const factories = new WeakSet();
    const reactObjects = new WeakSet();
    let loader;
    let writerAvailable = false;
    let banner;

    function note(name) { status.hooks[name] = true; }
    function error(error) {
        status.state = 'partial';
        if (status.errors.length < 10) status.errors.push(String(error?.message || error));
    }
    function message(text) {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', () => message(text), { once: true });
            return;
        }
        if (!banner) {
            banner = document.createElement('div');
            banner.setAttribute('role', 'status');
            banner.style.cssText = 'position:fixed;bottom:12px;left:12px;max-width:550px;z-index:2147483647;padding:10px 14px;border:1px solid #b59a57;border-radius:6px;background:#28251a;color:#fff3cd;font:13px/1.5 system-ui;pointer-events:none';
            document.body.append(banner);
        }
        banner.textContent = text;
    }
    function block(reason) {
        status.blockedSaves++;
        status.lastBlockedSave = reason;
        message(`Cannot save: ${reason}`);
        throw new Error(`Hypershift Mapping Unlocker: ${reason}`);
    }

    function patchLayout(root) {
        const pending = [root], seen = new WeakSet();
        while (pending.length) {
            const value = pending.pop();
            if (!value || typeof value !== 'object' || seen.has(value)) continue;
            seen.add(value);
            if (Array.isArray(value.functionList) && typeof value.buttonKey === 'string') {
                const add = name => {
                    if (!value.functionList.includes(name)) value.functionList.push(name);
                };
                if (product === '688') {
                    if (options.windows && writerAvailable && value.buttonKey === 'KEY_WINDOWS') {
                        value.isEnabled = true;
                        value.isSidePanelList = true;
                        note('windowsLayout');
                    }
                } else if (options.macros) { add('MACRO'); note('macroMenus'); }
            }
            for (const key of Reflect.ownKeys(value)) {
                const entry = descriptor(value, key);
                if (entry && 'value' in entry && entry.value && typeof entry.value === 'object') pending.push(entry.value);
            }
        }
        return root;
    }

    function patchCapabilities(value) {
        if (product !== '229' || !options.macros || !value || typeof value !== 'object') return value;
        if (Number(value.productId) === 229 && value.OBMSpecs) {
            if (value.OBMSpecs.supportedFeature) value.OBMSpecs.supportedFeature.macros = true;
            if (value.OBMSpecs.supportedMappings) value.OBMSpecs.supportedMappings.macroGroup = true;
            note('macroCapabilities');
        }
        if (value.engineType === 'obmEngineMouse' && value.obmSupportFeature) {
            value.obmSupportFeature.macros = true;
            note('macroEngine');
        }
        return value;
    }

    function patchFunction(value) {
        if (product !== '688' || typeof value !== 'function') return value;
        if (wrappers.has(value)) return wrappers.get(value);
        const source = sourceOf(value);
        let wrapped = value;
        // The Web save adapter otherwise falls through with an empty mapping for
        // these editors. Reject before it can call the device engine.
        if (source.includes('setKeyMapping') && source.includes('setSingleButtonMapping') && source.includes('outputType')) {
            wrapped = async function (engine, mapping, ...rest) {
                if (mapping?.inputID === 'KEY_FN') block('Fn mappings cannot be saved in Synapse Web.');
                const assignments = Array.isArray(mapping?.mapping) ? mapping.mapping : [mapping];
                const supported = ['defaultGroup', 'keyboardGroup', 'mouseGroup', 'multimediaGroup', 'hyperShiftGroup', 'sensitivityGroup', 'disableGroup', 'profileNavigationGroup', 'macroGroup'];
                if (assignments.some(item => item && !supported.includes(item.outputType))) {
                    block('Controller, joystick and Dynamic Keystroke assignments have no Web save implementation.');
                }
                let next = mapping;
                if (options.windows && mapping?.inputID === 'KEY_WINDOWS') {
                    if (!engine?.inputIDToMapping?.keyboard?.NormalMode?.KEY_LEFT_GUI) {
                        block('This engine does not expose the Windows key firmware mapping.');
                    }
                    // Use the existing firmware mapping, never an invented ID.
                    next = { ...mapping, inputID: 'KEY_LEFT_GUI' };
                    note('windowsSaveAlias');
                }
                return apply(value, this, [engine, next, ...rest]);
            };
            note('saveGuard');
        } else if (options.drag && source.includes('dragCustomize') && source.includes('originalButton')
            && source.includes('controllerAssignment') && source.includes('buttonKey')) {
            wrapped = function (drag, target, ...rest) {
                if (drag?.data?.[0]?.outputType !== 'hyperShiftGroup') return apply(value, this, arguments);
                // Only the denylist reads buttonKey here. Preserve controller
                // eligibility and the originalButton/inputID self-drop check.
                note('hypershiftDrag');
                return apply(value, this, [drag, { ...target, buttonKey: '__local_hypershift_drop__' }, ...rest]);
            };
            note('dragGuard');
        }
        wrappers.set(value, wrapped);
        return wrapped;
    }

    function patchExport(key, value) {
        try {
            if (key === 'groupList') return patchLayout(value);
            if (['DeviceInfo', 'lp', 'P7'].includes(key)) return patchCapabilities(value);
            if (key === 'IOh' && product === '688' && Array.isArray(value)) {
                return value.filter(key => !(writerAvailable && options.windows && key === 'KEY_WINDOWS'));
            }
            if (key === 'e' || key === 'z') return patchFunction(value);
        } catch (caught) { error(caught); }
        return value;
    }

    function patchReact(value) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function') || reactObjects.has(value)) return;
        reactObjects.add(value);
        // React's shared export is loaded before the product's class components.
        if (product === '688' && value.Component?.prototype) {
            const proto = value.Component.prototype;
            for (const method of ['clickBtn', 'checkNotRemapped']) {
                if (descriptor(proto, method)) continue;
                define(proto, method, {
                    configurable: true,
                    set(original) {
                        let wrapped = original;
                        if (typeof original === 'function') {
                            const source = sourceOf(original);
                            if (method === 'clickBtn' && options.menu && source.includes('KEY_APPLICATION')
                                && source.includes('setActiveSelectedKeys') && source.includes('setDefaultActuation')
                                && !/\bawait\b/.test(source)) {
                                wrapped = (...args) => {
                                    if (args[0] !== 'KEY_APPLICATION' || !this.props.isHyperShiftOn) return apply(original, this, args);
                                    const previous = this.props;
                                    // Audited handler is async but contains no awaits.
                                    // This bypasses only its Menu/Hypershift check;
                                    // the actual layer state and other checks stay intact.
                                    this.props = { ...previous, isHyperShiftOn: false };
                                    try { note('menuSelection'); return apply(original, this, args); }
                                    finally { this.props = previous; }
                                };
                                note('menuClickHandler');
                            }
                            if (method === 'checkNotRemapped' && options.windows && writerAvailable
                                && source.includes('KEY_WINDOWS') && source.includes('isSidePanelList')) {
                                wrapped = (button, ...rest) => apply(original, this, [button?.inputID === 'KEY_WINDOWS'
                                    ? { ...button, inputID: 'KEY_LEFT_GUI' } : button, ...rest]);
                                note('windowsEligibility');
                            }
                        }
                        define(this, method, { configurable: true, enumerable: true, writable: true, value: wrapped });
                    },
                });
            }
            note('reactMethods');
        }
    }

    function wrapFactories(modules) {
        // Mouse capability exports need no React or module-factory wrappers.
        if (product !== '688') return;
        for (const id of Object.keys(modules)) {
            const original = modules[id];
            if (typeof original !== 'function' || factories.has(original)) continue;
            const source = sourceOf(original);
            const probeSource = readProbe && (source.includes('initializeRzDevice') || source.includes('current profile changed')
                || (source.includes('customizeReducer:') && source.includes('modTapReducer:'))) ? source : '';
            if (product === '688') {
                if (source.includes('setKeyMapping') && source.includes('setSingleButtonMapping') && source.includes('outputType')) {
                    writerAvailable = true;
                    note('saveAdapterFound');
                }
            }
            const wrapped = function (module) {
                const result = apply(original, this, arguments);
                try { patchReact(module.exports); } catch (caught) { error(caught); }
                try { if (probeSource) readProbe.observeModule(module, probeSource); } catch (caught) { error(caught); }
                return result;
            };
            factories.add(wrapped);
            modules[id] = wrapped;
        }
    }

    function capture(require) {
        if (loader) return;
        if (!require?.m || typeof require.d !== 'function') return;
        loader = require;
        const original = require.d;
        require.d = function (target, exports) {
            const patched = {};
            for (const key of Object.keys(exports)) {
                const get = exports[key];
                patched[key] = ['groupList', 'DeviceInfo', 'lp', 'P7', 'IOh', 'e', 'z'].includes(key)
                    ? () => patchExport(key, get()) : get;
            }
            return apply(original, this, [target, patched]);
        };
        wrapFactories(require.m);
        status.state = 'hooked';
    }

    // Capture Webpack before it starts the entry module. Its old push is retained
    // per wrapper, avoiding recursion when Webpack binds the parent push.
    const chunkName = product === '688' ? 'webpackChunkproject_anne_taliat160' : 'webpackChunkproject_anne_wilmat1';
    function attach(queue) {
        if (!Array.isArray(queue)) return queue;
        let push;
        const wrap = original => function (...chunks) {
            for (const chunk of chunks) if (chunk?.[1] && loader) wrapFactories(chunk[1]);
            return apply(original, this, chunks);
        };
        push = wrap(queue.push);
        define(queue, 'push', {
            configurable: true,
            get: () => push,
            set(next) {
                push = wrap(next);
                if (!loader && typeof next === 'function') {
                    try { apply(next, queue, [[['hypershift-features'], {}, capture]]); }
                    catch (caught) { error(caught); }
                }
            },
        });
        return queue;
    }
    // An already initialized runtime cannot be patched reliably at this point.
    if (descriptor(window, chunkName)) {
        status.state = 'too-late';
        return;
    }
    let chunks;
    define(window, chunkName, {
        configurable: true,
        get: () => chunks,
        set(value) { chunks = attach(value); },
    });
    setTimeout(() => {
        if (!loader) status.state = 'runtime-not-found';
    }, 10000);
}
