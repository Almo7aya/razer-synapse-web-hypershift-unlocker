// Generated from src/runtime.mjs. MIT licensed.
(function installHypershiftPatch() {
    'use strict';

    const match = /^\/products\/([1-9]\d*)(?:\/|$)/.exec(location.pathname);
    if (location.origin !== 'https://synapse.razer.com' || !match) return;
    const productId = match[1];

    const statusKey = '__razerHypershiftPatch';
    if (window[statusKey]) return;
    const status = window[statusKey] = {
        productId,
        state: 'waiting',
        hookedLayouts: 0,
        matchedFlags: 0,
        changedFlags: 0,
        failedFlags: 0,
    };
    const prefix = `[Synapse Web Hypershift: ${productId}]`;
    const defineProperty = Object.defineProperty;
    const getDescriptor = Object.getOwnPropertyDescriptor;
    const ownKeys = Reflect.ownKeys;
    const apply = Reflect.apply;
    const matched = new WeakSet();
    const failed = new WeakSet();
    let reportPending = false;

    function report() {
        if (reportPending) return;
        reportPending = true;
        queueMicrotask(() => {
            reportPending = false;
            console.info(`${prefix} ${status.changedFlags} flag(s) changed to false; ${status.matchedFlags} found in ${status.hookedLayouts} layout export(s).`, { ...status });
        });
    }

    function patchLayout(root) {
        const pending = [root];
        const visited = new WeakSet();
        try {
            while (pending.length) {
                const value = pending.pop();
                if (!value || typeof value !== 'object' || visited.has(value)) continue;
                visited.add(value);

                // Read data descriptors, without invoking unrelated getters.
                for (const key of ownKeys(value)) {
                    const descriptor = getDescriptor(value, key);
                    if (!descriptor || !('value' in descriptor)) continue;
                    if (key !== 'disableHypershiftMapping') {
                        if (descriptor.value && typeof descriptor.value === 'object') pending.push(descriptor.value);
                        continue;
                    }
                    if (!matched.has(value)) {
                        matched.add(value);
                        status.matchedFlags++;
                        report();
                    }
                    if (descriptor.value === false) continue;
                    try {
                        defineProperty(value, key, { ...descriptor, value: false });
                        status.changedFlags++;
                        report();
                    } catch (error) {
                        // A frozen object should not prevent Synapse from loading.
                        if (!failed.has(value)) {
                            failed.add(value);
                            status.failedFlags++;
                            console.warn(`${prefix} A mapping flag could not be changed.`, error);
                        }
                    }
                }
            }
            if (status.matchedFlags) status.state = status.failedFlags ? 'partial' : 'active';
        } catch (error) {
            status.state = 'partial';
            console.warn(`${prefix} Could not inspect a layout.`, error);
        }
        return root;
    }

    // Webpack registers exports before initializing their arrays. Read them
    // when a consumer does, or after the synchronous initialization finishes.
    Object.defineProperty = function (target, key, descriptor) {
        if (key !== 'groupList' || !descriptor || typeof descriptor.get !== 'function'
            || !target || getDescriptor(target, '__esModule')?.value !== true) {
            return apply(defineProperty, this, arguments);
        }

        const get = descriptor.get;
        const result = defineProperty(target, key, {
            ...descriptor,
            get() {
                return patchLayout(apply(get, this, []));
            },
        });
        status.hookedLayouts++;
        queueMicrotask(() => {
            try {
                // Also cover layouts which the user has not selected yet.
                patchLayout(apply(get, target, []));
            } catch (error) {
                console.warn(`${prefix} Layout not initialized yet; retrying when it is read.`, error);
            }
        });
        return result;
    };

    console.info(`${prefix} Ready; waiting for product layout exports.`);
    setTimeout(() => {
        if (!status.matchedFlags) {
            status.state = 'no-flags-found';
            // Products without this flag need no changes. Keep listening for
            // later exports, without presenting an error or warning.
        }
    }, 10000);
})();
