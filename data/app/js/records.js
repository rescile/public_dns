/**
 * DNS record helpers – CSV row building, record extraction from GraphQL,
 * record type form handling, save / delete / edit operations.
 */
import { state } from './state.js';
import { closeModalById } from './ui.js';
import { showBuildProgress } from './build.js';

/* ====================================================================
   CSV helpers
   ==================================================================== */

export function buildCsvRow(type, name, value, ttl, disabled, zone, priority, weight, port) {
  const t = type.toLowerCase();
  const d = disabled ? 'True' : 'False';
  let v = value;
  if (t === 'txt') {
    let txtVal = value;
    if (!txtVal.startsWith('"')) txtVal = '"' + txtVal;
    if (!txtVal.endsWith('"')) txtVal = txtVal + '"';
    v = `"${txtVal.replace(/"/g, '""')}"`;
  }

  if (t === 'a' || t === 'aaaa') return `type,name,address,ttl,comment,disabled,zone\n${t},${name},${v},${ttl},,${d},${zone}`;
  if (t === 'cname') return `type,name,canonical,ttl,comment,disabled,zone\n${t},${name},${v},${ttl},,${d},${zone}`;
  if (t === 'txt') return `type,name,text,ttl,comment,disabled,zone\n${t},${name},${v},${ttl},,${d},${zone}`;
  if (t === 'mx') return `type,zone,name,mail_exchanger,priority,ttl,disabled\n${t},${zone},${name},${v},${priority},${ttl},${d}`;
  if (t === 'srv') return `type,name,target,port,priority,weight,ttl,disabled,zone\n${t},${name},${v},${port},${priority},${weight},${ttl},${d},${zone}`;
  return `type,name,content,ttl,disabled,zone\n${t},${name},${v},${ttl},${d},${zone}`;
}

export function getRemoveCsvRow(type, name, zone, originalValue) {
  const t = type.toLowerCase();
  let v = originalValue || '';
  if (t === 'txt') {
    let txtVal = v;
    if (!txtVal.startsWith('"')) txtVal = '"' + txtVal;
    if (!txtVal.endsWith('"')) txtVal = txtVal + '"';
    v = `"${txtVal.replace(/"/g, '""')}"`;
  }
  if (t === 'a' || t === 'aaaa') return `type,name,address,zone\n${t},${name},${v},${zone}`;
  if (t === 'cname') return `type,name,canonical,zone\n${t},${name},${v},${zone}`;
  if (t === 'txt') return `type,name,text,zone\n${t},${name},${v},${zone}`;
  if (t === 'mx') return `type,zone,name,mail_exchanger\n${t},${zone},${name},${v}`;
  if (t === 'srv') return `type,name,target,zone\n${t},${name},${v},${zone}`;
  return `type,name,content,zone\n${t},${name},${v},${zone}`;
}

/* ====================================================================
   Record extraction from GraphQL response
   ==================================================================== */

export function extractRecords(zoneNode) {
  const records = [];

  const pushRecords = (nodes, type, valField) => {
    if (!nodes) return;
    nodes.forEach(edge => {
      const n = edge.node;
      let value = n[valField] || '';
      if (type === 'MX') value = n.mail_exchanger;
      if (type === 'SRV') value = n.target;
      const disabled = n.disabled === 'True' || n.disabled === true || n.disabled === 'true';
      records.push({
        type, name: n.original_name || n.name, value, ttl: n.ttl || '3600',
        disabled, priority: n.priority || '', weight: n.weight || '', port: n.port || '', raw: n,
      });
    });
  };

  pushRecords(zoneNode.has_a_record, 'A', 'address');
  pushRecords(zoneNode.has_aaaa_record, 'AAAA', 'address');
  pushRecords(zoneNode.has_cname_record, 'CNAME', 'canonical');
  pushRecords(zoneNode.has_txt_record, 'TXT', 'text');
  pushRecords(zoneNode.has_mx_record, 'MX', 'mail_exchanger');
  pushRecords(zoneNode.has_srv_record, 'SRV', 'target');
  pushRecords(zoneNode.has_ptr_record, 'PTR', 'content');
  pushRecords(zoneNode.has_caa_record, 'CAA', 'content');
  pushRecords(zoneNode.has_apex_ns_record, 'NS', 'content');
  pushRecords(zoneNode.has_subdomain_ns_record, 'NS', 'content');
  pushRecords(zoneNode.has_sshfp_record, 'SSHFP', 'content');
  pushRecords(zoneNode.has_cert_record, 'CERT', 'content');
  pushRecords(zoneNode.has_dnskey_record, 'DNSKEY', 'content');
  pushRecords(zoneNode.has_ds_record, 'DS', 'content');
  pushRecords(zoneNode.has_https_record, 'HTTPS', 'content');
  pushRecords(zoneNode.has_loc_record, 'LOC', 'content');
  pushRecords(zoneNode.has_naptr_record, 'NAPTR', 'content');
  pushRecords(zoneNode.has_smimea_record, 'SMIMEA', 'content');
  pushRecords(zoneNode.has_svcb_record, 'SVCB', 'content');
  pushRecords(zoneNode.has_tlsa_record, 'TLSA', 'content');
  pushRecords(zoneNode.has_uri_record, 'URI', 'content');

  return records.sort((a, b) => a.type !== b.type ? a.type.localeCompare(b.type) : a.name.localeCompare(b.name));
}

/* ====================================================================
   Record-type form toggling
   ==================================================================== */

export function handleTypeChange() {
  const type = document.getElementById('recType').value;
  const mxFields = document.getElementById('mxFields');
  const srvFields = document.getElementById('srvFields');
  const valLabel = document.getElementById('valueLabel');

  mxFields.classList.add('hidden');
  srvFields.classList.add('hidden');
  document.getElementById('recPriority').required = false;
  document.getElementById('recWeight').required = false;
  document.getElementById('recPort').required = false;

  if (type === 'mx') {
    mxFields.classList.remove('hidden');
    document.getElementById('recPriority').required = true;
    valLabel.textContent = 'Mail Exchanger';
  } else if (type === 'srv') {
    mxFields.classList.remove('hidden');
    srvFields.classList.remove('hidden');
    document.getElementById('recPriority').required = true;
    document.getElementById('recWeight').required = true;
    document.getElementById('recPort').required = true;
    valLabel.textContent = 'Target';
  } else if (type === 'a' || type === 'aaaa') {
    valLabel.textContent = 'IP Address';
  } else if (type === 'cname') {
    valLabel.textContent = 'Canonical Name';
  } else if (type === 'txt') {
    valLabel.textContent = 'Text Content';
  } else {
    valLabel.textContent = 'Content / Value';
  }
}

/* ====================================================================
   Open the record modal pre-populated for editing
   ==================================================================== */

export function editRecord(zoneName, idx) {
  const rec = state.zonesData[zoneName].records[idx];
  if (!rec) return;

  document.getElementById('modalTitle').textContent = 'Edit DNS Record';
  const typeSelect = document.getElementById('recType');
  typeSelect.value = rec.type.toLowerCase();
  typeSelect.disabled = true;

  document.getElementById('recName').value = rec.name;
  document.getElementById('recOriginalName').value = rec.name;
  document.getElementById('recValue').value = rec.value.replace(/^"|"$/g, '');
  document.getElementById('recOriginalValue').value = rec.value;
  document.getElementById('recTtl').value = rec.ttl;
  document.getElementById('recDisabled').checked = rec.disabled;

  if (rec.type === 'MX' || rec.type === 'SRV') document.getElementById('recPriority').value = rec.priority;
  if (rec.type === 'SRV') {
    document.getElementById('recWeight').value = rec.weight;
    document.getElementById('recPort').value = rec.port;
  }

  handleTypeChange();
  document.getElementById('recordModal').classList.add('active');
}

/* ====================================================================
   Save / delete record via CSV API
   ==================================================================== */

export async function saveRecord(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Saving...';
  submitBtn.disabled = true;

  const zone = document.getElementById('zoneSelect').value;
  const type = document.getElementById('recType').value;
  const name = document.getElementById('recName').value;
  const value = document.getElementById('recValue').value;
  const originalValue = document.getElementById('recOriginalValue').value;
  const originalName = document.getElementById('recOriginalName').value;
  const ttl = document.getElementById('recTtl').value;
  const disabled = document.getElementById('recDisabled').checked;
  const priority = document.getElementById('recPriority').value || '';
  const weight = document.getElementById('recWeight').value || '';
  const port = document.getElementById('recPort').value || '';

  const formData = new FormData();

  if (originalValue) {
    const removeCsv = getRemoveCsvRow(type, originalName || name, zone, originalValue);
    formData.append('remove', removeCsv);
  }

  const csvData = buildCsvRow(type, name, value, ttl, disabled, zone, priority, weight, port);
  formData.append('update', csvData);

  try {
    await fetch(`/api/assets/${type}.csv`, { method: 'POST', body: formData });
    closeModalById('recordModal');
    showBuildProgress();
  } catch (err) {
    console.error(err);
    alert('Failed to save DNS record');
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

export async function deleteRecord(zoneName, idx) {
  const rec = state.zonesData[zoneName].records[idx];
  if (!confirm(`Are you sure you want to delete the ${rec.type} record for ${rec.name}?`)) return;

  const csvData = getRemoveCsvRow(rec.type, rec.name, zoneName, rec.value);
  const formData = new FormData();
  formData.append('remove', csvData);

  try {
    await fetch(`/api/assets/${rec.type.toLowerCase()}.csv`, { method: 'POST', body: formData });
    showBuildProgress();
  } catch (err) {
    console.error(err);
    alert('Failed to delete DNS record');
  }
}
