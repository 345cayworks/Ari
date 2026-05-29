/* =========================================================================
   ASI Cayman Theme — asi-cayman.js
   Lightweight, dependency-free progressive enhancement.
   - Accessible mobile menu toggle (aria-expanded + .is-open)
   - Close on Escape, on outside click, and when resizing up to desktop
   The site works without JS; this only enhances the mobile navigation.
   ========================================================================= */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") {
      fn();
    } else {
      document.addEventListener("DOMContentLoaded", fn);
    }
  }

  ready(function () {
    var toggle = document.querySelector("[data-asi-nav-toggle]");
    if (!toggle) { return; }

    var navId = toggle.getAttribute("aria-controls") || "asi-primary-nav";
    var nav = document.getElementById(navId);
    if (!nav) { return; }

    var DESKTOP_BP = 721; // keep in sync with the CSS breakpoint

    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    function openNav() {
      toggle.setAttribute("aria-expanded", "true");
      nav.classList.add("is-open");
    }

    function closeNav(returnFocus) {
      toggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
      if (returnFocus) { toggle.focus(); }
    }

    toggle.addEventListener("click", function () {
      if (isOpen()) { closeNav(false); } else { openNav(); }
    });

    // Close on Escape
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Escape" || e.key === "Esc") && isOpen()) {
        closeNav(true);
      }
    });

    // Close when a nav link is followed (mobile)
    nav.addEventListener("click", function (e) {
      var link = e.target.closest ? e.target.closest("a") : null;
      if (link && isOpen()) { closeNav(false); }
    });

    // Close on outside click
    document.addEventListener("click", function (e) {
      if (!isOpen()) { return; }
      var insideNav = nav.contains(e.target);
      var onToggle = toggle.contains(e.target);
      if (!insideNav && !onToggle) { closeNav(false); }
    });

    // Reset state when resized up to desktop (CSS reveals the nav there)
    var resizeTimer;
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        if (window.innerWidth >= DESKTOP_BP && isOpen()) {
          closeNav(false);
        }
      }, 150);
    });
  });
})();
