// GM_* API shims for testing in Playwright
window.GM_addStyle = function(css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
};
window.GM_xmlhttpRequest = function(details) {
    fetch(details.url, { method: details.method || 'GET' })
        .then(r => ({ finalUrl: r.url, status: r.status }))
        .then(details.onload)
        .catch(details.onerror);
};
window.GM_download = function(details) {
    const a = document.createElement('a');
    a.href = details.url;
    a.download = details.name || '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[easydown-shim] download:', details.name);
};
