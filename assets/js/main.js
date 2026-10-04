/**
 * Fauziyat Folashade — site behaviour.
 * No dependencies. Progressive enhancement: every link works without this file.
 * All motion is suppressed when the visitor prefers reduced motion.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mqDesktop = window.matchMedia('(min-width: 900px)');

  /* ---------- current year in footer ---------- */
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  /* ---------- header "stuck" state ---------- */
  var header = document.querySelector('[data-header]');
  if (header) {
    var ticking = false;
    var updateHeader = function () {
      header.classList.toggle('is-stuck', window.scrollY > 8);
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(updateHeader);
      }
    }, { passive: true });
    updateHeader();
  }

  /* ---------- mobile navigation ---------- */
  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.getElementById('site-nav');
  var scrim = document.querySelector('[data-nav-scrim]');

  function setNav(open) {
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);

    if (!scrim) return;
    if (open) {
      scrim.hidden = false;
      window.requestAnimationFrame(function () { scrim.classList.add('is-open'); });
    } else {
      scrim.classList.remove('is-open');
      window.setTimeout(function () { scrim.hidden = true; }, 300);
    }
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      setNav(toggle.getAttribute('aria-expanded') !== 'true');
    });

    // Close after choosing a destination.
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setNav(false);
    });

    if (scrim) {
      scrim.addEventListener('click', function () { setNav(false); });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setNav(false);
        toggle.focus();
      }
    });

    var onBreakpointChange = function () {
      if (mqDesktop.matches) setNav(false);
    };
    if (typeof mqDesktop.addEventListener === 'function') {
      mqDesktop.addEventListener('change', onBreakpointChange);
    } else if (typeof mqDesktop.addListener === 'function') {
      mqDesktop.addListener(onBreakpointChange);
    }
  }

  /* ---------- reveal elements as they enter the viewport ---------- */
  var revealEls = document.querySelectorAll('.reveal');

  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(revealEls, function (el) {
      el.classList.add('is-visible');
    });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

    Array.prototype.forEach.call(revealEls, function (el) { observer.observe(el); });
  }

  /* ---------- mark the section you are currently reading ---------- */
  var sections = document.querySelectorAll('main section[id]');
  var navLinks = document.querySelectorAll('.site-nav__link');

  if (sections.length && navLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    Array.prototype.forEach.call(navLinks, function (link) {
      var href = link.getAttribute('href');
      if (href && href.charAt(0) === '#') byId[href.slice(1)] = link;
    });

    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = byId[entry.target.id];
        if (!link || !entry.isIntersecting) return;
        Array.prototype.forEach.call(navLinks, function (l) {
          l.classList.remove('is-active');
        });
        link.classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    Array.prototype.forEach.call(sections, function (section) { spy.observe(section); });
  }
})();
