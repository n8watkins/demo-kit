// The test extension needs a service worker so demo-kit can read its manifest
// and icons from inside the browser (the pre-flight check). It does nothing else.
chrome.runtime.onInstalled.addListener(() => {})
