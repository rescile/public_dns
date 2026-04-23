/**
 * NS Overview view – groups zones by vanity nameserver provider.
 */
import { state } from './state.js';
import { gql } from './api.js';

/**
+ * Introspect the zone resource type and return the set of available field names.
+ */
async function introspectZoneFields() {
  try {
    const capName = state.zoneResource.charAt(0).toUpperCase() + state.zoneResource.slice(1);
    let introData = await gql(`{ __type(name: "${capName}") { fields { name } } }`);
    if (introData?.__type?.fields) {
      return new Set(introData.__type.fields.map(f => f.name));
    }
    introData = await gql(`{ __type(name: "${state.zoneResource}") { fields { name } } }`);
    if (introData?.__type?.fields) {
      return new Set(introData.__type.fields.map(f => f.name));
    }
  } catch (e) {
    console.warn('Failed to introspect zone schema for NS overview', e);
  }
  return new Set();
}

const NS_RECORD_FIELDS = '{ node { name original_name content ttl disabled } }';

export async function renderNsOverview() {
  const content = document.getElementById('nsOverviewContent');
  content.innerHTML = '<div class="ns-overview-loading"><span class="material-symbols-outlined" style="animation: spin 1s linear infinite;">sync</span> Loading nameserver data...</div>';

  try {
    const data = await gql(`
      query {
        ${state.zoneResource} {
          name
          vanity_name_server
          zone_format
          disabled
          dnssec
        }
      }
    `);

    if (!data?.[state.zoneResource]) {
      content.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined" style="font-size: 48px; color: var(--border);">dns</span><h3>No Zones Found</h3><p>No DNS zones are available.</p></div>';
      return;
    }

    const zones = data[state.zoneResource];

    /* Fetch vanity NS provider map */
    let nsProviderMap = {};
    try {
      const inputRes = await fetch('/api/outputs/vanity_ns_list/vanity_ns/vanity_ns.json');
      if (inputRes.ok) { const parsed = await inputRes.json(); nsProviderMap = parsed.data || {}; }
    } catch (e) { console.warn('Failed to fetch vanity_ns.json output', e); }

    /* Fetch NS records for delegation section */
    let zoneNsRecords = {};
    let zoneApexNsRecords = {};
    try {
      const fields = await introspectZoneFields();
      const hasApex = fields.has('has_apex_ns_record');
      const hasSub = fields.has('has_subdomain_ns_record');

      if (hasApex || hasSub) {
        let nsQueryFields = '';
        if (hasApex) nsQueryFields += `\n            has_apex_ns_record ${NS_RECORD_FIELDS}`;
        if (hasSub) nsQueryFields += `\n            has_subdomain_ns_record ${NS_RECORD_FIELDS}`;

        const nsData = await gql(`
          query {
            ${state.zoneResource} {
              name${nsQueryFields}
            }
          }
        `);
        if (nsData?.[state.zoneResource]) {
          nsData[state.zoneResource].forEach(z => {
            if (z.has_apex_ns_record?.length) {
              zoneApexNsRecords[z.name] = z.has_apex_ns_record.map(e => e.node).filter(n => !(n.disabled === 'True' || n.disabled === true || n.disabled === 'true'));
            }
            if (z.has_subdomain_ns_record?.length) {
              zoneNsRecords[z.name] = z.has_subdomain_ns_record.map(e => e.node).filter(n => !(n.disabled === 'True' || n.disabled === true || n.disabled === 'true'));
            }
          });
        }
      }
    } catch (e) { console.warn('Failed to fetch NS records for overview', e); }

    /* ---- Build provider groups ---- */
    const providerGroups = {};
    const unassignedZones = [];

    zones.forEach(zone => {
      const rawVns = zone.vanity_name_server || '';
      const vnsList = (Array.isArray(rawVns) ? rawVns : String(rawVns).split(',')).map(s => s.trim()).filter(Boolean);
      if (vnsList.length === 0) { unassignedZones.push(zone); return; }

      const nsProviders = new Map();
      let hasProvider = false;
      vnsList.forEach(ns => {
        const provider = nsProviderMap[ns]?.provider || null;
        const providerKey = provider || '__no_provider__';
        if (provider) hasProvider = true;
        if (!nsProviders.has(providerKey)) nsProviders.set(providerKey, []);
        nsProviders.get(providerKey).push(ns);
      });

      const nsKey = vnsList.slice().sort().join(',');
      const providerLabel = hasProvider
        ? [...nsProviders.keys()].filter(k => k !== '__no_provider__').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')
          + ([...nsProviders.keys()].includes('__no_provider__') ? ' + Other' : '')
        : 'Custom (No Provider)';
      const groupKey = providerLabel + '||' + nsKey;
      if (!providerGroups[groupKey]) providerGroups[groupKey] = { label: providerLabel, nameservers: vnsList.slice().sort(), zones: [] };
      providerGroups[groupKey].zones.push(zone);
    });

    /* ---- Render ---- */
    let html = '';
    const providerIcons = { 'cloudflare': 'cloud', 'custom (no provider)': 'storage' };
    const sortedGroups = Object.values(providerGroups).sort((a, b) => a.label.localeCompare(b.label));

    sortedGroups.forEach(group => {
      const iconName = providerIcons[group.label.toLowerCase()] || 'language';
      html += `<div class="provider-group">`;
      html += `<div class="provider-group-header"><span class="material-symbols-outlined provider-icon">${iconName}</span><h3>${group.label}<span class="provider-zone-count">(${group.zones.length} zone${group.zones.length !== 1 ? 's' : ''})</span></h3></div>`;
      html += `<div class="ns-tag-list">`;
      group.nameservers.forEach(ns => {
        const nsInfo = nsProviderMap[ns];
        const ip = nsInfo?.target?.ipv4 || '';
        const ipv6 = nsInfo?.target?.ipv6 || '';
        const nsRole = nsInfo?.role || 'primary';
        const roleClass = nsRole === 'secondary' ? 'role-secondary' : 'role-primary';
        const ipDisplay = [ip, ipv6].filter(Boolean).join(' / ');
        html += `<span class="ns-tag" title="${ipDisplay ? 'IP: ' + ipDisplay : ''}">${ns} <span class="role-tag ${roleClass}" style="margin-left:0.25rem;">${nsRole}</span>${ipDisplay ? ' <span style="opacity:0.6;">(' + ipDisplay + ')</span>' : ''}</span>`;
      });
      html += `</div><div class="domain-chip-list">`;
      group.zones.sort((a, b) => a.name.localeCompare(b.name)).forEach(zone => {
        const isActive = !(zone.disabled === 'True' || zone.disabled === true || zone.disabled === 'true');
        html += `<div class="domain-chip" onclick="window._selectZone('${zone.name}')" title="Click to view zone details"><span class="chip-icon material-symbols-outlined" style="font-size: 1rem;">dns</span>${zone.name}${!isActive ? ' <span class="badge badge-false" style="margin-left:0.25rem;">Disabled</span>' : ''}</div>`;
      });
      html += `</div></div>`;
    });

    /* Unassigned zones */
    if (unassignedZones.length > 0) {
      html += `<div class="provider-group">`;
      html += `<div class="provider-group-header"><span class="material-symbols-outlined provider-icon" style="color: var(--text-light);">help_outline</span><h3>Unassigned<span class="provider-zone-count">(${unassignedZones.length} zone${unassignedZones.length !== 1 ? 's' : ''})</span></h3></div>`;
      html += `<p class="unassigned-note">These zones have no vanity nameservers configured and will use default provider nameservers.</p>`;
      html += `<div class="domain-chip-list">`;
      unassignedZones.sort((a, b) => a.name.localeCompare(b.name)).forEach(zone => {
        const isActive = !(zone.disabled === 'True' || zone.disabled === true || zone.disabled === 'true');
        html += `<div class="domain-chip" onclick="window._selectZone('${zone.name}')" title="Click to view zone details"><span class="chip-icon material-symbols-outlined" style="font-size: 1rem;">dns</span>${zone.name}${!isActive ? ' <span class="badge badge-false" style="margin-left:0.25rem;">Disabled</span>' : ''}</div>`;
      });
      html += `</div></div>`;
    }

    /* APEX NS Record Delegations */
    const zonesWithApexNs = Object.entries(zoneApexNsRecords).filter(([, records]) => records.length > 0).sort((a, b) => a[0].localeCompare(b[0]));
    if (zonesWithApexNs.length > 0) {
      const allApexTargets = new Set();
      zonesWithApexNs.forEach(([, records]) => { records.forEach(r => { if (r.content) allApexTargets.add(r.content.replace(/\.$/, '')); }); });
      const undeclaredApexNs = [...allApexTargets].filter(ns => !nsProviderMap[ns]).sort();

      let totalApexDelegations = 0;
      zonesWithApexNs.forEach(([, records]) => { totalApexDelegations += records.length; });

      html += `<div class="ns-overview-delegation-section"><div class="provider-group">`;
      html += `<div class="provider-group-header"><span class="material-symbols-outlined provider-icon" style="color: #10b981;">language</span><h3>Apex NS Records<span class="provider-zone-count">(${totalApexDelegations} record${totalApexDelegations !== 1 ? 's' : ''} across ${zonesWithApexNs.length} zone${zonesWithApexNs.length !== 1 ? 's' : ''})</span></h3></div>`;
      html += `<p class="unassigned-note">These are zone-level (apex) NS records that define the authoritative nameservers for each zone.</p>`;

      if (undeclaredApexNs.length > 0) {
        html += `<p class="unassigned-note">The following apex NS targets are not declared in vanity_ns configuration: <span style="font-family: monospace; font-style: normal;">${undeclaredApexNs.join(', ')}</span></p>`;
      }

      zonesWithApexNs.forEach(([zoneName, records]) => {
        const delegations = {};
        records.forEach(r => {
          const name = r.original_name || r.name;
          if (!delegations[name]) delegations[name] = [];
          delegations[name].push(r.content ? r.content.replace(/\.$/, '') : r.content);
        });

        html += `<div class="delegation-zone-card delegation-zone-apex">`;
        html += `<div class="delegation-zone-header" onclick="window._selectZone('${zoneName}')"><span class="material-symbols-outlined" style="font-size: 1rem; color: #10b981;">language</span>${zoneName} <span class="ns-record-badge ns-record-badge-apex"><span class="material-symbols-outlined" style="font-size:0.7rem;">public</span> ${records.length} apex NS</span></div>`;
        html += `<div class="delegation-entries">`;

        Object.entries(delegations).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, targets]) => {
          targets.sort().forEach(target => {
            const isKnown = nsProviderMap[target];
            const providerLabel = isKnown?.provider ? ` <span style="font-size:0.7rem;color:var(--text-light);">(${isKnown.provider})</span>` : '';
            html += `<div class="ns-delegation-entry ns-delegation-entry-apex"><span class="ns-delegation-name">${name}</span><span class="ns-delegation-arrow">→ NS →</span><span class="ns-delegation-target">${target}${providerLabel}</span></div>`;
          });
        });
        html += `</div></div>`;
      });
      html += `</div></div>`;
    }

    /* Subdomain NS Record Delegations */
    const zonesWithNsRecords = Object.entries(zoneNsRecords).filter(([, records]) => records.length > 0).sort((a, b) => a[0].localeCompare(b[0]));
    if (zonesWithNsRecords.length > 0) {
      const allNsTargets = new Set();
      zonesWithNsRecords.forEach(([, records]) => { records.forEach(r => { if (r.content) allNsTargets.add(r.content.replace(/\.$/, '')); }); });
      const undeclaredNs = [...allNsTargets].filter(ns => !nsProviderMap[ns]).sort();

      let totalDelegations = 0;
      zonesWithNsRecords.forEach(([, records]) => { totalDelegations += records.length; });

      html += `<div class="ns-overview-delegation-section"><div class="provider-group">`;
      html += `<div class="provider-group-header"><span class="material-symbols-outlined provider-icon" style="color: #8b5cf6;">subdirectory_arrow_right</span><h3>Subdomain NS Delegations<span class="provider-zone-count">(${totalDelegations} record${totalDelegations !== 1 ? 's' : ''} across ${zonesWithNsRecords.length} zone${zonesWithNsRecords.length !== 1 ? 's' : ''})</span></h3></div>`;
      html += `<p class="unassigned-note">These NS records delegate authority for subdomains to other nameservers.</p>`;

      if (undeclaredNs.length > 0) {
        html += `<p class="unassigned-note">The following NS targets are referenced in NS records but not declared in vanity_ns configuration: <span style="font-family: monospace; font-style: normal;">${undeclaredNs.join(', ')}</span></p>`;
      }

      zonesWithNsRecords.forEach(([zoneName, records]) => {
        const delegations = {};
        records.forEach(r => {
          const name = r.original_name || r.name;
          if (!delegations[name]) delegations[name] = [];
          delegations[name].push(r.content ? r.content.replace(/\.$/, '') : r.content);
        });

        html += `<div class="delegation-zone-card delegation-zone-subdomain">`;
        html += `<div class="delegation-zone-header" onclick="window._selectZone('${zoneName}')"><span class="material-symbols-outlined" style="font-size: 1rem; color: #8b5cf6;">subdirectory_arrow_right</span>${zoneName} <span class="ns-record-badge ns-record-badge-subdomain"><span class="material-symbols-outlined" style="font-size:0.7rem;">call_split</span> ${Object.keys(delegations).length} subdomain delegation${Object.keys(delegations).length !== 1 ? 's' : ''}</span></div>`;
        html += `<div class="delegation-entries">`;

        Object.entries(delegations).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, targets]) => {
          targets.sort().forEach(target => {
            const isKnown = nsProviderMap[target];
            const providerLabel = isKnown?.provider ? ` <span style="font-size:0.7rem;color:var(--text-light);">(${isKnown.provider})</span>` : '';
            html += `<div class="ns-delegation-entry ns-delegation-entry-subdomain"><span class="ns-delegation-name">${name}</span><span class="ns-delegation-arrow">→ NS →</span><span class="ns-delegation-target">${target}${providerLabel}</span></div>`;
          });
        });
        html += `</div></div>`;
      });
      html += `</div></div>`;
    }

    if (!html) {
      html = '<div class="empty-state"><span class="material-symbols-outlined" style="font-size: 48px; color: var(--border);">dns</span><h3>No Zones Found</h3><p>No DNS zones are available.</p></div>';
    }

    content.innerHTML = html;
  } catch (err) {
    console.error('Failed to render NS overview:', err);
    content.innerHTML = `<div style="color: var(--danger); padding: 2rem;">Failed to load NS overview: ${err.message}</div>`;
  }
}
