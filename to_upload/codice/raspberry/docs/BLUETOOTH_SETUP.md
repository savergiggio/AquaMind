# Configurazione Bluetooth per Raspberry Pi 4

Questa guida spiega come configurare il Bluetooth sul Raspberry Pi 4 per permettere ad AquaMind di controllare le lampade Chihiros via BLE.

## Problema

Il Bluetooth sul Raspberry Pi potrebbe essere disabilitato o bloccato da RF-kill, causando errori come:
- `No powered Bluetooth adapters found`
- `Operation not possible due to RF-kill`
- `PowerState: off-blocked`

## Soluzione Rapida

```bash
# Sblocca Bluetooth
sudo rfkill unblock bluetooth

# Accendi l'adattatore
sudo hciconfig hci0 up

# Verifica
hciconfig
```

Dovresti vedere `UP RUNNING` nell'output.

## Soluzione Permanente

Per evitare di dover sbloccare il Bluetooth ad ogni riavvio, crea un servizio systemd:

### 1. Crea il file del servizio

```bash
sudo nano /etc/systemd/system/bluetooth-enable.service
```

### 2. Incolla questo contenuto

```ini
[Unit]
Description=Enable Bluetooth at startup
After=bluetooth.service

[Service]
Type=oneshot
ExecStart=/usr/sbin/rfkill unblock bluetooth
ExecStartPost=/usr/bin/hciconfig hci0 up
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

### 3. Attiva il servizio

```bash
sudo systemctl daemon-reload
sudo systemctl enable bluetooth-enable.service
sudo systemctl start bluetooth-enable.service
```

### 4. Verifica

```bash
sudo systemctl status bluetooth-enable.service
hciconfig
```

## Verifica Docker

Con il Bluetooth attivo, verifica che il container lo veda:

```bash
docker exec -it aquamind-backend /app/chihiros-venv/bin/python3 /app/chihiros_wrapper.py simple_scan 5
```

Dovresti vedere una lista di dispositivi BLE trovati.

## Troubleshooting

### Verifica stato Bluetooth
```bash
sudo systemctl status bluetooth
bluetoothctl show
```

### Verifica RF-kill
```bash
sudo rfkill list
```

Se vedi `Soft blocked: yes` o `Hard blocked: yes`, usa:
```bash
sudo rfkill unblock bluetooth
```

### Verifica D-Bus
```bash
ls -la /var/run/dbus/
```

Deve mostrare `system_bus_socket`.

## Requisiti Docker

Il `docker-compose.yml` deve avere:
- `network_mode: host` (per accesso BLE)
- `privileged: true`
- Volume D-Bus montato: `/var/run/dbus:/var/run/dbus:ro`
