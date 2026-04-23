/**
 * Application entry point – initialisation, event binding, and routing.
 */
import { state } from './state.js';
import { gql } from './api.js';
import { toggleTheme, openModalById, closeModalById } from './ui.js';
import { switchView, getURLParams, getCurrentView, replaceURL } from './router.js';
import { loadVanityNsGroups } from './vanity-ns.js';
import { handleTypeChange, editRecord, saveRecord, deleteRecord } from './records.js';
import {
  handleZoneSelection, renderZoneList, selectZone,
  openAddZoneModal, closeAddZoneModal, saveNewZone,
  openZoneSettingsModal, closeZoneSettingsModal, saveZoneSettings,
} from './zones.js';
import { calculateDiff, performSync, pullSync } from './sync.js';
import { renderNsOverview } from './ns-overview.js';
import { renderArchitectureDiagram } from './architecture.js';
import { showBuildProgress, closeBuildProgress, setOnRebuildComplete } from './build.js';

/* ====================================================================
   View-switch hooks (passed to switchView so it can trigger side-effects)
   ==================================================================== */

const viewHooks = {
  onOverviewNoZone: () => renderZoneList(),
  onSync: () => calculateDiff(),
  onNsOverview: () => renderNsOverview(),
  onArchitecture: () => renderArchitectureDiagram(),
};

/* ====================================================================
   Config loading
   ==================================================================== */

async function loadConfig() {
  try {
    const res = await fetch('/api/outputs/hybriddns_config/config/config.json');
    if (res.ok) {
      const config = await res.json();
      if (config.auth) state.authResource = config.auth;
      if (config.zone) state.zoneResource = config.zone;
    }
  } catch (e) {
    console.warn('Failed to load configuration map', e);
  }
}

/* ====================================================================
   Record modal (Add mode)
   ==================================================================== */

function openRecordModal() {
  document.getElementById('modalTitle').textContent = 'Add DNS Record';
  document.getElementById('recordForm').reset();
  document.getElementById('recOriginalValue').value = '';
  document.getElementById('recOriginalName').value = '';
  document.getElementById('recType').disabled = false;
  handleTypeChange();
  openModalById('recordModal');
}

/* ====================================================================
   Initialisation
   ==================================================================== */

async function init() {
  await loadConfig();
  await loadVanityNsGroups();

  /* ---- Check read-only mode ---- */
  try {
    const featRes = await fetch('/api/features');
    const features = await featRes.json();
    if (!features.includes('admin_assets')) {
      state.isReadOnly = true;
      document.getElementById('addZoneBtn').style.display = 'none';
      document.getElementById('readOnlyNotice').classList.remove('hidden');
      document.getElementById('addRecordBtn').disabled = true;
      document.querySelector('#zoneSettingsForm button[type="submit"]').disabled = true;
    }
  } catch (err) {
    console.error('Failed to fetch features:', err);
  }

  /* ---- Fetch all zones ---- */
  const query = `
    query {
      ${state.zoneResource} {
        name
        zone_format
        dns_topology
        provider_roles
        dnssec
        disabled
      }
    }
  `;

  try {
    const data = await gql(query);
    if (!data?.[state.zoneResource]) return;

    state.zonesData = {};
    const select = document.getElementById('zoneSelect');

    // Clear existing options except the first placeholder
    while (select.options.length > 1) select.remove(1);

    data[state.zoneResource]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(z => {
        state.zonesData[z.name] = {
          name: z.name,
          zone_format: z.zone_format,
          dnssec: z.dnssec,
          dns_topology: z.dns_topology,
          provider_roles: z.provider_roles,
          disabled: z.disabled,
        };
        const option = document.createElement('option');
        option.value = z.name;
        option.textContent = z.name;
        select.appendChild(option);
      });

    /* ---- Restore initial view / zone from URL or session ---- */
    const urlParams = getURLParams();
    let initialZone = urlParams.zone || sessionStorage.getItem('selectedZone') || '';
    const initialView = urlParams.view || 'overview';

    if (initialZone && state.zonesData[initialZone]) {
      select.value = initialZone;
    } else {
      initialZone = '';
    }

    state.suppressUrlUpdate = true;
    if (initialZone && select.value) {
      await handleZoneSelection({ target: select });
    }
    switchView(initialView, true, viewHooks);
    state.suppressUrlUpdate = false;
    replaceURL(initialView, select.value || '');
  } catch (err) {
    console.error('Failed to fetch DNS zones:', err);
  }
}

/* ====================================================================
   Event binding
   ==================================================================== */

function bindEvents() {
  /* Sidebar navigation */
  document.getElementById('nav-overview').addEventListener('click', () => switchView('overview', false, viewHooks));
  document.getElementById('nav-sync').addEventListener('click', () => switchView('sync', false, viewHooks));
  document.getElementById('nav-nsoverview').addEventListener('click', () => switchView('nsoverview', false, viewHooks));
  document.getElementById('nav-architecture').addEventListener('click', () => switchView('architecture', false, viewHooks));

  /* Zone selector */
  document.getElementById('zoneSelect').addEventListener('change', handleZoneSelection);

  /* Topbar buttons */
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  document.getElementById('addZoneBtn').addEventListener('click', openAddZoneModal);
  document.getElementById('zoneSettingsBtn').addEventListener('click', openZoneSettingsModal);
  document.getElementById('addRecordBtn').addEventListener('click', openRecordModal);

  /* Record modal */
  document.getElementById('recordForm').addEventListener('submit', saveRecord);
  document.getElementById('recordCancelBtn').addEventListener('click', () => closeModalById('recordModal'));
  document.getElementById('recType').addEventListener('change', handleTypeChange);

  /* Add zone modal */
  document.getElementById('addZoneForm').addEventListener('submit', saveNewZone);
  document.getElementById('addZoneCancelBtn').addEventListener('click', closeAddZoneModal);

  /* Zone settings modal */
  document.getElementById('zoneSettingsForm').addEventListener('submit', saveZoneSettings);
  document.getElementById('zoneSettingsCancelBtn').addEventListener('click', closeZoneSettingsModal);

  /* Sync buttons */
  document.getElementById('calcDiffBtn').addEventListener('click', calculateDiff);
  document.getElementById('pullChangesBtn').addEventListener('click', pullSync);
  document.getElementById('applyChangesBtn').addEventListener('click', performSync);

  /* Build progress modal */
  document.getElementById('buildCloseBtn').addEventListener('click', closeBuildProgress);

  /* Browser back / forward */
  window.addEventListener('popstate', function (e) {
    const st = e.state || {};
    const view = st.view || getURLParams().view || 'overview';
    const zone = st.zone || getURLParams().zone || '';
    const select = document.getElementById('zoneSelect');

    state.suppressUrlUpdate = true;
    if (zone && state.zonesData[zone]) {
      select.value = zone;
      handleZoneSelection({ target: select });
    } else if (!zone && select.value) {
      select.value = '';
      handleZoneSelection({ target: select });
    }
    switchView(view, true, viewHooks);
    state.suppressUrlUpdate = false;
  });

  /* ---- Global functions for dynamically-generated onclick handlers ---- */
  window._selectZone = (name) => selectZone(name, viewHooks);
  window._editRecord = editRecord;
  window._deleteRecord = deleteRecord;
}

/* ====================================================================
   Bootstrap
   ==================================================================== */

// Allow build.js to re-run init after a successful build
setOnRebuildComplete(init);

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  init();
});
