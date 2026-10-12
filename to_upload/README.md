<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.0.1/model-viewer.min.js"></script>

<p align="center">
  <img src="docs/banner_en.png" alt="AquaMind — aquarium monitoring system" width="920"/>
</p>

<p align="center">
  <strong>The brain of your aquarium. 🐟</strong><br>
  Real-time monitoring: <strong>temp, pH, TDS, level, camera, AI, notifications</strong>.
</p>

<p align="center">
  <strong>🇬🇧 English</strong> · <a href="README_it.md"><strong>🇮🇹 Italiano</strong></a>
</p>

<p align="center">
  <img alt="Firmware" src="https://img.shields.io/badge/firmware-2.0.0--S3-22d3ee?style=for-the-badge&logo=esp32&logoColor=white"/>
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-2563eb?style=for-the-badge&logo=docker&logoColor=white"/>
  <img alt="KiCad" src="https://img.shields.io/badge/pcb-kicad-0e9f6e?style=for-the-badge&logo=kicad&logoColor=white"/>
  <img alt="React" src="https://img.shields.io/badge/frontend-react%20%2B%20vite-61dafb?style=for-the-badge&logo=react&logoColor=black"/>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge"/>
  <a href="https://pcbway.com"><img alt="PCBs made by PCBWay" src="https://img.shields.io/badge/PCBs%20made%20by-PCBWay-00a4e0?style=for-the-badge&logoColor=white"/></a>
</p>

<p align="center">
  <sub>
  <a href="#-features">Features</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-repository-structure">Contents</a> ·
  <a href="#-interactive-3d-models">3D Models</a> ·
  <a href="#-renderings-and-underwater-camera">Renderings</a> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-api">API</a> ·
  <a href="#-components">Components</a> ·
  <a href="#-sponsor--pcbway">Sponsor · PCBWay</a>
  </sub>
</p>

---

# 🇬🇧 AquaMind


## 🐟 What is AquaMind

**AquaMind** is a complete, open-source system for monitoring and controlling a
fish tank. A microcontroller reads the submerged sensors, a Raspberry Pi acts as the
central brain (history, video, AI and notifications) and a web dashboard + mobile app
let you keep an eye on everything, even from afar.

The project covers **the entire chain**: from the sensor firmware, to the custom PCB,
to the 3D-printed case, all the way to the Docker backend and the React frontend.

### 📸 The final prototype

A photo tour of the built prototype: custom PCB, 3D-printed enclosure and all the components. **Click any photo to open it full size.**

<table>
  <tr>
    <td align="center"><a href="images/proto_01.jpg"><img src="images/proto_01.jpg" width="220" alt="PCB fabricated by PCBWay"/></a><br><sub>🏭 PCB fabricated by PCBWay</sub></td>
    <td align="center"><a href="images/proto_02.jpg"><img src="images/proto_02.jpg" width="220" alt="Components and JST connectors"/></a><br><sub>🧩 Components &amp; JST connectors</sub></td>
    <td align="center"><a href="images/proto_03.jpg"><img src="images/proto_03.jpg" width="220" alt="Wired sensors and ESP32"/></a><br><sub>🔌 Wired sensors + ESP32</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="images/proto_04.jpg"><img src="images/proto_04.jpg" width="220" alt="3D-printed enclosure with PCB"/></a><br><sub>🧊 3D-printed enclosure + PCB</sub></td>
    <td align="center"><a href="images/proto_05.jpg"><img src="images/proto_05.jpg" width="220" alt="Enclosure with OLED display"/></a><br><sub>🖥️ Enclosure with OLED display</sub></td>
    <td align="center"><a href="images/proto_06.jpg"><img src="images/proto_06.jpg" width="220" alt="3D-printed lid AQUAMIND"/></a><br><sub>🐟 3D-printed lid "AQUAMIND"</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="images/proto_07.jpg"><img src="images/proto_07.jpg" width="220" alt="Front panel TEMP PH TDS LEVEL"/></a><br><sub>🏷️ Front panel · TEMP · PH · TDS · LEVEL</sub></td>
    <td align="center"><a href="images/proto_08.jpg"><img src="images/proto_08.jpg" width="220" alt="Open enclosure with PCB inside"/></a><br><sub>📂 Open enclosure, PCB inside</sub></td>
    <td align="center"><a href="images/proto_09.jpg"><img src="images/proto_09.jpg" width="220" alt="Prototype in the aquarium"/></a><br><sub>🐠 The prototype in the aquarium</sub></td>
  </tr>
</table>

### ⚙️ Features

| Area | What it does |
|------|-------------|
| 📷 **Video** | **IMX179** camera (8MP, 1080p) inside a **repurposed transparent garden sphere**, live MJPEG streaming + night-vision mode |
| 💡 **Controls** | Lights, pump, skimmer, heater, feeder — from web and app |
| 📅 **Scheduler** | Automatic on/off schedules for every device |
| 🤖 **AI** | **Google Gemini** integration for diagnostics and control |
| 🔔 **Notifications** | **ntfy** and **Telegram** alerts when a parameter goes out of range |
| 📈 **History** | Archived data with browsable history (`/sensors/history` API) |
| 📱 **UI** | **React** dashboard + REST API for the mobile app |
| 🧩 **Home Assistant** | Custom component for **Chihiros** lights (BLE) |

---

## 🧠 Architecture

The flow is simple: the **ESP32-S3** reads the sensors and publishes them as JSON over
serial; the **Raspberry Pi** (in Docker) receives and stores them, acts as the hub for
video and controls, and pushes events to the dashboard, the app and the notification
channels.

```mermaid
flowchart LR
  subgraph Tank
    S1[DS18B20]
    S2[PH-4502C]
    S3[TDS]
    S4[RCWL-1670]
    CAM[IMX179]
  end
  S1 --> ESP[ESP32-S3]
  S2 --> ESP
  S3 --> ESP
  S4 --> ESP
  ESP -- serial JSON --> RPI[Raspberry Pi]
  CAM -- MJPEG --> RPI
  RPI --> DB[(SQLite)]
  RPI --> WEB[React Dashboard]
  RPI --> APP[Mobile App]
  RPI --> AI[Gemini AI]
  RPI --> NTF[ntfy / Telegram]
```

---

## 📦 Repository structure

The repo is organized in 4 areas, one per "layer" of the project:

```
.
├── 3D/
│   ├── case/            #    Enclosure: base, lid, sensor mounts, spacer, cap
│   ├── display/         #    display_aquamind + 53 mm glass mount (SLDPRT/STEP)
│   └── completo/        #    Main assemblies as GLB (viewable in the browser)
├── codice/
│   ├── esp32-s3/        # Sensor firmware (ESP32-S3, v2.0.0-S3)
│   └── raspberry/       # Full dockerized system (backend + frontend)
│       ├── backend/     #   Node.js: API, history, video, AI, notifications, Chihiros
│       ├── frontend/    #   React + Vite + Tailwind (dashboard)
│       ├── docs/        #   Setup notes (Bluetooth, etc.)
│       └── docker-compose.yml
├── pcb/
│   └── kicad/           # KiCad project: sch, pcb, gerber, BOM, netlist, positions
│       ├── gerber/      #   Production files (fab-ready)
│       └── production/  #   BOM, designators, IPC netlist, positions
├── rendering/           # Full-system renderings
└── docs/                # Page images and banner
```

### 🧊 1 · Case and 3D models

The mechanics are designed in **SolidWorks** (`.SLDPRT` sources) and exported as
**STEP** (neutral format for CAD/verification). In the repo you will find:

- **`3D/case/`** — the complete enclosure: base, lid, sensor mounts, spacer, cap and
  the full assembly (`AquaMind.step`).
- **`3D/display/`** — the **display housing** (`display_aquamind`) and the **53 mm
  glass mount**, the bracket that fixes the camera sphere to the tank glass.
- **`3D/completo/`** — the **main assemblies as GLB**, viewable directly in the
  browser ([Interactive 3D models](#-interactive-3d-models)).

> 💡 `.SLDPRT` are the SolidWorks sources, `.STEP` is the neutral exchange format.

### 🔲 2 · Sensor firmware (ESP32-S3)

`codice/esp32-s3/Aquamind-s3.ino` — firmware that reads the 4 sensors and publishes
them as JSON over serial/UART every 2 seconds, with a **local OLED display** and
**EEPROM-based calibration** (pH offset, TDS coefficient, level range).

- **DS18B20** → temperature (OneWire)
- **PH-4502C** → pH (ADC)
- **TDS** → salinity (ADC)
- **RCWL-1670** → water level (mmWave)
- **SSD1306** → 128×64 OLED display (I²C)

### 🍓 3 · Raspberry Pi system (Docker)

`codice/raspberry/` is the complete **dockerized** system (backend + frontend in
containers):

- **`backend/`** — **Node.js** server: REST API, serial ingest, MJPEG video streaming,
  SQLite history, controls, scheduler, **Gemini AI** proxy, **ntfy/Telegram**
  notifications and a daemon for the **Chihiros** lights (BLE).
- **`frontend/`** — **React + Vite + Tailwind** dashboard, served by **Nginx**.
- **`docker-compose.yml`** — orchestrates the two services (backend on `host`
  network for USB/BLE, frontend on port 80).
#### What the backend does (subsystems)

| Subsystem | How it works |
|----------------|---------------|
| **REST API** | Express (`server.js`) exposes the `/api/*` endpoints for the dashboard and the mobile app |
| **WebSocket** | `ws` on `/ws` → live push of sensors, device states and alerts to the dashboard |
| **Serial ingest** | `serialport` reads the JSON frames from the ESP32; one port per tank (`tankSerialPorts`) |
| **History** | `better-sqlite3` with `sensors`, `alert_log`, `schedules`, `chihiros_devices`, `maintenance_log`, `water_parameters`, `fish_inventory` tables (+ auto migrations) |
| **Video** | `child_process` + `ffmpeg` → MJPEG stream from `/dev/video0` (`/api/stream`) |
| **Scheduler** | Automatic device on/off, with active-devices lookup (`/api/schedules/active-devices`) |
| **Alerts** | Configurable thresholds and deltas, event log, notification test (`/api/alerts/*`) |
| **Notifications** | Push to **ntfy** and **Telegram** when a parameter goes out of range |
| **Chihiros BLE** | Python daemon (`chihiros_daemon.py` + `bleak`) handles scan, on/off, brightness, RGB, channels, schedules and auto-mode |
| **AI** | **Gemini** proxy (`/api/gemini`) with saved conversations and recipes |
| **Multi-tank** | Tank CRUD, remote calibration, camera settings, config export/import |
| **Firmware** | ESP32 firmware flashing over serial upload (`/api/tanks/:id/firmware`) |
| **Backup** | Database export/import (`/api/backup`, `/api/restore`) |

<details>
<summary><b>Quick start</b></summary>

```bash
cd codice/raspberry
cp backend/.env.example backend/.env   # add GEMINI_API_KEY, tokens, etc.
docker-compose build
docker-compose up -d
# Dashboard: http://<raspberry-ip>/
```

</details>

### 🛠️ 4 · PCB (KiCad)

`pcb/kicad/` contains the complete **KiCad** project of the AquaMind board:

- `AquaMind.kicad_sch` / `AquaMind.kicad_pcb` — schematic and PCB layout (2 layers)
- `gerber/` — complete production set (Cu, mask, silkscreen, paste, edge cuts, drill)
- `production/` — **BOM**, **designators**, **IPC netlist** and **positions** for
 manufacturing
- `AquaMind.step` — 3D model of the PCB

> ℹ️ In the BOM the board uses the **ESP32-C3 SuperMini** module (`U1`); the firmware
> in `codice/esp32-s3/Aquamind-s3.ino` is written for the **ESP32-S3 DevKit** — pins
> are configurable at the top of the file.

> 🏭 **The PCBs of this project are fabricated by [PCBWay](https://pcbway.com)** —
> the files in `gerber/` and `production/` are fab-order ready.

## 🏭 Sponsor · PCBWay

<p align="center">
  <a href="https://pcbway.com"><img src="https://img.shields.io/badge/PCB%20fabrication-PCBWay-00a4e0?style=for-the-badge&logoColor=white" alt="PCBs fabricated by PCBWay"/></a>
</p>

Special thanks to **[PCBWay](https://pcbway.com)**, the **official sponsor of the
project for PCB fabrication**: they produced the AquaMind board (and the prototype
revisions) straight from the Gerber set and BOM shipped in `pcb/kicad/`.

With their support the project could iterate quickly on the layout, validate the real
JST connector footprints and verify the final board.

- 📂 Fab-ready Gerbers: `pcb/kicad/gerber/`
- 📋 BOM + positions + IPC netlist: `pcb/kicad/production/`
- 🧊 3D model of the board: `pcb/kicad/AquaMind.step`

Want to build the board? Upload the Gerber set to PCBWay — the project thanks
everyone who supports the hardware pipeline. 🐟

---

## 🎮 Interactive 3D models
The three main assemblies are exported as **GLB** (binary glTF) and render
**right here, in the browser**: drag to rotate, scroll to zoom.

### 🔲 Board + sensors assembly

<model-viewer src="3D/completo/Assieme_scheda_e_sensori.glb" alt="AquaMind assembly: PCB with mounted sensors" shadow-intensity="0.5" auto-rotate auto-play style="width:100%;height:480px"></model-viewer>

### 📷 Camera assembly

 <model-viewer src="3D/completo/Assieme_telecamera.glb" alt="Aquarium camera assembly" shadow-intensity="0.5" auto-rotate auto-play camera-orbit="0deg 80deg 100%" style="width:100%;height:480px"></model-viewer>

### 🛠️ AquaMind PCB

<model-viewer src="3D/completo/scheda.glb" alt="AquaMind PCB" shadow-intensity="0.5" auto-rotate auto-play style="width:100%;height:480px"></model-viewer>

---

## 🎨 Renderings and underwater camera

Full-system renderings:

![AquaMind rendering](rendering/Acquario.png)

![AquaMind rendering 2](rendering/Acquario1.png)

### 📷 The underwater sphere

To house the camera underwater, a **transparent garden sphere** was purchased — one of
those solar-panel LED globes used for garden lighting — and **repurposed** for this
purpose: inside it sits the **IMX179** camera (8 MP, 1080p, 1/3.2″ CMOS), and the
sphere is fixed to the tank glass with the **53 mm mount** (sources in `3D/display/`).

![Night-vision camera](docs/camera.jpg)

---

## 🚀 Quick start

```bash
# 1. Clone the repo
git clone https://github.com/<your-username>/AquaMind.git
cd AquaMind

# 2. Start the Raspberry system (Docker)
cd codice/raspberry
cp backend/.env.example backend/.env
docker-compose build && docker-compose up -d

# 3. Flash the ESP32-S3 firmware (from Arduino IDE)
#    Board: ESP32S3 Dev Module · Port: /dev/ttyUSB*
```

Open the dashboard at `http://<raspberry-ip>` and you are up and running. 🐠

---

## 🔌 API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sensors` | GET | Current sensor data |
| `/api/sensors/history?hours=24` | GET | Data history |
| `/api/controls` | GET / POST | Device state / control |
| `/api/schedules` | GET / POST | Schedules |
| `/api/schedules/:id` | PUT / DELETE | Update / delete schedule |
| `/api/stream` | GET | MJPEG video stream |
| `/api/status` | GET | System status |
| `/api/gemini` | POST | Gemini AI proxy |

Example:

```bash
curl http://raspberry/api/sensors
# {"temp":25.4,"ph":8.2,"tds":120,"level":98,"fw_version":"2.0.0-S3"}

curl -X POST http://raspberry/api/controls \
  -H "Content-Type: application/json" \
  -d '{"device":"mainLight","state":true}'
```

---

## 🖼️ Components

The hardware components at the heart of the project:

| | | |
|:---:|:---:|:---:|
| <img src="docs/imx179-camera.jpg" alt="IMX179 8MP camera module" width="300"/> | <img src="docs/tds-sensor.jpg" alt="TDS probe" width="300"/> | <img src="docs/ph-sensor.jpg" alt="PH-4502C pH probe" width="300"/> |
| 🎥 **IMX179** — 8MP camera<br>night-vision in the underwater sphere | 🧪 **TDS** — salinity probe<br>ADC, EEPROM calibration | 🔬 **PH-4502C** — pH probe<br>ADC, EEPROM offset |
 | <img src="docs/ds18b20.jpg" alt="DS18B20 probe" width="300"/> | <img src="docs/rcwl-1670.jpg" alt="RCWL-1670 module" width="300"/> | <img src="3D/oled display/images.jpg" alt="SSD1306 OLED display" width="300"/> |
| 🌡️ **DS18B20** — temperature probe<br>OneWire bus | 📶 **RCWL-1670** — mmWave module<br>water-level detection | 🖥️ **OLED SSD1306** — local display<br>128×64 I²C |
| <img src="docs/esp32-s3.jpg" alt="ESP32-S3" width="300"/> | <img src="docs/raspberry-pi.jpg" alt="Raspberry Pi" width="300"/> | |
| 🧠 **ESP32-S3** — microcontroller<br>sensor reading + OLED | 🍓 **Raspberry Pi** — central hub<br>API, history, video, AI | |

---

## 📄 License

[MIT](LICENSE) — fork it, improve it, share it. 🐟
