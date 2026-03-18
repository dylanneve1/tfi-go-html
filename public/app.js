(() => {
  'use strict';

  // Base path detection (works at / or /tfi/ etc)
  const BASE = document.querySelector('base')?.href
    ? new URL(document.querySelector('base').href).pathname.replace(/\/$/, '')
    : window.location.pathname.replace(/\/(index\.html)?$/, '');
  const API = (path) => `${BASE}${path}`;

  // ===== State =====
  const state = {
    currentStop: null,
    departures: [],
    allDepartures: [],
    activeFilters: new Set(),
    favourites: JSON.parse(localStorage.getItem('tfi-favourites') || '[]'),
    refreshTimer: null,
    searchAbort: null,
    activeTab: 'search', // 'search' or 'map'
    map: null,
    mapMarkers: [],
    mapSearchResults: [],
    userLocation: null,
    userLocationMarker: null,
    mapSearchAbort: null,
    areaStops: [],
    areaMarkers: [],
    areaClusterGroup: null,
    areaLoadAbort: null,
    isSearchingMap: false,
    tripDeparture: null,
    vehicleMarkers: [],     // live vehicle position markers
    vehicleInterval: null,  // vehicle tracking interval
  };

  // ===== DOM =====
  const $ = id => document.getElementById(id);
  const el = {
    searchView: $('searchView'),
    departuresView: $('departuresView'),
    searchInput: $('searchInput'),
    clearBtn: $('clearBtn'),
    backBtn: $('backBtn'),
    appTitle: $('appTitle'),
    themeToggle: $('themeToggle'),
    themeIcon: $('themeIcon'),
    nearbySection: $('nearbySection'),
    nearbyList: $('nearbyList'),
    nearbyLoading: $('nearbyLoading'),
    favouritesSection: $('favouritesSection'),
    favouritesList: $('favouritesList'),
    favouritesEmpty: $('favouritesEmpty'),
    resultsSection: $('resultsSection'),
    resultsList: $('resultsList'),
    resultsEmpty: $('resultsEmpty'),
    resultsLoading: $('resultsLoading'),
    depStopName: $('depStopName'),
    depStopId: $('depStopId'),
    depStopIcon: $('depStopIcon'),
    favToggle: $('favToggle'),
    favIcon: $('favIcon'),
    refreshBtn: $('refreshBtn'),
    filterChips: $('filterChips'),
    refreshBar: $('refreshBar'),
    departuresList: $('departuresList'),
    departuresEmpty: $('departuresEmpty'),
    departuresLoading: $('departuresLoading'),
    snackbar: $('snackbar'),
    alertsBanner: $('alertsBanner'),
    alertsText: $('alertsText'),
    alertsDismiss: $('alertsDismiss'),
    facilitiesBanner: $('facilitiesBanner'),
    // Trip map
    tripMapContainer: $('tripMapContainer'),
    tripMap: $('tripMap'),
    tripMapToggle: $('tripMapToggle'),
    tripMapToggleLabel: $('tripMapToggleLabel'),
    // Map elements
    mapView: $('mapView'),
    mapSearchInput: $('mapSearchInput'),
    mapClearBtn: $('mapClearBtn'),
    mapBottomSheet: $('mapBottomSheet'),
    mapResultsList: $('mapResultsList'),
    bottomSheetHandle: $('bottomSheetHandle'),
    // Trip view
    tripView: $('tripView'),
    tripRouteBadge: $('tripRouteBadge'),
    tripDestination: $('tripDestination'),
    tripService: $('tripService'),
    tripStopsList: $('tripStopsList'),
    tripLoading: $('tripLoading'),
    tripEmpty: $('tripEmpty'),
    // Bottom nav
    bottomNav: $('bottomNav'),
    navSearch: $('navSearch'),
    navMap: $('navMap'),
  };

  // ===== Theme =====
  function initTheme() {
    const saved = localStorage.getItem('tfi-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved ? saved === 'dark' : prefersDark;
    setTheme(dark);
  }

  function setTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    el.themeIcon.textContent = dark ? 'light_mode' : 'dark_mode';
    localStorage.setItem('tfi-theme', dark ? 'dark' : 'light');
  }

  el.themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(!isDark);
  });

  // ===== Stop Helpers =====
  function stopTypeIcon(type) {
    const map = {
      'BUS_STOP': 'directions_bus',
      'TRAIN_STATION': 'train',
      'TRAM_STOP': 'tram',
      'TRAM_STOP_AREA': 'tram',
      'COACH_STOP': 'airport_shuttle',
      'FERRY_PORT': 'directions_boat',
    };
    return map[type] || 'place';
  }

  function stopTypeBadge(type) {
    if (type?.includes('TRAIN')) return 'badge-train';
    if (type?.includes('TRAM')) return 'badge-tram';
    if (type?.includes('FERRY')) return 'badge-ferry';
    if (type?.includes('COACH')) return 'badge-coach';
    return 'badge-bus';
  }

  function stopTypeLabel(type) {
    const map = {
      'BUS_STOP': 'Bus Stop',
      'TRAIN_STATION': 'Train Station',
      'TRAM_STOP': 'Luas Stop',
      'TRAM_STOP_AREA': 'Luas Stop',
      'COACH_STOP': 'Coach Stop',
      'FERRY_PORT': 'Ferry Port',
    };
    return map[type] || 'Stop';
  }

  function routeColor(route) {
    const known = {
      'DART': '#00a651',
      'dart': '#00a651',
      'rail': '#5c6bc0',
      'Luas Green': '#00a651',
      'Luas Red': '#e53935',
      'Green': '#00a651',
      'Red': '#e53935',
    };
    if (known[route]) return known[route];
    let hash = 0;
    const s = (route || '').toString();
    for (let i = 0; i < s.length; i++) {
      hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 42%)`;
  }

  // ===== Favourites =====
  function saveFavourites() {
    localStorage.setItem('tfi-favourites', JSON.stringify(state.favourites));
  }

  function isFavourite(stopId) {
    return state.favourites.some(f => f.id === stopId);
  }

  function toggleFavourite(stop) {
    const idx = state.favourites.findIndex(f => f.id === stop.id);
    if (idx >= 0) {
      state.favourites.splice(idx, 1);
      showSnackbar('Removed from favourites');
    } else {
      state.favourites.push({ id: stop.id, name: stop.name, type: stop.type });
      showSnackbar('Added to favourites');
    }
    saveFavourites();
    renderFavourites();
    updateFavButton();
  }

  function renderFavourites() {
    el.favouritesList.innerHTML = '';
    if (state.favourites.length === 0) {
      el.favouritesEmpty.classList.remove('hidden');
      return;
    }
    el.favouritesEmpty.classList.add('hidden');
    state.favourites.forEach(fav => {
      el.favouritesList.appendChild(createStopCard(fav));
    });
  }

  function updateFavButton() {
    if (!state.currentStop) return;
    const fav = isFavourite(state.currentStop.id);
    el.favIcon.textContent = fav ? 'star' : 'star_border';
    el.favToggle.classList.toggle('fav-active', fav);
  }

  // ===== Stop Card =====
  function createStopCard(stop) {
    const card = document.createElement('button');
    card.className = 'stop-card';
    card.innerHTML = `
      <div class="stop-type-badge ${stopTypeBadge(stop.type)}">
        <span class="material-symbols-rounded">${stopTypeIcon(stop.type)}</span>
      </div>
      <div class="stop-details">
        <div class="stop-name">${esc(stop.name)}</div>
        <div class="stop-meta">${stopTypeLabel(stop.type)} · ${esc(stop.id || '')}</div>
      </div>
      <span class="material-symbols-rounded chevron">chevron_right</span>
    `;
    card.addEventListener('click', () => navigateToDepartures(stop));
    return card;
  }

  // ===== Search =====
  let searchTimeout;

  el.searchInput.addEventListener('input', () => {
    const q = el.searchInput.value.trim();
    el.clearBtn.classList.toggle('hidden', !q);
    clearTimeout(searchTimeout);
    if (!q) {
      el.resultsSection.classList.add('hidden');
      el.favouritesSection.classList.remove('hidden');
      return;
    }
    searchTimeout = setTimeout(() => search(q), 300);
  });

  el.clearBtn.addEventListener('click', () => {
    el.searchInput.value = '';
    el.clearBtn.classList.add('hidden');
    el.resultsSection.classList.add('hidden');
    el.favouritesSection.classList.remove('hidden');
    el.searchInput.focus();
  });

  async function search(query) {
    if (state.searchAbort) state.searchAbort.abort();
    state.searchAbort = new AbortController();

    el.resultsSection.classList.remove('hidden');
    el.favouritesSection.classList.add('hidden');
    el.resultsList.innerHTML = '';
    el.resultsEmpty.classList.add('hidden');
    el.resultsLoading.classList.remove('hidden');

    try {
      const params = new URLSearchParams({
        query,
        allowedTypes: 'BUS_STOP,TRAIN_STATION,TRAM_STOP,TRAM_STOP_AREA,COACH_STOP,FERRY_PORT',
        language: 'en',
      });
      const res = await fetch(API(`/api/locationLookup?${params}`), {
        signal: state.searchAbort.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      el.resultsLoading.classList.add('hidden');
      const locations = Array.isArray(data) ? data : (data.locations || []);
      if (locations.length === 0) {
        el.resultsEmpty.classList.remove('hidden');
        return;
      }

      locations.forEach(loc => {
        const stop = {
          id: loc.id || loc.stopId || loc.locationId,
          name: loc.name || loc.stopName || loc.displayName || '',
          type: loc.type || loc.stopType || 'BUS_STOP',
        };
        el.resultsList.appendChild(createStopCard(stop));
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      el.resultsLoading.classList.add('hidden');
      el.resultsEmpty.classList.remove('hidden');
      showSnackbar('Search failed -- check your connection');
      console.error('Search error:', e);
    }
  }

  // ===== Navigation =====
  function navigateToDepartures(stop) {
    history.pushState({ stop }, '', '#' + stop.id);
    showDepartures(stop);
  }

  function showDepartures(stop) {
    state.currentStop = stop;
    state.activeFilters.clear();

    el.searchView.classList.remove('active');
    el.mapView.classList.remove('active');
    el.departuresView.classList.add('active');
    el.backBtn.classList.remove('hidden');
    el.appTitle.textContent = stop.name;
    hideBottomNav();

    el.depStopName.textContent = stop.name;
    el.depStopId.textContent = `${stopTypeLabel(stop.type)} · ${stop.id}`;
    el.depStopIcon.textContent = stopTypeIcon(stop.type);
    updateFavButton();

    el.departuresList.innerHTML = '';
    el.departuresEmpty.classList.add('hidden');
    el.filterChips.innerHTML = '';

    // Hide banners
    if (el.alertsBanner) el.alertsBanner.classList.add('hidden');
    if (el.facilitiesBanner) el.facilitiesBanner.classList.add('hidden');

    loadDepartures();
    loadAlerts(stop);
    loadFacilities(stop);
    startAutoRefresh();
  }

  function goBack() {
    // If we're in trip view, go back to departures
    if (el.tripView.classList.contains('active')) {
      el.tripView.classList.remove('active');
      state.tripDeparture = null;
      stopVehicleTracking();
      if (state.currentStop) {
        el.departuresView.classList.add('active');
        el.appTitle.textContent = state.currentStop.name;
        hideBottomNav();
      }
      return;
    }

    stopAutoRefresh();
    stopVehicleTracking();
    state.currentStop = null;
    el.departuresView.classList.remove('active');
    if (el.alertsBanner) el.alertsBanner.classList.add('hidden');
    if (state.activeTab === 'map') {
      el.mapView.classList.add('active');
      setTimeout(() => state.map && state.map.invalidateSize(), 50);
    } else {
      el.searchView.classList.add('active');
    }
    el.backBtn.classList.add('hidden');
    el.appTitle.textContent = 'TFI Go';
    showBottomNav();
    renderFavourites();
  }

  el.backBtn.addEventListener('click', () => {
    history.back();
  });

  window.addEventListener('popstate', (e) => {
    if (el.tripView.classList.contains('active')) {
      goBack();
    } else if (el.departuresView.classList.contains('active')) {
      goBack();
    } else if (e.state?.trip && e.state?.dep) {
      showTrip(e.state.dep);
    } else if (e.state?.stop) {
      showDepartures(e.state.stop);
    }
  });

  el.favToggle.addEventListener('click', () => {
    if (state.currentStop) toggleFavourite(state.currentStop);
  });

  el.refreshBtn.addEventListener('click', () => {
    loadDepartures();
    resetRefreshTimer();
  });

  // ===== Service Alerts =====
  async function loadAlerts(stop) {
    if (!el.alertsBanner) return;
    try {
      const res = await fetch(API('/api/situations/stops'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idList: [stop.id] }),
      });
      if (!res.ok) return;
      const data = await res.json();

      const allSituations = [];
      (Array.isArray(data) ? data : []).forEach(item => {
        (item.situations || []).forEach(sit => {
          allSituations.push(sit.title || sit.details || 'Service disruption');
        });
      });

      if (allSituations.length > 0) {
        el.alertsText.textContent = allSituations.join(' • ');
        el.alertsBanner.classList.remove('hidden');
      }
    } catch (e) {
      // Silently ignore alert errors
    }
  }

  if (el.alertsDismiss) {
    el.alertsDismiss.addEventListener('click', () => {
      el.alertsBanner.classList.add('hidden');
    });
  }

  // ===== Stop Facilities =====
  const facilityIcons = {
    'SHELTER': { icon: 'night_shelter', label: 'Shelter' },
    'TOILETS': { icon: 'wc', label: 'Toilets' },
    'TICKET_OFFICE': { icon: 'confirmation_number', label: 'Tickets' },
    'CAR_PARK': { icon: 'local_parking', label: 'Parking' },
    'WHEELCHAIR_ACCESS': { icon: 'accessible', label: 'Accessible' },
    'BIKE_PARK': { icon: 'pedal_bike', label: 'Bike Park' },
    'WAITING_ROOM': { icon: 'weekend', label: 'Waiting Room' },
    'WIFI': { icon: 'wifi', label: 'WiFi' },
    'ATM': { icon: 'atm', label: 'ATM' },
    'SHOP': { icon: 'shopping_bag', label: 'Shop' },
    'CAFE': { icon: 'coffee', label: 'Café' },
    'LIFT': { icon: 'elevator', label: 'Lift' },
    'TAXI_RANK': { icon: 'local_taxi', label: 'Taxi' },
  };

  async function loadFacilities(stop) {
    if (!el.facilitiesBanner) return;
    try {
      const res = await fetch(API('/api/stopsAssets'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idList: [stop.id] }),
      });
      if (!res.ok) return;
      const data = await res.json();

      const assets = [];
      (Array.isArray(data) ? data : []).forEach(item => {
        (item.assets || []).forEach(asset => {
          const type = asset.assetType?.toUpperCase() || '';
          if (facilityIcons[type]) {
            assets.push(facilityIcons[type]);
          }
        });
      });

      if (assets.length > 0) {
        el.facilitiesBanner.innerHTML = assets.map(a =>
          `<div class="facility-chip">
            <span class="material-symbols-rounded">${a.icon}</span>
            <span>${a.label}</span>
          </div>`
        ).join('');
        el.facilitiesBanner.classList.remove('hidden');
      }
    } catch (e) {
      // Silently ignore
    }
  }

  // ===== Load Departures =====
  async function loadDepartures() {
    if (!state.currentStop) return;
    const stop = state.currentStop;

    el.departuresLoading.classList.remove('hidden');
    el.departuresEmpty.classList.add('hidden');
    el.refreshBtn.classList.add('refreshing');

    const now = new Date();
    // Build local ISO string with correct timezone offset for TFI API
    const tzOffsetMin = now.getTimezoneOffset(); // 0 for GMT, -60 for IST (UTC+1)
    const sign = tzOffsetMin <= 0 ? '+' : '-';
    const absMin = Math.abs(tzOffsetMin);
    const tzHH = String(Math.floor(absMin / 60)).padStart(2, '0');
    const tzMM = String(absMin % 60).padStart(2, '0');
    const tzStr = `${sign}${tzHH}:${tzMM}`;
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.000${tzStr}`;

    const body = {
      clientTimeZoneOffsetInMS: -tzOffsetMin * 60 * 1000,
      departureDate: iso,
      departureTime: iso,
      stopIds: [stop.id],
      stopType: stop.type,
      stopName: stop.name,
      requestTime: iso,
      departureOrArrival: 'DEPARTURE',
      refresh: false,
    };

    try {
      const res = await fetch(API('/api/departures'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      el.departuresLoading.classList.add('hidden');
      el.refreshBtn.classList.remove('refreshing');

      if (data.errorMessage) {
        el.departuresEmpty.classList.remove('hidden');
        showSnackbar(data.errorMessage);
        return;
      }

      let deps = [];
      if (Array.isArray(data.stopDepartures)) {
        deps = data.stopDepartures;
      } else if (Array.isArray(data)) {
        deps = data;
      }

      deps = deps.filter(d => !d.cancelled);

      state.allDepartures = deps;
      buildFilterChips(deps);
      applyFilters();
    } catch (e) {
      el.departuresLoading.classList.add('hidden');
      el.refreshBtn.classList.remove('refreshing');
      showSnackbar('Failed to load departures');
      console.error('Departures error:', e);
    }
  }

  // ===== Filter Chips =====
  function buildFilterChips(deps) {
    const routes = [...new Set(deps.map(d => d.serviceNumber || '').filter(Boolean))].sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

    el.filterChips.innerHTML = '';
    if (routes.length <= 1) return;

    routes.forEach(r => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (state.activeFilters.has(r) ? ' active' : '');
      chip.textContent = r;
      chip.addEventListener('click', () => {
        if (state.activeFilters.has(r)) {
          state.activeFilters.delete(r);
          chip.classList.remove('active');
        } else {
          state.activeFilters.add(r);
          chip.classList.add('active');
        }
        applyFilters();
      });
      el.filterChips.appendChild(chip);
    });
  }

  function applyFilters() {
    let deps = state.allDepartures;
    if (state.activeFilters.size > 0) {
      deps = deps.filter(d => state.activeFilters.has(d.serviceNumber || ''));
    }
    state.departures = deps;
    renderDepartures(deps);
  }

  // ===== Render Departures =====
  function renderDepartures(deps) {
    el.departuresList.innerHTML = '';
    if (deps.length === 0) {
      el.departuresEmpty.classList.remove('hidden');
      return;
    }
    el.departuresEmpty.classList.add('hidden');

    deps.forEach((dep, i) => {
      const card = document.createElement('div');
      card.className = 'departure-card';
      card.style.animationDelay = `${i * 0.03}s`;

      const route = dep.serviceNumber || '?';
      const destination = dep.destination || 'Unknown';
      const operatorName = dep.operator?.operatorName || '';
      const serviceName = dep.serviceDisplayName || '';

      const realTime = dep.realTimeDeparture;
      const scheduled = dep.scheduledDeparture;
      const depTimeStr = realTime || scheduled || '';
      const isRealtime = !!realTime && realTime !== scheduled;

      let timeDisplay = '';
      let timeClass = '';
      let timeLabel = '';
      let scheduledStr = '';
      let isDelayed = false;

      if (depTimeStr) {
        const dt = new Date(depTimeStr);
        const now = new Date();
        const diffMs = dt - now;
        const diffMins = Math.round(diffMs / 60000);

        if (diffMins <= 0) {
          timeDisplay = 'Due';
          timeClass = 'due';
        } else if (diffMins <= 60) {
          timeDisplay = `${diffMins}`;
          timeLabel = 'min';
        } else {
          timeDisplay = dt.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
      }

      if (realTime && scheduled && realTime !== scheduled) {
        const st = new Date(scheduled);
        scheduledStr = st.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });
        isDelayed = new Date(realTime) > st;
      }

      const subtitle = serviceName || operatorName;

      card.innerHTML = `
        <div class="route-badge" style="background:${routeColor(route)}">${esc(route)}</div>
        <div class="dep-details">
          <div class="dep-destination">${isRealtime ? '<span class="dep-realtime-dot" title="Real-time data"></span>' : ''}${esc(destination)}</div>
          ${subtitle ? `<div class="dep-operator">${esc(subtitle)}</div>` : ''}
        </div>
        <div class="dep-time-container">
          <div class="dep-time ${timeClass}">${timeDisplay}</div>
          ${timeLabel ? `<div class="dep-time-label">${timeLabel}</div>` : ''}
          ${scheduledStr ? `<div class="dep-scheduled ${isDelayed ? 'dep-delayed' : ''}">Sched. ${scheduledStr}</div>` : ''}
        </div>
        <span class="material-symbols-rounded chevron" style="color:var(--md-on-surface-variant);font-size:20px;flex-shrink:0">chevron_right</span>
      `;
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => navigateToTrip(dep));
      el.departuresList.appendChild(card);
    });
  }

  // ===== Auto-refresh =====
  function startAutoRefresh() {
    stopAutoRefresh();
    resetRefreshTimer();
  }

  function resetRefreshTimer() {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);

    el.refreshBar.style.transition = 'none';
    el.refreshBar.style.transform = 'scaleX(1)';
    void el.refreshBar.offsetHeight;
    el.refreshBar.style.transition = 'transform 30s linear';
    el.refreshBar.style.transform = 'scaleX(0)';

    state.refreshTimer = setTimeout(() => {
      loadDepartures();
      resetRefreshTimer();
    }, 30000);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  // ===== Snackbar =====
  let snackbarTimeout;
  function showSnackbar(msg) {
    clearTimeout(snackbarTimeout);
    el.snackbar.textContent = msg;
    el.snackbar.classList.add('show');
    snackbarTimeout = setTimeout(() => el.snackbar.classList.remove('show'), 3000);
  }

  // ===== Utils =====
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ===== Bottom Navigation =====
  function switchTab(tab) {
    state.activeTab = tab;
    el.navSearch.classList.toggle('active', tab === 'search');
    el.navMap.classList.toggle('active', tab === 'map');

    el.searchView.classList.toggle('active', tab === 'search');
    el.mapView.classList.toggle('active', tab === 'map');

    if (tab === 'map') {
      initMap();
      setTimeout(() => state.map && state.map.invalidateSize(), 50);
    }
  }

  function showBottomNav() {
    el.bottomNav.classList.remove('hidden');
    document.body.classList.add('has-bottom-nav');
  }

  function hideBottomNav() {
    el.bottomNav.classList.add('hidden');
    document.body.classList.remove('has-bottom-nav');
  }

  el.navSearch.addEventListener('click', () => switchTab('search'));
  el.navMap.addEventListener('click', () => switchTab('map'));

  // ===== Map =====
  function initMap() {
    if (state.map) return;

    state.map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
    }).setView([53.3498, -6.2603], 14);

    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(state.map);

    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('&copy; <a href="https://openstreetmap.org/copyright">OSM</a>')
      .addTo(state.map);

    // Marker cluster group for area stops — huge perf boost
    state.areaClusterGroup = L.markerClusterGroup({
      maxClusterRadius: 45,
      disableClusteringAtZoom: 17,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 10,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        let size = 'small';
        if (count >= 50) size = 'large';
        else if (count >= 20) size = 'medium';
        return L.divIcon({
          html: `<div class="cluster-marker cluster-${size}"><span>${count}</span></div>`,
          className: '',
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });
      },
    });
    state.map.addLayer(state.areaClusterGroup);

    let areaLoadTimeout;
    state.map.on('moveend', () => {
      if (state.isSearchingMap) return;
      clearTimeout(areaLoadTimeout);
      areaLoadTimeout = setTimeout(() => loadAreaStops(), 500);
    });

    // Locate me button
    const locateBtn = document.getElementById('locateMeBtn');
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        if (state.userLocation) {
          state.map.setView(state.userLocation, 16, { animate: true });
        } else {
          requestUserLocation();
        }
      });
    }

    requestUserLocation();
    setTimeout(() => loadAreaStops(), 300);
  }

  function requestUserLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLocation = [pos.coords.latitude, pos.coords.longitude];
        if (state.map) {
          state.map.setView(state.userLocation, 15);
          showUserLocationMarker();
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function showUserLocationMarker() {
    if (!state.map || !state.userLocation) return;
    if (state.userLocationMarker) {
      state.userLocationMarker.setLatLng(state.userLocation);
      return;
    }
    const icon = L.divIcon({
      className: 'user-location-marker',
      html: '<div class="user-location-dot"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    state.userLocationMarker = L.marker(state.userLocation, { icon, interactive: false }).addTo(state.map);
  }

  // ===== Area Stops (native TFI API) =====
  function showMapLoading(show) {
    let indicator = document.getElementById('mapLoadingIndicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'mapLoadingIndicator';
      indicator.className = 'map-loading';
      indicator.innerHTML = '<div class="map-loading-bar"></div>';
      const mapContainer = document.getElementById('mapView');
      if (mapContainer) mapContainer.appendChild(indicator);
    }
    indicator.classList.toggle('active', show);
  }

  async function loadAreaStops() {
    if (!state.map) return;
    const zoom = state.map.getZoom();
    if (zoom < 13) {
      clearAreaMarkers();
      return;
    }

    const bounds = state.map.getBounds();
    const south = bounds.getSouth().toFixed(5);
    const west = bounds.getWest().toFixed(5);
    const north = bounds.getNorth().toFixed(5);
    const east = bounds.getEast().toFixed(5);

    if (state.areaLoadAbort) state.areaLoadAbort.abort();
    state.areaLoadAbort = new AbortController();

    showMapLoading(true);

    try {
      const res = await fetch(API(`/api/stops?south=${south}&west=${west}&north=${north}&east=${east}`), {
        signal: state.areaLoadAbort.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stops = await res.json();

      state.areaStops = stops;
      renderAreaMarkers(stops);
      showMapLoading(false);
    } catch (e) {
      showMapLoading(false);
      if (e.name === 'AbortError') return;
      console.error('Area stops load error:', e);
    }
  }

  function clearAreaMarkers() {
    if (state.areaClusterGroup) {
      state.areaClusterGroup.clearLayers();
    }
    state.areaMarkers = [];
  }

  function renderAreaMarkers(stops) {
    clearAreaMarkers();
    const markers = [];
    stops.forEach(stop => {
      if (!stop.lat || !stop.lon) return;
      const marker = L.marker([stop.lat, stop.lon], {
        icon: createMapMarkerIcon(stop.type),
      });

      const popupContent = `
        <div class="map-popup">
          <div class="map-popup-name">${esc(stop.name)}</div>
          <div class="map-popup-type">${stopTypeLabel(stop.type)}${stop.ref ? ` · ${esc(stop.ref)}` : ''}</div>
          <button class="map-popup-btn" onclick="window.__tfiViewStop__('${esc(stop.id)}', '${esc(stop.name)}', '${esc(stop.type)}')">
            <span class="material-symbols-rounded">departure_board</span>
            View departures
          </button>
        </div>
      `;
      marker.bindPopup(popupContent, { closeButton: false, maxWidth: 240 });
      markers.push(marker);
    });

    if (state.areaClusterGroup) {
      state.areaClusterGroup.addLayers(markers);
    }
    state.areaMarkers = markers;
  }

  // Direct stop navigation — no more searching by name!
  window.__tfiViewStop__ = (id, name, type) => {
    navigateToDepartures({ id, name, type });
  };

  // ===== Live Vehicle Tracking =====
  function clearVehicleMarkers() {
    state.vehicleMarkers.forEach(m => state.map && state.map.removeLayer(m));
    state.vehicleMarkers = [];
  }

  function stopVehicleTracking() {
    if (state.vehicleInterval) {
      clearInterval(state.vehicleInterval);
      state.vehicleInterval = null;
    }
    clearVehicleMarkers();
  }

  async function loadVehiclePositions(serviceRef, direction) {
    if (!state.map) return;
    try {
      const res = await fetch(API('/api/vehicleLocation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceReference: serviceRef, direction: direction || 'OUTBOUND' }),
      });
      if (!res.ok) return;
      const data = await res.json();

      clearVehicleMarkers();
      const vehicles = data.vehicleLocations || [];
      vehicles.forEach(v => {
        if (!v.coordinate) return;
        const icon = L.divIcon({
          className: 'vehicle-marker-container',
          html: `<div class="vehicle-marker" style="transform:rotate(${v.bearing || 0}deg)">
            <span class="material-symbols-rounded">directions_bus</span>
          </div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const marker = L.marker([v.coordinate.latitude, v.coordinate.longitude], { icon })
          .addTo(state.map);
        state.vehicleMarkers.push(marker);
      });
    } catch (e) {
      console.error('Vehicle position error:', e);
    }
  }

  // ===== Map Markers =====
  function markerColorClass(type) {
    if (type?.includes('TRAIN')) return 'map-marker-train';
    if (type?.includes('TRAM')) return 'map-marker-tram';
    if (type?.includes('FERRY')) return 'map-marker-ferry';
    if (type?.includes('COACH')) return 'map-marker-coach';
    if (type?.includes('BUS')) return 'map-marker-bus';
    return 'map-marker-default';
  }

  function createMapMarkerIcon(type) {
    const colorClass = markerColorClass(type);
    return L.divIcon({
      className: '',
      html: `<div class="map-marker ${colorClass}"><span class="material-symbols-rounded">${stopTypeIcon(type)}</span></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
    });
  }

  function clearMapMarkers() {
    state.mapMarkers.forEach(m => state.map.removeLayer(m));
    state.mapMarkers = [];
  }

  function addMapMarkers(stops) {
    clearMapMarkers();
    const bounds = [];
    stops.forEach(stop => {
      if (!stop.lat || !stop.lon) return;
      const marker = L.marker([stop.lat, stop.lon], {
        icon: createMapMarkerIcon(stop.type),
      }).addTo(state.map);

      const popupContent = `
        <div class="map-popup">
          <div class="map-popup-name">${esc(stop.name)}</div>
          <div class="map-popup-type">${stopTypeLabel(stop.type)} &middot; ${esc(stop.id)}</div>
          <button class="map-popup-btn" onclick="window.__tfiViewStop__('${esc(stop.id)}', '${esc(stop.name)}', '${esc(stop.type)}')">
            <span class="material-symbols-rounded">departure_board</span>
            View departures
          </button>
        </div>
      `;
      marker.bindPopup(popupContent, { closeButton: false, maxWidth: 240 });
      state.mapMarkers.push(marker);
      bounds.push([stop.lat, stop.lon]);
    });

    if (bounds.length > 1) {
      state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else if (bounds.length === 1) {
      state.map.setView(bounds[0], 16);
    }
  }

  // ===== Map Search =====
  let mapSearchTimeout;

  el.mapSearchInput.addEventListener('input', () => {
    const q = el.mapSearchInput.value.trim();
    el.mapClearBtn.classList.toggle('hidden', !q);
    clearTimeout(mapSearchTimeout);
    if (!q) {
      clearMapMarkers();
      el.mapBottomSheet.classList.remove('visible');
      state.mapSearchResults = [];
      state.isSearchingMap = false;
      renderAreaMarkers(state.areaStops);
      return;
    }
    state.isSearchingMap = true;
    clearAreaMarkers();
    mapSearchTimeout = setTimeout(() => mapSearch(q), 300);
  });

  el.mapClearBtn.addEventListener('click', () => {
    el.mapSearchInput.value = '';
    el.mapClearBtn.classList.add('hidden');
    clearMapMarkers();
    el.mapBottomSheet.classList.remove('visible');
    state.mapSearchResults = [];
    state.isSearchingMap = false;
    renderAreaMarkers(state.areaStops);
    el.mapSearchInput.focus();
  });

  async function mapSearch(query) {
    if (state.mapSearchAbort) state.mapSearchAbort.abort();
    state.mapSearchAbort = new AbortController();

    try {
      const params = new URLSearchParams({
        query,
        allowedTypes: 'BUS_STOP,TRAIN_STATION,TRAM_STOP,TRAM_STOP_AREA,COACH_STOP,FERRY_PORT',
        language: 'en',
      });
      const res = await fetch(API(`/api/locationLookup?${params}`), {
        signal: state.mapSearchAbort.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const locations = Array.isArray(data) ? data : (data.locations || []);
      const stops = locations.map(loc => ({
        id: loc.id || loc.stopId || loc.locationId,
        name: loc.name || loc.stopName || loc.displayName || '',
        type: loc.type || loc.stopType || 'BUS_STOP',
        lat: loc.coordinate?.latitude || null,
        lon: loc.coordinate?.longitude || null,
      }));

      state.mapSearchResults = stops;
      addMapMarkers(stops);

      el.mapResultsList.innerHTML = '';
      if (stops.length > 0) {
        stops.forEach(stop => {
          el.mapResultsList.appendChild(createStopCard(stop));
        });
        el.mapBottomSheet.classList.add('visible');
      } else {
        el.mapBottomSheet.classList.remove('visible');
        showSnackbar('No stops found');
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      showSnackbar('Map search failed');
      console.error('Map search error:', e);
    }
  }

  // ===== Trip Details =====
  function navigateToTrip(dep) {
    history.pushState({ trip: true, dep }, '', '#trip');
    showTrip(dep);
  }

  function showTrip(dep) {
    state.tripDeparture = dep;
    stopVehicleTracking();

    el.departuresView.classList.remove('active');
    el.searchView.classList.remove('active');
    el.mapView.classList.remove('active');
    el.tripView.classList.add('active');
    hideBottomNav();

    const route = dep.serviceNumber || '?';
    const destination = dep.destination || 'Unknown';
    const serviceName = dep.serviceDisplayName || dep.operator?.operatorName || '';

    el.tripRouteBadge.textContent = route;
    el.tripRouteBadge.style.background = routeColor(route);
    el.tripDestination.textContent = destination;
    el.tripService.textContent = serviceName;
    el.appTitle.textContent = `${route} → ${destination}`;

    el.tripStopsList.innerHTML = '';
    el.tripLoading.classList.remove('hidden');
    el.tripEmpty.classList.add('hidden');

    // Reset trip map
    if (el.tripMapContainer) {
      el.tripMapContainer.classList.add('hidden');
      state.tripMapExpanded = false;
      if (el.tripMapToggleLabel) el.tripMapToggleLabel.textContent = 'Show live map';
    }
    if (state.tripMap) {
      state.tripMap.remove();
      state.tripMap = null;
    }

    loadTripDetails(dep);
  }

  async function loadTripDetails(dep) {
    const vehicle = dep.vehicle;
    const hasRealtime = vehicle && vehicle.dataFrameRef && vehicle.datedVehicleJourneyRef;

    if (hasRealtime) {
      // Try real-time estimated timetable first
      try {
        const res = await fetch(API('/api/estimatedTimetable'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataFrameRef: vehicle.dataFrameRef,
            datedVehicleJourneyRef: vehicle.datedVehicleJourneyRef,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.rows && data.rows.length > 0) {
          el.tripLoading.classList.add('hidden');
          renderTripStops(data);
          startTripTracking(dep, data);
          return;
        }
      } catch (e) {
        console.error('Estimated timetable error:', e);
      }
    }

    // Fallback: try scheduled timetable
    const serviceRef = dep.serviceReference || dep.vehicle?.lineRef;
    if (serviceRef) {
      try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00.000+00:00`;

        const res = await fetch(API('/api/timetable'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientTimeZoneOffsetInMS: 0,
            timetableDirection: dep.direction || 'OUTBOUND',
            timetableId: serviceRef,
            maxColumnsToFetch: 3,
            dateAndTime: dateStr,
            includeNonTimingPoints: true,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.rows && data.rows.length > 0) {
          el.tripLoading.classList.add('hidden');
          renderTripStops(data, true); // true = scheduled only
          startTripTracking(dep, data);
          return;
        }
      } catch (e) {
        console.error('Scheduled timetable error:', e);
      }
    }

    el.tripLoading.classList.add('hidden');
    el.tripEmpty.classList.remove('hidden');
  }

  // ===== Trip Live Map =====
  function startTripTracking(dep, timetableData) {
    const serviceRef = dep.vehicle?.lineRef || dep.serviceReference;
    if (!serviceRef) return;

    // Show the map toggle button
    if (el.tripMapContainer) {
      el.tripMapContainer.classList.remove('hidden');
    }

    // Store trip data for map rendering
    state.tripTimetableData = timetableData;
    state.tripServiceRef = serviceRef;

    // Set up toggle
    if (el.tripMapToggle && !el.tripMapToggle._bound) {
      el.tripMapToggle._bound = true;
      el.tripMapToggle.addEventListener('click', () => {
        state.tripMapExpanded = !state.tripMapExpanded;
        const mapEl = el.tripMap;
        if (state.tripMapExpanded) {
          mapEl.style.display = 'block';
          el.tripMapToggleLabel.textContent = 'Hide live map';
          setTimeout(() => initTripMap(), 50);
        } else {
          mapEl.style.display = 'none';
          el.tripMapToggleLabel.textContent = 'Show live map';
          stopVehicleTracking();
        }
      });
    }
  }

  function initTripMap() {
    if (state.tripMap) {
      state.tripMap.invalidateSize();
      updateTripMapVehicles();
      return;
    }

    state.tripMap = L.map('tripMap', {
      zoomControl: false,
      attributionControl: false,
    }).setView([53.3498, -6.2603], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(state.tripMap);

    // Plot route stops on mini-map
    const data = state.tripTimetableData;
    if (data?.rows) {
      const coords = [];
      data.rows.forEach(row => {
        if (row.coordinate) {
          const lat = row.coordinate.latitude;
          const lon = row.coordinate.longitude;
          coords.push([lat, lon]);
          // Small circle marker for each stop
          L.circleMarker([lat, lon], {
            radius: 5,
            fillColor: '#00B74F',
            color: '#fff',
            weight: 2,
            fillOpacity: 0.9,
          }).addTo(state.tripMap);
        }
      });

      // Draw route polyline
      if (coords.length > 1) {
        L.polyline(coords, {
          color: '#00B74F',
          weight: 3,
          opacity: 0.6,
          dashArray: '8, 8',
        }).addTo(state.tripMap);
        state.tripMap.fitBounds(coords, { padding: [30, 30] });
      }
    }

    // Load vehicles immediately and start interval
    updateTripMapVehicles();
    state.vehicleInterval = setInterval(() => updateTripMapVehicles(), 10000);
  }

  async function updateTripMapVehicles() {
    if (!state.tripMap || !state.tripServiceRef) return;
    try {
      const res = await fetch(API('/api/vehicleLocation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceReference: state.tripServiceRef, direction: 'OUTBOUND' }),
      });
      if (!res.ok) return;
      const data = await res.json();

      // Clear old vehicle markers on trip map
      clearVehicleMarkers();

      const vehicles = data.vehicleLocations || [];
      vehicles.forEach(v => {
        if (!v.coordinate) return;
        const icon = L.divIcon({
          className: 'vehicle-marker-container',
          html: `<div class="vehicle-marker">
            <span class="material-symbols-rounded">directions_bus</span>
          </div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const marker = L.marker([v.coordinate.latitude, v.coordinate.longitude], { icon })
          .addTo(state.tripMap);
        state.vehicleMarkers.push(marker);
      });
    } catch (e) {
      console.error('Trip vehicle update error:', e);
    }
  }

  function renderTripStops(data, scheduledOnly) {
    el.tripStopsList.innerHTML = '';
    const rows = data.rows || [];
    const column = (data.columns && data.columns[0]) || {};
    const events = column.events || {};
    const now = new Date();

    let currentIdx = -1;
    const currentStopId = state.currentStop?.id;

    rows.forEach((row, i) => {
      const evt = events[String(row.rowIndex)] || events[String(i)];
      if (evt) {
        const t = new Date(evt.realTimeOfEvent || evt.timeOfEvent);
        if (t <= now) currentIdx = i;
      }
      if (currentStopId && row.stopReference === currentStopId) {
        currentIdx = i;
      }
    });

    rows.forEach((row, i) => {
      const evt = events[String(row.rowIndex)] || events[String(i)] || {};
      const isPast = i < currentIdx;
      const isCurrent = i === currentIdx;

      const stopEl = document.createElement('div');
      stopEl.className = `trip-stop ${isPast ? 'past' : isCurrent ? 'current' : 'future'}`;

      let timeHtml = '';
      const scheduled = evt.timeOfEvent;
      const realtime = evt.realTimeOfEvent;

      if (scheduled) {
        const schedTime = new Date(scheduled);
        const schedStr = schedTime.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });

        if (realtime && realtime !== scheduled) {
          const rtTime = new Date(realtime);
          const rtStr = rtTime.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });
          const isDelayed = rtTime > schedTime;
          timeHtml = `
            <div class="trip-stop-time-realtime">
              <span class="dep-realtime-dot"></span>
              <span class="trip-stop-time ${isDelayed ? 'trip-stop-time-delayed' : ''}">${rtStr}</span>
            </div>
            <div class="trip-stop-time-scheduled">${schedStr}</div>
          `;
        } else {
          timeHtml = `<div class="trip-stop-time">${schedStr}</div>`;
        }
      }

      const stopName = row.stopName || 'Unknown';
      const stopRef = row.shortCode || row.stopReference || '';

      stopEl.innerHTML = `
        <div class="trip-stop-timeline">
          <div class="trip-stop-line trip-stop-line-top"></div>
          <div class="trip-stop-dot"></div>
          <div class="trip-stop-line trip-stop-line-bottom"></div>
        </div>
        <div class="trip-stop-content" data-stop-ref="${esc(row.stopReference || '')}" data-stop-name="${esc(stopName)}" data-stop-type="${esc(row.type || 'BUS_STOP')}">
          <div class="trip-stop-details">
            <div class="trip-stop-name">${esc(stopName)}</div>
            ${stopRef ? `<div class="trip-stop-ref">${esc(stopRef)}</div>` : ''}
          </div>
          <div class="trip-stop-times">
            ${timeHtml}
          </div>
        </div>
      `;

      const content = stopEl.querySelector('.trip-stop-content');
      content.addEventListener('click', () => {
        const ref = content.dataset.stopRef;
        const name = content.dataset.stopName;
        const type = content.dataset.stopType;
        if (ref) {
          navigateToDepartures({ id: ref, name, type });
        }
      });

      el.tripStopsList.appendChild(stopEl);
    });

    // Scroll current stop into view
    setTimeout(() => {
      const currentEl = el.tripStopsList.querySelector('.trip-stop.current');
      if (currentEl) {
        currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  // Bottom sheet drag-to-dismiss
  let sheetDragStart = null;

  el.bottomSheetHandle.addEventListener('touchstart', (e) => {
    sheetDragStart = e.touches[0].clientY;
    el.mapBottomSheet.style.transition = 'none';
  });

  el.bottomSheetHandle.addEventListener('touchmove', (e) => {
    if (sheetDragStart === null) return;
    const dy = e.touches[0].clientY - sheetDragStart;
    if (dy > 0) {
      el.mapBottomSheet.style.transform = `translateY(${dy}px)`;
    }
  });

  el.bottomSheetHandle.addEventListener('touchend', (e) => {
    if (sheetDragStart === null) return;
    el.mapBottomSheet.style.transition = '';
    const dy = e.changedTouches[0].clientY - sheetDragStart;
    if (dy > 80) {
      el.mapBottomSheet.classList.remove('visible');
      el.mapBottomSheet.style.transform = '';
    } else {
      el.mapBottomSheet.style.transform = '';
    }
    sheetDragStart = null;
  });

  // ===== Nearby Stops =====
  function loadNearbyStops() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        state.userLocation = [lat, lon];

        // Show section and loading
        el.nearbySection.classList.remove('hidden');
        el.nearbyLoading.classList.remove('hidden');
        el.nearbyList.innerHTML = '';

        // Use native TFI API with small bounding box (~500m radius)
        const delta = 0.005; // ~500m
        try {
          const res = await fetch(API(`/api/stops?south=${lat-delta}&west=${lon-delta}&north=${lat+delta}&east=${lon+delta}`));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const stops = await res.json();

          el.nearbyLoading.classList.add('hidden');

          if (stops.length === 0) {
            el.nearbySection.classList.add('hidden');
            return;
          }

          // Sort by distance
          const withDist = stops.map(s => ({
            ...s,
            dist: haversine(lat, lon, s.lat, s.lon),
          })).sort((a, b) => a.dist - b.dist).slice(0, 8);

          withDist.forEach(stop => {
            const card = createStopCard(stop);
            // Add distance badge
            const distText = stop.dist < 1000
              ? `${Math.round(stop.dist)}m`
              : `${(stop.dist / 1000).toFixed(1)}km`;
            const meta = card.querySelector('.stop-meta');
            if (meta) meta.textContent += ` · ${distText}`;
            el.nearbyList.appendChild(card);
          });
        } catch (e) {
          el.nearbyLoading.classList.add('hidden');
          console.error('Nearby stops error:', e);
        }
      },
      () => {
        // Geolocation denied/unavailable — hide section
        el.nearbySection.classList.add('hidden');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Quick departure preview on nearby stop cards
  async function loadQuickDepartures(stop, card) {
    try {
      const now = new Date();
      const tzOffsetMin = now.getTimezoneOffset();
      const sign = tzOffsetMin <= 0 ? '+' : '-';
      const absMin = Math.abs(tzOffsetMin);
      const tzHH = String(Math.floor(absMin / 60)).padStart(2, '0');
      const tzMM = String(absMin % 60).padStart(2, '0');
      const tzStr = `${sign}${tzHH}:${tzMM}`;
      const pad = (n) => String(n).padStart(2, '0');
      const iso = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.000${tzStr}`;

      const res = await fetch(API('/api/departures'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientTimeZoneOffsetInMS: -tzOffsetMin * 60 * 1000,
          departureDate: iso, departureTime: iso, requestTime: iso,
          stopIds: [stop.id], stopType: stop.type, stopName: stop.name,
          departureOrArrival: 'DEPARTURE', refresh: false,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();

      let deps = (data.stopDepartures || []).filter(d => !d.cancelled);
      // Take next 3 departures
      deps = deps.slice(0, 3);
      if (deps.length === 0) return;

      const preview = document.createElement('div');
      preview.className = 'quick-departures';
      deps.forEach(dep => {
        const route = dep.serviceNumber || '?';
        const dest = dep.destination || '';
        const timeStr = dep.realTimeDeparture || dep.scheduledDeparture || '';
        let display = '';
        if (timeStr) {
          const dt = new Date(timeStr);
          const diffMins = Math.round((dt - new Date()) / 60000);
          display = diffMins <= 0 ? 'Due' : diffMins <= 60 ? `${diffMins}m` : dt.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        const chip = document.createElement('div');
        chip.className = 'quick-dep-chip';
        chip.innerHTML = `<span class="quick-dep-route" style="background:${routeColor(route)}">${esc(route)}</span><span class="quick-dep-dest">${esc(dest)}</span><span class="quick-dep-time">${display}</span>`;
        preview.appendChild(chip);
      });

      // Insert before the chevron
      const chevron = card.querySelector('.chevron');
      card.querySelector('.stop-details').appendChild(preview);
    } catch (e) {
      // Silently ignore
    }
  }

  // Haversine distance in meters
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ===== Init =====
  initTheme();
  renderFavourites();
  showBottomNav();
  loadNearbyStops();

  if (window.innerWidth > 600) {
    setTimeout(() => el.searchInput.focus(), 300);
  }
})();
