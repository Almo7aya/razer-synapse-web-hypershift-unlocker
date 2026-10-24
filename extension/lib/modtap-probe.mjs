// Generated editor bridge and diagnostic export. Legacy test entry points are not shipped.
export async function runModTapEditorInPage(action, request) {
    if (location.origin !== 'https://synapse.razer.com' || !/^\/products\/688(?:\/|$)/.test(location.pathname)) return { ok: false, message: 'Open the Huntsman V3 Pro Mini in Synapse Web.' };
    if (!window.__razerModTapProbe?.editor) return { ok: false, message: 'Reload the extension and Synapse Web to load the editor.' };
    return await window.__razerModTapProbe.editor(action, request);
}
export function collectModTapProbeInPage() {
    const reports = [], visited = new Set();
    function visit(frame, path) {
        if (visited.has(frame) || visited.size >= 64) return;
        visited.add(frame);
        try {
            if (frame.location.origin !== 'https://synapse.razer.com') return;
            if (/^\/products\/688(?:\/|$)/.test(frame.location.pathname) && frame.__razerModTapProbe) {
                reports.push({ frame: path, ...frame.__razerModTapProbe.snapshot() });
            }
            for (let index = 0; index < frame.frames.length; index++) visit(frame.frames[index], `${path}/${index}`);
        } catch { /* Frame navigated. */ }
    }
    visit(window, 'top');
    return reports;
}
