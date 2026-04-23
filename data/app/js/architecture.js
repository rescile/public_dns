/**
 * Architecture diagram view – visual topology of DNS providers, nameservers, and zones.
 */
import { state } from './state.js';
import { gql } from './api.js';

/**
 * Introspect the zone resource type and return the set of available field names.
 */
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
    console.warn('Failed to introspect zone schema for architecture', e);
  }
  return new Set();
}

const NS_RECORD_FIELDS = '{ node { name original_name content ttl disabled } }';

/**
 * Fetch available bind_conf output artifacts from the REST API.
 * Returns an array of { name, filename, download_url } objects.
 */
async function fetchBindConfArtifacts() {
  try {
    const res = await fetch('/api/outputs/index?type=bind_conf');
    if (!res.ok) return [];
    const items = await res.json();
    return items.filter(i => i.type === 'bind_conf').map(i => ({
      name: i.name,
      filename: i.filename,
      download_url: i.download_url,
    }));
  } catch (e) { console.warn('Failed to fetch bind_conf artifacts', e); return []; }
}

export async function renderArchitectureDiagram() {
  const content = document.getElementById('architectureContent');
  content.innerHTML = '<div class="ns-overview-loading"><span class="material-symbols-outlined" style="animation: spin 1s linear infinite;">sync</span> Generating architecture diagram...</div>';

  try {
    const data = await gql(`
      query {
        ${state.zoneResource} {
          name
          vanity_name_server
          dns_topology
          provider_roles
          zone_format
          disabled
          dnssec
          multi_provider
        }
      }
    `);

    if (!data?.[state.zoneResource]?.length) {
      content.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined" style="font-size: 48px; color: var(--border);">schema</span><h3>No Zones Found</h3><p>No DNS zones are available to visualize.</p></div>';
      return;
    }

    const zones = data[state.zoneResource];

    /* Fetch vanity NS provider map */
    let nsProviderMap = {};
    try {
      const inputRes = await fetch('/api/outputs/vanity_ns_list/vanity_ns/vanity_ns.json');
      if (inputRes.ok) { const parsed = await inputRes.json(); nsProviderMap = parsed.data || {}; }
    } catch (e) { console.warn('Failed to fetch vanity_ns.json output', e); }

    /* Fetch NS records */
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
    } catch (e) { console.warn('Failed to fetch NS records for architecture', e); }

    /* ---- Provider colors ---- */
    const providerColorMap = { cloudflare: '#3b82f6', 'self-hosted': '#10b981', akamai: '#ff6b35', route53: '#ff9900', google: '#4285f4', azure: '#0078d4' };
    const fallbackColors = ['#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#ef4444', '#6366f1'];
    let colorIdx = 0;
    const getColor = p => {
      if (providerColorMap[p]) return providerColorMap[p];
      /* Assign a fallback colour for unknown providers */
      const c = fallbackColors[colorIdx % fallbackColors.length];
      providerColorMap[p] = c;
      colorIdx++;
      return c;
    };

    /* ---- Collect providers & zone entries ---- */
    const providers = new Map();
    const zoneEntries = [];

    zones.forEach(zone => {
      const rawVns = zone.vanity_name_server || '';
      const vnsList = (Array.isArray(rawVns) ? rawVns : String(rawVns).split(',')).map(s => s.trim()).filter(Boolean);
      const zProviders = [];
      vnsList.forEach(ns => {
        const nsInfo = nsProviderMap[ns];
        const provider = nsInfo?.provider || 'self-hosted';
        const role = nsInfo?.role || 'primary';
        const ip = nsInfo?.target?.ipv4 || '';
        const ipv6 = nsInfo?.target?.ipv6 || '';
        if (!providers.has(provider)) providers.set(provider, { nameservers: new Map(), color: getColor(provider) });
        providers.get(provider).nameservers.set(ns, { ip, ipv6, role });
        zProviders.push({ provider, role });
      });
      zoneEntries.push({
        name: zone.name,
        topology: zone.dns_topology || 'unknown',
        subdomainNsRecords: zoneNsRecords[zone.name] || [],
        apexNsRecords: zoneApexNsRecords[zone.name] || [],
        dnssec: zone.dnssec === 'True' || zone.dnssec === true || zone.dnssec === 'true',
        disabled: zone.disabled === 'True' || zone.disabled === true || zone.disabled === 'true',
        format: zone.zone_format || 'FORWARD',
        providers: zProviders,
        hasNs: vnsList.length > 0,
      });
    });

    /* ---- Topology grouping ---- */
    const topoOrder = ['active-active', 'active-secondary', 'active', 'default', 'unknown'];
    const topoMeta = {
      'active-active': { label: 'Active-Active', icon: 'sync', color: '#10b981' },
      'active-secondary': { label: 'Active-Secondary', icon: 'swap_vert', color: '#f59e0b' },
      'active': { label: 'Active', icon: 'check_circle', color: '#3b82f6' },
      'default': { label: 'Default / Delegated', icon: 'help_outline', color: '#6b7280' },
      'unknown': { label: 'Other / Unassigned', icon: 'help_outline', color: '#6b7280' },
    };

    const topoGroups = {};
    zoneEntries.forEach(z => {
      const t = topoOrder.includes(z.topology) ? z.topology : 'default';
      if (!topoGroups[t]) topoGroups[t] = [];
      topoGroups[t].push(z);
    });

    /* ---- Build HTML ---- */
    let html = '<div class="arch-diagram">';
    html += '<div class="arch-layer-card arch-internet-layer"><span class="material-symbols-outlined">public</span> Internet / DNS Resolvers</div>';
    html += '<div class="arch-connector-line"></div>';

    /* Stats bar */
    const activeCount = zoneEntries.filter(z => !z.disabled).length;
    const dnssecCount = zoneEntries.filter(z => z.dnssec).length;
    html += '<div class="arch-stats-bar">';
    html += `<div class="arch-stat"><strong>${zoneEntries.length}</strong> Zones</div>`;
    html += `<div class="arch-stat"><strong>${providers.size}</strong> Providers</div>`;
    html += `<div class="arch-stat"><strong>${activeCount}</strong> Active</div>`;
    html += `<div class="arch-stat"><strong>${dnssecCount}</strong> DNSSEC</div>`;
    const subdomainDelegationCount = zoneEntries.reduce((sum, z) => sum + z.subdomainNsRecords.length, 0);
    const apexDelegationCount = zoneEntries.reduce((sum, z) => sum + z.apexNsRecords.length, 0);
    const delegationCount = subdomainDelegationCount + apexDelegationCount;
    if (delegationCount > 0) {
      html += `<div class="arch-stat"><strong>${apexDelegationCount}</strong> Apex NS</div>`;
      html += `<div class="arch-stat"><strong>${subdomainDelegationCount}</strong> Subdomain NS</div>`;
    }
    html += '</div>';
    html += '<div class="arch-connector-line"></div>';

    /* Provider cards */
    html += '<div class="arch-providers-row">';

    /* Pre-fetch bind conf artifacts so we can render them inside self-hosted cards */
    const bindConfArtifacts = await fetchBindConfArtifacts();

    providers.forEach((pData, pName) => {
      const label = pName.charAt(0).toUpperCase() + pName.slice(1);
      const zoneCount = zoneEntries.filter(z => z.providers.some(p => p.provider === pName)).length;
      html += `<div class="arch-provider-card" style="border-top: 3px solid ${pData.color}">`;
      html += `<div class="arch-provider-header"><span class="arch-provider-dot" style="background:${pData.color}"></span><strong>${label}</strong><span style="margin-left:auto;font-size:0.78rem;color:var(--text-light);">${zoneCount} zones</span></div>`;
      html += '<div class="arch-ns-entries">';
      pData.nameservers.forEach((nsData, nsName) => {
        const roleClass = nsData.role === 'secondary' ? 'role-secondary' : 'role-primary';
        html += `<div class="arch-ns-entry"><code>${nsName}</code><span class="role-tag ${roleClass}">${nsData.role}</span>`;
        if (nsData.ip) html += `<span class="arch-ns-ip">${nsData.ip}</span>`;
        if (nsData.ipv6) html += `<span class="arch-ns-ip">${nsData.ipv6}</span>`;
        if (pName === 'self-hosted') {
          const artifact = bindConfArtifacts.find(a => a.name === `bind_conf_${nsName}`);
          if (artifact) {
            html += `<a href="${artifact.download_url}" title="Download ${artifact.filename}" target="_blank" style="margin-left:auto; font-size:0.8rem; display:inline-flex; align-items:center; gap:0.2rem; color:var(--primary);"><span class="material-symbols-outlined" style="font-size:1rem;">download</span> Config</a>`;
          }
        }
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    });

    /* NS record targets NOT already shown in a vanity_ns provider card */
    const nsRecordProviders = new Map();
    zoneEntries.forEach(z => {
      [...z.apexNsRecords, ...z.subdomainNsRecords].forEach(r => {
        if (!r.content) return;
        const target = r.content.replace(/\.$/, '');
        const nsInfo = nsProviderMap[target];
        const provider = nsInfo?.provider || null;
        if (!provider || !providers.has(provider)) {
          const pKey = provider || 'external-ns';
          if (!nsRecordProviders.has(pKey)) {
            nsRecordProviders.set(pKey, { nameservers: new Map(), color: provider ? getColor(provider) : '#8b5cf6' });
          }
          if (!nsRecordProviders.get(pKey).nameservers.has(target)) {
            const ip = nsInfo?.target?.ipv4 || '';
            const ipv6 = nsInfo?.target?.ipv6 || '';
            const role = nsInfo?.role || 'delegation';
            nsRecordProviders.get(pKey).nameservers.set(target, { ip, ipv6, role });
          }
        }
      });
    });

    nsRecordProviders.forEach((pData, pName) => {
      const label = pName === 'external-ns'
        ? 'External NS (from records)'
        : pName.charAt(0).toUpperCase() + pName.slice(1) + ' (from records)';
      html += `<div class="arch-provider-card" style="border-top: 3px dashed ${pData.color}">`;
      html += `<div class="arch-provider-header"><span class="arch-provider-dot" style="background:${pData.color}"></span><strong>${label}</strong><span style="margin-left:auto;font-size:0.78rem;color:var(--text-light);">${pData.nameservers.size} NS</span></div>`;
      html += '<div class="arch-ns-entries">';
      pData.nameservers.forEach((nsData, nsName) => {
        html += `<div class="arch-ns-entry"><code>${nsName}</code><span class="ns-record-badge">${nsData.role}</span>`;
        if (nsData.ip) html += `<span class="arch-ns-ip">${nsData.ip}</span>`;
        if (nsData.ipv6) html += `<span class="arch-ns-ip">${nsData.ipv6}</span>`;
        html += '</div>';
      });
      html += '</div></div>';
    });

    html += '</div>'; // close arch-providers-row
    html += '<div class="arch-connector-line"></div>';

    /* Zone groups by topology */
    html += '<div class="arch-zones-section">';
    topoOrder.forEach(topo => {
      const tZones = topoGroups[topo];
      if (!tZones || tZones.length === 0) return;
      const meta = topoMeta[topo];
      html += '<div class="arch-topo-group">';
      html += `<div class="arch-topo-header" style="border-left: 3px solid ${meta.color}"><span class="material-symbols-outlined" style="color:${meta.color};font-size:1.1rem;">${meta.icon}</span><span>${meta.label}</span><span class="arch-topo-count">${tZones.length} zone${tZones.length !== 1 ? 's' : ''}</span></div>`;
      html += '<div class="arch-zone-grid">';

      tZones.sort((a, b) => a.name.localeCompare(b.name)).forEach(z => {
        html += '<div class="arch-zone-item">';
        html += `<div class="arch-zone-chip ${z.disabled ? 'arch-zone-disabled' : ''}" onclick="window._selectZone('${z.name}')" title="${z.name}${z.dnssec ? ' • DNSSEC' : ''}${z.disabled ? ' • Disabled' : ''}${z.format !== 'FORWARD' ? ' • ' + z.format : ''}">`;
        html += '<div class="arch-zone-name">';
        if (z.dnssec) html += '<span class="material-symbols-outlined" style="font-size:0.8rem;color:#f59e0b;" title="DNSSEC">lock</span>';
        html += `${z.name}`;
        if (z.disabled) html += ' <span class="badge badge-false" style="font-size:0.6rem;padding:0.1rem 0.35rem;">OFF</span>';
        if (z.format !== 'FORWARD') html += ` <span style="font-size:0.65rem;color:var(--text-light);">${z.format}</span>`;
        html += '</div><div class="arch-zone-providers">';

        const seen = new Set();
        z.providers.forEach(p => {
          if (seen.has(p.provider)) return;
          seen.add(p.provider);
          const pInfo = providers.get(p.provider);
          const c = pInfo ? pInfo.color : '#6b7280';
          const lbl = p.provider.charAt(0).toUpperCase() + p.provider.slice(1);
          html += `<span class="arch-provider-tag" style="background:${c}12;color:${c};border-color:${c}35">${lbl}</span>`;
        });
        if (z.providers.length === 0) {
          html += '<span class="arch-provider-tag" style="background:var(--hover-bg);color:var(--text-light);border-color:var(--border)">Default</span>';
        }
        html += '</div>';
        html += '</div>'; // close arch-zone-chip

        /* NS record delegations for this zone – apex and subdomain */
        const hasAnyNsRecords = z.apexNsRecords.length > 0 || z.subdomainNsRecords.length > 0;
        if (hasAnyNsRecords) {
          /* Apex NS records */
          if (z.apexNsRecords.length > 0) {
            const apexDelegations = {};
            z.apexNsRecords.forEach(r => {
              const name = r.original_name || r.name;
              if (!apexDelegations[name]) apexDelegations[name] = [];
              apexDelegations[name].push(r.content ? r.content.replace(/\.$/, '') : '');
            });
            html += '<div class="arch-ns-delegation-card arch-ns-delegation-apex">';
            html += '<div style="font-size:0.7rem;font-weight:600;color:#10b981;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:0.25rem;display:flex;align-items:center;gap:0.25rem;"><span class="material-symbols-outlined" style="font-size:0.75rem;">public</span> Apex NS</div>';
            Object.entries(apexDelegations).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, targets]) => {
              targets.sort().forEach(target => {
                html += `<div class="arch-ns-record"><span class="material-symbols-outlined" style="font-size:0.7rem;color:#10b981;">language</span>`;
                html += `<span class="arch-ns-record-name">${name}</span>`;
                html += `<span style="font-size:0.7rem;color:var(--text-light);">NS</span>`;
                html += `<span class="arch-ns-record-target">${target}</span></div>`;
              });
            });
            html += '</div>';
          }

          /* Subdomain NS records */
          if (z.subdomainNsRecords.length > 0) {
            const delegations = {};
            z.subdomainNsRecords.forEach(r => {
            const name = r.original_name || r.name;
            if (!delegations[name]) delegations[name] = [];
            delegations[name].push(r.content ? r.content.replace(/\.$/, '') : '');
          });
          html += '<div class="arch-ns-delegation-card arch-ns-delegation-subdomain">';
          html += '<div style="font-size:0.7rem;font-weight:600;color:#8b5cf6;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:0.25rem;display:flex;align-items:center;gap:0.25rem;"><span class="material-symbols-outlined" style="font-size:0.75rem;">subdirectory_arrow_right</span> Subdomain NS</div>';
          Object.entries(delegations).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, targets]) => {
            targets.sort().forEach(target => {
              html += `<div class="arch-ns-record"><span class="material-symbols-outlined" style="font-size:0.7rem;color:#8b5cf6;">subdirectory_arrow_right</span>`;
              html += `<span class="arch-ns-record-name">${name}</span>`;
              html += `<span style="font-size:0.7rem;color:var(--text-light);">NS</span>`;
              html += `<span class="arch-ns-record-target">${target}</span></div>`;
            });
          });
          html += '</div>';
          }
        }

        html += '</div>'; // close arch-zone-item
      });

      html += '</div></div>'; // close arch-zone-grid + arch-topo-group
    });

    html += '</div></div>'; // close arch-zones-section + arch-diagram

    content.innerHTML = html;
  } catch (err) {
    console.error('Failed to render architecture diagram:', err);
    content.innerHTML = `<div style="color: var(--danger); padding: 2rem;">Failed to generate architecture diagram: ${err.message}</div>`;
  }
}
