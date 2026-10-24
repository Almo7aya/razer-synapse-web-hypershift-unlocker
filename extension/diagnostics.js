// Generated from src/diagnostics.mjs. MIT licensed.
(function installDiagnostics() {
    'use strict';
    if (location.origin !== 'https://synapse.razer.com' || window.__razerDiagnostics) return;
    const startedAt = new Date().toISOString();
    const entries = [], errors = [], startup = [];
    const hooks = {}, limits = { entries: 1000, characters: 1000000, entryCharacters: 12000, routinePerSecond: 60, importantPerSecond: 20, mappingPerSecond: 20, consolePerSecond: 5 };
    const rateLimited = { routine: 0, important: 0, mapping: 0 };
    const budget = { second: -1, routine: 0, important: 0, mapping: 0, console: 0 };
    const mappingEvents = [];
    const mappingLabel = /mod\s*tap|single\s*analog\s*key\s*assignment|dynamic\s*key\s*stroke/i;
    let totalSeen = 0, consoleSuppressed = 0;
    let characters = 0, sequence = 0, dropped = 0, recording = false;
    const sensitive = /token|password|secret|cookie|authorization|serial|email|username|userid|\bsn\b/i;
    function scrub(text) {
        let clean = text.slice(0, 16000);
        if (/bearer/i.test(clean)) clean = clean.replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]');
        if (clean.includes('eyJ')) clean = clean.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted JWT]');
        // Bound token lengths and skip irrelevant patterns: device packet logs
        // can be very frequent, so redaction must not backtrack over long strings.
        if (sensitive.test(clean) && /[:=]/.test(clean)) {
            clean = clean.replace(/(^|[\s,{])(["']?[\w-]{1,80}["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/g,
                (match, boundary, key) => sensitive.test(key) ? `${boundary}${key}[redacted]` : match);
        }
        if (clean.includes('@')) clean = clean.replace(/[\w.+-]{1,100}@[\w.-]{1,200}\.[A-Za-z]{2,20}/g, '[redacted email]');
        if (/\\Users\\/i.test(clean)) clean = clean.replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[redacted]');
        if (/https?:\/\//.test(clean)) {
            clean = clean.replace(/https?:\/\/[^\s"'<>]+/g, match => {
                try { const url = new URL(match); return url.origin + url.pathname; }
                catch { return '[URL]'; }
            });
        }
        return clean;
    }
    function snapshotValue(root) {
        const seen = new WeakSet();
        let visited = 0;
        function visit(value, depth = 0) {
            if (++visited > 160) return '[node limit]';
            if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
            if (typeof value === 'string') {
                const clean = scrub(value);
                return clean.slice(0, 2400) + (value.length > 2400 ? '…[truncated]' : '');
            }
            if (typeof value === 'undefined') return '[undefined]';
            if (typeof value === 'bigint') return `${value}n`;
            if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
            if (depth > 5) return '[depth limit]';
            if (seen.has(value)) return '[circular/repeated]';
            seen.add(value);
            try {
                if (typeof Node === 'function' && value instanceof Node) return '[DOM node]';
                if (ArrayBuffer.isView(value)) {
                    const bytes = new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, 128));
                    return { bytes: Array.from(bytes), byteLength: value.byteLength, truncated: value.byteLength > 128 };
                }
                if (value instanceof ArrayBuffer) return { bytes: Array.from(new Uint8Array(value, 0, Math.min(value.byteLength, 128))), byteLength: value.byteLength, truncated: value.byteLength > 128 };
                if (value instanceof Date) return Date.prototype.toISOString.call(value);
                const result = Array.isArray(value) ? [] : Object.create(null);
                const keys = Object.getOwnPropertyNames(value).filter(key => key !== 'length');
                for (const key of keys.slice(0, 50)) {
                    const entry = Object.getOwnPropertyDescriptor(value, key);
                    if (key === 'stack' && value instanceof Error && entry?.get
                        && Function.prototype.toString.call(entry.get).includes('[native code]')) {
                        try { result[key] = visit(Reflect.apply(entry.get, value, []), depth + 1); }
                        catch { result[key] = '[stack unavailable]'; }
                    } else result[key] = sensitive.test(key) ? '[redacted]'
                        : entry && 'value' in entry ? visit(entry.value, depth + 1) : '[accessor omitted]';
                }
                if (!Array.isArray(result) && keys.length > 50) result.__truncated = `${keys.length - 50} more fields`;
                return result;
            } catch { return '[unreadable value]'; }
        }
        return visit(root);
    }
    function record(level, args) {
        if (recording) return;
        totalSeen++;
        const second = Math.floor(Date.now() / 1000);
        if (budget.second !== second) Object.assign(budget, { second, routine: 0, important: 0, mapping: 0, console: 0 });
        // Reserve room for relevant command evidence even during noisy polling.
        // Read data descriptors only; never inspect devices or invoke getters.
        const mapping = args.slice(0, 12).some(value => {
            if (typeof value === 'string') return mappingLabel.test(value.slice(0, 1600));
            if (!value || typeof value !== 'object') return false;
            try {
                const entry = Object.getOwnPropertyDescriptor(value, 'commandDesc');
                return typeof entry?.value === 'string' && mappingLabel.test(entry.value.slice(0, 1600));
            } catch { return false; }
        });
        const category = mapping ? 'mapping' : ['warn', 'error', 'unhandledrejection', 'page-error', 'assert'].includes(level) ? 'important' : 'routine';
        if (++budget[category] > limits[`${category}PerSecond`]) {
            rateLimited[category]++;
            return;
        }
        recording = true;
        try {
            const entry = { sequence: ++sequence, time: new Date().toISOString(), level, args: snapshotValue(args.slice(0, 12)) };
            let serialized = JSON.stringify(entry);
            if (serialized.length > limits.entryCharacters) {
                entry.args = ['[entry truncated]', serialized.slice(0, 8000)];
                serialized = JSON.stringify(entry);
            }
            const size = serialized.length;
            entries.push({ entry, size });
            characters += size;
            if (mapping) {
                mappingEvents.push(entry);
                if (mappingEvents.length > 60) mappingEvents.shift();
            }
            if (startup.length < 40) startup.push(entry);
            if (['error', 'unhandledrejection', 'page-error', 'assert'].includes(level)) {
                errors.push(entry);
                if (errors.length > 40) errors.shift();
            }
            while (entries.length > limits.entries || characters > limits.characters) {
                characters -= entries.shift().size;
                dropped++;
            }
        } catch { /* Diagnostics must never interrupt an application log call. */ }
        finally { recording = false; }
    }
    const cleanURL = value => {
        try { const url = new URL(value, location.href); return url.origin + url.pathname; }
        catch { return ''; }
    };
    window.__razerDiagnostics = Object.freeze({
        snapshot() {
            const all = new Map([...startup, ...entries.map(item => item.entry), ...errors, ...mappingEvents].map(entry => [entry.sequence, entry]));
            return {
                schemaVersion: 1, startedAt, exportedAt: new Date().toISOString(),
                url: cleanURL(location.href), productId: /^\/products\/([1-9]\d*)(?:\/|$)/.exec(location.pathname)?.[1] || null,
                userAgent: navigator.userAgent, hooks: { ...hooks }, limits,
                captureMode: 'buffered; rate-limited warnings and errors echoed to console',
                totalSeen, totalRecorded: sequence, rateLimited: { ...rateLimited }, consoleSuppressed, droppedFromRecent: dropped,
                retainedMappingEvents: mappingEvents.length,
                scripts: Array.from(document.scripts).map(script => script.src).filter(Boolean).map(cleanURL).slice(-100),
                hypershift: snapshotValue(window.__razerHypershiftPatch ?? null),
                experiments: snapshotValue(window.__razerExperiments ?? null),
                appliedOptions: snapshotValue(window.__razerExperimentalOptions ?? null),
                entries: [...all.values()].sort((a, b) => a.sequence - b.sequence),
            };
        },
    });
    for (const method of ['log', 'info', 'debug', 'warn', 'error', 'assert', 'trace', 'dir', 'table', 'group', 'groupCollapsed', 'clear']) {
        const original = console[method];
        if (typeof original !== 'function') continue;
        try {
            console[method] = function (...args) {
                if (method === 'assert' && args[0]) return;
                record(method, method === 'assert' ? args.slice(1) : args);
                // Enabling the site's logger otherwise floods DevTools with HID
                // polling traffic. Routine output is available in the export.
                if (['warn', 'error', 'assert'].includes(method) && budget.console < limits.consolePerSecond) {
                    budget.console++;
                    return Reflect.apply(original, console, args);
                }
                consoleSuppressed++;
            };
            hooks[method] = true;
        } catch { hooks[method] = false; }
    }
    // Let the site call our buffered logger without persisting a site setting.
    try {
        const storage = window.localStorage, original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
            if (this === storage && key === 'enableLog') return 'true';
            return Reflect.apply(original, this, arguments);
        };
        hooks.enableLog = true;
    } catch { hooks.enableLog = false; }
    window.addEventListener('error', event => {
        if (event.message) record('page-error', [event.message, cleanURL(event.filename), event.lineno, event.colno, event.error]);
    });
    window.addEventListener('unhandledrejection', event => record('unhandledrejection', [event.reason]));
    record('info', ['Local diagnostic capture started. Buffer resets when this frame reloads.']);
})();
