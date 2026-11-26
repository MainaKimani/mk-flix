// window.MKFlixNative for cinejoy.pk pages, in the page's own world, where the
// shared scripts run (they wrap the site's history.pushState, which a content
// script's isolated world can't reach). The desktop app's preload.js plays
// this part there.
//
// The synchronous answers (isSubscribed) come from a snapshot the service
// worker hands in right after this file, and again whenever it changes, so
// they are in place before any shared script runs. Calls that ask for
// something go out as window messages to bridge-relay.js, which passes them
// to the service worker. The worker decides what to do with them; nothing a
// page sends here can grant a subscription.
//
// Only what the desktop bridge offers on cinejoy.pk is defined. Methods left
// out make the shared scripts skip that feature: no enterPip/setPlaying (the
// browser's own picture-in-picture is used), and no CineJoy account calls yet,
// so mkflix-cinejoy.js does nothing for now.
(function () {
  "use strict";
  if (window.__blendyBridge) return;

  var state = { subscribed: false };

  function send(call) {
    window.postMessage({ __blendy: "page", call: call }, location.origin);
  }

  window.__blendyBridge = {
    update: function (snapshot) { state = snapshot || state; },
  };

  window.MKFlixNative = {
    isSubscribed: function () { return state.subscribed === true; },
    openPaywall: function () { send("openPaywall"); },
    openSubscription: function () { send("openSubscription"); },
    refreshSubscription: function () { send("refreshSubscription"); },
  };
})();
