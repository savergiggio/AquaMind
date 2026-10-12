# AquaMind - Sistema di Monitoraggio Acquario

Sistema completo di monitoraggio acquario con Arduino, Raspberry Pi, Docker e interfaccia web React.

## 🐟 Caratteristiche

- **Monitoraggio Real-time**: Temperatura, pH, salinità e livello acqua
- **Streaming Video**: Camera USB con live feed MJPEG
- **Controllo Dispositivi**: Luci, pompe, skimmer via web
- **Programmazione**: Timer automatici per dispositivi
- **AI Assistant**: Integrazione Gemini per diagnostica e controllo vocale
- **API REST**: Endpoints per app mobile

## 📋 Requisiti Hardware

### Raspberry Pi
- Raspberry Pi 3/4/5
- Camera USB compatibile
- Connessione Internet

### Arduino Uno
- Sensore temperatura DS18B20 (waterproof)
- Modulo pH (pH-4502C o simile)
- Sensore TDS per salinità
- Sensore ultrasonico HC-SR04 per livello acqua
- Cavo USB per collegamento a Raspberry

## 🔌 Schema Collegamento Arduino

```
Arduino Uno:
├── Pin 2       → DS18B20 Data (+ 4.7k pullup a 5V)
├── Pin A0      → pH Sensor Output
├── Pin A1      → TDS Sensor Output
├── Pin 9       → HC-SR04 Trigger
├── Pin 10      → HC-SR04 Echo
├── 5V          → Alimentazione sensori
└── GND         → Ground comune
```

## 🚀 Installazione Raspberry Pi

### 1. Clona il repository
```bash
git clone https://github.com/tuouser/AquaMind.git
cd AquaMind
```

### 2. Configura la chiave API Gemini
```bash
cp .env.example .env
nano .env
# Inserisci la tua GEMINI_API_KEY
```

### 3. Verifica dispositivi USB
```bash
# Trova la porta Arduino
ls -la /dev/ttyACM* /dev/ttyUSB*

# Trova la camera
ls -la /dev/video*

# Modifica docker-compose.yml se necessario
```

### 4. Avvia il sistema
```bash
docker-compose build
docker-compose up -d
```

### 5. Accedi all'interfaccia
Apri il browser su: `http://<ip-raspberry>:80`

## 📡 API Endpoints

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/sensors` | GET | Dati sensori attuali |
| `/api/sensors/history?hours=24` | GET | Storico dati |
| `/api/controls` | GET | Stato dispositivi |
| `/api/controls` | POST | Controlla dispositivo `{device, state}` |
| `/api/schedules` | GET | Lista programmazioni |
| `/api/schedules` | POST | Nuova programmazione |
| `/api/schedules/:id` | PUT | Modifica programmazione |
| `/api/schedules/:id` | DELETE | Elimina programmazione |
| `/api/stream` | GET | Stream video MJPEG |
| `/api/status` | GET | Stato sistema |
| `/api/gemini` | POST | Proxy Gemini API |

### Esempio API

```bash
# Leggi sensori
curl http://raspberry:80/api/sensors

# Accendi luci
curl -X POST http://raspberry:80/api/controls \
  -H "Content-Type: application/json" \
  -d '{"device":"mainLight","state":true}'

# Storico 24 ore
curl http://raspberry:80/api/sensors/history?hours=24
```

## 🔧 Arduino Setup

### Librerie Richieste
Installa tramite Arduino IDE Library Manager:
- `OneWire`
- `DallasTemperature`

### Caricamento Sketch
1. Apri `arduino/aquarium_sensors.ino` in Arduino IDE
2. Seleziona **Board: Arduino Uno**
3. Seleziona la porta COM corretta
4. Carica lo sketch
5. Apri Serial Monitor a **115200 baud** per verificare

Output atteso:
```json
{"temp":25.4,"ph":8.2,"salinity":1.025,"level":98}
```

## 🐳 Comandi Docker

```bash
# Avvia tutto
docker-compose up -d

# Visualizza log
docker-compose logs -f

# Log specifico backend
docker-compose logs -f backend

# Ferma tutto
docker-compose down

# Ricostruisci dopo modifiche
docker-compose build --no-cache
docker-compose up -d
```

## 🔍 Troubleshooting

### Arduino non rilevato
```bash
# Verifica permessi
sudo chmod 666 /dev/ttyACM0
# Oppure aggiungi utente al gruppo dialout
sudo usermod -aG dialout $USER
```

### Camera non funziona
```bash
# Verifica device
v4l2-ctl --list-devices

# Test camera
ffmpeg -f v4l2 -i /dev/video0 -frames 1 test.jpg
```

### Container non si avvia
```bash
# Verifica che i device esistano
ls -la /dev/ttyACM0 /dev/video0

# Modifica docker-compose.yml se i path sono diversi
```

## 📱 Sviluppo App Mobile

Il backend espone API REST complete utilizzabili da qualsiasi app:

```javascript
// Esempio React Native / Flutter
const API_BASE = 'http://raspberry-ip:80/api';

// GET sensori
const sensors = await fetch(`${API_BASE}/sensors`).then(r => r.json());

// POST controllo
await fetch(`${API_BASE}/controls`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ device: 'mainLight', state: true })
});
```

## 📄 Licenza

MIT License
