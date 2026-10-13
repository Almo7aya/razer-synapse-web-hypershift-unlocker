// Executed read-only in the Synapse tab. All helpers must stay inside this
// function because chrome.scripting serializes it without module dependencies.
export function discoverProducts() {
    const origin = 'https://synapse.razer.com';
    if (location.origin !== origin) return [];
    const products = new Map();
    const visited = new Set();
    const sidebarIcons = new Map();

    function productId(href) {
        try {
            const url = new URL(href, location.href);
            return url.origin === origin ? /^\/products\/([1-9]\d{0,9})(?:\/|$)/.exec(url.pathname)?.[1] : undefined;
        } catch { return undefined; }
    }

    function nameKey(value) {
        return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/^razer\b/, '').replace(/[^a-z0-9]/g, '');
    }

    function readSidebarIcons(doc) {
        // Match each product's sidebar link by name, then read its live CSS.
        // No product categories, SVG markup, asset names, or hashes are bundled.
        for (const link of doc.querySelectorAll('a[aria-label][href]')) {
            try {
                const url = new URL(link.getAttribute('href'), doc.baseURI);
                if (url.origin !== origin) continue;
                const icon = link.querySelector('[class*="--bg-"][class*="-icon"]');
                if (!icon) continue;
                const background = doc.defaultView.getComputedStyle(icon).backgroundImage;
                const match = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)$/i.exec(background);
                const source = match?.[1] || match?.[2] || match?.[3];
                if (!source || source.length > 160000) continue;
                let image;
                if (/^data:image\/svg\+xml(?:;[a-z0-9=._+-]+)*,/i.test(source)) image = source;
                else {
                    const asset = new URL(source, doc.baseURI);
                    if (asset.origin !== origin || !/\.svg$/i.test(asset.pathname)) continue;
                    image = asset.href;
                }
                const routeName = decodeURIComponent(url.hash.replace(/^#\/?/, '').split(/[/?]/)[0]);
                for (const name of [link.getAttribute('aria-label'), routeName]) {
                    const key = nameKey(name || '');
                    if (key) sidebarIcons.set(key, image);
                }
            } catch { /* Skip an incomplete link or unavailable icon. */ }
        }
    }

    function inspect(win, href) {
        const id = productId(href);
        let doc;
        try { doc = win?.document; } catch { /* A frame can be in navigation. */ }
        if (id) {
            const currentId = (() => { try { return productId(win?.location.href); } catch { return undefined; } })();
            const ready = Boolean(doc && currentId === id && doc.readyState !== 'loading');
            const name = ready ? (doc.querySelector('.device-name')?.textContent || doc.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
            const previous = products.get(id);
            const applied = ready ? Boolean(win.__razerHypershiftPatch) : null;
            products.set(id, {
                productId: id,
                name: name || previous?.name || 'Razer product',
                applied: [...(previous?.applied || []), applied],
                loading: !ready || Boolean(previous?.loading),
            });
        }
        if (!doc || visited.has(doc)) return;
        visited.add(doc);
        readSidebarIcons(doc);
        for (const iframe of doc.querySelectorAll('iframe')) {
            try {
                const url = new URL(iframe.getAttribute('src') || '', doc.baseURI);
                if (url.origin === origin) inspect(iframe.contentWindow, url.href);
            } catch { /* Ignore unrelated or incomplete frames. */ }
        }
    }
    inspect(window, location.href);
    return [...products.values()].map(product => ({
        ...product,
        image: sidebarIcons.get(nameKey(product.name)) || '',
    }));
}
