/**
 * Load, cache, and render Vanity Name-Server group selects.
 */
import { state } from './state.js';

export async function loadVanityNsGroups() {
  try {
    const res = await fetch('/api/outputs/vanity_ns_list/vanity_ns/vanity_ns.json');
    if (!res.ok) return;
    const parsed = await res.json();
    state.vanityNsMap = parsed.data || {};
  } catch (e) {
    console.warn('Failed to load vanity_ns.json for select', e);
    return;
  }

  const providerMap = {};
  Object.entries(state.vanityNsMap).forEach(([nsName, info]) => {
    const provider = info?.provider || 'self-hosted';
    const role = info?.role || 'primary';
    const ipv4 = info?.target?.ipv4 || '';
    const ipv6 = info?.target?.ipv6 || '';
    if (!providerMap[provider]) providerMap[provider] = [];
    providerMap[provider].push({ name: nsName, role, ipv4, ipv6 });
  });

  state.vanityNsGroups = [];
  state.vanityNsGroups.push({ label: 'None (use default nameservers)', value: '', nameservers: [] });

  const providerNames = Object.keys(providerMap).sort();
  providerNames.forEach(provider => {
    const nsList = providerMap[provider].sort((a, b) => a.name.localeCompare(b.name));
    const nsNames = nsList.map(n => n.name);
    const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
    state.vanityNsGroups.push({
      label: `${providerLabel} — ${nsNames.join(', ')}`,
      value: nsNames.join(','),
      nameservers: nsList,
      provider,
    });
  });

  if (providerNames.length > 1) {
    const allNs = Object.values(providerMap).flat().sort((a, b) => a.name.localeCompare(b.name));
    const allNsNames = allNs.map(n => n.name);
    const allProviderLabels = providerNames.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ');
    state.vanityNsGroups.push({
      label: `${allProviderLabels} (all) — ${allNsNames.join(', ')}`,
      value: allNsNames.join(','),
      nameservers: allNs,
      provider: 'multi',
    });
  }

  populateVanitySelect('azVanity', 'azVanityDetail');
  populateVanitySelect('zsVanity', 'zsVanityDetail');
}

export function populateVanitySelect(selectId, detailId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '';

  state.vanityNsGroups.forEach(group => {
    const opt = document.createElement('option');
    opt.value = group.value;
    opt.textContent = group.label;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => updateVanityDetail(selectId, detailId));
  updateVanityDetail(selectId, detailId);
}

export function updateVanityDetail(selectId, detailId) {
  const select = document.getElementById(selectId);
  const detail = document.getElementById(detailId);
  if (!select || !detail) return;
  const group = state.vanityNsGroups.find(g => g.value === select.value);
  if (!group || group.nameservers.length === 0) { detail.innerHTML = ''; return; }

  let html = '<div style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-top:0.25rem;">';
  group.nameservers.forEach(ns => {
    const providerLabel = state.vanityNsMap[ns.name]?.provider || 'self-hosted';
    const roleClass = ns.role === 'secondary' ? 'role-secondary' : 'role-primary';
    const ipDisplay = [ns.ipv4, ns.ipv6].filter(Boolean).join(' / ');
    html += `<span class="ns-tag"><strong>${ns.name}</strong> <span class="role-tag ${roleClass}" style="margin-left:0.2rem;">${ns.role}</span>`;
    html += ` <span style="opacity:0.7;font-size:0.7rem;text-transform:capitalize;">${providerLabel}</span>`;
    if (ipDisplay) html += ` <span style="opacity:0.5;font-size:0.68rem;">(${ipDisplay})</span>`;
    html += '</span>';
  });
  html += '</div>';
  detail.innerHTML = html;
}

export function setVanitySelectValue(selectId, detailId, currentValue) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const normalized = currentValue ? currentValue.split(',').map(s => s.trim()).filter(Boolean).sort().join(',') : '';
  let matched = false;
  for (let i = 0; i < select.options.length; i++) {
    const optNormalized = select.options[i].value.split(',').map(s => s.trim()).filter(Boolean).sort().join(',');
    if (optNormalized === normalized) { select.value = select.options[i].value; matched = true; break; }
  }
  if (!matched && normalized) {
    const opt = document.createElement('option');
    opt.value = currentValue;
    opt.textContent = `Custom — ${currentValue}`;
    select.appendChild(opt);
    select.value = currentValue;
  }
  updateVanityDetail(selectId, detailId);
}
