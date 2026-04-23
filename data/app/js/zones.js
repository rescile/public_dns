/**
 * Zone management – selection, listing, CRUD, overview rendering.
 */
import { state } from './state.js';
import { gql } from './api.js';
import { showNotification, closeModalById, openModalById } from './ui.js';
import { getCurrentView, updateURL, switchView } from './router.js';
import { extractRecords } from './records.js';
import { setVanitySelectValue } from './vanity-ns.js';
import { showBuildProgress } from './build.js';
import { fetchLiveState } from './providers/cloudflare.js';

/* ====================================================================
   Topology / provider-role helpers
   ==================================================================== */

export function getTopologyBadge(topology) {
  switch (topology) {
    case 'active-active':
      return '<span class="badge-topology badge-active-active"><span class="material-symbols-outlined" style="font-size:0.85rem;">sync</span> Active-Active</span>';
    case 'active-secondary':
      return '<span class="badge-topology badge-active-secondary"><span class="material-symbols-outlined" style="font-size:0.85rem;">swap_vert</span> Active-Secondary</span>';
    case 'active':
      return '<span class="badge-topology badge-active"><span class="material-symbols-outlined" style="font-size:0.85rem;">check_circle</span> Active</span>';
    case 'default':
      return '<span class="badge-topology badge-unknown-topology"><span class="material-symbols-outlined" style="font-size:0.85rem;">help_outline</span> Default</span>';
    default:
      if (!topology) return '<span class="badge badge-false">N/A</span>';
      return `<span class="badge-topology badge-unknown-topology">${topology}</span>`;
  }
}

export function renderProviderRoles(providerRolesRaw) {
  if (!providerRolesRaw) return '';
  let roles = [];
  try {
    roles = typeof providerRolesRaw === 'string' ? JSON.parse(providerRolesRaw) : (Array.isArray(providerRolesRaw) ? providerRolesRaw : []);
  } catch (e) { return ''; }
  if (!roles.length) return '';
  return roles.map(r => {
    const provider = r.provider || 'unknown';
    const role = r.role || 'primary';
    const ns = (r.nameservers || []).join(', ');
    const roleClass = role === 'secondary' ? 'role-secondary' : 'role-primary';
    return `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
      <span class="role-tag ${roleClass}">${role}</span>
      <span style="font-weight:500;text-transform:capitalize;">${provider}</span>
      ${ns ? `<span style="font-size:0.75rem;color:var(--text-light);font-family:monospace;">(${ns})</span>` : ''}
    </div>`;
  }).join('');
}

/* ====================================================================
   Zone list view (shown when no zone is selected)
   ==================================================================== */

export function renderZoneList() {
  const listTableBody = document.querySelector('#zonesListTable tbody');
  if (!listTableBody) return;

  listTableBody.innerHTML = '';
  Object.values(state.zonesData).forEach(zone => {
    const tr = document.createElement('tr');
    const isDnssec = zone.dnssec === 'True' || zone.dnssec === true || zone.dnssec === 'true';
    const isActive = !(zone.disabled === 'True' || zone.disabled === true || zone.disabled === 'true');
    const topology = zone.dns_topology || '';
    const topoBadge = getTopologyBadge(topology);

    tr.innerHTML = `
      <td><strong>${zone.name}</strong></td>
      <td>${zone.zone_format || 'FORWARD'}</td>
      <td>${isDnssec ? '<span class="badge badge-true">Enabled</span>' : '<span class="badge badge-false">Disabled</span>'}</td>
      <td>${topoBadge}</td>
      <td>${isActive ? '<span class="badge badge-true">Active</span>' : '<span class="badge badge-false">Disabled</span>'}</td>
      <td style="text-align: right;">
        <button class="action-btn" title="View" onclick="window._selectZone('${zone.name}')">
          <span class="material-symbols-outlined" style="font-size: 1.25rem;">visibility</span>
        </button>
      </td>
    `;
    listTableBody.appendChild(tr);
  });

  document.getElementById('zoneDetailsWrapper').classList.add('hidden');
  const emptyPrompt = document.getElementById('emptyZonePrompt');
  if (emptyPrompt) emptyPrompt.classList.add('hidden');
  document.getElementById('zoneListView').classList.remove('hidden');
}

/* ====================================================================
   Select a zone (used by dynamic onclick handlers)
   ==================================================================== */

export function selectZone(name, viewHooks) {
  switchView('overview', true, viewHooks);
  const select = document.getElementById('zoneSelect');
  select.value = name;
  handleZoneSelection({ target: select });
  updateURL('overview', name);
}

/* ====================================================================
   Zone selection handler
   ==================================================================== */

export async function handleZoneSelection(e) {
  const zoneName = e.target.value;
  sessionStorage.setItem('selectedZone', zoneName);

  const tbody = document.querySelector('#recordsTable tbody');
  const zsBtn = document.getElementById('zoneSettingsBtn');
  const artifactsDiv = document.getElementById('zoneArtifacts');
  const wrapper = document.getElementById('zoneDetailsWrapper');
  const emptyPrompt = document.getElementById('emptyZonePrompt');
  const listView = document.getElementById('zoneListView');

  if (!zoneName) {
    zsBtn.style.display = 'none';
    updateURL(getCurrentView(), '');
    artifactsDiv.classList.add('hidden');
    wrapper.classList.add('hidden');
    emptyPrompt.classList.add('hidden');
    renderZoneList();
    return;
  }

  updateURL(getCurrentView(), zoneName);
  if (listView) listView.classList.add('hidden');

  /* ---------- Introspect schema for record fields ---------- */
  let recordQueryFields = '';
  try {
    let fields = [];
    const capName = state.zoneResource.charAt(0).toUpperCase() + state.zoneResource.slice(1);
    let introData = await gql(`{ __type(name: "${capName}") { fields { name } } }`);
    if (introData?.__type?.fields) {
      fields = introData.__type.fields.map(f => f.name);
    } else {
      introData = await gql(`{ __type(name: "${state.zoneResource}") { fields { name } } }`);
      if (introData?.__type?.fields) fields = introData.__type.fields.map(f => f.name);
    }

    const allRecordTypes = {
      has_a_record: '{ node { name original_name address ttl disabled } }',
      has_aaaa_record: '{ node { name original_name address ttl disabled } }',
      has_cname_record: '{ node { name original_name canonical ttl disabled } }',
      has_txt_record: '{ node { name original_name text ttl disabled } }',
      has_mx_record: '{ node { name original_name mail_exchanger priority ttl disabled } }',
      has_srv_record: '{ node { name original_name target port priority weight ttl disabled } }',
      has_ptr_record: '{ node { name original_name content ttl disabled } }',
      has_caa_record: '{ node { name original_name content ttl disabled } }',
      has_apex_ns_record: '{ node { name original_name content ttl disabled } }',
      has_subdomain_ns_record: '{ node { name original_name content ttl disabled } }',
      has_sshfp_record: '{ node { name original_name content ttl disabled } }',
      has_cert_record: '{ node { name original_name content ttl disabled } }',
      has_dnskey_record: '{ node { name original_name content ttl disabled } }',
      has_ds_record: '{ node { name original_name content ttl disabled } }',
      has_https_record: '{ node { name original_name content ttl disabled } }',
      has_loc_record: '{ node { name original_name content ttl disabled } }',
      has_naptr_record: '{ node { name original_name content ttl disabled } }',
      has_smimea_record: '{ node { name original_name content ttl disabled } }',
      has_svcb_record: '{ node { name original_name content ttl disabled } }',
      has_tlsa_record: '{ node { name original_name content ttl disabled } }',
      has_uri_record: '{ node { name original_name content ttl disabled } }',
    };

    for (const [key, val] of Object.entries(allRecordTypes)) {
      if (fields.length === 0 || fields.includes(key)) {
        recordQueryFields += `\n                        ${key} ${val}`;
      }
    }
  } catch (err) {
    console.warn('Failed to introspect schema', err);
  }

  /* ---------- Fetch full zone data ---------- */
  const query = `
    query {
      ${state.zoneResource} (filter: { name: { eq: "${zoneName}" }}) {
        name
        multi_provider
        vanity_name_server
        dns_topology
        provider_roles
        view
        zone_format
        disabled
        dnssec
        DESCRIBED_BY {
          node {
            __typename
            ... on cloudflare_py { name filename }
            ... on zone_file { name filename }
            ... on tfvars { name filename }
          }
        }
        ${recordQueryFields}
      }
    }
  `;

  try {
    const data = await gql(query);
    if (!data?.[state.zoneResource]?.length) return;

    const z = data[state.zoneResource][0];
    state.zonesData[zoneName] = {
      name: z.name,
      multi_provider: z.multi_provider,
      vanity_name_server: z.vanity_name_server,
      dns_topology: z.dns_topology,
      provider_roles: z.provider_roles,
      view: z.view,
      zone_format: z.zone_format,
      disabled: z.disabled,
      dnssec: z.dnssec,
      artifacts: z.DESCRIBED_BY || [],
      records: extractRecords(z),
    };
  } catch (err) {
    console.error('Failed to fetch zone details:', err);
    return;
  }

  const zone = state.zonesData[zoneName];
  wrapper.classList.remove('hidden');
  emptyPrompt.classList.add('hidden');
  zsBtn.style.display = 'inline-flex';
  tbody.innerHTML = '';

  /* ---------- Declared configuration ---------- */
  const isDnssec = zone.dnssec === 'True' || zone.dnssec === true;
  const isActive = !(zone.disabled === 'True' || zone.disabled === true);
  const topology = zone.dns_topology || '';
  const topoBadge = getTopologyBadge(topology);
  const providerRolesHtml = renderProviderRoles(zone.provider_roles);

  document.getElementById('declaredDetails').innerHTML = `
    <div class="detail-item"><span class="detail-label">Zone Format</span><span class="detail-value">${zone.zone_format || 'FORWARD'}</span></div>
    <div class="detail-item"><span class="detail-label">DNSSEC</span><span class="detail-value">${isDnssec ? '<span class="badge badge-true">Enabled</span>' : '<span class="badge badge-false">Disabled</span>'}</span></div>
    <div class="detail-item"><span class="detail-label">Vanity NS</span><span class="detail-value">${Array.isArray(zone.vanity_name_server) ? zone.vanity_name_server.join(', ') : (zone.vanity_name_server || 'None')}</span></div>
    <div class="detail-item"><span class="detail-label">Status</span><span class="detail-value">${isActive ? '<span class="badge badge-true">Active</span>' : '<span class="badge badge-false">Disabled</span>'}</span></div>
    <div class="detail-item"><span class="detail-label">Topology</span><span class="detail-value">${topoBadge}</span></div>
    ${providerRolesHtml ? `<div class="detail-item" style="grid-column: 1 / -1;"><span class="detail-label">Provider Roles</span><span class="detail-value">${providerRolesHtml}</span></div>` : ''}
  `;

  /* ---------- Live state (provider-specific) ---------- */
  fetchLiveState(zoneName);

  /* ---------- Artifacts ---------- */
  artifactsDiv.innerHTML = '';
  if (zone.artifacts.length > 0) {
    artifactsDiv.classList.remove('hidden');
    zone.artifacts.forEach(edge => {
      const out = edge.node;
      if (out.name && out.filename) {
        let icon = 'download';
        if (out.__typename === 'cloudflare_py') icon = 'code';
        if (out.__typename === 'zone_file') icon = 'description';
        if (out.__typename === 'tfvars') icon = 'data_object';
        const url = `/api/outputs/${out.__typename}/${out.name}/${out.filename}/download`;
        artifactsDiv.innerHTML += `
          <a href="${url}" title="Download ${out.filename}" target="_blank">
            <span class="material-symbols-outlined" style="font-size: 1.1rem;">${icon}</span>
          </a>
        `;
      }
    });
  } else {
    artifactsDiv.classList.add('hidden');
  }

  /* ---------- Records table ---------- */
  zone.records.forEach((rec, idx) => {
    const tr = document.createElement('tr');
    const statusBadge = rec.disabled
      ? '<span class="badge badge-false">Disabled</span>'
      : '<span class="badge badge-true">Active</span>';

    let displayValue = rec.value;
    if (rec.type === 'MX') displayValue = `[${rec.priority}] ${rec.value}`;
    if (rec.type === 'SRV') displayValue = `[${rec.priority} ${rec.weight} ${rec.port}] ${rec.value}`;
    if (rec.type === 'TXT') displayValue = `<span style="opacity:0.8; font-family:monospace;">${rec.value}</span>`;

    tr.innerHTML = `
      <td><span class="badge badge-type">${rec.type}</span></td>
      <td><strong>${rec.name}</strong></td>
      <td>${displayValue}</td>
      <td><span style="color: var(--text-light); font-variant-numeric: tabular-nums;">${rec.ttl}</span></td>
      <td>${statusBadge}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="action-btn" title="Edit" onclick="window._editRecord('${zoneName}', ${idx})" ${state.isReadOnly ? 'disabled' : ''}>
          <span class="material-symbols-outlined" style="font-size: 1.25rem;">edit</span>
        </button>
        <button class="action-btn delete" title="Delete" onclick="window._deleteRecord('${zoneName}', ${idx})" ${state.isReadOnly ? 'disabled' : ''}>
          <span class="material-symbols-outlined" style="font-size: 1.25rem;">delete</span>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  /* If sync view is active, refresh the diff */
  if (document.getElementById('nav-sync').classList.contains('active')) {
    const { calculateDiff } = await import('./sync.js');
    calculateDiff();
  }
}

/* ====================================================================
   Zone modals – add / settings / save
   ==================================================================== */

export function openAddZoneModal() {
  document.getElementById('addZoneForm').reset();
  openModalById('addZoneModal');
}

export function closeAddZoneModal() {
  closeModalById('addZoneModal');
}

export function openZoneSettingsModal() {
  const zoneName = document.getElementById('zoneSelect').value;
  const z = state.zonesData[zoneName];
  document.getElementById('zsDnssec').checked = z.dnssec === 'True' || z.dnssec === 'true' || z.dnssec === true;
  const currentVanity = Array.isArray(z.vanity_name_server) ? z.vanity_name_server.join(',') : (z.vanity_name_server || '');
  setVanitySelectValue('zsVanity', 'zsVanityDetail', currentVanity);
  openModalById('zoneSettingsModal');
}

export function closeZoneSettingsModal() {
  closeModalById('zoneSettingsModal');
}

export async function saveNewZone(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Saving...';
  submitBtn.disabled = true;

  const zoneName = document.getElementById('azName').value.trim();
  const dnssec = document.getElementById('azDnssec').checked ? 'True' : 'False';
  const vanity = document.getElementById('azVanity').value.replace(/"/g, '""').split(',').map(s => s.trim()).filter(Boolean).join(',');

  const csvData = `type,name,view,zone_format,disabled,dnssec,vanity_name_server\n${state.authResource},${zoneName},default,FORWARD,False,${dnssec},"${vanity}"`;
  const formData = new FormData();
  formData.append('update', csvData);

  try {
    await fetch(`/api/assets/${state.authResource}.csv`, { method: 'POST', body: formData });
    closeAddZoneModal();
    sessionStorage.setItem('selectedZone', zoneName);
    showBuildProgress();
  } catch (err) {
    console.error(err);
    alert('Failed to add new zone');
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

export async function saveZoneSettings(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Saving...';
  submitBtn.disabled = true;

  const zoneName = document.getElementById('zoneSelect').value;
  const z = state.zonesData[zoneName];
  const dnssec = document.getElementById('zsDnssec').checked ? 'True' : 'False';
  const vanity = document.getElementById('zsVanity').value.replace(/"/g, '""').split(',').map(s => s.trim()).filter(Boolean).join(',');

  const view = z.view || 'default';
  const zone_format = z.zone_format || 'FORWARD';
  const disabled = z.disabled || 'False';
  const csvData = `type,name,view,zone_format,disabled,dnssec,vanity_name_server\n${state.authResource},${zoneName},${view},${zone_format},${disabled},${dnssec},"${vanity}"`;

  const formData = new FormData();
  formData.append('update', csvData);

  try {
    await fetch(`/api/assets/${state.authResource}.csv`, { method: 'POST', body: formData });
    closeZoneSettingsModal();
    showBuildProgress();
  } catch (err) {
    console.error(err);
    alert('Failed to save Zone Settings');
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}
