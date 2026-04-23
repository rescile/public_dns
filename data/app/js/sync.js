/**
 * Sync / diff logic – calculate differences between declared state and
 * Cloudflare live state, push changes to CF, or pull changes into CSV.
 */
import { state } from './state.js';
import { showNotification } from './ui.js';
import { buildCsvRow, getRemoveCsvRow } from './records.js';
import { showBuildProgress } from './build.js';
import {
  getCfAccountId,
  fetchCfZoneByName,
  fetchAllCfRecords,
  fetchCfCustomNs,
  fetchCfAccountCustomNs,
} from './providers/cloudflare.js';

/* ====================================================================
   Calculate Diff
   ==================================================================== */

export async function calculateDiff() {
  const zoneName = document.getElementById('zoneSelect').value;
  if (!zoneName) return;
  const zone = state.zonesData[zoneName];
  const diffStatus = document.getElementById('syncStatus');
  const tbody = document.getElementById('diffTableBody');
  const applyBtn = document.getElementById('applyChangesBtn');
  const pullBtn = document.getElementById('pullChangesBtn');
  const calcBtn = document.getElementById('calcDiffBtn');

  tbody.innerHTML = '';
  document.getElementById('diffResults').classList.add('hidden');
  applyBtn.disabled = true;
  pullBtn.disabled = true;
  calcBtn.disabled = true;

  diffStatus.textContent = 'Fetching live state from Cloudflare...';

  try {
    const accountId = await getCfAccountId();

    /* Fetch vanity NS provider map (same as architecture.js) */
    let nsProviderMap = {};
    try {
      const inputRes = await fetch('/api/outputs/vanity_ns_list/vanity_ns/vanity_ns.json');
      if (inputRes.ok) { const parsed = await inputRes.json(); nsProviderMap = parsed.data || {}; }
    } catch (e) { console.warn('Failed to fetch vanity_ns.json output', e); }

    let zoneData;
    try {
      zoneData = await fetchCfZoneByName(zoneName);
    } catch (e) {
      console.error('Failed to fetch zone from Cloudflare:', e);
      zoneData = { success: false, result: [] };
    }
    let zoneId = null;
    let cfRecords = [];
    let cfVanity = [];

    if (zoneData.success && zoneData.result.length > 0) {
      const cfZone = zoneData.result[0];
      zoneId = cfZone.id;
      cfVanity = (cfZone.vanity_name_servers?.length) ? cfZone.vanity_name_servers : [];
      diffStatus.textContent = 'Fetching existing records...';
      cfRecords = await fetchAllCfRecords(zoneId);
    }

    /* ---- Build declared map ---- */
    const declared = zone.records.filter(r => !r.disabled).map(r => {
      let name = r.name;
      if (!name.includes(zoneName) && name !== '@') name = name + '.' + zoneName;
      if (name === '@') name = zoneName;

      let content = r.value;
      if (r.type === 'TXT' && content.startsWith('"') && content.endsWith('"')) content = content.slice(1, -1);

      let data, priority;
      if (r.type === 'MX') {
        priority = parseInt(r.priority);
      } else if (r.type === 'SRV') {
        data = { priority: parseInt(r.priority), weight: parseInt(r.weight), port: parseInt(r.port), target: r.value.replace(/\.$/, '') };
        content = `${data.priority} ${data.weight} ${data.port} ${data.target}`;
      } else if (r.type === 'CNAME') {
        content = content.replace(/\.$/, '');
      }

      return { type: r.type, name, content, ttl: parseInt(r.ttl), priority, data, _original: r };
    });

    const exMap = new Map();
    cfRecords.forEach(r => {
      let val = r.content;
      if (r.type === 'TXT' && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (r.type === 'SRV' && r.data) val = `${r.data.priority} ${r.data.weight} ${r.data.port} ${r.data.target}`;
      exMap.set(`${r.name}|${r.type}|${val.toLowerCase()}`, r);
    });

    const decMap = new Map();
    declared.forEach(r => {
      let val = r.content;
      if (r.type === 'SRV' && r.data) val = `${r.data.priority} ${r.data.weight} ${r.data.port} ${r.data.target}`;
      decMap.set(`${r.name}|${r.type}|${val.toLowerCase()}`, r);
    });

    const toAdd = [], toUpdate = [], toRemove = [];

    decMap.forEach((dRec, key) => {
      if (!exMap.has(key)) { toAdd.push(dRec); } else {
        const eRec = exMap.get(key);
        if (eRec.ttl !== dRec.ttl) toUpdate.push({ id: eRec.id, cfRecord: eRec, ...dRec });
      }
    });

    exMap.forEach((eRec, key) => {
      if (!decMap.has(key) && eRec.type !== 'SOA' && eRec.type !== 'NS') toRemove.push(eRec);
    });

    /* ---- Vanity NS comparison ---- */
    const hasVanityConfig = zone.vanity_name_server && String(zone.vanity_name_server).trim() !== '';
    /* Build declared Cloudflare vanity NS list from vanity_ns.json instead of zone.cf_vanity_name_server */
    const allVanity = zone.vanity_name_server
      ? (Array.isArray(zone.vanity_name_server) ? zone.vanity_name_server : String(zone.vanity_name_server).split(',')).map(s => s.trim()).filter(Boolean)
      : [];
    let decVanity = allVanity.filter(ns => {
      const nsInfo = nsProviderMap[ns];
      return nsInfo && nsInfo.provider === 'cloudflare';
    });
    let cfVanityStr = cfVanity.slice().sort().join(', ');
    let isAccountCustomNs = false;

    if (zoneId) {
      try {
        const customNsData = await fetchCfCustomNs(zoneId);
        const nsResult = customNsData.result || customNsData;
        if (customNsData.success && nsResult.enabled) {
          isAccountCustomNs = true;
          const nsSet = parseInt(nsResult.ns_set || nsResult.set, 10);
          if (accountId) {
            try {
              const accountNsData = await fetchCfAccountCustomNs(accountId);
              if (accountNsData.success) {
                const nsList = accountNsData.result.filter(ns => ns.ns_set === nsSet).map(ns => ns.ns_name).sort();
                if (nsList.length > 0) cfVanityStr = nsList.join(', ');
              }
            } catch (e) { console.warn('Failed to fetch account custom NS for diff', e); }
          } else {
            console.warn('Custom NS is enabled but no account ID available to resolve NS set');
            }
        }
      } catch (e) { console.warn('Failed to fetch custom NS for diff', e); }
    }

    let decVanityDisplay = decVanity;
    if (decVanityDisplay.length === 0 && hasVanityConfig) {
      decVanityDisplay = (Array.isArray(zone.vanity_name_server) ? zone.vanity_name_server : String(zone.vanity_name_server).split(',')).map(s => s.trim()).filter(Boolean);
    }
    const decVanityStr = decVanityDisplay.slice().sort().join(', ');

    let updateVanity = false;
    if (hasVanityConfig && cfVanityStr !== decVanityStr) updateVanity = true;

    state.pendingSync = { zoneName, zoneId, accountId, toAdd, toUpdate, toRemove, updateVanity, toUpdateVanity: decVanity, cfVanityStr, isAccountCustomNs };

    /* ---- Render diff table ---- */
    document.getElementById('diffResults').classList.remove('hidden');

    if (!zoneId) {
      tbody.innerHTML += `<tr><td><span class="badge badge-type">ZONE</span></td><td>${zoneName}</td><td style="color: #10b981; font-weight: 500;">Exists</td><td><span class="badge badge-false">Missing</span></td></tr>`;
    }
    if (updateVanity) {
      tbody.innerHTML += `<tr><td><span class="badge badge-type">VANITY NS</span></td><td>@</td><td style="color: var(--info); font-weight: 500;">${decVanityStr || 'None'}</td><td>${zoneId ? `<span style="color: var(--text-light);">${cfVanityStr || 'None'}</span>` : '<span class="badge badge-false">Missing</span>'}</td></tr>`;
    }
    toAdd.forEach(r => {
      tbody.innerHTML += `<tr><td><span class="badge badge-type">${r.type}</span></td><td>${r.name}</td><td style="color: #10b981; font-weight: 500;">${r.content} <span style="font-size: 0.85em; color: var(--text-light);">(TTL: ${r.ttl})</span></td><td><span class="badge badge-false">Missing</span></td></tr>`;
    });
    toUpdate.forEach(r => {
      tbody.innerHTML += `<tr><td><span class="badge badge-type">${r.type}</span></td><td>${r.name}</td><td style="color: var(--info); font-weight: 500;">${r.content} <span style="font-size: 0.85em; color: var(--text-light);">(TTL: ${r.ttl})</span></td><td style="color: var(--text-light);">${r.cfRecord.content} <span style="font-size: 0.85em;">(TTL: ${r.cfRecord.ttl})</span></td></tr>`;
    });
    toRemove.forEach(r => {
      let val = r.content;
      if (r.type === 'SRV' && r.data) val = `${r.data.priority} ${r.data.weight} ${r.data.port} ${r.data.target}`;
      tbody.innerHTML += `<tr><td><span class="badge badge-type">${r.type}</span></td><td>${r.name}</td><td><span class="badge badge-false">Missing</span></td><td style="color: #ef4444; font-weight: 500;">${val} <span style="font-size: 0.85em; color: var(--text-light);">(TTL: ${r.ttl})</span></td></tr>`;
    });

    if (!zoneId && toAdd.length === 0 && toUpdate.length === 0 && toRemove.length === 0 && !updateVanity) {
      diffStatus.textContent = 'Zone will be created, no records to sync.';
      applyBtn.disabled = false; pullBtn.disabled = false;
    } else if (toAdd.length === 0 && toUpdate.length === 0 && toRemove.length === 0 && !updateVanity) {
      diffStatus.textContent = 'No changes to apply. Cloudflare is fully synced.' + (!hasVanityConfig ? ' (Vanity NS not configured, skipped)' : '');
    } else {
      diffStatus.textContent = 'Review changes below and choose to Push or Pull.';
      applyBtn.disabled = false; pullBtn.disabled = false;
    }
  } catch (err) {
    console.error(err);
    diffStatus.textContent = 'Error calculating diff: ' + err.message;
  } finally {
    calcBtn.disabled = false;
  }
}

/* ====================================================================
   Push Sync (declared → Cloudflare)
   ==================================================================== */

export async function performSync() {
  if (!state.pendingSync) return;
  const { zoneName, accountId, toAdd, toUpdate, toRemove } = state.pendingSync;
  let zoneId = state.pendingSync.zoneId;
  const applyBtn = document.getElementById('applyChangesBtn');
  const pullBtn = document.getElementById('pullChangesBtn');
  applyBtn.disabled = true;
  pullBtn.disabled = true;
  const diffStatus = document.getElementById('syncStatus');
  diffStatus.textContent = 'Applying changes...';

  try {
    if (!zoneId) {
      diffStatus.textContent = `Creating zone ${zoneName}...`;
      const res = await fetch('api/cloudflare/zones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: zoneName, account: { id: accountId } }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.errors[0].message);
      zoneId = data.result.id;
      state.pendingSync.zoneId = zoneId;
    }

    if (state.pendingSync.updateVanity) {
      diffStatus.textContent = 'Updating Vanity Name Servers...';
      const vanityStr = state.pendingSync.toUpdateVanity.join(', ');
      const match = vanityStr.match(/Account Custom NS \(Set (\d+)\)/i);

      if (match) {
        await fetch(`api/cloudflare/zones/${zoneId}/custom_ns`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, ns_set: parseInt(match[1]) }) });
      } else {
        if (state.pendingSync.isAccountCustomNs) {
          await fetch(`api/cloudflare/zones/${zoneId}/custom_ns`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
        }
        const newVanity = (vanityStr.toLowerCase() === 'none' || vanityStr === '') ? [] : state.pendingSync.toUpdateVanity;
        await fetch(`api/cloudflare/zones/${zoneId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vanity_name_servers: newVanity }) });
      }
    }

    for (const r of toRemove) {
      diffStatus.textContent = `Removing ${r.name}...`;
      await fetch(`api/cloudflare/zones/${zoneId}/dns_records/${r.id}`, { method: 'DELETE' });
    }
    for (const r of toAdd) {
      diffStatus.textContent = `Adding ${r.name}...`;
      const payload = { type: r.type, name: r.name, content: r.content, ttl: r.ttl };
      if (r.priority !== undefined) payload.priority = r.priority;
      if (r.data !== undefined) payload.data = r.data;
      await fetch(`api/cloudflare/zones/${zoneId}/dns_records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    for (const r of toUpdate) {
      diffStatus.textContent = `Updating ${r.name}...`;
      const payload = { type: r.type, name: r.name, content: r.content, ttl: r.ttl };
      if (r.priority !== undefined) payload.priority = r.priority;
      if (r.data !== undefined) payload.data = r.data;
      await fetch(`api/cloudflare/zones/${zoneId}/dns_records/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }

    showNotification('Sync complete!');
    state.pendingSync = null;
    calculateDiff();
  } catch (err) {
    console.error(err);
    diffStatus.textContent = 'Error during sync: ' + err.message;
    applyBtn.disabled = false;
    pullBtn.disabled = false;
  }
}

/* ====================================================================
   Pull Sync (Cloudflare → CSV)
   ==================================================================== */

export async function pullSync() {
  if (!state.pendingSync) return;
  const { zoneName, toAdd, toUpdate, toRemove } = state.pendingSync;
  const applyBtn = document.getElementById('applyChangesBtn');
  const pullBtn = document.getElementById('pullChangesBtn');
  applyBtn.disabled = true;
  pullBtn.disabled = true;
  const diffStatus = document.getElementById('syncStatus');
  diffStatus.textContent = 'Pulling changes to CSV...';

  try {
    const groupedUpdates = {};
    const groupedRemoves = {};

    /* Records that exist in declared but not in CF → remove from CSV */
    for (const r of toAdd) {
      const rec = r._original;
      const type = rec.type.toLowerCase();
      const csvData = getRemoveCsvRow(rec.type, rec.name, zoneName, rec.value);
      const splitIdx = csvData.indexOf('\n');
      if (!groupedRemoves[type]) groupedRemoves[type] = { header: csvData.slice(0, splitIdx), rows: [] };
      groupedRemoves[type].rows.push(csvData.slice(splitIdx + 1));
    }

    /* Records that exist in CF but not in declared → add to CSV */
    for (const r of toRemove) {
      let value = r.content;
      let priority = r.priority || '';
      let weight = '';
      let port = '';
      if (r.type === 'SRV' && r.data) {
        priority = r.data.priority || '';
        weight = r.data.weight || '';
        port = r.data.port || '';
        value = r.data.target || r.content;
      } else if (r.type === 'MX') {
        priority = r.priority || '';
      }

      let shortName = r.name;
      if (shortName === zoneName) shortName = '@';
      else if (shortName.endsWith('.' + zoneName)) shortName = shortName.slice(0, -(zoneName.length + 1));

      const type = r.type.toLowerCase();
      const csvData = buildCsvRow(r.type, shortName, value, r.ttl, false, zoneName, priority, weight, port);
      const splitIdx = csvData.indexOf('\n');
      if (!groupedUpdates[type]) groupedUpdates[type] = { header: csvData.slice(0, splitIdx), rows: [] };
      groupedUpdates[type].rows.push(csvData.slice(splitIdx + 1));
    }

    /* Records that exist in both but differ → update CSV */
    for (const r of toUpdate) {
      const rec = r._original;
      const cfRec = r.cfRecord;
      const type = rec.type.toLowerCase();

      const removeCsv = getRemoveCsvRow(rec.type, rec.name, zoneName, rec.value);
      const remSplit = removeCsv.indexOf('\n');
      if (!groupedRemoves[type]) groupedRemoves[type] = { header: removeCsv.slice(0, remSplit), rows: [] };
      groupedRemoves[type].rows.push(removeCsv.slice(remSplit + 1));

      const csvData = buildCsvRow(rec.type, rec.name, rec.value, cfRec.ttl, rec.disabled, zoneName, rec.priority, rec.weight, rec.port);
      const splitIdx = csvData.indexOf('\n');
      if (!groupedUpdates[type]) groupedUpdates[type] = { header: csvData.slice(0, splitIdx), rows: [] };
      groupedUpdates[type].rows.push(csvData.slice(splitIdx + 1));
    }

    const types = new Set([...Object.keys(groupedUpdates), ...Object.keys(groupedRemoves)]);
    for (const type of types) {
      diffStatus.textContent = `Syncing ${type.toUpperCase()} records in bulk...`;
      const formData = new FormData();
      if (groupedRemoves[type]) formData.append('remove', `${groupedRemoves[type].header}\n${groupedRemoves[type].rows.join('\n')}`);
      if (groupedUpdates[type]) formData.append('update', `${groupedUpdates[type].header}\n${groupedUpdates[type].rows.join('\n')}`);
      await fetch(`/api/assets/${type}.csv`, { method: 'POST', body: formData });
    }

    /* Vanity NS pull */
    if (state.pendingSync.updateVanity) {
      diffStatus.textContent = 'Syncing Vanity Name Servers...';
      const zone = state.zonesData[zoneName];
      const view = zone.view || 'default';
      const zone_format = zone.zone_format || 'FORWARD';
      const disabled = zone.disabled || 'False';
      const dnssec = zone.dnssec || 'False';

      let allNs = new Set(zone.vanity_name_server ? String(zone.vanity_name_server).split(',').map(s => s.trim()).filter(Boolean) : []);
      /* Remove current Cloudflare vanity NS (identified via vanity_ns.json) */
      let nsProviderMap = {};
      try {
        const inputRes = await fetch('/api/outputs/vanity_ns_list/vanity_ns/vanity_ns.json');
        if (inputRes.ok) { const parsed = await inputRes.json(); nsProviderMap = parsed.data || {}; }
      } catch (e) { console.warn('Failed to fetch vanity_ns.json for pull', e); }
      for (const ns of allNs) {
        const nsInfo = nsProviderMap[ns];
        if (nsInfo && nsInfo.provider === 'cloudflare') allNs.delete(ns);
      }
      if (state.pendingSync.cfVanityStr) {
        state.pendingSync.cfVanityStr.split(',').map(s => s.trim()).filter(Boolean).forEach(ns => allNs.add(ns));
      }

      const vanity = Array.from(allNs).join(',').replace(/"/g, '""');
      const csvData = `type,name,view,zone_format,disabled,dnssec,vanity_name_server\n${state.authResource},${zoneName},${view},${zone_format},${disabled},${dnssec},"${vanity}"`;
      const formData = new FormData();
      formData.append('update', csvData);
      await fetch(`/api/assets/${state.authResource}.csv`, { method: 'POST', body: formData });
    }

    showNotification('Pull complete!');
    state.pendingSync = null;
    showBuildProgress();
  } catch (err) {
    console.error(err);
    diffStatus.textContent = 'Error during pull: ' + err.message;
    applyBtn.disabled = false;
    pullBtn.disabled = false;
  }
}
