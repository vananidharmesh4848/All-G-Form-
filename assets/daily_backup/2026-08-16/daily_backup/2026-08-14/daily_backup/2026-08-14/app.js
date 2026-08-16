/* ==========================================================
   MULTI-FORM CENTRAL DASHBOARD - DYNAMIC AGGREGATOR ENGINE
   ========================================================== */

// Application State
let appData = {
  activeTab: 'dash', // 'dash', 'details', 'userReport', 'linker', 'analytics'
  selectedFormId: '', // selected form ID for details tab
  registeredForms: [], // dynamic list of connected forms: { id, name, url, status, lastSync }
  submissions: {}, // parsed entries map: { [formId]: [{ timestamp, email }, ...] }
  chartInstanceVolume: null,
  chartInstanceShare: null
};

// Toast Notifications Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);

  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Format Date objects cleanly
function formatDateTime(date) {
  if (!date || isNaN(date.getTime())) return 'No Data / કોઈ એન્ટ્રી નથી';
  
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// Relative time string helper
function getRelativeTimeString(date) {
  if (!date || isNaN(date.getTime())) return '';
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'હમણાં જ';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} મિનિટ પહેલાં`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} કલાક પહેલાં`;
  const days = Math.floor(hours / 24);
  return `${days} દિવસ પહેલાં`;
}

// Parse CSV output exported from Google Sheet URLs
function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/);
  const result = [];
  if (lines.length <= 1) return result;
  
  // Custom CSV parser handling quotes and commas
  function parseCSVLine(line) {
    const arr = [];
    let quote = false;
    let val = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        quote = !quote;
      } else if (c === ',' && !quote) {
        arr.push(val);
        val = '';
      } else {
        val += c;
      }
    }
    arr.push(val);
    return arr.map(v => v.trim().replace(/^"|"$/g, ''));
  }

  const headers = parseCSVLine(lines[0]);
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVLine(lines[i]);
    
    // Column A is Timestamp
    let rawTs = row[0];
    let ts = new Date(rawTs);
    if (isNaN(ts.getTime())) {
      ts = new Date(rawTs.replace(/-/g, '/'));
    }
    
    // Column B is Submitter (Email/Name)
    let email = row[1] || '-';
    
    if (!isNaN(ts.getTime())) {
      result.push({
        timestamp: ts,
        email: email
      });
    }
  }
  return result;
}

// Connect a new Google Sheet to the Dashboard registry
function bindGoogleSheet(event) {
  if (event) event.preventDefault();
  
  const name = document.getElementById('linkName').value.trim();
  const url = document.getElementById('linkSheetUrl').value.trim();

  if (!url.includes('docs.google.com/spreadsheets') && !url.includes('docs.google.com/forms')) {
    alert('ગૂગલ સ્પ્રેડશીટની સાચી લિંક દાખલ કરો! / Please paste a valid Google Sheets URL');
    return;
  }

  if (url.includes('docs.google.com/forms')) {
    alert('⚠️ આ ગૂગલ ફોર્મની લિંક છે. ફોર્મના જવાબો મેળવવા માટે તે જે ગૂગલ શીટ સાથે જોડાયેલ છે તેની લિંક અહીં પેસ્ટ કરો.');
    return;
  }

  // Create a unique Form ID
  const formId = 'form_' + Date.now();

  const newForm = {
    id: formId,
    name: name,
    url: url,
    status: 'Syncing... / અપડેટ થાય છે',
    lastSync: null
  };

  appData.registeredForms.push(newForm);
  appData.submissions[formId] = [];
  
  if (!appData.selectedFormId) {
    appData.selectedFormId = formId;
  }

  saveRegistryToStorage();

  // Clear inputs
  document.getElementById('linkName').value = '';
  document.getElementById('linkSheetUrl').value = '';

  showToast(`Linking form "${name}"...`);

  // Sync and reload views
  syncGoogleSheet(formId).then(() => {
    renderActiveConnectionsTable();
    renderDashboardTable();
    renderFormSelector();
  });
}

// Sync a single Google Sheet via server CORS proxy
async function syncGoogleSheet(formId, quiet = false) {
  const form = appData.registeredForms.find(f => f.id === formId);
  if (!form) return;

  form.status = 'Syncing... / અપડેટ થાય છે';
  renderActiveConnectionsTable();

  // We convert normal share links into public CSV export links
  // The backend proxy `/api/proxy-sheet` fetches this data server-side
  try {
    const sheetIdMatch = form.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) throw new Error('Invalid Google Sheets URL');
    const spreadsheetId = sheetIdMatch[1];

    const gidMatch = form.url.match(/[#&?]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';

    const directExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    const proxyUrl = `/api/proxy-sheet?url=${encodeURIComponent(directExportUrl)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Google Sheet returned HTTP ${response.status}`);
    }

    const csvText = await response.text();
    const list = parseCSV(csvText);

    appData.submissions[formId] = list;
    form.status = 'Success / ચાલુ છે';
    form.lastSync = new Date();

    // Cache results in localStorage for instant offline loads
    localStorage.setItem(`cached_dynamic_subs_${formId}`, JSON.stringify(list));

    if (!quiet) {
      showToast(`"${form.name}" updated!`);
    }
  } catch (err) {
    console.error(err);
    form.status = 'Failed / નિષ્ફળ';
    if (!quiet) {
      alert(`ભૂલ: "${form.name}" અપડેટ કરવામાં નિષ્ફળતા મળી.\nખાતરી કરો કે સ્પ્રેડશીટના સેટિંગ્સમાં "Anyone with the link can view" ચાલુ છે.\nError: ${err.message}`);
    }
  }

  saveRegistryToStorage();
}

// Sync all connected Google Sheets sequentially
async function syncAllGoogleSheets() {
  if (appData.registeredForms.length === 0) return;

  const btn = document.getElementById('syncAllBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '🔄 અપડેટ થાય છે...';
  }

  showToast('Updating all dynamic forms...');

  for (const form of appData.registeredForms) {
    await syncGoogleSheet(form.id, true);
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = '🔄 લાઈવ અપડેટ કરો / Sync Sheets';
  }

  // Redraw dashboard views
  renderDashboardTable();
  if (appData.activeTab === 'details') renderFormDetailsPanel();
  if (appData.activeTab === 'userReport') generateUserReport();
  if (appData.activeTab === 'analytics') updateAnalyticsCharts();

  showToast('All forms successfully updated!');
}

// Delete form link from Registry
function deleteBinding(formId) {
  const form = appData.registeredForms.find(f => f.id === formId);
  if (!form) return;

  if (!confirm(`શું તમે ખરેખર "${form.name}" ની લિંક કાઢી નાખવા માંગો છો? / Are you sure?`)) return;

  appData.registeredForms = appData.registeredForms.filter(f => f.id !== formId);
  delete appData.submissions[formId];

  // Clean caches
  localStorage.removeItem(`cached_dynamic_subs_${formId}`);
  saveRegistryToStorage();

  if (appData.selectedFormId === formId) {
    appData.selectedFormId = appData.registeredForms.length > 0 ? appData.registeredForms[0].id : '';
  }

  showToast(`"${form.name}" unlinked.`);

  renderActiveConnectionsTable();
  renderDashboardTable();
  renderFormSelector();
  renderFormDetailsPanel();
}

// Save Registry to localStorage
function saveRegistryToStorage() {
  localStorage.setItem('dynamic_registered_forms_v3', JSON.stringify(appData.registeredForms));
}

// Load Registry and cache on boot
function loadRegistryAndCache() {
  const saved = localStorage.getItem('dynamic_registered_forms_v3');
  if (saved) {
    try {
      appData.registeredForms = JSON.parse(saved);
      
      // Select first form as default
      if (appData.registeredForms.length > 0) {
        appData.selectedFormId = appData.registeredForms[0].id;
      }

      // Load cached submissions
      appData.registeredForms.forEach(form => {
        const cached = localStorage.getItem(`cached_dynamic_subs_${form.id}`);
        if (cached) {
          try {
            const list = JSON.parse(cached);
            appData.submissions[form.id] = list.map(item => ({
              timestamp: new Date(item.timestamp),
              email: item.email
            }));
          } catch (e) {
            console.error("Cache load error", e);
          }
        } else {
          appData.submissions[form.id] = [];
        }
      });
    } catch (e) {
      console.error("Registry load error", e);
    }
  }
}

// Switch tabs and trigger view updates
function switchTab(tabId) {
  appData.activeTab = tabId;

  // Toggle active tab buttons
  document.querySelectorAll('.tab-link').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Toggle active panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.getAttribute('id') === `tab-${tabId}`);
  });

  // Load and refresh contents based on active tab
  if (tabId === 'dash') {
    renderDashboardTable();
  } else if (tabId === 'details') {
    const searchInput = document.getElementById('detailsSearchInput');
    if (searchInput) searchInput.value = '';
    renderFormSelector();
    renderFormDetailsPanel();
  } else if (tabId === 'userReport') {
    populateUserEmailsDatalist();
    generateUserReport();
    render24hContributors();
  } else if (tabId === 'linker') {
    renderActiveConnectionsTable();
  } else if (tabId === 'analytics') {
    updateAnalyticsCharts();
  }
}

// Calculate and render Master Dashboard grid table
function renderDashboardTable() {
  const tbody = document.getElementById('dashboardTableBody');
  const emptyState = document.getElementById('dashboardEmptyState');
  const tableContainer = document.getElementById('dashboardTableContainer');
  const syncAllBtn = document.getElementById('syncAllBtn');

  if (!tbody) return;

  const formsCount = appData.registeredForms.length;
  document.getElementById('statTotalForms').textContent = formsCount;

  if (formsCount === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';
    if (syncAllBtn) syncAllBtn.style.display = 'none';
    
    document.getElementById('statActive24h').textContent = '0';
    document.getElementById('statTotal24h').textContent = '0';
    document.getElementById('statTotalSubmissions').textContent = '0';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (tableContainer) tableContainer.style.display = 'block';
  if (syncAllBtn) syncAllBtn.style.display = 'inline-block';

  tbody.innerHTML = '';

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let active24hCount = 0;
  let total24hSubmissions = 0;
  let grandTotalSubmissions = 0;

  appData.registeredForms.forEach(form => {
    const subs = appData.submissions[form.id] || [];
    grandTotalSubmissions += subs.length;

    // Filter submissions in last 24h
    const subs24h = subs.filter(s => s.timestamp >= oneDayAgo);
    total24hSubmissions += subs24h.length;
    if (subs24h.length > 0) {
      active24hCount++;
    }

    // Find last submitter and last submission time
    let lastTime = null;
    let lastSubmitter = '-';
    subs.forEach(s => {
      if (!lastTime || s.timestamp > lastTime) {
        lastTime = s.timestamp;
        lastSubmitter = s.email;
      }
    });

    const statusBadge = form.status.includes('Success') 
      ? '<span class="badge badge-success">ચાલુ છે (Live)</span>'
      : (form.status.includes('Failed') ? '<span class="badge badge-danger">ભૂલ (Failed)</span>' : '<span class="badge badge-warning">બાકી (Pending)</span>');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${form.name}</strong></td>
      <td>${lastTime ? formatDateTime(lastTime) + ` (${getRelativeTimeString(lastTime)})` : '<span class="muted">-</span>'}</td>
      <td>
        <span class="badge ${subs24h.length > 0 ? 'badge-success' : 'badge-neutral'}">
          ${subs24h.length} વાર / times
        </span>
      </td>
      <td><code>${lastSubmitter}</code></td>
      <td>${statusBadge}</td>
      <td style="text-align: center;" class="no-print">
        <div style="display: flex; gap: 6px; justify-content: center;">
          <button class="btn btn-secondary btn-sm" onclick="syncGoogleSheet('${form.id}').then(renderDashboardTable)">🔄 Sync</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBinding('${form.id}')">🗑 Unlink</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Update master summary indicators
  document.getElementById('statActive24h').textContent = active24hCount;
  document.getElementById('statTotal24h').textContent = total24hSubmissions;
  document.getElementById('statTotalSubmissions').textContent = grandTotalSubmissions;
}

// Populate selectors in Details dropdown
function renderFormSelector() {
  const select = document.getElementById('detailsFormSelect');
  if (!select) return;
  select.innerHTML = '';

  appData.registeredForms.forEach(form => {
    const opt = document.createElement('option');
    opt.value = form.id;
    opt.textContent = form.name;
    opt.selected = form.id === appData.selectedFormId;
    select.appendChild(opt);
  });
}

// Render Form Submissions history table
function renderFormDetailsPanel() {
  const select = document.getElementById('detailsFormSelect');
  const tbody = document.getElementById('detailsTableBody');
  if (!tbody) return;

  const formId = select ? select.value : appData.selectedFormId;
  appData.selectedFormId = formId;

  tbody.innerHTML = '';

  if (!formId) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No forms connected / કોઈ લિંક કરેલ ફોર્મ નથી</td></tr>`;
    return;
  }

  const subs = appData.submissions[formId] || [];
  const searchInput = document.getElementById('detailsSearchInput');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  // Filter based on search query
  const filtered = subs.filter(s => (s.email || '').toLowerCase().includes(query));

  // Sort newest first
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No matching records found / કોઈ પરિણામ મળ્યું નથી</td></tr>`;
    return;
  }

  filtered.forEach((sub, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${idx + 1}</strong></td>
      <td>${formatDateTime(sub.timestamp)} <span style="font-size:0.75rem; color:var(--text-muted); margin-left: 8px;">(${getRelativeTimeString(sub.timestamp)})</span></td>
      <td><code>${sub.email}</code></td>
    `;
    tbody.appendChild(tr);
  });
}

// Populate User Report Search Datalist
function populateUserEmailsDatalist() {
  const listEl = document.getElementById('userEmailsList');
  if (!listEl) return;
  listEl.innerHTML = '';
  
  const emails = new Set();
  appData.registeredForms.forEach(form => {
    const list = appData.submissions[form.id] || [];
    list.forEach(sub => {
      if (sub.email && sub.email !== '-') {
        emails.add(sub.email.trim());
      }
    });
  });

  emails.forEach(email => {
    const opt = document.createElement('option');
    opt.value = email;
    listEl.appendChild(opt);
  });
}

// Generate User Report (Filter submissions, timeline, and dynamic form summaries)
function generateUserReport() {
  const input = document.getElementById('userSearchInput');
  let targetEmail = input ? input.value.trim() : 'vanani.dharmesh4848@gmail.com';
  if (!targetEmail) targetEmail = 'vanani.dharmesh4848@gmail.com';

  const titleEl = document.getElementById('userReportTitle');
  if (titleEl) {
    titleEl.textContent = `👤 વપરાશકર્તા રીપોર્ટ: ${targetEmail}`;
  }

  const targetEmailLower = targetEmail.toLowerCase();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let usrActiveFormsCount = 0;
  let usrLast24hCount = 0;
  let usrTotalSubmissionsCount = 0;
  
  const tbodyStats = document.getElementById('userFormStatsTableBody');
  if (tbodyStats) tbodyStats.innerHTML = '';

  const userTimeline = [];

  appData.registeredForms.forEach(form => {
    const formSubmissions = appData.submissions[form.id] || [];
    const userSubsInForm = formSubmissions.filter(sub => (sub.email || '').toLowerCase() === targetEmailLower);
    
    if (userSubsInForm.length > 0) {
      usrActiveFormsCount++;
      usrTotalSubmissionsCount += userSubsInForm.length;
    }

    const user24hInForm = userSubsInForm.filter(sub => sub.timestamp >= oneDayAgo);
    usrLast24hCount += user24hInForm.length;

    // Find last submit time
    let lastTime = null;
    userSubsInForm.forEach(sub => {
      if (!lastTime || sub.timestamp > lastTime) {
        lastTime = sub.timestamp;
      }
    });

    userSubsInForm.forEach(sub => {
      userTimeline.push({
        formName: form.name,
        timestamp: sub.timestamp
      });
    });

    if (tbodyStats) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${form.name}</strong></td>
        <td>${lastTime ? formatDateTime(lastTime) + ` (${getRelativeTimeString(lastTime)})` : '<span class="muted">-</span>'}</td>
        <td>
          <span class="badge ${user24hInForm.length > 0 ? 'badge-success' : 'badge-neutral'}">
            ${user24hInForm.length} times / વાર
          </span>
        </td>
        <td><strong>${userSubsInForm.length}</strong> entries / એન્ટ્રી</td>
      `;
      tbodyStats.appendChild(tr);
    }
  });

  // Render KPIs
  document.getElementById('usrActiveForms').textContent = usrActiveFormsCount;
  document.getElementById('usrLast24h').textContent = usrLast24hCount;
  document.getElementById('usrTotalSubmissions').textContent = usrTotalSubmissionsCount;

  // Render Timeline
  userTimeline.sort((a, b) => b.timestamp - a.timestamp);

  const tbodyTimeline = document.getElementById('userTimelineTableBody');
  if (tbodyTimeline) {
    tbodyTimeline.innerHTML = '';
    if (userTimeline.length === 0) {
      tbodyTimeline.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No submissions found for this user / આ વપરાશકર્તાની કોઈ એન્ટ્રી નથી</td></tr>`;
    } else {
      userTimeline.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td><strong>${item.formName}</strong></td>
          <td>${formatDateTime(item.timestamp)} <span style="font-size:0.75rem; color:var(--text-muted); margin-left: 8px;">(${getRelativeTimeString(item.timestamp)})</span></td>
        `;
        tbodyTimeline.appendChild(tr);
      });
    }
  }
}

// Generate the 24 Hour Leaderboard
function render24hContributors() {
  const tbody = document.getElementById('contributor24hTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const activity = {};

  appData.registeredForms.forEach(form => {
    const list = appData.submissions[form.id] || [];
    list.forEach(sub => {
      if (sub.timestamp >= oneDayAgo && sub.email && sub.email !== '-') {
        const email = sub.email.trim();
        if (!activity[email]) {
          activity[email] = {
            count: 0,
            forms: new Set()
          };
        }
        activity[email].count++;
        activity[email].forms.add(form.id);
      }
    });
  });

  const sorted = Object.keys(activity)
    .map(email => ({
      email: email,
      count: activity[email].count,
      formsCount: activity[email].forms.size
    }))
    .sort((a, b) => b.count - a.count);

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">No active contributors in the last 24h / છેલ્લાં ૨૪ કલાકમાં કોઈ ઓપરેટર એક્ટિવ નથી</td></tr>`;
    return;
  }

  sorted.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${index + 1}</strong></td>
      <td><code>${item.email}</code></td>
      <td>
        <span class="badge badge-success">${item.count} વાર / times</span>
      </td>
      <td><strong>${item.formsCount}</strong> forms / ફોર્મ્સ</td>
    `;
    tbody.appendChild(tr);
  });
}

// Render dynamic forms registry under the Connect tab
function renderActiveConnectionsTable() {
  const tbody = document.getElementById('activeConnectionsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (appData.registeredForms.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">No sheets linked yet / હજુ કોઈ ફોર્મ જોડેલ નથી</td></tr>`;
    return;
  }

  appData.registeredForms.forEach(form => {
    const syncTimeStr = form.lastSync ? formatDateTime(new Date(form.lastSync)) : 'Never / ક્યારેય નહિ';
    const statusBadge = form.status.includes('Success') 
      ? '<span class="badge badge-success">ચાલુ છે (Live)</span>'
      : (form.status.includes('Failed') ? '<span class="badge badge-danger">ભૂલ (Failed)</span>' : '<span class="badge badge-warning">બાકી (Pending)</span>');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${form.name}</strong></td>
      <td>
        <a href="${form.url}" target="_blank" style="color:var(--primary); font-size:0.8rem; word-break:break-all;">🔗 View Sheet</a>
      </td>
      <td>
        ${statusBadge}
        <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">Last Sync: ${syncTimeStr}</div>
      </td>
      <td style="text-align: center;">
        <div class="btn-group no-print" style="display:flex; gap:6px; justify-content:center;">
          <button class="btn btn-secondary btn-sm" onclick="syncGoogleSheet('${form.id}').then(() => { renderActiveConnectionsTable(); renderDashboardTable(); })">🔄 Sync</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBinding('${form.id}')">🗑 Remove</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Re-render Volume and Distribution charts dynamically using Chart.js
function updateAnalyticsCharts() {
  const volCtx = document.getElementById('analyticsVolumeChart');
  const shareCtx = document.getElementById('analyticsShareChart');
  if (!volCtx || !shareCtx) return;

  // Clear existing instances
  if (appData.chartInstanceVolume) appData.chartInstanceVolume.destroy();
  if (appData.chartInstanceShare) appData.chartInstanceShare.destroy();

  const labels = appData.registeredForms.map(f => f.name);
  const dataCounts = appData.registeredForms.map(f => (appData.submissions[f.id] || []).length);

  const colors = [
    '#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4',
    '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7',
    '#b45309', '#d97706', '#f59e0b', '#fbbf24'
  ];

  const isDarkMode = document.body.classList.contains('dark-mode');
  const textColor = isDarkMode ? '#e2e8f0' : '#1e293b';
  const gridColor = isDarkMode ? '#334155' : '#e2e8f0';

  if (labels.length === 0) {
    return;
  }

  // Volume Bar Chart
  appData.chartInstanceVolume = new Chart(volCtx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Submissions Count / એન્ટ્રી સંખ્યા',
        data: dataCounts,
        backgroundColor: '#0d9488',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: false }
      },
      scales: {
        x: {
          ticks: { color: textColor },
          grid: { color: gridColor }
        },
        y: {
          beginAtZero: true,
          ticks: { color: textColor, precision: 0 },
          grid: { color: gridColor }
        }
      }
    }
  });

  // Share percentage Doughnut Chart
  appData.chartInstanceShare = new Chart(shareCtx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataCounts,
        backgroundColor: colors.slice(0, labels.length)
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: textColor }
        }
      }
    }
  });
}

// Toggle Theme (Light vs. Dark Mode)
function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('central_dashboard_darkmode_v3', isDark ? 'true' : 'false');
  updateAnalyticsCharts();
}

// Load theme settings from local storage
function loadThemeFromStorage() {
  const saved = localStorage.getItem('central_dashboard_darkmode_v3');
  if (saved === 'true') {
    document.body.classList.add('dark-mode');
  }
}

// Setup Event Listeners
function initEventBindings() {
  // Details search input logic
  const searchInput = document.getElementById('detailsSearchInput');
  if (searchInput) {
    searchInput.oninput = () => {
      renderFormDetailsPanel();
    };
  }

  // Bind keyup in User search input
  const userSearchInput = document.getElementById('userSearchInput');
  if (userSearchInput) {
    userSearchInput.onkeyup = (e) => {
      if (e.key === 'Enter') {
        generateUserReport();
      }
    };
  }
}

// App Bootstrapper
document.addEventListener('DOMContentLoaded', () => {
  loadThemeFromStorage();
  loadRegistryAndCache(); // Load registered sheets and caches
  initEventBindings();
  
  // Default render
  renderDashboardTable();

  // Background Live Sync on boot
  setTimeout(() => {
    syncAllGoogleSheets();
  }, 1000);

  // Setup periodic sync interval every 60 seconds (Auto-Sync)
  setInterval(() => {
    syncAllGoogleSheets();
  }, 60000);
});
