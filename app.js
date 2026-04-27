// EuropeEx — Interactive Europe Region Explorer
// All state is encoded in the URL hash

(function() {
  'use strict';

  // ── Color scheme ──────────────────────────────────────────
  const COLORS = {
    0: '#ffffff',
    1: '#3598db',
    2: '#30cc70',
    3: '#f3c218',
    4: '#d58337',
    5: '#e84c3d'
  };

  // ── State ─────────────────────────────────────────────────
  const state = {};          // regionId → level (0-5)
  let currentLang = 'en';    // 'en' or 'local'
  let authorName = '';
  let currentRegion = null;  // currently selected region id
  let geoData = null;        // loaded topojson/geojson
  let regionLookup = {};     // regionId → {en, local, countryIso, countryEn}
  let countryGeometries = {};// iso → merged geometry for thick borders
  let pathGenerator = null;
  let projection = null;
  let svg, g, zoom;

  // ── Build region lookup ───────────────────────────────────
  function buildLookup() {
    COUNTRIES.forEach(c => {
      c.subs.forEach(s => {
        regionLookup[s.id] = {
          en: s.en,
          local: s.local,
          countryIso: c.iso,
          countryEn: c.en,
          countryLocal: c.local
        };
        state[s.id] = 0;
      });
    });
  }

  // ── URL hash encode/decode ────────────────────────────────
  function encodeHash() {
    let hash = '';
    REGION_ORDER.forEach(id => {
      hash += (state[id] || 0).toString();
    });
    let url = '#' + hash;
    if (authorName) {
      url += '&n=' + encodeURIComponent(authorName);
    }
    history.replaceState(undefined, document.title, url);
  }

  function decodeHash() {
    let raw = window.location.hash.substring(1);
    // Extract name parameter if present
    const ampIdx = raw.indexOf('&');
    if (ampIdx !== -1) {
      const params = raw.substring(ampIdx + 1);
      raw = raw.substring(0, ampIdx);
      const parts = params.split('&');
      parts.forEach(p => {
        const [key, val] = p.split('=');
        if (key === 'n' && val) {
          authorName = decodeURIComponent(val);
          document.getElementById('authorName').textContent = authorName;
        }
      });
    }
    if (!raw || raw.length !== TOTAL_REGIONS) return false;
    for (let i = 0; i < TOTAL_REGIONS; i++) {
      const val = parseInt(raw[i]);
      if (isNaN(val) || val < 0 || val > 5) return false;
      state[REGION_ORDER[i]] = val;
    }
    return true;
  }

  // ── Score calculation ─────────────────────────────────────
  function calcScore() {
    let total = 0;
    REGION_ORDER.forEach(id => { total += (state[id] || 0); });
    return total;
  }

  function updateScore() {
    document.getElementById('levelScore').textContent = calcScore();
  }

  // ── Apply colors to map ───────────────────────────────────
  function applyColors() {
    REGION_ORDER.forEach(id => {
      const path = document.querySelector(`path[data-id="${id}"]`);
      if (path) {
        path.style.fill = COLORS[state[id] || 0];
      }
    });
  }

  // ── Popup ─────────────────────────────────────────────────
  const popup = document.getElementById('popup');
  const popupTitle = document.getElementById('popupTitle');

  function showPopup(regionId, x, y) {
    currentRegion = regionId;
    const info = regionLookup[regionId];
    if (!info) return;
    
    const name = currentLang === 'en' ? info.en : info.local;
    const country = currentLang === 'en' ? info.countryEn : info.countryLocal;
    popupTitle.textContent = `@ ${name}, ${country}`;

    // Highlight current level
    popup.querySelectorAll('.popup-level').forEach(btn => {
      const lvl = parseInt(btn.dataset.level);
      btn.classList.toggle('active', lvl === (state[regionId] || 0));
    });

    // Position popup
    const appRect = document.getElementById('app').getBoundingClientRect();
    let left = x + 10;
    let top = y - 10;
    
    // Keep popup in viewport
    const popupW = 200;
    const popupH = 260;
    if (left + popupW > appRect.width) left = x - popupW - 10;
    if (top + popupH > appRect.height) top = appRect.height - popupH - 10;
    if (top < 10) top = 10;
    if (left < 10) left = 10;

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.classList.add('show');
  }

  function hidePopup() {
    popup.classList.remove('show');
    currentRegion = null;
  }

  // ── Map initialization ────────────────────────────────────
  function initMap() {
    const container = document.getElementById('mapContainer');
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg = d3.select('#mapSvg')
      .attr('width', width)
      .attr('height', height);

    // Background rect
    svg.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', '#9dc3fb');

    g = svg.append('g');

    // Projection: Conic Conformal centered on Europe
    projection = d3.geoConicConformal()
      .center([15, 52])
      .rotate([-10, 0])
      .parallels([35, 65])
      .scale(Math.min(width, height) * 1.4)
      .translate([width * 0.45, height * 0.52]);

    pathGenerator = d3.geoPath().projection(projection);

    // Zoom behavior with pan constraints
    const margin = 200; // pixels of slack before hitting edge
    zoom = d3.zoom()
      .scaleExtent([0.8, 20])
      .translateExtent([[-margin, -margin], [width + margin, height + margin]])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        const k = event.transform.k;
        // Scale borders inversely so they stay readable
        g.selectAll('.country-border').attr('stroke-width', 1.8 / k);
        g.selectAll('.region-path').attr('stroke-width', 0.15 / k);
      });

    svg.call(zoom);

    // Load map data
    loadMapData();
  }

  function loadMapData() {
    const geojson = EUROPE_GEOJSON;
    geoData = geojson;
    const features = geojson.features;

    // Draw regions first (below country borders)
    const regionGroup = g.append('g').attr('class', 'regions-group');
    regionGroup.selectAll('.region-path')
      .data(features)
      .enter()
      .append('path')
      .attr('class', 'region-path')
      .attr('d', pathGenerator)
      .attr('data-id', d => d.properties.id)
      .style('fill', d => COLORS[state[d.properties.id] || 0]);

    // Draw country borders on top (non-interactive)
    // Group features by ISO country code, then draw merged outlines
    const borderGroup = g.append('g').attr('class', 'borders-group');
    const countryGroups = {};
    features.forEach(f => {
      const iso = f.properties.iso;
      if (!iso) return;
      if (!countryGroups[iso]) countryGroups[iso] = [];
      countryGroups[iso].push(f);
    });

    Object.keys(countryGroups).forEach(iso => {
      // Collect all polygons for this country into a single MultiPolygon
      const allCoords = [];
      countryGroups[iso].forEach(f => {
        const geom = f.geometry;
        if (geom.type === 'Polygon') {
          allCoords.push(geom.coordinates);
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach(poly => allCoords.push(poly));
        }
      });
      if (allCoords.length > 0) {
        borderGroup.append('path')
          .datum({ type: 'MultiPolygon', coordinates: allCoords })
          .attr('class', 'country-border')
          .attr('d', pathGenerator);
      }
    });

    // Click handler on region paths
    regionGroup.selectAll('.region-path').on('click', function(event, d) {
      event.stopPropagation();
      const regionId = d.properties.id;
      if (regionId && regionLookup[regionId]) {
        showPopup(regionId, event.clientX, event.clientY);
      }
    });
    
    // Click on SVG background closes popup
    svg.on('click', function(event) {
      if (!event.target.closest('.popup')) {
        hidePopup();
      }
    });
  }



  // ── Event handlers ────────────────────────────────────────
  function setupEvents() {
    // Close popup button
    document.getElementById('popupClose').addEventListener('click', hidePopup);

    // Level selection in popup
    popup.querySelectorAll('.popup-level').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!currentRegion) return;
        const level = parseInt(btn.dataset.level);
        state[currentRegion] = level;
        
        // Update map
        const path = document.querySelector(`path[data-id="${currentRegion}"]`);
        if (path) path.style.fill = COLORS[level];
        
        updateScore();
        encodeHash();
        hidePopup();
      });
    });

    // Language toggle
    document.getElementById('langSelect').addEventListener('change', (e) => {
      currentLang = e.target.value;
    });

    // Add Name
    document.getElementById('addNameBtn').addEventListener('click', () => {
      document.getElementById('nameInput').value = authorName;
      document.getElementById('nameModal').classList.add('show');
      document.getElementById('nameInput').focus();
    });

    document.getElementById('nameOk').addEventListener('click', () => {
      authorName = document.getElementById('nameInput').value.trim();
      document.getElementById('authorName').textContent = authorName;
      document.getElementById('nameModal').classList.remove('show');
      encodeHash();
    });

    document.getElementById('nameCancel').addEventListener('click', () => {
      document.getElementById('nameModal').classList.remove('show');
    });

    document.getElementById('nameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('nameOk').click();
      if (e.key === 'Escape') document.getElementById('nameCancel').click();
    });

    // Save Image
    document.getElementById('saveImgBtn').addEventListener('click', saveImage);

    // Zoom buttons
    document.getElementById('zoomInBtn').addEventListener('click', () => {
      svg.transition().duration(300).call(zoom.scaleBy, 1.5);
    });
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
      svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.5);
    });

    // Save URL
    document.getElementById('saveUrlBtn').addEventListener('click', () => {
      encodeHash();
      const fullUrl = window.location.href;
      navigator.clipboard.writeText(fullUrl).catch(() => {});
      document.getElementById('saveUrlField').value = fullUrl;
      document.getElementById('saveModal').classList.add('show');
    });

    document.getElementById('copyUrlBtn').addEventListener('click', () => {
      const urlField = document.getElementById('saveUrlField');
      urlField.select();
      navigator.clipboard.writeText(urlField.value).then(() => {
        document.getElementById('copyUrlBtn').textContent = 'Copied!';
        setTimeout(() => {
          document.getElementById('copyUrlBtn').textContent = 'Copy URL';
        }, 2000);
      }).catch(() => {
        document.execCommand('copy');
      });
    });

    document.getElementById('saveModalClose').addEventListener('click', () => {
      document.getElementById('saveModal').classList.remove('show');
    });

    // Reset
    document.getElementById('resetBtn').addEventListener('click', () => {
      if (confirm('Reset all regions to Level 0?')) {
        REGION_ORDER.forEach(id => { state[id] = 0; });
        applyColors();
        updateScore();
        encodeHash();
      }
    });

    // About
    document.getElementById('aboutClose').addEventListener('click', () => {
      document.getElementById('aboutModal').classList.remove('show');
    });

    // Legend drag
    const legendEl = document.getElementById('legend');
    let dragState = null;

    legendEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      legendEl.classList.add('dragging');
      const rect = legendEl.getBoundingClientRect();
      dragState = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragState) return;
      const appRect = document.getElementById('app').getBoundingClientRect();
      let x = e.clientX - appRect.left - dragState.offsetX;
      let y = e.clientY - appRect.top - dragState.offsetY;
      // Constrain within app bounds
      x = Math.max(0, Math.min(x, appRect.width - legendEl.offsetWidth));
      y = Math.max(0, Math.min(y, appRect.height - legendEl.offsetHeight));
      legendEl.style.left = x + 'px';
      legendEl.style.top = y + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragState) {
        legendEl.classList.remove('dragging');
        dragState = null;
      }
    });

    // Touch drag support
    legendEl.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      const rect = legendEl.getBoundingClientRect();
      dragState = { offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top };
      legendEl.classList.add('dragging');
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!dragState) return;
      const touch = e.touches[0];
      const appRect = document.getElementById('app').getBoundingClientRect();
      let x = touch.clientX - appRect.left - dragState.offsetX;
      let y = touch.clientY - appRect.top - dragState.offsetY;
      x = Math.max(0, Math.min(x, appRect.width - legendEl.offsetWidth));
      y = Math.max(0, Math.min(y, appRect.height - legendEl.offsetHeight));
      legendEl.style.left = x + 'px';
      legendEl.style.top = y + 'px';
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (dragState) {
        legendEl.classList.remove('dragging');
        dragState = null;
      }
    });

    // Resize
    window.addEventListener('resize', debounce(() => {
      const container = document.getElementById('mapContainer');
      const w = container.clientWidth;
      const h = container.clientHeight;
      svg.attr('width', w).attr('height', h);
      svg.select('rect').attr('width', w).attr('height', h);
      
      projection.scale(Math.min(w, h) * 1.4).translate([w * 0.45, h * 0.52]);
      zoom.translateExtent([[-200, -200], [w + 200, h + 200]]);
      g.selectAll('.region-path').attr('d', pathGenerator);
      g.selectAll('.country-border').attr('d', pathGenerator);

    }, 200));
  }

  // ── Save image ────────────────────────────────────────────
  function saveImage() {
    const svgEl = document.getElementById('mapSvg');
    // Clone the SVG so we can bake inline fill attributes without affecting the live DOM
    const clone = svgEl.cloneNode(true);
    // Bake computed fill colors into each region path as attributes
    const livePaths = svgEl.querySelectorAll('.region-path');
    const clonePaths = clone.querySelectorAll('.region-path');
    livePaths.forEach((lp, i) => {
      const fill = window.getComputedStyle(lp).fill;
      clonePaths[i].setAttribute('fill', fill);
      clonePaths[i].removeAttribute('style');
    });
    // Also bake country borders
    const liveBorders = svgEl.querySelectorAll('.country-border');
    const cloneBorders = clone.querySelectorAll('.country-border');
    liveBorders.forEach((lb, i) => {
      const cs = window.getComputedStyle(lb);
      cloneBorders[i].setAttribute('fill', 'none');
      cloneBorders[i].setAttribute('stroke', cs.stroke);
      cloneBorders[i].setAttribute('stroke-width', cs.strokeWidth);
    });
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = svgEl.clientWidth * 2;
      canvas.height = svgEl.clientHeight * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      
      // Add title and score
      ctx.fillStyle = '#222';
      ctx.font = 'bold 36px Inter, sans-serif';
      ctx.fillText(`EU Level ${calcScore()}`, 20, 45);
      
      if (authorName) {
        ctx.font = '700 22px Inter, sans-serif';
        ctx.fillStyle = '#333';
        ctx.fillText(authorName, 22, 74);
      }
      
      // Add legend at its current screen position
      const legendEl = document.getElementById('legend');
      const legendRect = legendEl.getBoundingClientRect();
      const mapRect = svgEl.getBoundingClientRect();
      const legendX = legendRect.left - mapRect.left;
      const legendTopY = legendRect.top - mapRect.top;

      const levels = [
        { label: 'Lived there', level: 5 },
        { label: 'Stayed there', level: 4 },
        { label: 'Visited there', level: 3 },
        { label: 'Alighted there', level: 2 },
        { label: 'Passed there', level: 1 },
        { label: 'Never been there', level: 0 },
      ];
      
      // Legend background
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(legendX, legendTopY, 200, 158);
      ctx.strokeStyle = '#ccc';
      ctx.strokeRect(legendX, legendTopY, 200, 158);
      
      levels.forEach((l, i) => {
        const y = legendTopY + 10 + i * 24 + 8;
        ctx.fillStyle = COLORS[l.level];
        ctx.fillRect(legendX + 8, y - 8, 20, 14);
        ctx.strokeStyle = '#999';
        ctx.strokeRect(legendX + 8, y - 8, 20, 14);
        ctx.fillStyle = '#333';
        ctx.font = '500 12px Inter, sans-serif';
        ctx.fillText(l.label, legendX + 36, y + 2);
        ctx.fillStyle = '#888';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText(`Level: ${l.level}`, legendX + 146, y + 2);
      });
      
      canvas.toBlob(function(blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `europeex-level-${calcScore()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
      
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // ── Utility ───────────────────────────────────────────────
  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  window.toggleAbout = function() {
    document.getElementById('aboutModal').classList.toggle('show');
  };

  // ── Initialize ────────────────────────────────────────────
  function init() {
    buildLookup();
    decodeHash();
    updateScore();
    initMap();
    setupEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
