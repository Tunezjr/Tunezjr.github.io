const DURATION = 320;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function flipContainer(container, applyDomChange) {
  if (!container || prefersReducedMotion()) {
    applyDomChange();
    return;
  }
  const first = container.getBoundingClientRect();
  applyDomChange();
  const last = container.getBoundingClientRect();
  if (first.width < 1 || first.height < 1 || last.width < 1 || last.height < 1) return;
  const deltaW = first.width / last.width;
  const deltaH = first.height / last.height;
  const deltaX = first.left - last.left;
  const deltaY = first.top - last.top;
  container.animate(
    [
      { transform: `translate(${deltaX}px, ${deltaY}px) scale(${deltaW}, ${deltaH})`, transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ],
    { duration: DURATION, easing: EASE }
  );
}

function setScrollLock(locked) {
  document.documentElement.style.overflow = locked ? 'hidden' : '';
}

export function initNavDropdown(navRoot) {
  if (!navRoot) throw new Error('initNavDropdown: navRoot is required');
  const triggers = Array.from(navRoot.querySelectorAll('[data-nav-trigger]'));
  const panels = Array.from(navRoot.querySelectorAll('[data-nav-panel]'));
  const backdrop = navRoot.querySelector('[data-nav-backdrop]');
  const container = navRoot.querySelector('[data-nav-panel-container]') || navRoot;
  let openKey = null;
  const panelFor = (key) => panels.find((p) => p.dataset.navPanel === key);
  const triggerFor = (key) => triggers.find((t) => t.dataset.navTrigger === key);

  triggers.forEach((trigger) => {
    const key = trigger.dataset.navTrigger;
    const panel = panelFor(key);
    if (!panel) return;
    if (!panel.id) panel.id = `panel-${key}`;
    if (!trigger.getAttribute('aria-controls')) trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');
    if (!trigger.getAttribute('type')) trigger.setAttribute('type', 'button');
  });

  function closeAll({ restoreFocus = true } = {}) {
    if (!openKey) return;
    const prevKey = openKey;
    openKey = null;
    triggers.forEach((t) => t.setAttribute('aria-expanded', 'false'));
    panels.forEach((p) => p.setAttribute('hidden', ''));
    if (backdrop) backdrop.hidden = true;
    setScrollLock(false);
    if (restoreFocus) triggerFor(prevKey)?.focus();
  }

  function openPanel(key) {
    const panel = panelFor(key);
    const trigger = triggerFor(key);
    if (!panel || !trigger) return;
    if (openKey === key) {
      closeAll();
      return;
    }
    const isSwitch = openKey !== null;
    flipContainer(container, () => {
      triggers.forEach((t) => t.setAttribute('aria-expanded', String(t === trigger)));
      panels.forEach((p) => {
        if (p === panel) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
      if (backdrop) backdrop.hidden = false;
    });
    openKey = key;
    setScrollLock(true);
    const firstFocusable = panel.querySelector(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (firstFocusable && (isSwitch || document.activeElement === trigger)) {
      requestAnimationFrame(() => firstFocusable.focus());
    }
  }

  triggers.forEach((trigger) => {
    const key = trigger.dataset.navTrigger;
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      if (openKey === key) closeAll();
      else openPanel(key);
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && openKey !== key) {
        e.preventDefault();
        openPanel(key);
      }
      if (e.key === 'Escape') closeAll();
    });
  });

  panels.forEach((panel) => {
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeAll();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(
        panel.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!openKey) return;
    if (navRoot.contains(e.target)) return;
    closeAll({ restoreFocus: false });
  });
  if (backdrop) backdrop.addEventListener('click', () => closeAll({ restoreFocus: true }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openKey) closeAll();
  });

  return { closeAll, openPanel };
}
