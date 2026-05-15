class TesoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selectedDevice = null;
    this._initialized = false;
    this._currentType = null; // "pas" of "ticket"
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initCard();
    } else {
      this._updateValues();
    }
  }

  setConfig(config) {
    this._config = config;
  }

  getCardSize() {
    return 4;
  }

  _getAllDevices() {
    const hass = this._hass;
    if (!hass || !hass.states) return [];

    const devices = [];
    const passenMap = {};
    const ticketsMap = {};

    for (const entityId in hass.states) {
      const state = hass.states[entityId];
      const attrs = state ? state.attributes : {};

      // Formaat 1: sensor.gekoppeld_kenteken_{pasnummer}
      // Formaat 2: sensor.teso_pas_{pasnummer}_gekoppeld_kenteken
      const kentekenMatch =
        entityId.match(/^sensor\.gekoppeld_kenteken_(\d+)$/) ||
        entityId.match(/^sensor\.teso_pas_(\d+)_gekoppeld_kenteken/);

      const overtachtMatch =
        entityId.match(/^sensor\.laatste_overtocht_(\d+)$/) ||
        entityId.match(/^sensor\.teso_pas_(\d+)_laatste_overtocht/);

      const saldoMatch =
        entityId.match(/^sensor\.resterende_overtochten_/) ||
        entityId.match(/^sensor\.teso_pas_(\d+)_resterende_overtochten/);

      if (kentekenMatch) {
        // Pasnummer uit regex of uit attribuut
        const id = kentekenMatch[1] || (attrs.pasnummer ? String(attrs.pasnummer) : null);
        if (id) {
          if (!passenMap[id]) passenMap[id] = { id, type: "pas", name: `TESO-pas ${id}`, entities: {} };
          passenMap[id].entities.kenteken = entityId;
        }
      } else if (overtachtMatch) {
        const id = overtachtMatch[1] || (attrs.pasnummer ? String(attrs.pasnummer) : null);
        if (id) {
          if (!passenMap[id]) passenMap[id] = { id, type: "pas", name: `TESO-pas ${id}`, entities: {} };
          passenMap[id].entities.laatste_overtocht = entityId;
        }
      } else if (saldoMatch) {
        const id = (saldoMatch[1]) || (attrs.pasnummer ? String(attrs.pasnummer) : null);
        if (id) {
          if (!passenMap[id]) passenMap[id] = { id, type: "pas", name: `TESO-pas ${id}`, entities: {} };
          passenMap[id].entities.saldo = entityId;
        }
      }

      // E-tickets - zoek op ticket_nummer attribuut
      if (entityId.includes("e_ticket_saldo") || entityId.includes("ticket_saldo")) {
        if (attrs.ticket_nummer) {
          const id = String(attrs.ticket_nummer);
          const shortId = id.length > 8 ? `...${id.slice(-8)}` : id;
          if (!ticketsMap[id]) {
            ticketsMap[id] = {
              id,
              type: "ticket",
              name: `E-ticket ${shortId}`,
              entities: { saldo: entityId }
            };
          }
        }
      }
    }

    // Combineer passen en tickets gesorteerd
    const passen = Object.values(passenMap).sort((a, b) => a.id.localeCompare(b.id));
    const tickets = Object.values(ticketsMap).sort((a, b) => a.id.localeCompare(b.id));
    return [...passen, ...tickets];
  }

  _getProductIcon(productName) {
    if (!productName) return "mdi:ticket";
    const lower = productName.toLowerCase();
    if (lower.includes("voetganger")) return "mdi:walk";
    if (lower.includes("fiets") || lower.includes("bromfiets")) return "mdi:bicycle";
    if (lower.includes("lang voertuig") || lower.includes("vrachtwagen") || lower.includes("caravan")) return "mdi:truck";
    if (lower.includes("voertuig") || lower.includes("auto") || lower.includes("busje") || lower.includes("camper")) return "mdi:car";
    return "mdi:ticket";
  }

  _extractProductName(entityId) {
    if (!entityId || !this._hass) return null;
    const stateObj = this._hass.states[entityId];
    if (!stateObj) return null;
    if (stateObj.attributes.product) return stateObj.attributes.product;
    const friendlyName = stateObj.attributes.friendly_name || "";
    const match = friendlyName.match(/resterende overtochten\s*[-]\s*(.+)/i);
    if (match) return match[1].trim();
    return null;
  }

  _formatDate(dateStr) {
    if (!dateStr || dateStr === "unknown" || dateStr === "unavailable") return "-";
    try {
      const date = new Date(dateStr);
      if (isNaN(date)) return dateStr;
      return date.toLocaleString("nl-NL", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return dateStr; }
  }

  _showQrPopup(qrSrc) {
    const existing = this.shadowRoot.getElementById("qr-popup");
    if (existing) existing.remove();

    const popup = document.createElement("div");
    popup.id = "qr-popup";
    popup.innerHTML = `
      <div class="qr-overlay">
        <div class="qr-modal">
          <button class="qr-close">&#x2715;</button>
          <img src="${qrSrc}" alt="QR code" class="qr-image">
          <p class="qr-hint">Scan deze QR code bij de incheckpaal</p>
        </div>
      </div>
    `;
    this.shadowRoot.appendChild(popup);
    popup.querySelector(".qr-close").addEventListener("click", () => popup.remove());
    popup.querySelector(".qr-overlay").addEventListener("click", (e) => {
      if (e.target === popup.querySelector(".qr-overlay")) popup.remove();
    });
  }

  _initCard() {
    const devices = this._getAllDevices();
    if (devices.length === 0) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px">Geen TESO-passen gevonden.</div></ha-card>`;
      return;
    }

    if (!this._selectedDevice || !devices.find((d) => d.id === this._selectedDevice)) {
      this._selectedDevice = devices[0].id;
    }

    const dropdownOptions = devices
      .map((d) => `<option value="${d.id}" ${d.id === this._selectedDevice ? "selected" : ""}>${d.name}</option>`)
      .join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { --teso-yellow: #f5c400; --radius: 12px; }
        ha-card { border-radius: var(--radius); overflow: hidden; font-family: var(--paper-font-body1_-_font-family, sans-serif); }
        .header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px; border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.08)); }
        .header-left { display: flex; align-items: center; gap: 10px; }
        .teso-logo { font-size: 18px; font-weight: 800; letter-spacing: 3px; color: var(--primary-text-color); }
        .teso-crown { color: var(--teso-yellow); font-size: 14px; }
        select { background: var(--card-background-color, #1c1c1c); color: var(--primary-text-color); border: 1px solid var(--divider-color, rgba(255,255,255,0.15)); border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; outline: none; max-width: 200px; }
        select:focus { border-color: var(--teso-yellow); }
        .body { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 4px; }
        .row { display: flex; align-items: center; gap: 12px; padding: 10px 8px; border-radius: 8px; transition: background 0.15s; }
        .row:hover { background: var(--secondary-background-color, rgba(255,255,255,0.04)); }
        .row.clickable { cursor: pointer; }
        .row.clickable:hover { background: rgba(245,196,0,0.08); }
        .row-icon { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 8px; background: var(--secondary-background-color, rgba(255,255,255,0.06)); flex-shrink: 0; }
        .row-icon ha-icon { --mdc-icon-size: 20px; color: var(--teso-yellow); }
        .row-content { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .row-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--secondary-text-color); font-weight: 500; }
        .row-value { font-size: 15px; color: var(--primary-text-color); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .saldo-value { font-size: 22px; font-weight: 700; color: var(--teso-yellow); }
        .qr-hint-label { font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }
        .divider { height: 1px; background: var(--divider-color, rgba(255,255,255,0.06)); margin: 2px 8px; }

        /* QR Popup */
        .qr-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.75); z-index: 9999; display: flex; align-items: center; justify-content: center; }
        .qr-modal { background: var(--card-background-color, #1c1c1c); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; max-width: 320px; width: 90%; position: relative; }
        .qr-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: var(--primary-text-color); font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
        .qr-close:hover { background: rgba(255,255,255,0.1); }
        .qr-image { width: 100%; max-width: 260px; border-radius: 8px; image-rendering: pixelated; }
        .qr-hint { color: var(--secondary-text-color); font-size: 13px; text-align: center; margin: 0; }
      </style>

      <ha-card>
        <div class="header">
          <div class="header-left">
            <span class="teso-crown">&#9819;</span>
            <span class="teso-logo">TESO</span>
          </div>
          ${devices.length > 1
            ? `<select id="pas-select">${dropdownOptions}</select>`
            : `<span style="font-size:13px;color:var(--secondary-text-color)">${devices[0].name}</span>`
          }
        </div>

        <div class="body" id="card-body">
          <!-- Pas weergave -->
          <div id="pas-view">
            <div class="row row-product">
              <div class="row-icon"><ha-icon icon="mdi:card-account-details-outline"></ha-icon></div>
              <div class="row-content">
                <span class="row-label">Product</span>
                <span class="row-value" id="val-product"></span>
              </div>
            </div>
            <div class="divider divider-product"></div>
            <div class="row">
              <div class="row-icon"><ha-icon id="icon-saldo" icon="mdi:car"></ha-icon></div>
              <div class="row-content">
                <span class="row-label">Saldo</span>
                <span class="row-value saldo-value" id="val-saldo"></span>
              </div>
            </div>
            <div class="divider divider-kenteken" style="display:none"></div>
            <div class="row row-kenteken" style="display:none">
              <div class="row-icon"><ha-icon icon="mdi:license"></ha-icon></div>
              <div class="row-content">
                <span class="row-label">Kenteken</span>
                <span class="row-value" id="val-kenteken"></span>
              </div>
            </div>
            <div class="divider"></div>
            <div class="row">
              <div class="row-icon"><ha-icon icon="mdi:ferry"></ha-icon></div>
              <div class="row-content">
                <span class="row-label">Laatste overtocht</span>
                <span class="row-value" id="val-laatste"></span>
              </div>
            </div>
          </div>

          <!-- Ticket weergave -->
          <div id="ticket-view" style="display:none">
            <div class="row">
              <div class="row-icon"><ha-icon icon="mdi:card-account-details-outline"></ha-icon></div>
              <div class="row-content">
                <span class="row-label">Product</span>
                <span class="row-value" id="val-ticket-product"></span>
              </div>
            </div>
            <div class="divider"></div>
            <div class="row clickable" id="row-ticket-saldo">
              <div class="row-icon"><ha-icon id="icon-ticket-saldo" icon="mdi:ticket-confirmation"></ha-icon></div>
              <div class="row-content">
                <span class="row-label">Saldo</span>
                <span class="row-value saldo-value" id="val-ticket-saldo"></span>
                <span class="qr-hint-label">Tik om QR code te tonen</span>
              </div>
              <div class="row-icon" style="background:none"><ha-icon icon="mdi:qrcode" style="--mdc-icon-size:20px;color:var(--secondary-text-color)"></ha-icon></div>
            </div>
            <div class="divider"></div>
            <div class="row">
              <div class="row-icon"><ha-icon icon="mdi:calendar"></ha-icon></div>
              <div class="row-content">
                <span class="row-label">Aankoopdatum</span>
                <span class="row-value" id="val-ticket-datum"></span>
              </div>
            </div>
          </div>
        </div>
      </ha-card>
    `;

    const select = this.shadowRoot.getElementById("pas-select");
    if (select) {
      select.addEventListener("change", (e) => {
        this._selectedDevice = e.target.value;
        this._updateValues();
      });
    }

    this._initialized = true;
    this._updateValues();
  }

  _updateValues() {
    const hass = this._hass;
    const devices = this._getAllDevices();
    if (devices.length === 0 || !this._initialized) return;

    const device = devices.find((d) => d.id === this._selectedDevice) || devices[0];
    const root = this.shadowRoot;

    const pasView = root.getElementById("pas-view");
    const ticketView = root.getElementById("ticket-view");

    if (device.type === "ticket") {
      pasView.style.display = "none";
      ticketView.style.display = "block";

      const state = device.entities.saldo ? hass.states[device.entities.saldo] : null;
      const attrs = state ? state.attributes : {};

      const valProduct = root.getElementById("val-ticket-product");
      if (valProduct) valProduct.textContent = attrs.product || "-";

      const iconSaldo = root.getElementById("icon-ticket-saldo");
      if (iconSaldo) iconSaldo.setAttribute("icon", this._getProductIcon(attrs.product));

      const valSaldo = root.getElementById("val-ticket-saldo");
      if (valSaldo) valSaldo.textContent = state ? `${state.state} retours` : "-";

      const valDatum = root.getElementById("val-ticket-datum");
      if (valDatum) valDatum.textContent = attrs.aankoopdatum || "-";

      // QR popup klik
      const rowSaldo = root.getElementById("row-ticket-saldo");
      if (rowSaldo) {
        rowSaldo.onclick = null;
        if (attrs.qr_code) {
          rowSaldo.onclick = () => this._showQrPopup(attrs.qr_code);
        }
      }

    } else {
      pasView.style.display = "block";
      ticketView.style.display = "none";

      const { entities } = device;
      const salState = entities.saldo ? hass.states[entities.saldo] : null;
      const kentekenState = entities.kenteken ? hass.states[entities.kenteken] : null;
      const overtachtState = entities.laatste_overtocht ? hass.states[entities.laatste_overtocht] : null;

      const saldo = salState ? salState.state : "-";
      const kenteken = kentekenState ? kentekenState.state : null;
      const heeftKenteken = kenteken && kenteken !== "unknown" && kenteken !== "unavailable" && kenteken !== "";
      const laatste = overtachtState ? this._formatDate(overtachtState.state) : "-";
      const productName = this._extractProductName(entities.saldo);
      const productIcon = this._getProductIcon(productName);

      const valProduct = root.getElementById("val-product");
      const rowProduct = root.querySelector(".row-product");
      const dividerProduct = root.querySelector(".divider-product");
      if (valProduct) valProduct.textContent = productName || "";
      if (rowProduct) rowProduct.style.display = productName ? "flex" : "none";
      if (dividerProduct) dividerProduct.style.display = productName ? "block" : "none";

      const valSaldo = root.getElementById("val-saldo");
      if (valSaldo) valSaldo.textContent = `${saldo} overtochten`;

      const iconSaldo = root.getElementById("icon-saldo");
      if (iconSaldo) iconSaldo.setAttribute("icon", productIcon);

      const rowKenteken = root.querySelector(".row-kenteken");
      const dividerKenteken = root.querySelector(".divider-kenteken");
      const valKenteken = root.getElementById("val-kenteken");
      if (valKenteken) valKenteken.textContent = kenteken || "";
      if (rowKenteken) rowKenteken.style.display = heeftKenteken ? "flex" : "none";
      if (dividerKenteken) dividerKenteken.style.display = heeftKenteken ? "block" : "none";

      const valLaatste = root.getElementById("val-laatste");
      if (valLaatste) valLaatste.textContent = laatste;
    }
  }
}

customElements.define("teso-card", TesoCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "teso-card",
  name: "TESO Veerboot",
  description: "Toont TESO-pas en e-ticket informatie inclusief QR code.",
  preview: false,
});
