/**
 * URL / view switching logic.
 */
import { state } from './state.js';

const VIEW_IDS = ['overviewView', 'syncView', 'nsOverviewView', 'architectureView'];
const NAV_IDS  = ['nav-overview', 'nav-sync', 'nav-nsoverview', 'nav-architecture'];

export function getURLParams() {
  const params = new URLSearchParams(window.location.search);
  return { view: params.get('view') || '', zone: params.get('zone') || '' };
}

export function getCurrentView() {
  if (!document.getElementById('overviewView').classList.contains('hidden')) return 'overview';
  if (!document.getElementById('syncView').classList.contains('hidden')) return 'sync';
  if (!document.getElementById('nsOverviewView').classList.contains('hidden')) return 'nsoverview';
  if (!document.getElementById('architectureView').classList.contains('hidden')) return 'architecture';
  return 'overview';
}

export function updateURL(view, zone) {
  if (state.suppressUrlUpdate) return;
  const params = new URLSearchParams();
  if (view && view !== 'overview') params.set('view', view);
  else if (view === 'overview' && zone) params.set('view', 'overview');
  if (zone) params.set('zone', zone);
  const qs = params.toString();
  const newURL = qs ? window.location.pathname + '?' + qs : window.location.pathname;
  if (window.location.search !== (qs ? '?' + qs : '')) {
    history.pushState({ view: view || 'overview', zone: zone || '' }, '', newURL);
  }
}

export function replaceURL(view, zone) {
  const params = new URLSearchParams();
  if (view && view !== 'overview') params.set('view', view);
  else if (view === 'overview' && zone) params.set('view', 'overview');
  if (zone) params.set('zone', zone);
  const qs = params.toString();
  history.replaceState(
    { view: view || 'overview', zone: zone || '' },
    '',
    qs ? window.location.pathname + '?' + qs : window.location.pathname,
  );
}

/**
 * Switch the visible view.
 * @param {string} view
 * @param {boolean} skipUrlUpdate
 * @param {object} hooks – { onOverviewNoZone, onSync, onNsOverview, onArchitecture }
 */
export function switchView(view, skipUrlUpdate, hooks = {}) {
  VIEW_IDS.forEach(id => document.getElementById(id).classList.add('hidden'));
  NAV_IDS.forEach(id => document.getElementById(id).classList.remove('active'));

  const zoneSelect = document.getElementById('zoneSelect');

  if (view === 'overview') {
    document.getElementById('overviewView').classList.remove('hidden');
    document.getElementById('nav-overview').classList.add('active');
    if (!zoneSelect.value) {
      hooks.onOverviewNoZone?.();
      if (!skipUrlUpdate) updateURL('overview', '');
    } else {
      if (!skipUrlUpdate) updateURL('overview', zoneSelect.value);
    }
  } else if (view === 'sync') {
    document.getElementById('syncView').classList.remove('hidden');
    document.getElementById('nav-sync').classList.add('active');
    if (zoneSelect.value) {
      hooks.onSync?.();
    } else {
      document.getElementById('syncStatus').textContent = 'Please select a zone first.';
    }
    if (!skipUrlUpdate) updateURL('sync', zoneSelect.value);
  } else if (view === 'nsoverview') {
    document.getElementById('nsOverviewView').classList.remove('hidden');
    document.getElementById('nav-nsoverview').classList.add('active');
    hooks.onNsOverview?.();
    if (!skipUrlUpdate) updateURL('nsoverview', '');
  } else if (view === 'architecture') {
    document.getElementById('architectureView').classList.remove('hidden');
    document.getElementById('nav-architecture').classList.add('active');
    if (!skipUrlUpdate) updateURL('architecture', '');
    hooks.onArchitecture?.();
  }
}
