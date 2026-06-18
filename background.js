// Background Service Worker for Cookie Auto Loader Premium

chrome.runtime.onInstalled.addListener(() => {
  console.log("Cookie Auto Loader Premium installed successfully.");
});

// We can add background listeners here if we need to coordinate across tabs
// or perform action changes, but most operations will run directly in popup.js.
