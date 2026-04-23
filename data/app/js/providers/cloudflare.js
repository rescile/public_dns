/**
 * Cloudflare-specific API interactions.
 *
 * Every Cloudflare REST call is routed through the local proxy defined in
 * proxy.toml so that the API token is injected server-side.
 */

/* ====================================================================
   Low-level API helpers
   ==================================================================== */

/**
 * Discover the Cloudflare account ID from the portal proxy configuration.
 * Falls back to the direct /api/apps endpoint when the portal wrapper is
 * unavailable.
 */
export async function getCfAccountId() {
  try {
    let res = await fetch('/__portal/api/apps' + window.location.search).catch(() => null);
    if (res && res.ok) {
      res = await fetch('/api/apps').catch(() => null);
    }
    if (!res || !res.ok) return '';
    const text = await res.text();
    if (!text) return '';
    let apps;
    try {
      apps = JSON.parse(text);
    } catch (_) {
      return '';
    }
    for (const app of apps) {
      if (!app.proxies) continue;
      const proxy = app.proxies.find(p => p.path && p.path.startsWith('/api/cloudflare/account/'));
      if (proxy) {
        return proxy.path.split('/').pop();
      }
    }
  } catch (err) {
    console.warn('Failed to fetch account ID from /api/apps:', err);
  }
}

/**
 * Fetch a Cloudflare zone object by its domain name.
 * @param {string} zoneName
 * @returns {Promise<object>} Raw CF API response with `success` and `result`.
 */
export async function fetchCfZoneByName(zoneName) {
  const res = await fetch(`api/cloudflare/zones?name=${zoneName}`);
  return res.json();
}

/**
 * Fetch *all* DNS records for a Cloudflare zone, paginating automatically.
 * @param {string} zoneId
 * @returns {Promise<Array>} Flat array of CF DNS-record objects.
 */
export async function fetchAllCfRecords(zoneId) {
  const records = [];
  let page = 1;
  while (true) {
    const res = await fetch(`api/cloudflare/zones/${zoneId}/dns_records?per_page=100&page=${page}`);
    const data = await res.json();
    if (data.success) records.push(...data.result);
    if (!data.result_info || data.result_info.page >= data.result_info.total_pages) break;
    page++;
  }
  return records;
}

/**
 * Fetch the custom nameserver configuration for a specific zone.
 * @param {string} zoneId
 * @returns {Promise<object>} Raw CF API response.
 */
export async function fetchCfCustomNs(zoneId) {
  const res = await fetch(`api/cloudflare/zones/${zoneId}/custom_ns`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch account-level custom nameservers.
 * @param {string} accountId
 * @returns {Promise<object>} Raw CF API response.
 */
export async function fetchCfAccountCustomNs(accountId) {
  const res = await fetch(`api/cloudflare/accounts/${accountId}/custom_ns`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ====================================================================
   Live-state panel (Overview → "Cloudflare Live State" card)
   ==================================================================== */

/**
 * Fetches the live zone state from Cloudflare and renders the right-hand
 * "Provider Live State" card on the overview page.
 *
 * @param {string} zoneName  The zone domain name (e.g. "example.com").
 */
export async function fetchLiveState(zoneName) {
  const liveDetails = document.getElementById('liveDetails');
  liveDetails.innerHTML =
    '<div style="color: var(--text-light); grid-column: 1 / -1;">' +
    '<span class="material-symbols-outlined" style="animation: spin 1s linear infinite; vertical-align: middle; margin-right: 4px;">sync</span> Fetching from Cloudflare...</div>';

  try {
    const res = await fetch(`api/cloudflare/zones?name=${zoneName}`);
    if (!res.ok) throw new Error('API Error');
    const data = await res.json();

    if (data.success && data.result.length > 0) {
      const cfZone = data.result[0];
      const statusBadge =
        cfZone.status === 'active'
          ? '<span class="badge badge-true">Active</span>'
          : `<span class="badge badge-false" style="text-transform: capitalize;">${cfZone.status}</span>`;
      const nsList = (cfZone.name_servers || []).join(', ') || 'N/A';

      let vanityNsList =
        cfZone.vanity_name_servers?.length
          ? cfZone.vanity_name_servers.join(', ')
          : '';
      let hasVanityNs = !!(cfZone.vanity_name_servers?.length);

      /* ---- DNSSEC ---- */
      let dnssecBadge = '<span class="badge badge-false">Unknown</span>';
      let multiSignerBadge = '<span class="badge badge-false">Unknown</span>';

      try {
        const dnssecRes = await fetch(`api/cloudflare/zones/${cfZone.id}/dnssec`);
        if (dnssecRes.ok) {
          const dnssecData = await dnssecRes.json();
          if (dnssecData.success && dnssecData.result) {
            const dnssec = dnssecData.result;
            if (dnssec.status === 'active') {
              dnssecBadge = '<span class="badge badge-true">Active</span>';
            } else if (dnssec.status === 'disabled') {
              dnssecBadge = '<span class="badge badge-false">Disabled</span>';
            } else if (dnssec.status) {
              dnssecBadge = `<span class="badge badge-false" style="text-transform: capitalize;">${dnssec.status}</span>`;
            }

            multiSignerBadge = dnssec.dnssec_multi_signer
              ? '<span class="badge badge-true">Enabled</span>'
              : '<span class="badge badge-false">Disabled</span>';
          }
        }
      } catch (e) {
        console.error('Failed to fetch DNSSEC', e);
      }

      /* ---- Account-level custom NS ---- */
      try {
        const customNsRes = await fetch(`api/cloudflare/zones/${cfZone.id}/custom_ns`);
        if (customNsRes.ok) {
          const customNsData = await customNsRes.json();
          const nsResult = customNsData.result || customNsData;
          if (customNsData.success && nsResult.enabled) {
            const nsSet = parseInt(nsResult.ns_set || nsResult.set, 10);
            const accountId = cfZone.account ? cfZone.account.id : await getCfAccountId();
            try {
              const accountNsRes = await fetch(`api/cloudflare/accounts/${accountId}/custom_ns`);
              if (accountNsRes.ok) {
                const accountNsData = await accountNsRes.json();
                if (accountNsData.success) {
                  const resolvedList = accountNsData.result
                    .filter(ns => parseInt(ns.ns_set, 10) === nsSet)
                    .map(ns => ns.ns_name)
                    .sort();
                  if (resolvedList.length > 0) {
                    vanityNsList = resolvedList.join(', ');
                    hasVanityNs = true;
                  } else {
                    vanityNsList = `Account Custom NS (Set ${nsSet})`;
                    hasVanityNs = true;
                  }
                } else {
                  vanityNsList = `Account Custom NS (Set ${nsSet})`;
                  hasVanityNs = true;
                }
              } else {
                vanityNsList = `Account Custom NS (Set ${nsSet})`;
                hasVanityNs = true;
              }
            } catch (e) {
              console.error('Failed to fetch account custom NS', e);
              vanityNsList = `Account Custom NS (Set ${nsSet})`;
              hasVanityNs = true;
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch custom NS', e);
      }

      /* ---- Render ---- */
      let nsDisplayHtml;
      if (hasVanityNs) {
        nsDisplayHtml =
          `<div class="detail-item" style="grid-column: 1 / -1;"><span class="detail-label">Vanity NS</span>` +
          `<span class="detail-value" style="font-family: monospace; font-size: 0.85rem;">${vanityNsList}</span></div>`;
      } else {
        nsDisplayHtml =
          `<div class="detail-item" style="grid-column: 1 / -1;"><span class="detail-label">Assigned Nameservers</span>` +
          `<span class="detail-value" style="font-family: monospace; font-size: 0.85rem;">${nsList}</span></div>`;
      }

      liveDetails.innerHTML = `
        <div class="detail-item"><span class="detail-label">Status</span><span class="detail-value">${statusBadge}</span></div>
        <div class="detail-item"><span class="detail-label">Zone ID</span><span class="detail-value" style="font-family: monospace; font-size: 0.8rem;">${cfZone.id}</span></div>
        <div class="detail-item"><span class="detail-label">DNSSEC</span><span class="detail-value">${dnssecBadge}</span></div>
        <div class="detail-item"><span class="detail-label">Multi-Signer</span><span class="detail-value">${multiSignerBadge}</span></div>
        ${nsDisplayHtml}
      `;
    } else {
      liveDetails.innerHTML =
        '<div style="color: var(--text-light); grid-column: 1 / -1;">Zone not found in Cloudflare (or insufficient permissions).</div>';
    }
  } catch (err) {
    console.error(err);
    liveDetails.innerHTML =
      '<div style="color: var(--danger); grid-column: 1 / -1;">Failed to load live state. Check API Token / Proxy Config.</div>';
  }
}
